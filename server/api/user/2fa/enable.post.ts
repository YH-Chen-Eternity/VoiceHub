// Modified by YH-Chen on 2026-10-17
import otplib from 'otplib'
import { sendAccountEmail, formatMailTime, notifyLoginSuccess, notifyLoginFailure } from '~~/server/utils/accountNotifications'
const { authenticator } = otplib
import { db, userIdentities, eq, and } from '~/drizzle/db'
import { createApiError } from '~~/server/utils/apiError'

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) {
    throw createApiError(401, 'AUTH_UNAUTHORIZED_ACCESS', '未授权访问')
  }
  const body = await readBody(event)
  const { token, secret } = body

  if (!token || !secret) {
    throw createApiError(400, 'USER_MISSING_CODE_OR_SECRET', '缺少验证码或密钥')
  }

  // 与登录校验一致：接受 ±1 个 TOTP 窗口（约 ±30 秒），避免启用时因跨窗口边界失败
  authenticator.options = Object.assign({}, authenticator.options, { window: 1 })
  const isValid = authenticator.check(token, secret)
  if (!isValid) {
    throw createApiError(400, 'USER_CODE_INVALID', '验证码错误')
  }

  // 检查是否已存在
  const existing = await db.query.userIdentities.findFirst({
    where: and(eq(userIdentities.userId, user.id), eq(userIdentities.provider, 'totp'))
  })

  if (existing) {
     // 更新密钥
     await db.update(userIdentities)
       .set({ providerUserId: secret })
       .where(eq(userIdentities.id, existing.id))
  } else {
    // 保存到数据库
    await db.insert(userIdentities).values({
      userId: user.id,
      provider: 'totp',
      providerUserId: secret,
      createdAt: new Date()
    })
  }

  void sendAccountEmail(user.id, 'account.2fa.enabled', { time: formatMailTime() })

  return { success: true }
})
