import { getRouterParam } from 'h3'
import { count, eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityBoards, communityPosts } from '~/drizzle/schema'
import { requireCommunityAdmin } from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'

export default defineEventHandler(async (event) => {
  requireCommunityAdmin(event)
  const boardId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(boardId) || boardId <= 0) {
    throw createApiError(400, 'COMMUNITY_BOARD_INVALID', '板块参数不正确')
  }

  const used = await db
    .select({ value: count() })
    .from(communityPosts)
    .where(eq(communityPosts.boardId, boardId))
  if (Number(used[0]?.value || 0) > 0) {
    throw createApiError(409, 'COMMUNITY_BOARD_IN_USE', '该板块下已有帖子，请先隐藏而不是删除')
  }

  const [deleted] = await db
    .delete(communityBoards)
    .where(eq(communityBoards.id, boardId))
    .returning({ id: communityBoards.id })
  if (!deleted) throw createApiError(404, 'COMMUNITY_BOARD_NOT_FOUND', '板块不存在')

  return { success: true }
})
