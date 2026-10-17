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
import { getStore, setStore } from '~~/server/utils/captchaStore'
import { SmtpService } from '~~/server/services/smtpService'

/**
 * 账号类通知邮件统一入口。
 * 约定：邮件发送失败绝不影响主流程，只记日志。
 * 所有模板都可在后台「推送配置 → 邮件模板管理」里修改文案。
 */
export async function sendAccountEmail(
  target: number | { email?: string | null; username?: string | null },
  templateKey: string,
  data: Record<string, unknown> = {}
): Promise<boolean> {
  try {
    let email: string | null = null
    let username: string | null = null

    if (typeof target === 'number') {
      const [row] = await db
        .select({ email: users.email, username: users.username })
        .from(users)
        .where(eq(users.id, target))
        .limit(1)
      email = row?.email ?? null
      username = row?.username ?? null
    } else {
      email = target.email ?? null
      username = target.username ?? null
    }

    if (!email) return false

    const smtp = SmtpService.getInstance()
    await smtp.initializeSmtpConfig()
    return await smtp.renderAndSend(email, templateKey, { username, ...data })
  } catch (error) {
    console.error(`[通知邮件] ${templateKey} 发送失败:`, error)
    return false
  }
}

/** 格式化时间（UTC 墙钟口径下的本地展示，统一由服务端给出，避免模板里做逻辑） */
export function formatMailTime(date = new Date()): string {
  try {
    return date.toLocaleString('zh-CN', { hour12: false })
  } catch {
    return date.toISOString()
  }
}

/**
 * 登录成功提醒：30 分钟内不重复发（避免疯狂刷新时轰炸邮箱）
 */
export async function notifyLoginSuccess(
  user: { id: number; username?: string | null; email?: string | null },
  ip: string,
  userAgent?: string
): Promise<void> {
  const throttleKey = `login-alert:${user.id}`
  const recent = await getStore(throttleKey)
  if (recent) return
  await setStore(throttleKey, '1', 30 * 60)

  await sendAccountEmail(user, 'account.login.alert', {
    time: formatMailTime(),
    ip: ip || '未知',
    device: (userAgent || '').slice(0, 120)
  })
}

/**
 * 登录失败提醒：1 小时内累计 3 次密码错误时发一封
 */
export async function notifyLoginFailure(
  username: string,
  ip: string,
  failCount = 3
): Promise<void> {
  if (!username) return
  const key = `login-fail-alert:${username.toLowerCase()}`
  const raw = await getStore(key)
  const count = Number(raw || 0) + 1
  await setStore(key, String(count), 60 * 60)
  if (count !== failCount) return

  const [row] = await db
    .select({ id: users.id, email: users.email, username: users.username })
    .from(users)
    .where(eq(users.username, username))
    .limit(1)
  if (!row?.email) return

  await sendAccountEmail(row, 'account.login.failed', {
    time: formatMailTime(),
    ip: ip || '未知',
    failCount: count
  })
}
