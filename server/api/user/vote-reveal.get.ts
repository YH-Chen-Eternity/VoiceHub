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

// 读取我的点赞署名偏好（ASK=每次询问 / ANONYMOUS=总是匿名 / REVEAL=总是署名）
export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createApiError(401, 'AUTH_UNAUTHORIZED_ACCESS', '未授权访问')

  const [me] = await db
    .select({ voteRevealMode: users.voteRevealMode })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1)

  const mode = MODES.includes(me?.voteRevealMode || '') ? me!.voteRevealMode : 'ASK'
  return { success: true, data: { voteRevealMode: mode } }
})
