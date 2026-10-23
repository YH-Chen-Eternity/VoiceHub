/* Modified by YH-Chen-Eternity on 2026-10-23 */

import { db, users, notifications } from '~/drizzle/db'
import { inArray } from 'drizzle-orm'
import { SmtpService } from '~~/server/services/smtpService'

// 注册通知：待审核时仅站内通知所有管理员；有邮箱时邮件通知注册结果。
// 说明：两个注册入口都在 serverless 请求内 await 本函数，若 fire-and-forget 会在请求结束后被丢弃。
// 这里的 try/catch 保证通知失败不影响注册结果。
export async function notifyRegistration(
  username: string,
  name: string,
  email: string,
  requiresApproval: boolean,
  gradeClass?: { grade?: string | null; class?: string | null }
) {
  try {
    if (requiresApproval) {
      const adminResult = await db
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.role, ['ADMIN', 'SUPER_ADMIN']))
      const adminIds = adminResult.map((u) => u.id)
      if (adminIds.length > 0) {
        const title = '新用户注册待审核'
        const message = `用户「${name}」（用户名：${username}）提交了注册申请，请前往用户管理审核。`
        await db.insert(notifications).values(
          adminIds.map((id) => ({
            userId: id,
            type: 'SYSTEM_NOTICE',
            title,
            message,
            important: false
          }))
        )
      }
    }
    if (email) {
      const smtpService = SmtpService.getInstance()
      if (await smtpService.ensureInitialized()) {
        await smtpService.renderAndSend(email, 'register', {
          title: requiresApproval ? '注册申请已提交' : '注册成功',
          message: requiresApproval
            ? `${name}，您的注册申请已提交，请耐心等待管理员审核。`
            : `${name}，恭喜您注册成功，欢迎使用 VoiceHub！`
        })
      }
    }
  } catch (error) {
    console.error('注册通知发送失败:', error)
  }
}
