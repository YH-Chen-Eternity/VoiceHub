/* Modified by YH-Chen-Eternity on 2026-10-23 */

// Modified by YH-Chen on 2026-10-17
import { getServerTimestamp } from './serverTime'

// 简易的内存限流器实现，带有最大容量限制防止内存溢出
// 如果项目扩展为多实例/Serverless，建议替换为 Redis 或基于数据库的实现

interface RateLimitRecord {
  count: number
  resetTime: number
}

const MAX_STORE_SIZE = 10000 // 最大允许存储的IP记录数
const REDIS_ERROR_LOG_INTERVAL_MS = 60 * 1000
const store = new Map<string, RateLimitRecord>()
let lastRedisErrorLogTime = 0
const DISTRIBUTED_RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if count == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`

/**
 * 检查并增加限流计数
 * @param key 限流的唯一键 (如 IP、用户名等)
 * @param limit 在指定时间窗口内允许的最大请求数
 * @param windowMs 时间窗口大小（毫秒）
 * @returns { isAllowed: boolean, remaining: number, resetTime: number }
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): { isAllowed: boolean; remaining: number; resetTime: number } {
  const now = getServerTimestamp()
  let record = store.get(key)

  if (!record || now > record.resetTime) {
    // 防止内存溢出：如果达到上限，清理部分旧数据
    if (store.size >= MAX_STORE_SIZE) {
      cleanupRateLimits(true)
    }

    // 记录不存在或已过期，重置计数
    record = {
      count: 1,
      resetTime: now + windowMs
    }
    store.set(key, record)
    return { isAllowed: true, remaining: limit - 1, resetTime: record.resetTime }
  }

  // 记录未过期，增加计数
  record.count++
  const remaining = Math.max(0, limit - record.count)
  const isAllowed = record.count <= limit

  return { isAllowed, remaining, resetTime: record.resetTime }
}

/**
 * 优先使用 Redis 执行跨实例限流，Redis 不可用时回退到当前进程内存。
 * 适用于需要在多实例或 Serverless 环境中保持一致计数的敏感接口。
 *
 * ⚠️ 本站策略：**不按 IP 精确限流**（校园网 NAT 下大量学生共享出口 IP，
 * 按 IP 计数会把整个学校当成一个人，造成「莫名其妙被限流」）。IP 维度的键
 * 走宽松硬上限（见下方 IP_SCOPED_RATE_LIMIT_HARD_CAPS），正常流量不受影响，
 * 仅拦脚本化洪水。按用户/按插件维度的限流保持不变
 * （music-plugins:<key>、card_code_validate_user_*:<userId>）。
 */
const IP_SCOPED_RATE_LIMIT_PREFIXES = [
  'register',
  'email-code',
  'captcha_fetch',
  'captcha_precheck',
  'forgot_password_ip',
  'reset_password_ip',
  'card_code_validate_ip_hourly',
  'plugin-media'
]

const isIpScopedRateLimitKey = (key: string) =>
  IP_SCOPED_RATE_LIMIT_PREFIXES.some((prefix) => key.startsWith(`${prefix}:`))

/**
 * IP 维度限流的宽松硬上限（2026-10-23 安全加固）。
 *
 * 背景：本站策略是不按 IP 精确限流（校园 NAT 下大量学生共享出口 IP，按 IP 计数
 * 会把整所学校当成一个人）。原实现直接把 IP 键全部放行，但调用方传入的限额
 * 若被调得过大（注册曾配到 100 万/小时），限流即形同虚设，匿名脚本可无限
 * 注册/发验证码/轰炸 SMTP。
 *
 * 方案：对 IP 键取 min(调用方限额, 硬上限)。硬上限取正常 NAT 流量峰值的数倍：
 * 正常调用方的限额远低于硬上限，行为完全不变；只有被调大的限额会被压回硬上限，
 * 脚本化洪水仍能被拦住，真实用户永不被误伤。
 */
const IP_SCOPED_RATE_LIMIT_HARD_CAPS: Record<string, number> = {
  register: 500, // 原调用方限额 100 万/小时，压回 500/小时
  'email-code': 500, // 调用方 10/分钟，不受影响
  captcha_fetch: 500, // 调用方 100/10 分钟，不受影响
  captcha_precheck: 500,
  forgot_password_ip: 200, // 调用方 5/小时，不受影响
  reset_password_ip: 200, // 调用方 10/小时，不受影响
  card_code_validate_ip_hourly: 500,
  'plugin-media': 500 // 调用方 120/分钟，不受影响
}
const DEFAULT_IP_SCOPED_HARD_CAP = 500

const getIpScopedHardCap = (key: string): number => {
  const prefix = IP_SCOPED_RATE_LIMIT_PREFIXES.find((p) => key.startsWith(`${p}:`))
  return (prefix && IP_SCOPED_RATE_LIMIT_HARD_CAPS[prefix]) || DEFAULT_IP_SCOPED_HARD_CAP
}

export async function checkDistributedRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ isAllowed: boolean; remaining: number; resetTime: number }> {
  // IP 维度键不精确限流，但压回宽松硬上限，防止限额被调大后形同虚设
  const effectiveLimit = isIpScopedRateLimitKey(key)
    ? Math.min(limit, getIpScopedHardCap(key))
    : limit

  try {
    const redisModule = await import('./redis')
    const client = await redisModule.getRedisClient()

    if (client) {
      const redisKey = redisModule.buildRedisKey('ratelimit', key)
      const result = await client.eval(DISTRIBUTED_RATE_LIMIT_SCRIPT, {
        keys: [redisKey],
        arguments: [String(windowMs)]
      })
      if (!Array.isArray(result) || result.length < 2) {
        throw new Error('Redis 限流脚本返回了无效结果')
      }

      const count = Number(result[0])
      const ttl = Math.max(0, Number(result[1]))
      if (!Number.isFinite(count) || !Number.isFinite(ttl)) {
        throw new Error('Redis 限流脚本返回了无效计数')
      }

      return {
        isAllowed: count <= effectiveLimit,
        remaining: Math.max(0, effectiveLimit - count),
        resetTime: getServerTimestamp() + ttl
      }
    }

    if (redisModule.isRedisConfigured()) {
      throw new Error('Redis 分布式限流服务当前不可用')
    }
  } catch (error: any) {
    const now = Date.now()
    if (now - lastRedisErrorLogTime >= REDIS_ERROR_LOG_INTERVAL_MS) {
      console.error('[RateLimit] Redis 限流失败，已回退到内存限流', error)
      lastRedisErrorLogTime = now
    }
  }

  return checkRateLimit(key, effectiveLimit, windowMs)
}

/**
 * 清理过期的限流记录
 * @param force 如果为 true，在没有过期数据时也会强制删除最旧的记录
 */
export function cleanupRateLimits(force = false) {
  const now = getServerTimestamp()
  let deletedCount = 0

  for (const [key, record] of store.entries()) {
    if (now > record.resetTime) {
      store.delete(key)
      deletedCount++
    }
  }

  // 如果强制清理且没有过期数据可删，则一次性删除 10% 的最早插入记录
  // 避免高并发下 Map 始终满载导致频繁触发清理逻辑
  if (force && deletedCount === 0 && store.size > 0) {
    const itemsToDelete = Math.ceil(MAX_STORE_SIZE * 0.1)
    const keys = store.keys()

    for (let i = 0; i < itemsToDelete; i++) {
      const key = keys.next().value
      if (key !== undefined) {
        store.delete(key)
      } else {
        break
      }
    }
  }
}

// 尝试设置定时清理器，但在 Serverless 环境中可能不会按预期工作，所以主要依赖惰性清理
if (typeof setInterval !== 'undefined') {
  setInterval(() => cleanupRateLimits(false), 60 * 60 * 1000)
}
