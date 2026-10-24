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
import { and, eq, sql } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import {
  nameChangeRequests,
  notificationSettings,
  notifications,
  songs,
  userIdentities,
  users,
  votes
} from '~/drizzle/schema'
import { getServerTimestamp } from '~~/server/utils/serverTime'
import { getStore, setStore } from '~~/server/utils/captchaStore'

/**
 * 30 天宽限期后清理自助注销账号。
 *
 * 规则（站长定的）：注销后数据库不立即删除 → 保留 30 天 → 30 天内没有登录，才真正清理。
 * 宽限期内登录会自动撤销注销（见 login.post.ts），所以这里只会处理"确实不再回来"的账号。
 *
 * 清理动作：
 *   1. 投稿改挂到「已注销用户」占位账号（Song.requesterId 是 NOT NULL，且没有外键，不能置空）
 *   2. 投票 / 站内信 / 通知设置 / 第三方绑定 / 改名申请 一并删除
 *   3. 删除账号行；若被外键（如点歌券使用日志）拦住，则退化为「匿名化」：
 *      用户名改名、姓名置为「已注销用户」、邮箱与密码清空、状态置 withdrawn
 */
const THROTTLE_KEY = 'account-purge:last-run'
const THROTTLE_MS = 12 * 60 * 60 * 1000
const GRACE_DAYS = 30

async function ensurePlaceholderUserId(): Promise<number> {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, '__deleted_user__'))
    .limit(1)
  if (existing) return existing.id

  const [created] = await db
    .insert(users)
    .values({
      username: '__deleted_user__',
      name: '已注销用户',
      role: 'USER',
      password: '!deleted-placeholder-no-login!',
      status: 'withdrawn',
      remark: '系统占位账号：承接已注销用户的投稿'
    })
    .returning({ id: users.id })

  if (!created) {
    throw new Error('无法创建已注销用户占位账号')
  }
  return created.id
}

export interface PurgeResult {
  ran: boolean
  purged: number
  anonymized: number
  candidates: { id: number; username: string }[]
}

export async function purgeExpiredDeletions(options: { force?: boolean } = {}): Promise<PurgeResult> {
  if (!options.force) {
    const last = await getStore(THROTTLE_KEY)
    if (last && getServerTimestamp() - Number(last) < THROTTLE_MS) {
      return { ran: false, purged: 0, anonymized: 0, candidates: [] }
    }
  }
  await setStore(THROTTLE_KEY, String(getServerTimestamp()), 7 * 24 * 60 * 60)

  // 列存 UTC 墙钟，所以用 (now() at time zone 'UTC') 比较
  const rows = await db
    .select({ id: users.id, username: users.username, email: users.email })
    .from(users)
    .where(
      and(
        eq(users.status, 'pending_deletion'),
        sql`coalesce("deletionRequestedAt", "statusChangedAt") < (now() at time zone 'UTC') - interval '${sql.raw(String(GRACE_DAYS))} days'`
      )
    )

  let purged = 0
  let anonymized = 0

  for (const row of rows) {
    try {
      // 清理前先发最后一封通知（此时账号信息还在）
      if (row.email) {
        try {
          const { SmtpService } = await import('~~/server/services/smtpService')
          const smtp = SmtpService.getInstance()
          await smtp.initializeSmtpConfig()
          await smtp.renderAndSend(row.email, 'account.deletion.completed', {
            username: row.username,
            deletedAt: new Date().toLocaleString('zh-CN', { hour12: false })
          })
        } catch (error: any) {
          console.error(`[账号清理] #${row.id} 发送注销完成邮件失败:`, error)
        }
      }

      const placeholderId = await ensurePlaceholderUserId()
      await db.update(songs).set({ requesterId: placeholderId }).where(eq(songs.requesterId, row.id))
      await db.delete(votes).where(eq(votes.userId, row.id)).catch(() => {})
      await db.delete(notifications).where(eq(notifications.userId, row.id)).catch(() => {})
      await db.delete(notificationSettings).where(eq(notificationSettings.userId, row.id)).catch(() => {})
      await db.delete(nameChangeRequests).where(eq(nameChangeRequests.userId, row.id)).catch(() => {})
      await db.delete(userIdentities).where(eq(userIdentities.userId, row.id)).catch(() => {})

      await db.delete(users).where(eq(users.id, row.id))
      purged += 1
    } catch (error: any) {
      // 外键拦住（例如点歌券使用日志 RESTRICT）→ 退化为匿名化，保证个人信息一定被清掉
      console.error(`[账号清理] #${row.id} 删除失败，退化为匿名化:`, error)
      try {
        await db
          .update(users)
          .set({
            username: `deleted_${row.id}`,
            name: '已注销用户',
            email: null,
            emailVerified: false,
            password: '!deleted-account!',
            status: 'withdrawn',
            deletionRequestedAt: null,
            deletionScheduledAt: null,
            updatedAt: new Date()
          })
          .where(eq(users.id, row.id))
        anonymized += 1
      } catch (inner: any) {
        console.error(`[账号清理] #${row.id} 匿名化也失败:`, inner)
      }
    }
  }

  return { ran: true, purged, anonymized, candidates: rows }
}
