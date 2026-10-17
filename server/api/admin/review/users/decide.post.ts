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
import { nameChangeRequests, users } from '~/drizzle/schema'
import { createApiError } from '~~/server/utils/apiError'
import { purgeExpiredDeletions } from '~~/server/utils/accountPurge'

// 用户审核决策：注册审核 / 改名审核 / 注销处理 / 手动触发清理
export default defineEventHandler(async (event) => {
  const operator = event.context.user
  if (!operator || !['ADMIN', 'SUPER_ADMIN'].includes(operator.role)) {
    throw createApiError(403, 'COMMON_INSUFFICIENT_PERMISSION', '权限不足')
  }

  const body = await readBody(event)
  const kind = String(body?.kind || '')
  const approve = body?.approve === true
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
  const now = new Date()

  if (kind === 'purge') {
    const result = await purgeExpiredDeletions({ force: true })
    return { success: true, result }
  }

  const id = Number(body?.id)
  if (!Number.isInteger(id) || id <= 0) throw createApiError(400, 'COMMON_INVALID_PARAMS', '参数错误')

  if (kind === 'register') {
    await db
      .update(users)
      .set({
        status: approve ? 'active' : 'rejected',
        statusChangedAt: now,
        statusChangedBy: operator.id,
        remark: reason || undefined,
        updatedAt: now
      })
      .where(eq(users.id, id))
    return { success: true }
  }

  if (kind === 'name') {
    const [request] = await db.select().from(nameChangeRequests).where(eq(nameChangeRequests.id, id)).limit(1)
    if (!request || request.status !== 'PENDING') {
      throw createApiError(404, 'NAME_CHANGE_NOT_PENDING', '该改名申请不存在或已处理')
    }
    if (approve) {
      await db.update(users).set({ name: request.newName, updatedAt: now }).where(eq(users.id, request.userId))
    }
    await db
      .update(nameChangeRequests)
      .set({ status: approve ? 'APPROVED' : 'REJECTED', reason: reason || null, reviewedBy: operator.id, reviewedAt: now })
      .where(eq(nameChangeRequests.id, id))

    // 邮件通知申请人（失败不影响审核结果）——模板可在后台「推送配置 → 通知模板」修改
    try {
      const [target] = await db
        .select({ email: users.email, username: users.username })
        .from(users)
        .where(eq(users.id, request.userId))
        .limit(1)
      if (target?.email) {
        const { SmtpService } = await import('~~/server/services/smtpService')
        const smtp = SmtpService.getInstance()
        await smtp.initializeSmtpConfig()
        await smtp.renderAndSend(
          target.email,
          approve ? 'account.nameChange.approved' : 'account.nameChange.rejected',
          {
            username: target.username,
            oldName: request.oldName || '未填写',
            newName: request.newName,
            reason
          }
        )
      }
    } catch (emailError) {
      console.error('发送姓名修改审核邮件失败:', emailError)
    }

    return { success: true }
  }

  if (kind === 'deletion') {
    if (approve) {
      // 管理员同意立即清理：把请求时间提前到 31 天前，随后由清理逻辑处理
      await db
        .update(users)
        .set({
          deletionRequestedAt: new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000),
          deletionScheduledAt: now,
          updatedAt: now
        })
        .where(eq(users.id, id))
      const result = await purgeExpiredDeletions({ force: true })
      return { success: true, result }
    }
    await db
      .update(users)
      .set({
        status: 'active',
        deletionRequestedAt: null,
        deletionScheduledAt: null,
        statusChangedAt: now,
        statusChangedBy: operator.id,
        updatedAt: now
      })
      .where(eq(users.id, id))
    return { success: true }
  }

  throw createApiError(400, 'COMMON_INVALID_PARAMS', '未知的审核类型')
})
