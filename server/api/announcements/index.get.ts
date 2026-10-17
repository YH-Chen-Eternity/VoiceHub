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
import { asc, eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { announcements } from '~/drizzle/schema'

// 首页公告栏数据（公开）：只返回启用项，按 sortOrder 排序
export default defineEventHandler(async () => {
  const rows = await db
    .select()
    .from(announcements)
    .where(eq(announcements.enabled, true))
    .orderBy(asc(announcements.sortOrder), asc(announcements.id))

  return {
    success: true,
    data: rows.map((row) => ({
      id: row.id,
      type: row.type === 'IMAGE' ? 'IMAGE' : 'TEXT',
      text: row.text || '',
      imageUrl: row.imageId ? `/api/media/${row.imageId}` : row.imageUrl || '',
      linkUrl: row.linkUrl || '',
      // SCROLL=超宽滚动（默认）；WRAP=分两行完整显示
      displayMode: row.displayMode === 'WRAP' ? 'WRAP' : 'SCROLL'
    }))
  }
})
