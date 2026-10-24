import { getRouterParam } from 'h3'
import { and, count, desc, eq, isNull } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import {
  communityComments,
  communityPosts,
  communityProfiles,
  communityTitles,
  communityUserTitles,
  songs,
  users,
  votes
} from '~/drizzle/schema'
import {
  buildCommunityIdentity,
  ensureCommunityProfile,
  getCommunitySettings,
  isCommunityReviewer,
  requireCommunityUser
} from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'

export default defineEventHandler(async (event) => {
  const viewer = requireCommunityUser(event)
  const settings = await getCommunitySettings()
  if (!settings.enabled && !isCommunityReviewer(viewer)) {
    throw createApiError(403, 'COMMUNITY_DISABLED', '回声社区暂未开放')
  }

  const userId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(userId) || userId <= 0) {
    throw createApiError(400, 'COMMUNITY_USER_INVALID', '用户参数不正确')
  }

  const userRows = await db
    .select({
      id: users.id,
      name: users.name,
      grade: users.grade,
      class: users.class,
      likesVisible: users.likesVisible,
      createdAt: users.createdAt
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  const target = userRows[0]
  if (!target) throw createApiError(404, 'USER_NOT_FOUND', '用户不存在')

  const profile = await ensureCommunityProfile(userId)
  const isSelf = viewer.id === userId

  const titleRows = await db
    .select({ id: communityTitles.id, name: communityTitles.name, description: communityTitles.description })
    .from(communityUserTitles)
    .innerJoin(communityTitles, eq(communityTitles.id, communityUserTitles.titleId))
    .where(eq(communityUserTitles.userId, userId))

  const equippedTitle = titleRows.find((title) => title.id === profile.equippedTitleId) || null

  const showFavorite = isSelf || profile.showFavorite
  const showLikedSongs = isSelf || (profile.showLikedSongs && target.likesVisible)

  let favoriteSong = null
  if (showFavorite && profile.favoriteSongId) {
    const rows = await db
      .select({
        id: songs.id,
        title: songs.title,
        artist: songs.artist,
        cover: songs.cover,
        played: songs.played
      })
      .from(songs)
      .where(eq(songs.id, profile.favoriteSongId))
      .limit(1)
    favoriteSong = rows[0] || null
  }

  let likedSongs: any[] | null = null
  if (showLikedSongs) {
    const rows = await db
      .select({
        id: songs.id,
        title: songs.title,
        artist: songs.artist,
        cover: songs.cover,
        played: songs.played,
        likedAt: votes.createdAt
      })
      .from(votes)
      .innerJoin(songs, eq(songs.id, votes.songId))
      .where(eq(votes.userId, userId))
      .orderBy(desc(votes.createdAt))
      .limit(60)
    likedSongs = rows
  }

  const postCountRows = await db
    .select({ value: count() })
    .from(communityPosts)
    .where(
      and(
        eq(communityPosts.authorId, userId),
        eq(communityPosts.status, 'APPROVED'),
        isNull(communityPosts.deletedAt)
      )
    )
  const commentCountRows = await db
    .select({ value: count() })
    .from(communityComments)
    .where(
      and(
        eq(communityComments.authorId, userId),
        eq(communityComments.status, 'APPROVED'),
        isNull(communityComments.deletedAt)
      )
    )

  return {
    success: true,
    user: {
      id: target.id,
      ...buildCommunityIdentity(target, equippedTitle?.name),
      joinedAt: target.createdAt
    },
    isSelf,
    titles: titleRows,
    equippedTitleId: profile.equippedTitleId,
    favoriteSong,
    likedSongs,
    privacy: {
      showFavorite: profile.showFavorite,
      showLikedSongs: profile.showLikedSongs,
      likesVisible: target.likesVisible
    },
    stats: {
      posts: Number(postCountRows[0]?.value || 0),
      comments: Number(commentCountRows[0]?.value || 0)
    }
  }
})
