import { getRouterParam } from 'h3'
import { asc, eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityBoardReviewers, communityBoards, users } from '~/drizzle/schema'
import { requireCommunityAdmin } from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'

export default defineEventHandler(async (event) => {
  requireCommunityAdmin(event)
  const boardId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(boardId) || boardId <= 0) {
    throw createApiError(400, 'COMMUNITY_BOARD_INVALID', '板块参数不正确')
  }

  const board = await db
    .select({ id: communityBoards.id, name: communityBoards.name })
    .from(communityBoards)
    .where(eq(communityBoards.id, boardId))
    .limit(1)
  if (!board[0]) throw createApiError(404, 'COMMUNITY_BOARD_NOT_FOUND', '板块不存在')

  const assigned = await db
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      grade: users.grade,
      class: users.class,
      role: users.role
    })
    .from(communityBoardReviewers)
    .innerJoin(users, eq(users.id, communityBoardReviewers.userId))
    .where(eq(communityBoardReviewers.boardId, boardId))
    .orderBy(asc(users.id))

  const candidates = await db
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      grade: users.grade,
      class: users.class,
      role: users.role
    })
    .from(users)
    .where(eq(users.role, 'REVIEWER'))
    .orderBy(asc(users.id))
    .limit(200)

  return { success: true, board: board[0], assigned, candidates }
})
