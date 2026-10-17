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
import { and, eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { nameChangeRequests, users } from '~/drizzle/schema'
import { createApiError } from '~~/server/utils/apiError'
import { validateRealName } from '~~/server/utils/register-validation'

// 提交真实姓名修改申请（需管理员审核通过后才生效）
export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createApiError(401, 'AUTH_UNAUTHORIZED_ACCESS', '未授权访问')

  const body = await readBody(event)
  const newName = typeof body?.name === 'string' ? body.name.trim() : ''

  const nameError = validateRealName(newName)
  if (nameError) throw createApiError(400, nameError.code, nameError.message)

  const [current] = await db.select({ name: users.name }).from(users).where(eq(users.id, user.id)).limit(1)
  if (current?.name === newName) {
    throw createApiError(400, 'NAME_CHANGE_SAME', '新姓名与当前姓名相同')
  }

  const [pending] = await db
    .select({ id: nameChangeRequests.id })
    .from(nameChangeRequests)
    .where(and(eq(nameChangeRequests.userId, user.id), eq(nameChangeRequests.status, 'PENDING')))
    .limit(1)
  if (pending) {
    throw createApiError(409, 'NAME_CHANGE_PENDING', '已有一条待审核的改名申请，请等待管理员处理')
  }

  const [row] = await db
    .insert(nameChangeRequests)
    .values({ userId: user.id, oldName: current?.name || null, newName, status: 'PENDING' })
    .returning()

  return { success: true, data: row }
})
