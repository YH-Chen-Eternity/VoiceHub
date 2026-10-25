import { getRouterParam } from 'h3'
import { eq, sql } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityPostViews, communityPosts, communityProfiles } from '~/drizzle/schema'
import {
  getReviewableBoardIds,
  isCommunityAdmin,
  isCommunityReviewer,
  requireCommunityUser
} from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'
import { getCommunityPostById } from '~~/server/utils/communityFeed'

export default defineEventHandler(async (event) => {
  const user = requireCommunityUser(event)
  const postId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(postId) || postId <= 0) {
    throw createApiError(400, 'COMMUNITY_POST_INVALID', '帖子参数不正确')
  }

  const post = await getCommunityPostById(postId, user.id)
  if (!post) throw createApiError(404, 'COMMUNITY_POST_NOT_FOUND', '帖子不存在')

  // 审帖员只能读取自己负责板块的未公开帖子
  const scopedBoardIds = await getReviewableBoardIds(user)
  const canReviewBoard = !scopedBoardIds || scopedBoardIds.includes(post.board.id)
  const privileged = canReviewBoard && (isCommunityReviewer(user) || isCommunityAdmin(user))
  if (post.status !== 'APPROVED' && post.author.id !== user.id && !privileged) {
    throw createApiError(404, 'COMMUNITY_POST_NOT_FOUND', '帖子不存在')
  }

  // 影子封禁：仅作者本人与管理员/审帖员可见
  if (!privileged && post.author.id !== user.id) {
    const [shadow] = await db
      .select({ shadowBanned: communityProfiles.shadowBanned })
      .from(communityProfiles)
      .where(eq(communityProfiles.userId, post.author.id))
      .limit(1)
    if (shadow?.shadowBanned) {
      throw createApiError(404, 'COMMUNITY_POST_NOT_FOUND', '帖子不存在')
    }
  }

  // 观看人数：同一用户对同一帖子只计一次（数据库唯一键去重，重启/多实例都不会重复计数）
  let counted = false
  if (post.status === 'APPROVED') {
    try {
      const inserted = await db
        .insert(communityPostViews)
        .values({ postId, userId: user.id })
        .onConflictDoNothing()
        .returning({ postId: communityPostViews.postId })
      counted = inserted.length > 0
    } catch {
      counted = false
    }
  }
  if (counted) {
    const [updated] = await db
      .update(communityPosts)
      .set({ viewCount: sql`${communityPosts.viewCount} + 1` })
      .where(eq(communityPosts.id, postId))
      .returning({ viewCount: communityPosts.viewCount })
    post.viewCount = Number(updated?.viewCount ?? (Number(post.viewCount || 0) + 1))
  }

  return { success: true, post }
})
