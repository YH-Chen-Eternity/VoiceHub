/* Modified by YH-Chen-Eternity on 2026-10-23 */

/*
Copyright (C) 2026 YH-Chen

This file is part of VoiceHub-Plus (an unofficial community edition),
based on VoiceHub <https://github.com/laoshuikaixue/VoiceHub>.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
*/
import { createApiError } from '~~/server/utils/apiError'
import { SERVER_ERROR_CODES } from '~~/server/config/constants'
import { getClientIP } from '~~/server/utils/ip-utils'
import { checkDistributedRateLimit } from '~~/server/utils/rateLimiter'

/**
 * 播放直链解析（服务端 + 缓存）
 *
 * 目的：
 * 1. 同一首歌全站只解析一次（TTL 20 分钟），显著减少上游请求、避免被限流
 * 2. 服务端多源兜底（vkeys / meting 公共源），不依赖任何用户账号
 * 3. 命中缓存时秒开
 */

const CACHE_TTL = 20 * 60 * 1000
const cache = new Map<string, { url: string; source: string; expireAt: number }>()

const PRUNE_THRESHOLD = 800

function pruneCache() {
  if (cache.size < PRUNE_THRESHOLD) return
  const now = Date.now()
  for (const [key, entry] of cache) {
    if (entry.expireAt <= now) cache.delete(key)
  }
}

async function fetchWithTimeout(url: string, timeout = 8000, init: RequestInit = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: 'manual' })
  } finally {
    clearTimeout(timer)
  }
}

// 网易 CDN 不返回 CORS 头，浏览器 <audio crossorigin=anonymous> 无法直接加载，
// 统一改写为同源代理 /audio-proxy/<host>/<path>（nginx 白名单仅放行 *.music.126.net）
function wrapNeteaseProxy(url: string) {
  const m = String(url || '').match(/^https?:\/\/([^\/?#]+)(\/?[^#]*)$/i)
  if (!m) return url
  const host = m[1].toLowerCase()
  if (!/(^|\.)music\.126\.net$/.test(host) && !/(^|\.)music\.163\.com$/.test(host)) return url
  return '/audio-proxy/' + host + m[2]
}

function isPlayable(url: string) {
  return /^https?:\/\//i.test(url || '') && !/\.(jpg|jpeg|png|webp|gif)$/i.test(url)
}

/** vkeys 公共音源（免登录） */
async function tryVkeys(platform: string, musicId: string, quality: number) {
  const p = platform === 'tencent' ? 'tencent' : 'netease'
  const url = `https://api.vkeys.cn/v2/music/${p}?id=${encodeURIComponent(musicId)}&quality=${Number.isFinite(quality) ? quality : 4}`
  try {
    const res = await fetchWithTimeout(url, 8000, { headers: { accept: 'application/json' } })
    if (!res.ok) return null
    const json: any = await res.json().catch(() => null)
    const candidate =
      json?.data?.url || json?.data?.link || (Array.isArray(json?.data) ? json.data[0]?.url : null)
    if (typeof candidate === 'string' && isPlayable(candidate)) return { url: candidate, source: 'vkeys' }
  } catch {
    // 忽略，继续尝试下一个源
  }
  return null
}

/** meting 公共代理（免登录，返回 302 到音频地址） */
async function tryMeting(platform: string, musicId: string) {
  if (platform !== 'netease') return null
  const endpoints = [
    `https://api.injahow.cn/meting/?type=url&id=${encodeURIComponent(musicId)}`,
    `https://api.qijieya.cn/meting/?type=url&id=${encodeURIComponent(musicId)}`
  ]
  for (const endpoint of endpoints) {
    try {
      const res = await fetchWithTimeout(endpoint, 8000)
      const location = res.headers.get('location')
      if (location && isPlayable(location)) return { url: location, source: 'meting' }
      if (res.ok) {
        const text = await res.text().catch(() => '')
        const match = text.match(/https?:\/\/[^\s"'\\]+?\.(?:mp3|flac|m4a|aac)[^\s"'\\]*/i)
        if (match && isPlayable(match[0])) return { url: match[0], source: 'meting' }
      }
    } catch {
      // 继续下一个
    }
  }
  return null
}

export default defineEventHandler(async (event) => {
  const rateLimit = await checkDistributedRateLimit(
    `music_resolve:${getClientIP(event)}`,
    600,
    60 * 1000
  )
  if (!rateLimit.isAllowed) {
    throw createApiError(
      429,
      SERVER_ERROR_CODES.COMMON_RATE_LIMITED_SECONDS,
      '解析请求过于频繁，请稍后重试'
    )
  }

  const body = await readBody(event).catch(() => ({}) as any)
  const platform = String(body?.platform || '').toLowerCase()
  const musicId = String(body?.musicId ?? '').trim()
  const quality = Number(body?.quality)

  if (!platform || !musicId) {
    throw createApiError(400, 'COMMON_INVALID_PARAMS', '缺少音乐平台或歌曲 ID')
  }
  if (!['netease', 'netease-podcast', 'tencent'].includes(platform)) {
    throw createApiError(400, 'COMMON_INVALID_PARAMS', '不支持的平台')
  }

  const key = `${platform}:${musicId}:${Number.isFinite(quality) ? quality : 4}`
  const cached = cache.get(key)
  if (cached && cached.expireAt > Date.now()) {
    return { success: true, data: { url: wrapNeteaseProxy(cached.url), source: cached.source, cached: true } }
  }

  const attempts = [
    () => tryVkeys(platform, musicId, quality),
    () => tryMeting(platform, musicId)
  ]

  for (const attempt of attempts) {
    const hit = await attempt()
    if (hit) {
      pruneCache()
      cache.set(key, { ...hit, expireAt: Date.now() + CACHE_TTL })
      return { success: true, data: { url: wrapNeteaseProxy(hit.url), source: hit.source, cached: false } }
    }
  }

  return { success: false, message: '暂无可用音源' }
})
