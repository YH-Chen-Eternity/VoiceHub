/* Modified by YH-Chen-Eternity on 2026-10-23 */

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
import { purgeExpiredDeletions } from '~~/server/utils/accountPurge'
import { SmtpService } from '~~/server/services/smtpService'

// 用户审核决策：注册审核 / 注销处理 / 手动触发清理
// 注：真实姓名修改功能已于 2026-10-23 下线（用户自助改名仅保留登录用户名，即时生效无需审核）。
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
    const [target] = await db
      .select({ name: users.name, username: users.username, email: users.email })
      .from(users)
      .where(eq(users.id, id))
      .limit(1)

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

    // 注册审核结果邮件：复用 register-approved / register-rejected 模板，失败不影响审核结果
    if (target?.email) {
      const displayName = target.name || target.username || ''
      try {
        const smtp = SmtpService.getInstance()
        if (approve) {
          await smtp.renderAndSend(target.email, 'register-approved', {
            title: '注册审核已通过',
            message: `${displayName}，您的注册申请已通过审核，现在可以使用账号登录了。`
          })
        } else {
          await smtp.renderAndSend(target.email, 'register-rejected', {
            title: '注册申请未通过审核',
            message: `${displayName}，您的注册申请未通过审核${reason ? `，原因：${reason}` : ''}。如有疑问请联系管理员。`
          })
        }
      } catch (error: any) {
        console.error('注册审核结果邮件发送失败:', error)
      }
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
