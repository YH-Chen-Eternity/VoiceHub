import { getRouterParam } from 'h3'
import { and, count, desc, eq, isNull, ne } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import {
  communityBlocks,
  communityComments,
  communityPostLikes,
  communityPosts,
  communityResonance,
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
import { resolveCommunityLevel } from '~~/server/utils/communityLevel'

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

  // 收到的帖子点赞：只统计仍公开且未撤回的帖子
  const postLikesReceivedRows = await db
    .select({ value: count() })
    .from(communityPostLikes)
    .innerJoin(communityPosts, eq(communityPosts.id, communityPostLikes.postId))
    .where(
      and(
        eq(communityPosts.authorId, userId),
        eq(communityPosts.status, 'APPROVED'),
        isNull(communityPosts.deletedAt)
      )
    )

  // 收到的歌曲点赞：自己投稿的歌曲被他人点赞（自赞已被规则禁止，兜底排除）
  const songLikesReceivedRows = await db
    .select({ value: count() })
    .from(votes)
    .innerJoin(songs, eq(songs.id, votes.songId))
    .where(and(eq(songs.requesterId, userId), ne(votes.userId, userId)))

  const resonanceCountRows = await db
    .select({ value: count() })
    .from(communityResonance)
    .where(eq(communityResonance.userId, userId))

  // 拉黑关系：用于前端隐藏「拉黑/已拉黑」入口
  let blockedByMe = false
  let blockedMe = false
  if (!isSelf) {
    const [blockedByMeRows, blockedMeRows] = await Promise.all([
      db
        .select({ blockedId: communityBlocks.blockedId })
        .from(communityBlocks)
        .where(
          and(eq(communityBlocks.blockerId, viewer.id), eq(communityBlocks.blockedId, userId))
        )
        .limit(1),
      db
        .select({ blockerId: communityBlocks.blockerId })
        .from(communityBlocks)
        .where(
          and(eq(communityBlocks.blockerId, userId), eq(communityBlocks.blockedId, viewer.id))
        )
        .limit(1)
    ])
    blockedByMe = blockedByMeRows.length > 0
    blockedMe = blockedMeRows.length > 0
  }

  const stats = {
    posts: Number(postCountRows[0]?.value || 0),
    comments: Number(commentCountRows[0]?.value || 0),
    postLikesReceived: Number(postLikesReceivedRows[0]?.value || 0),
    songLikesReceived: Number(songLikesReceivedRows[0]?.value || 0)
  }
  const resonanceCount = Number(resonanceCountRows[0]?.value || 0)

  return {
    success: true,
    user: {
      id: target.id,
      ...buildCommunityIdentity(target, equippedTitle?.name),
      joinedAt: target.createdAt
    },
    isSelf,
    joinedAt: target.createdAt,
    titles: titleRows,
    // 称号即成就徽章，equipped 标记当前佩戴
    badges: titleRows.map((title) => ({
      id: title.id,
      name: title.name,
      description: title.description,
      equipped: title.id === profile.equippedTitleId
    })),
    equippedTitleId: profile.equippedTitleId,
    resonanceCount,
    level: resolveCommunityLevel(stats),
    favoriteSong,
    likedSongs,
    blockedByMe,
    blockedMe,
    privacy: {
      showFavorite: profile.showFavorite,
      showLikedSongs: profile.showLikedSongs,
      likesVisible: target.likesVisible
    },
    stats
  }
})
