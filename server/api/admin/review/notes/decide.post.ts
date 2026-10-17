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
import { songReplayRequests, songs } from '~/drizzle/schema'
import { createApiError } from '~~/server/utils/apiError'
import { SUBMISSION_NOTE_STATUS } from '~~/server/config/constants'

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user || !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throw createApiError(403, 'COMMON_INSUFFICIENT_PERMISSION', '权限不足')
  }

  const body = await readBody(event)
  const kind = body?.kind === 'replay' ? 'replay' : 'song'
  const id = Number(body?.id)
  const approve = body?.approve === true
  if (!Number.isInteger(id) || id <= 0) throw createApiError(400, 'COMMON_INVALID_PARAMS', '参数错误')

  const status = approve ? SUBMISSION_NOTE_STATUS.APPROVED : SUBMISSION_NOTE_STATUS.REJECTED

  if (kind === 'song') {
    await db
      .update(songs)
      .set({ submissionNotePublicStatus: status, submissionNotePublic: approve })
      .where(eq(songs.id, id))
  } else {
    await db
      .update(songReplayRequests)
      .set({ submissionNotePublicStatus: status, submissionNotePublic: approve })
      .where(eq(songReplayRequests.id, id))
  }

  return { success: true }
})
