import { getRouterParam } from 'h3'
import { eq, sql } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityPosts } from '~/drizzle/schema'
import { buildRedisKey, getRedisClient } from '~~/server/utils/redis'
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

  // 浏览量：同一用户 1 小时内只计一次（Redis 不可用时退化为每次浏览都计，保证功能可用）
  let counted = true
  try {
    const redis = await getRedisClient()
    if (redis) {
      const key = buildRedisKey('community:post:view', postId, user.id)
      const ok = await redis.set(key, '1', { NX: true, EX: 3600 })
      counted = ok === 'OK'
    }
  } catch {
    counted = true
  }
  if (counted && post.status === 'APPROVED') {
    const [updated] = await db
      .update(communityPosts)
      .set({ viewCount: sql`${communityPosts.viewCount} + 1` })
      .where(eq(communityPosts.id, postId))
      .returning({ viewCount: communityPosts.viewCount })
    post.viewCount = Number(updated?.viewCount ?? (Number(post.viewCount || 0) + 1))
  }

  return { success: true, post }
})
