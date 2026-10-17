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
import { announcements } from '~/drizzle/schema'
import { createApiError } from '~~/server/utils/apiError'

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user || !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throw createApiError(403, 'COMMON_INSUFFICIENT_PERMISSION', '权限不足')
  }
  const id = Number(event.context.params?.id || getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw createApiError(400, 'COMMON_INVALID_PARAMS', '参数错误')

  const body = await readBody(event)
  const patch: Record<string, unknown> = { updatedAt: new Date() }

  if (body?.type !== undefined) patch.type = body.type === 'IMAGE' ? 'IMAGE' : 'TEXT'
  if (body?.text !== undefined) patch.text = String(body.text || '').trim() || null
  if (body?.imageId !== undefined) {
    const n = Number(body.imageId)
    patch.imageId = Number.isInteger(n) && n > 0 ? n : null
  }
  if (body?.imageUrl !== undefined) patch.imageUrl = String(body.imageUrl || '').trim() || null
  if (body?.linkUrl !== undefined) patch.linkUrl = String(body.linkUrl || '').trim() || null
  if (body?.displayMode !== undefined) patch.displayMode = body.displayMode === 'WRAP' ? 'WRAP' : 'SCROLL'
  if (body?.enabled !== undefined) patch.enabled = body.enabled === true
  if (body?.sortOrder !== undefined) {
    const n = Number(body.sortOrder)
    if (Number.isFinite(n)) patch.sortOrder = Math.trunc(n)
  }

  const [row] = await db.update(announcements).set(patch).where(eq(announcements.id, id)).returning()
  if (!row) throw createApiError(404, 'ANNOUNCEMENT_NOT_FOUND', '公告不存在')
  return { success: true, data: row }
})
