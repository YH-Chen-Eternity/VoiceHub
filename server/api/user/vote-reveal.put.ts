/*
Copyright (C) 2026 YH-Chen

This file is part of VoiceHub-Plus (an unofficial community edition),
based on VoiceHub <https://github.com/laoshuikaixue/VoiceHub>.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
*/
import { eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { users } from '~/drizzle/schema'
import { createApiError } from '~~/server/utils/apiError'

const MODES = ['ASK', 'ANONYMOUS', 'REVEAL']

// 保存我的点赞署名偏好
export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createApiError(401, 'AUTH_UNAUTHORIZED_ACCESS', '未授权访问')

  const body = await readBody(event)
  const mode = String(body?.voteRevealMode || '')
  if (!MODES.includes(mode)) throw createApiError(400, 'COMMON_INVALID_PARAMS', '参数错误')

  await db.update(users).set({ voteRevealMode: mode, updatedAt: new Date() }).where(eq(users.id, user.id))
  return { success: true, data: { voteRevealMode: mode } }
})
