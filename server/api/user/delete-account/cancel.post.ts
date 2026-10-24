// Copyright (C) 2026 YH-Chen
//
// This file is part of VoiceHub-Plus (an unofficial community edition),
// based on VoiceHub <https://github.com/laoshuikaixue/VoiceHub>.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.
import { eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { users } from '~/drizzle/schema'
import { createApiError } from '~~/server/utils/apiError'

// 撤销注销申请（登录时也会自动撤销）；reason 用于邮件说明撤销来源
export async function cancelAccountDeletion(userId: number, reason = '用户主动撤销') {
  const now = new Date()
  const [row] = await db
    .select({ email: users.email, username: users.username, status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  await db
    .update(users)
    .set({
      status: 'active',
      deletionRequestedAt: null,
      deletionScheduledAt: null,
      statusChangedAt: now,
      updatedAt: now
    })
    .where(eq(users.id, userId))

  // 仅当原本确实处于注销宽限期时才发撤销通知，避免普通调用误发
  if (row?.status === 'pending_deletion' && row.email) {
    try {
      const { SmtpService } = await import('~~/server/services/smtpService')
      const smtp = SmtpService.getInstance()
      await smtp.initializeSmtpConfig()
      await smtp.renderAndSend(row.email, 'account.deletion.cancelled', {
        username: row.username,
        reason,
        cancelledAt: now.toLocaleString('zh-CN', { hour12: false })
      })
    } catch (error: any) {
      console.error('发送注销撤销邮件失败:', error)
    }
  }
}

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createApiError(401, 'AUTH_UNAUTHORIZED_ACCESS', '未授权访问')
  await cancelAccountDeletion(user.id)
  return { success: true }
})
