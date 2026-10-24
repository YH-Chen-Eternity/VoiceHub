import { createHmac, timingSafeEqual } from 'node:crypto'
import { getServerTimestamp } from './serverTime'

const DEFAULT_TTL_MS = 10 * 60 * 1000

const getSecret = () => String(process.env.MEDIA_TOKEN_SECRET || process.env.JWT_SECRET || '')

/** 为待审图片签发短期访问令牌（审核服务/Aliyun 拉图用） */
export function signMediaToken(mediaId: number, ttlMs = DEFAULT_TTL_MS): string {
  const secret = getSecret()
  if (!secret) return ''
  const exp = getServerTimestamp() + ttlMs
  const sig = createHmac('sha256', secret).update(`${mediaId}.${exp}`).digest('base64url')
  return `${exp}.${sig}`
}

export function verifyMediaToken(mediaId: number, token: unknown): boolean {
  if (typeof token !== 'string' || !getSecret()) return false
  const [expText, sig] = token.split('.')
  const exp = Number(expText)
  if (!Number.isFinite(exp) || exp <= getServerTimestamp() || !sig) return false

  const expected = createHmac('sha256', getSecret())
    .update(`${mediaId}.${exp}`)
    .digest('base64url')
  const left = Buffer.from(sig)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}
