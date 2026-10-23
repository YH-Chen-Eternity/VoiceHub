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
import { nameChangeRequests, users } from '~/drizzle/schema'
import { createApiError } from '~~/server/utils/apiError'
import { validateUsernameFormat } from '~~/server/utils/username-policy'

// 修改登录用户名（2026-10-23 起仅保留用户名修改；真实姓名自助修改功能已下线）
// 策略：格式校验（禁中文/禁纯数字/限长）→ 唯一性校验 → 即时生效，无需审核。
// 修改成功后同步清除管理员下发的「强制更新用户名」标记，并写入历史记录。
export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createApiError(401, 'AUTH_UNAUTHORIZED_ACCESS', '未授权访问')

  const body = await readBody(event)
  const rawValue = typeof body?.value === 'string' ? body.value.trim() : ''

  const formatError = validateUsernameFormat(rawValue)
  if (formatError) throw createApiError(400, formatError.code, formatError.message)

  const [current] = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1)

  if (current?.username === rawValue) {
    throw createApiError(400, 'USERNAME_CHANGE_SAME', '新用户名与当前用户名相同')
  }

  const [dup] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, rawValue))
    .limit(1)
  if (dup) throw createApiError(409, 'USERNAME_TAKEN', '该用户名已被占用')

  // 即时生效，无需审核；同时清除管理员下发的「强制更新用户名」标记
  await db
    .update(users)
    .set({ username: rawValue, forceUsernameChange: false, updatedAt: new Date() })
    .where(eq(users.id, user.id))

  const [row] = await db
    .insert(nameChangeRequests)
    .values({
      userId: user.id,
      field: 'USERNAME',
      oldName: current?.username || null,
      newName: rawValue,
      status: 'APPROVED',
      reviewedBy: user.id,
      reviewedAt: new Date()
    })
    .returning()

  return { success: true, data: row, applied: true }
})
