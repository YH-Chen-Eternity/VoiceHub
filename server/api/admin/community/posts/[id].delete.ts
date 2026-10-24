import { getRouterParam } from 'h3'
import { eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityPosts, notifications } from '~/drizzle/schema'
import { requireCommunityAdmin } from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'

export default defineEventHandler(async (event) => {
  requireCommunityAdmin(event)
  const postId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(postId) || postId <= 0) {
    throw createApiError(400, 'COMMUNITY_POST_INVALID', '帖子参数不正确')
  }

  const [deleted] = await db
    .delete(communityPosts)
    .where(eq(communityPosts.id, postId))
    .returning({ id: communityPosts.id, authorId: communityPosts.authorId })
  if (!deleted) throw createApiError(404, 'COMMUNITY_POST_NOT_FOUND', '帖子不存在')

  await db.insert(notifications).values({
    userId: deleted.authorId,
    type: 'COMMUNITY_POST_REMOVED',
    source: 'COMMUNITY',
    title: '回声社区：帖子已被移除',
    message: '你的帖子因违反社区规范已被管理员移除。'
  })

  return { success: true }
})
