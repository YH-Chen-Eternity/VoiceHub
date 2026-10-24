/* Modified by YH-Chen-Eternity on 2026-10-23 */

import { createError, defineEventHandler, readBody } from 'h3'
import { checkDistributedRateLimit } from '~~/server/utils/rateLimiter'

export default defineEventHandler(async (event) => {
  try {
    // 仅登录用户可用，并按用户限流：防止把本接口当作向任意 MeoW 昵称
    // 批量推送自定义文本的中继通道（2026-10-23 安全加固：原实现无任何频率限制）
    const user = event.context.user
    if (!user) {
      throw createError({ statusCode: 401, message: '未授权访问' })
    }
    const limitResult = await checkDistributedRateLimit(`meow_verify:${user.id}`, 5, 60 * 60 * 1000)
    if (!limitResult.isAllowed) {
      throw createError({ statusCode: 429, message: '发送过于频繁，请稍后再试' })
    }

    const body = await readBody(event)
    const { nickname, verificationCode } = body

    if (!nickname || !verificationCode) {
      throw createError({
        statusCode: 400,
        message: '昵称和验证码不能为空'
      })
    }

    // 验证昵称格式
    if (nickname.includes('/')) {
      throw createError({
        statusCode: 400,
        message: '昵称不能包含斜杠'
      })
    }

    // 验证码仅允许 4-10 位字母数字：绑定码本身由服务端生成，
    // 限制字符形态可阻断借本接口中继任意文本（2026-10-23 安全加固）
    if (!/^[A-Za-z0-9]{4,10}$/.test(String(verificationCode))) {
      throw createError({
        statusCode: 400,
        message: '验证码格式不正确'
      })
    }

    // 发送验证码到 MeoW
    const message = `VoiceHub 账号绑定验证码：${verificationCode}`
    const title = 'VoiceHub 账号绑定'

    // 使用 GET 请求发送验证码
    const meowUrl = `https://api.chuckfang.com/${encodeURIComponent(nickname)}/${encodeURIComponent(title)}/${encodeURIComponent(message)}`

    const response = await fetch(meowUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'VoiceHub/1.0'
      }
    })

    if (!response.ok) {
      throw createError({
        statusCode: 500,
        message: '发送验证码失败，请检查昵称是否正确'
      })
    }

    const result = await response.json()

    if (result.status !== 200) {
      throw createError({
        statusCode: 500,
        message: result.message || '发送验证码失败'
      })
    }

    return {
      success: true,
      message: '验证码发送成功'
    }
  } catch (error: any) {
    console.error('发送 MeoW 验证码失败:', error)

    if (error.statusCode) {
      throw error
    }

    throw createError({
      statusCode: 500,
      message: '发送验证码失败，请稍后重试'
    })
  }
})
