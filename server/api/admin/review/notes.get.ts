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
import { songReplayRequests, songs, users } from '~/drizzle/schema'
import { createApiError } from '~~/server/utils/apiError'

// 公开备注审核：待审= submissionNotePublicStatus = 'PENDING'
export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user || !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throw createApiError(403, 'COMMON_INSUFFICIENT_PERMISSION', '权限不足')
  }

  const songRows = await db
    .select({
      id: songs.id,
      title: songs.title,
      artist: songs.artist,
      note: songs.submissionNote,
      requesterId: songs.requesterId,
      createdAt: songs.createdAt
    })
    .from(songs)
    .where(eq(songs.submissionNotePublicStatus, 'PENDING'))
    .orderBy(desc(songs.createdAt))
    .limit(200)

  const replayRows = await db
    .select({
      id: songReplayRequests.id,
      songId: songReplayRequests.songId,
      userId: songReplayRequests.userId,
      note: songReplayRequests.submissionNote,
      createdAt: songReplayRequests.createdAt
    })
    .from(songReplayRequests)
    .where(eq(songReplayRequests.submissionNotePublicStatus, 'PENDING'))
    .orderBy(desc(songReplayRequests.createdAt))
    .limit(200)

  const songIds = [...new Set(replayRows.map((r) => r.songId))]
  const titleMap = new Map<number, string>()
  if (songIds.length > 0) {
    const titles = await db.select({ id: songs.id, title: songs.title }).from(songs).where(inArray(songs.id, songIds))
    titles.forEach((t) => titleMap.set(t.id, t.title))
  }

  const requesterIds = [...new Set([...songRows.map((s) => s.requesterId), ...replayRows.map((r) => r.userId)])].filter(Boolean)
  const nameMap = new Map<number, string>()
  if (requesterIds.length > 0) {
    const names = await db.select({ id: users.id, name: users.name, username: users.username }).from(users).where(inArray(users.id, requesterIds as number[]))
    names.forEach((n) => nameMap.set(n.id, n.name || n.username || `#${n.id}`))
  }

  return {
    success: true,
    data: {
      songs: songRows.map((s) => ({ ...s, requester: nameMap.get(s.requesterId) || '未知用户' })),
      replays: replayRows.map((r) => ({ ...r, songTitle: titleMap.get(r.songId) || `#${r.songId}`, requester: nameMap.get(r.userId) || '未知用户' }))
    }
  }
})
