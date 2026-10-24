import { readBody } from 'h3'
import { and, eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityProfiles, communityTitles, communityUserTitles, songs } from '~/drizzle/schema'
import { ensureCommunityProfile, requireCommunityUser } from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'

export default defineEventHandler(async (event) => {
  const user = requireCommunityUser(event)
  await ensureCommunityProfile(user.id)
  const body = await readBody(event)

  const patch: Record<string, unknown> = { updatedAt: new Date() }

  if (body && Object.prototype.hasOwnProperty.call(body, 'favoriteSongId')) {
    if (body.favoriteSongId == null || body.favoriteSongId === '') {
      patch.favoriteSongId = null
    } else {
      const songId = Number(body.favoriteSongId)
      if (!Number.isInteger(songId) || songId <= 0) {
        throw createApiError(400, 'COMMUNITY_SONG_INVALID', '歌曲参数不正确')
      }
      const song = await db.select({ id: songs.id }).from(songs).where(eq(songs.id, songId)).limit(1)
      if (!song[0]) throw createApiError(404, 'SONG_NOT_FOUND', '歌曲不存在')
      patch.favoriteSongId = songId
    }
  }

  if (typeof body?.showFavorite === 'boolean') patch.showFavorite = body.showFavorite
  if (typeof body?.showLikedSongs === 'boolean') patch.showLikedSongs = body.showLikedSongs

  if (Object.prototype.hasOwnProperty.call(body || {}, 'equippedTitleId')) {
    if (body.equippedTitleId == null || body.equippedTitleId === '') {
      patch.equippedTitleId = null
    } else {
      const titleId = Number(body.equippedTitleId)
      if (!Number.isInteger(titleId) || titleId <= 0) {
        throw createApiError(400, 'COMMUNITY_TITLE_INVALID', '称号参数不正确')
      }
      const granted = await db
        .select({ titleId: communityUserTitles.titleId })
        .from(communityUserTitles)
        .innerJoin(communityTitles, eq(communityTitles.id, communityUserTitles.titleId))
        .where(
          and(eq(communityUserTitles.userId, user.id), eq(communityUserTitles.titleId, titleId))
        )
        .limit(1)
      if (!granted[0]) throw createApiError(403, 'COMMUNITY_TITLE_NOT_OWNED', '你还没有获得这个称号')
      patch.equippedTitleId = titleId
    }
  }

  const [updated] = await db
    .update(communityProfiles)
    .set(patch)
    .where(eq(communityProfiles.userId, user.id))
    .returning()

  return {
    success: true,
    profile: {
      favoriteSongId: updated?.favoriteSongId ?? null,
      showFavorite: updated?.showFavorite ?? true,
      showLikedSongs: updated?.showLikedSongs ?? true,
      equippedTitleId: updated?.equippedTitleId ?? null
    }
  }
})
