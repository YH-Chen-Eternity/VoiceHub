// Modified by YH-Chen on 2026-10-17
import { db } from '~/drizzle/db'
import { sendAccountEmail, formatMailTime, notifyLoginSuccess, notifyLoginFailure } from '~~/server/utils/accountNotifications'
import { users } from '~/drizzle/schema'
import { eq } from 'drizzle-orm'
import { createApiError } from '~~/server/utils/apiError'

export default defineEventHandler(async (event) => {
  // 检查请求方法
  if (getMethod(event) !== 'POST') {
    throw createApiError(405, 'HTTP_METHOD_NOT_ALLOWED', '方法不被允许')
  }

  // 检查用户认证
  const user = event.context.user

  if (!user) {
    throw createApiError(401, 'AUTH_UNAUTHORIZED_ACCESS', '未授权访问')
  }

  try {
    const [before] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1)

    // 解绑邮箱
    await db
      .update(users)
      .set({
        email: null,
        emailVerified: false,
        emailVerifiedAt: null
      })
      .where(eq(users.id, user.id))

    void sendAccountEmail(user.id, 'account.email.unbound', {
      oldEmail: before?.email || '（原邮箱）',
      time: formatMailTime()
    })

    return {
      success: true,
      message: '邮箱已解绑'
    }
  } catch (error) {
    console.error('解绑邮箱失败:', error)

    throw createApiError(500, 'USER_EMAIL_UNBIND_FAILED', '解绑邮箱失败')
  }
})
