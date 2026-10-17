// Modified by YH-Chen on 2026-10-17
import { db } from '~/drizzle/db'
import { users } from '~/drizzle/schema'
import { eq, sql } from 'drizzle-orm'
import { checkEmailDeliverability, isPermanentRecipientFailure } from '~~/server/utils/email-deliverability'
import { SmtpService } from '~~/server/services/smtpService'
import { getClientIP } from '~~/server/utils/ip-utils'
import { getServerTimestamp } from '~~/server/utils/serverTime'
import { delStoreIfValue, hashStateCode, setStore } from '~~/server/utils/captchaStore'
import { randomInt } from 'node:crypto'
import { createApiError } from '~~/server/utils/apiError'

function generateCode(): string {
  return randomInt(100000, 1000000).toString()
}

export async function sendEmailVerificationCode(
  userId: number,
  email: string,
  name?: string,
  ipAddress?: string,
  templateKey = 'verification.code'
) {
  const code = generateCode()
  const expiresAt = getServerTimestamp() + 5 * 60 * 1000
  const stateKey = `email-verify:${userId}`
  const storedValue = JSON.stringify({
    email,
    codeHash: hashStateCode(stateKey, code),
    expiresAt
  })
  await setStore(stateKey, storedValue, 5 * 60)

  const smtp = SmtpService.getInstance()
  await smtp.initializeSmtpConfig()
  let sent = false
  try {
    sent = await smtp.renderAndSend(
      email,
      templateKey,
      {
        name: name || '用户',
        email,
        code,
        expiresInMinutes: 5
      },
      ipAddress
    )
  } catch (error) {
    await delStoreIfValue(stateKey, storedValue)
    throw error
  }
  if (!sent) {
    await delStoreIfValue(stateKey, storedValue)
    // 收件人被永久拒绝（地址不存在/非法）→ 明确提示邮箱有问题
    if (isPermanentRecipientFailure(smtp.getLastSendFailure())) {
      throw createApiError(400, 'AUTH_EMAIL_UNREACHABLE', '该邮箱无法接收邮件，请检查邮箱地址是否写错')
    }
    throw createApiError(500, 'USER_CODE_SEND_FAILED', '验证码发送失败，请稍后重试')
  }
}

export default defineEventHandler(async (event) => {
  if (getMethod(event) !== 'POST') {
    throw createApiError(405, 'HTTP_METHOD_NOT_ALLOWED', '方法不被允许')
  }

  const user = event.context.user
  if (!user) {
    throw createApiError(401, 'AUTH_UNAUTHORIZED_ACCESS', '未授权访问')
  }

  const body = await readBody(event)
  const emailRaw = (body?.email || '').toString().trim().toLowerCase()
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  if (!emailRaw || !emailRegex.test(emailRaw)) {
    throw createApiError(400, 'AUTH_EMAIL_UNREACHABLE', '邮箱格式不正确，请检查后再试')
  }

  // 域名收信能力预检（同注册发码，避免"发不出去却提示已发送"）
  const deliverability = await checkEmailDeliverability(emailRaw)
  if (!deliverability.ok) {
    throw createApiError(
      400,
      'AUTH_EMAIL_UNREACHABLE',
      '该邮箱无法接收邮件，请检查邮箱地址是否写错（域名不存在或没有邮件服务）'
    )
  }

  // 确认邮箱未被其他用户占用
  const existing = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${emailRaw} and btrim(coalesce(${users.email}, '')) <> ''`)
    .limit(1)
  const existingUser = existing[0]
  if (existingUser && existingUser.id !== user.id) {
    throw createApiError(400, 'USER_EMAIL_TAKEN', '该邮箱已被其他用户绑定')
  }

  // 写入/更新邮箱，标记未验证
  await db.update(users).set({ email: emailRaw, emailVerified: false }).where(eq(users.id, user.id))

  // 获取客户端IP地址
  const clientIP = getClientIP(event)

  // 发送邮件验证码
  await sendEmailVerificationCode(user.id, emailRaw, user.name, clientIP)

  return { success: true, message: '验证码已发送，请查收邮箱' }
})
