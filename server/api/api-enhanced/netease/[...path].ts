// Modified by YH-Chen on 2026-10-17
import { JWTEnhanced } from '~~/server/utils/jwt-enhanced'
import { db } from '~/drizzle/db'
import { users } from '~/drizzle/schema'
import { eq } from 'drizzle-orm'
import { getRequestIP } from 'h3'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const neteaseEnhancedApiPromise = import('@neteasecloudmusicapienhanced/api').then((mod) => {
  return (mod.default || {}) as Record<string, (params: Record<string, any>) => Promise<any>>
})

// xeapi 公钥缓存文件路径（由 generateConfig 写入系统临时目录）
const xeapiPublicKeyPath = join(tmpdir(), 'xeapi_public_key')

let ncmConfigReady = false
let ncmConfigPromise: Promise<void> | null = null

const ensureNcmConfig = (): Promise<void> => {
  if (ncmConfigReady) return Promise.resolve()
  if (!ncmConfigPromise) {
    ncmConfigPromise = import('@neteasecloudmusicapienhanced/api/generateConfig.js')
      .then((mod) => (mod.default || mod)())
      .then(() => {
        if (existsSync(xeapiPublicKeyPath)) {
          ncmConfigReady = true
          console.log('[Netease] xeapi 公钥初始化完成')
        } else {
          console.error('[Netease] xeapi 公钥生成失败，下次请求将重试')
        }
      })
      .catch((error: unknown) => {
        console.error('[Netease] xeapi 配置初始化失败:', error)
      })
      .finally(() => {
        ncmConfigPromise = null
      })
  }
  return ncmConfigPromise
}

// 预热配置，不阻塞启动
ensureNcmConfig()

const normalizeParams = (input: Record<string, any>) => {
  const output: Record<string, any> = {}
  for (const [key, value] of Object.entries(input || {})) {
    if (value === undefined || value === null || value === '') {
      continue
    }
    output[key] = Array.isArray(value) ? value[value.length - 1] : value
  }
  return output
}

export default defineEventHandler(async (event) => {
  const rawPath = getRouterParam(event, 'path')
  const endpointPath = Array.isArray(rawPath) ? rawPath.join('/') : rawPath
  const method = getMethod(event)

  if (!endpointPath) {
    throw createError({
      statusCode: 400,
      message: '缺少网易云接口路径'
    })
  }

  if (!/^[a-z0-9/-]+$/i.test(endpointPath)) {
    throw createError({
      statusCode: 400,
      message: '网易云接口路径不合法'
    })
  }

  const action = endpointPath.replace(/\//g, '_').replace(/-/g, '_')
  const api = await neteaseEnhancedApiPromise
  const handler = api[action]

  if (typeof handler !== 'function') {
    throw createError({
      statusCode: 404,
      message: `未找到接口: ${endpointPath}`
    })
  }

  const queryParams = normalizeParams(getQuery(event))
  let bodyParams: Record<string, any> = {}

  if (method !== 'GET') {
    const body = await readBody(event).catch(() => ({}))
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      bodyParams = normalizeParams(body as Record<string, any>)
    }
  }

  const params = { ...queryParams, ...bodyParams }


  // 广播站播放端白名单：请求 IP 命中白名单、且客户端没带 Cookie 时注入账号 Cookie，

  // 让播放端稳定用会员直链；其他来源（学生）不受影响（白名单为空时不注入，默认安全）

  const sharedCookie = String(process.env.NETEASE_SHARE_COOKIE || '').trim()

  const sharedIps = String(process.env.NETEASE_SHARE_IPS || '')

    .split(',')

    .map((ip) => ip.trim())

    .filter(Boolean)


  // 内网 IP 经 Cloudflare/FRP 后不可见，因此再按「登录账号」识别播放端：

  // 管理员/超管登录后的请求自动带上账号 Cookie（学生账号不会）

  if (sharedCookie && !params.cookie) {

    try {

      const token = getCookie(event, 'auth-token') || ''

      if (token) {

        const { valid, payload } = JWTEnhanced.verifyAndRefresh(token)

        const uid = valid && payload ? Number((payload as any).userId) : 0

        if (uid) {

          const [row] = await db

            .select({ role: users.role, voteRevealMode: users.voteRevealMode })

            .from(users)

            .where(eq(users.id, uid))

            .limit(1)

          if (row && ['ADMIN', 'SUPER_ADMIN'].includes(row.role)) params.cookie = sharedCookie

        }

      }

    } catch {

      // 识别失败则不注入，保持匿名（安全）

    }

  }

  if (sharedCookie && !params.cookie && sharedIps.length > 0) {

    let clientIp = ''

    try {

      clientIp = getRequestIP(event, { xForwardedFor: true }) || ''

    } catch {

      clientIp = ''

    }

    if (sharedIps.some((ip) => ip === clientIp)) params.cookie = sharedCookie

  }

  // 等待 xeapi 公钥等配置就绪
  await ensureNcmConfig()

  try {
    const result = await handler(params)
    if (Array.isArray(result?.cookie) && result.cookie.length > 0) {
      setHeader(event, 'set-cookie', result.cookie)
    }
    if (typeof result?.status === 'number') {
      setResponseStatus(event, result.status)
    }
    return result?.body ?? result
  } catch (error: any) {
    // 上游模块以 { status, body: { code, msg } } 形态抛出失败，真实原因在 body.msg
    const upstream = error?.body ?? null
    const upstreamMessage = upstream?.msg || upstream?.message || error?.message
    console.warn(`[Netease] ${endpointPath} 调用失败: ${error?.status || 500} ${upstreamMessage}`)
    throw createError({
      statusCode: error?.statusCode || error?.status || 500,
      message: upstreamMessage || '网易云接口调用失败',
      data: { endpoint: endpointPath, upstream }
    })
  }
})
