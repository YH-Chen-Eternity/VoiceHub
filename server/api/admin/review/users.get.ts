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
import { desc, eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { users } from '~/drizzle/schema'
import { createApiError } from '~~/server/utils/apiError'
import { purgeExpiredDeletions } from '~~/server/utils/accountPurge'

// 用户审核：注册待审核 + 待注销账号（顺带跑一次逾期的注销清理）
// 注：真实姓名修改功能已于 2026-10-23 下线，不再有改名待审列表。
export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user || !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throw createApiError(403, 'COMMON_INSUFFICIENT_PERMISSION', '权限不足')
  }

  const purge = await purgeExpiredDeletions()

  const pendingUsers = await db
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      grade: users.grade,
      class: users.class,
      email: users.email,
      createdAt: users.createdAt
    })
    .from(users)
    .where(eq(users.status, 'pending'))
    .orderBy(desc(users.createdAt))
    .limit(200)

  const deletionRows = await db
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      email: users.email,
      deletionRequestedAt: users.deletionRequestedAt,
      deletionScheduledAt: users.deletionScheduledAt
    })
    .from(users)
    .where(eq(users.status, 'pending_deletion'))
    .orderBy(desc(users.deletionRequestedAt))
    .limit(200)

  return {
    success: true,
    data: {
      registrations: pendingUsers,
      deletions: deletionRows,
      purge
    }
  }
})
