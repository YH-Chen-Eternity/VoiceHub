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
import { desc, eq, inArray } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { nameChangeRequests, users } from '~/drizzle/schema'
import { createApiError } from '~~/server/utils/apiError'
import { purgeExpiredDeletions } from '~~/server/utils/accountPurge'

// 用户审核：注册待审核 + 改名待审核 + 待注销账号（顺带跑一次逾期的注销清理）
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

  const nameRows = await db
    .select()
    .from(nameChangeRequests)
    .where(eq(nameChangeRequests.status, 'PENDING'))
    .orderBy(desc(nameChangeRequests.createdAt))
    .limit(200)

  const nameUserIds = [...new Set(nameRows.map((n) => n.userId))]
  const infoMap = new Map<number, { username: string; name: string | null; grade: string | null; class: string | null }>()
  if (nameUserIds.length > 0) {
    const rows = await db
      .select({ id: users.id, username: users.username, name: users.name, grade: users.grade, class: users.class })
      .from(users)
      .where(inArray(users.id, nameUserIds))
    rows.forEach((r) => infoMap.set(r.id, { username: r.username, name: r.name, grade: r.grade, class: r.class }))
  }

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
      nameChanges: nameRows.map((n) => ({ ...n, user: infoMap.get(n.userId) || null })),
      deletions: deletionRows,
      purge
    }
  }
})
