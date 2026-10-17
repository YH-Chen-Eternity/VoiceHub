// Modified by YH-Chen on 2026-10-17
import { db } from '~/drizzle/db'
import { users } from '~/drizzle/schema'
import { eq, sql } from 'drizzle-orm'
import { createApiError } from '~~/server/utils/apiError'
import { checkEmailDeliverability } from '~~/server/utils/email-deliverability'

export default defineEventHandler(async (event) => {
  // 检查请求方法
  if (event.method !== 'POST') {
    throw createApiError(405, 'HTTP_METHOD_NOT_ALLOWED', '方法不被允许')
  }

  // 检查用户认证
  const user = event.context.user

  if (!user) {
    throw createApiError(401, 'AUTH_UNAUTHORIZED_ACCESS', '未授权访问')
  }

  try {
    const body = await readBody(event)

    // 验证邮箱格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!body.email || !emailRegex.test(body.email)) {
      throw createApiError(400, 'USER_INVALID_EMAIL', '请输入有效的邮箱地址')
    }

    const email = body.email.trim().toLowerCase()

    // 域名收信能力预检：先拦住"域名写错/收不到邮件"的地址，避免存进来还发不出验证码
    const deliverability = await checkEmailDeliverability(email)
    if (!deliverability.ok) {
      throw createApiError(
        400,
        'AUTH_EMAIL_UNREACHABLE',
        '该邮箱无法接收邮件，请检查邮箱地址是否写错（域名不存在或没有邮件服务）'
      )
    }

    // 检查邮箱是否已被其他用户绑定
    // 大小写不敏感地查重（邮箱唯一由 DB 唯一索引 + 这里共同保证）
    const existingUser = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email} and btrim(coalesce(${users.email}, '')) <> ''`)
      .limit(1)

    if (existingUser.length > 0 && existingUser[0].id !== user.id) {
      throw createApiError(400, 'USER_EMAIL_TAKEN', '该邮箱已被其他用户绑定')
    }

    // 更新用户邮箱
    await db
      .update(users)
      .set({
        email: email,
        emailVerified: false
      })
      .where(eq(users.id, user.id))

    // 发送邮箱验证码
    try {
      const { sendEmailVerificationCode } = await import('~~/server/api/user/email/send-code.post')
      const { getClientIP } = await import('~~/server/utils/ip-utils')
      const clientIP = getClientIP(event)

      await sendEmailVerificationCode(user.id, email, user.name, clientIP)
    } catch (emailError: any) {
      console.error('发送邮箱验证码失败:', emailError)
      // 邮箱不可达这类业务错误必须让前端看到，否则用户以为"已发送"却永远收不到
      if (emailError?.statusCode) throw emailError
    }

    return {
      success: true,
      message: '验证码已发送，请查收邮箱并输入验证码完成验证'
    }
  } catch (error: any) {
    console.error('绑定邮箱失败:', error)

    if (error?.statusCode) {
      throw error
    }

    throw createApiError(500, 'USER_EMAIL_BIND_FAILED', '绑定邮箱失败')
  }
})
