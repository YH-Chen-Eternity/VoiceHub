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
import { getServerTimestamp } from '~~/server/utils/serverTime'
import { delStoreIfValue, getStore, parseStoreJson, verifyStateCode } from '~~/server/utils/captchaStore'

// 注销确认：邮箱验证码通过后进入 30 天宽限期（期间登录会自动撤销）
const GRACE_DAYS = 30

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createApiError(401, 'AUTH_UNAUTHORIZED_ACCESS', '未授权访问')

  const body = await readBody(event)
  const code = (body?.code || '').toString().trim()
  if (!code) throw createApiError(400, 'DELETE_ACCOUNT_CODE_REQUIRED', '请输入邮箱验证码')

  const stateKey = `email-verify:${user.id}`
  const raw = await getStore(stateKey)
  const record = parseStoreJson<{ email: string; codeHash: string; expiresAt: number }>(raw)
  if (!record || typeof record.codeHash !== 'string') {
    throw createApiError(400, 'USER_SEND_CODE_FIRST', '请先获取邮箱验证码')
  }
  if (getServerTimestamp() > record.expiresAt) {
    await delStoreIfValue(stateKey, raw!)
    throw createApiError(400, 'USER_CODE_EXPIRED_RESEND', '验证码已过期，请重新获取')
  }
  if (!verifyStateCode(stateKey, code, record.codeHash)) {
    throw createApiError(400, 'USER_CODE_INVALID', '验证码错误')
  }
  await delStoreIfValue(stateKey, raw!)

  // 时间口径：这些列是 timestamp without time zone，存 UTC 墙钟
  const now = new Date()
  const scheduled = new Date(now.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000)

  await db
    .update(users)
    .set({
      status: 'pending_deletion',
      deletionRequestedAt: now,
      deletionScheduledAt: scheduled,
      statusChangedAt: now,
      updatedAt: now
    })
    .where(eq(users.id, user.id))

  // 发「注销申请已受理」通知邮件（失败不影响注销本身）
  try {
    const [row] = await db
      .select({ email: users.email, username: users.username })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1)
    if (row?.email) {
      const { SmtpService } = await import('~~/server/services/smtpService')
      const smtp = SmtpService.getInstance()
      await smtp.initializeSmtpConfig()
      await smtp.renderAndSend(row.email, 'account.deletion.scheduled', {
        username: row.username,
        graceDays: GRACE_DAYS,
        scheduledAt: scheduled.toLocaleString('zh-CN', { hour12: false })
      })
    }
  } catch (error: any) {
    console.error('发送注销受理邮件失败:', error)
  }

  return { success: true, graceDays: GRACE_DAYS, scheduledAt: scheduled.toISOString() }
})
