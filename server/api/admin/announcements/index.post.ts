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
import { sql } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { announcements } from '~/drizzle/schema'
import { createApiError } from '~~/server/utils/apiError'

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user || !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throw createApiError(403, 'COMMON_INSUFFICIENT_PERMISSION', '权限不足')
  }

  const body = await readBody(event)
  const type = body?.type === 'IMAGE' ? 'IMAGE' : 'TEXT'
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  const imageId = Number.isInteger(Number(body?.imageId)) && Number(body?.imageId) > 0 ? Number(body.imageId) : null
  const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl.trim() : ''
  const linkUrl = typeof body?.linkUrl === 'string' ? body.linkUrl.trim() : ''
  const displayMode = body?.displayMode === 'WRAP' ? 'WRAP' : 'SCROLL'

  if (type === 'TEXT' && !text) {
    throw createApiError(400, 'ANNOUNCEMENT_TEXT_REQUIRED', '请填写公告文字')
  }
  if (type === 'IMAGE' && !imageId && !imageUrl) {
    throw createApiError(400, 'ANNOUNCEMENT_IMAGE_REQUIRED', '请上传公告图片或填写图片地址')
  }

  const [maxRow] = await db.select({ max: sql<number>`coalesce(max(${announcements.sortOrder}), 0)` }).from(announcements)

  const [row] = await db
    .insert(announcements)
    .values({
      type,
      text: text || null,
      imageId,
      imageUrl: imageUrl || null,
      linkUrl: linkUrl || null,
      displayMode,
      sortOrder: Number(maxRow?.max || 0) + 1,
      enabled: body?.enabled !== false,
      createdBy: user.id
    })
    .returning()

  return { success: true, data: row }
})
