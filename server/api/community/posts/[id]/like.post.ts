import { getRouterParam } from 'h3'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityPostLikes, communityPosts, notifications } from '~/drizzle/schema'
import { requireCommunityUser, getCommunitySettings, isCommunityReviewer } from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'

/** 帖子点赞（与歌曲点赞 Vote 完全独立）：POST /api/community/posts/:id/like */
export default defineEventHandler(async (event) => {
  const user = requireCommunityUser(event)
  const settings = await getCommunitySettings()
  if (!settings.enabled && !isCommunityReviewer(user)) {
    throw createApiError(403, 'COMMUNITY_DISABLED', '回声社区暂未开放')
  }

  const postId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(postId) || postId <= 0) {
    throw createApiError(400, 'COMMUNITY_POST_INVALID', '帖子参数不正确')
  }

  const [post] = await db
    .select({
      id: communityPosts.id,
      authorId: communityPosts.authorId,
      status: communityPosts.status,
      deletedAt: communityPosts.deletedAt
    })
    .from(communityPosts)
    .where(eq(communityPosts.id, postId))
    .limit(1)

  if (!post || post.deletedAt) {
    throw createApiError(404, 'COMMUNITY_POST_NOT_FOUND', '帖子不存在')
  }
  if (post.status !== 'APPROVED') {
    throw createApiError(400, 'COMMUNITY_POST_NOT_PUBLIC', '帖子审核通过后才能点赞')
  }

  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ postId: communityPostLikes.postId })
      .from(communityPostLikes)
      .where(
        and(eq(communityPostLikes.postId, postId), eq(communityPostLikes.userId, user.id))
      )
      .limit(1)

    if (existing) {
      await tx
        .delete(communityPostLikes)
        .where(
          and(eq(communityPostLikes.postId, postId), eq(communityPostLikes.userId, user.id))
        )
      const [updated] = await tx
        .update(communityPosts)
        .set({ likeCount: sql`greatest(${communityPosts.likeCount} - 1, 0)` })
        .where(eq(communityPosts.id, postId))
        .returning({ likeCount: communityPosts.likeCount })
      return { liked: false, likeCount: Number(updated?.likeCount || 0) }
    }

    await tx.insert(communityPostLikes).values({ postId, userId: user.id })
    const [updated] = await tx
      .update(communityPosts)
      .set({ likeCount: sql`${communityPosts.likeCount} + 1` })
      .where(eq(communityPosts.id, postId))
      .returning({ likeCount: communityPosts.likeCount })

    if (post.authorId !== user.id) {
      await tx.insert(notifications).values({
        userId: post.authorId,
        type: 'COMMUNITY_POST_LIKE',
        source: 'COMMUNITY',
        title: '回声社区有新点赞',
        message: `${user.name || '一位同学'} 点赞了你的帖子`
      })
    }
    return { liked: true, likeCount: Number(updated?.likeCount || 0) }
  })

  return { success: true, ...result }
})
