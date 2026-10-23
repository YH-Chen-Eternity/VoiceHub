/* Modified by YH-Chen-Eternity on 2026-10-23 */

// Modified by YH-Chen on 2026-10-17
import { createApiError } from '~~/server/utils/apiError'
import { SERVER_ERROR_CODES } from '~~/server/config/constants'
import { getClientIP } from '~~/server/utils/ip-utils'
import { checkDistributedRateLimit } from '~~/server/utils/rateLimiter'
import { getServerTimestamp } from '~~/server/utils/serverTime'
import { SmtpService } from '~~/server/services/smtpService'
import { db } from '~/drizzle/db'
import { systemSettings } from '~/drizzle/schema'
import { checkEmailDeliverability, isPermanentRecipientFailure } from '~~/server/utils/email-deliverability'
import { getEmailDomain, getEmailDomainViolation } from '~~/server/utils/email-domain-policy'
import {
  generateEmailCode,
  storeEmailCode,
  isEmailCodeCooldownActive,
  isEmailCodeDailyLimitReached,
  cleanupExpiredEmailCodes
} from '~~/server/utils/email-verification'

const EMAIL_CODE_IP_LIMIT = 10
const EMAIL_CODE_IP_WINDOW_MS = 60 * 1000

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const clientIp = getClientIP(event)

  if (!email || !EMAIL_REGEX.test(email)) {
    throw createApiError(400, 'AUTH_EMAIL_UNREACHABLE', '邮箱格式不正确，请检查后再试')
  }

  // 注册/三方注册任一开放时允许发码（否则拒绝，避免成为邮件群发通道）
  const config = await db.query.systemSettings.findFirst()
  if (!config?.allowRegister && !config?.allowOAuthRegistration) {
    throw createApiError(403, SERVER_ERROR_CODES.AUTH_REGISTER_DISABLED, '系统未开放注册')
  }

  // IP 限流：每分钟最多 10 次
  const limitResult = await checkDistributedRateLimit(`email-code:${clientIp}`, EMAIL_CODE_IP_LIMIT, EMAIL_CODE_IP_WINDOW_MS)
  if (!limitResult.isAllowed) {
    const waitSeconds = Math.ceil((limitResult.resetTime - getServerTimestamp()) / 1000)
    throw createApiError(429, SERVER_ERROR_CODES.AUTH_RATE_LIMITED_SECONDS, `操作过于频繁，请 ${waitSeconds} 秒后再试`, { params: [waitSeconds] })
  }

  // 域名策略：仅主流邮箱、禁一次性邮箱。明确告知原因，避免"提示已发送却永远收不到"。
  // 放在限流与注册开关之后，防止绕过频控探测策略。
  const domainViolation = getEmailDomainViolation(email)
  if (domainViolation) {
    console.warn(
      `[email-policy] blocked registration code for domain: ${getEmailDomain(email) || 'invalid'}`
    )
    throw createApiError(400, domainViolation.code, domainViolation.message)
  }

  // 域名收信能力预检：把「域名写错/根本收不到邮件」提前变成明确提示，
  // 否则学生只会看到"已发送"却永远等不到验证码（2026-10-11）
  const deliverability = await checkEmailDeliverability(email)
  if (!deliverability.ok) {
    throw createApiError(
      400,
      'AUTH_EMAIL_UNREACHABLE',
      '该邮箱无法接收邮件，请检查邮箱地址是否写错（域名不存在或没有邮件服务）'
    )
  }

  // 同邮箱 60 秒冷却
  if (await isEmailCodeCooldownActive(email)) {
    throw createApiError(429, SERVER_ERROR_CODES.AUTH_EMAIL_CODE_COOLDOWN, '验证码发送过于频繁，请 1 分钟后再试')
  }

  // 同一邮箱每日发送上限
  if (await isEmailCodeDailyLimitReached(email)) {
    throw createApiError(429, SERVER_ERROR_CODES.AUTH_EMAIL_CODE_DAILY_LIMIT, '今日验证码发送次数已达上限，请明天再试')
  }

  // 邮件服务可用性检查
  const smtpService = SmtpService.getInstance()
  if (!(await smtpService.ensureInitialized())) {
    throw createApiError(503, SERVER_ERROR_CODES.AUTH_EMAIL_SERVICE_UNAVAILABLE, '邮件服务未配置或不可用，请联系管理员')
  }

  // 先发邮件，发送成功后才落码（失败不落码，也不触发冷却）
  const code = generateEmailCode()
  const sent = await smtpService.renderAndSend(email, 'verification.code', {
    title: 'VoiceHub 注册邮箱验证',
    // 补 builtin verification 模板所需变量（code 必填）
    name: '用户',
    email,
    code,
    expiresInMinutes: 5
  })

  if (!sent) {
    // 收件人被服务端永久拒绝（收件人不存在/地址非法）→ 明确告诉学生邮箱有问题，而不是让他一直重试
    if (isPermanentRecipientFailure(smtpService.getLastSendFailure())) {
      throw createApiError(
        400,
        'AUTH_EMAIL_UNREACHABLE',
        '该邮箱无法接收邮件，请检查邮箱地址是否写错（该地址在邮件服务商处不存在）'
      )
    }
    throw createApiError(503, SERVER_ERROR_CODES.AUTH_EMAIL_SERVICE_UNAVAILABLE, '验证码邮件发送失败，请稍后重试')
  }

  cleanupExpiredEmailCodes()
  await storeEmailCode(email, code)

  return { success: true }
})
