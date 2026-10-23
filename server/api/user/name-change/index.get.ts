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
import { and, desc, eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { nameChangeRequests } from '~/drizzle/schema'
import { createApiError } from '~~/server/utils/apiError'

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createApiError(401, 'AUTH_UNAUTHORIZED_ACCESS', '未授权访问')

  // 返回最近一条用户名修改记录（即时生效，无待审状态；真实姓名修改功能已下线）
  const [latest] = await db
    .select()
    .from(nameChangeRequests)
    .where(and(eq(nameChangeRequests.userId, user.id), eq(nameChangeRequests.field, 'USERNAME')))
    .orderBy(desc(nameChangeRequests.createdAt))
    .limit(1)

  return { success: true, data: latest || null }
})
