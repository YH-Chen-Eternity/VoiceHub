import { getRouterParam, readBody } from 'h3'
import { eq, inArray } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityBoardReviewers, users } from '~/drizzle/schema'
import { requireCommunityAdmin } from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'

export default defineEventHandler(async (event) => {
  requireCommunityAdmin(event)
  const boardId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(boardId) || boardId <= 0) {
    throw createApiError(400, 'COMMUNITY_BOARD_INVALID', '板块参数不正确')
  }
  const body = await readBody(event)
  const raw = Array.isArray(body?.userIds) ? body.userIds : []
  const userIds = Array.from(
    new Set(
      raw
        .map((id: unknown) => Number(id))
        .filter((id: number) => Number.isInteger(id) && id > 0)
    )
  ) as number[]

  if (userIds.length > 0) {
    const rows = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(inArray(users.id, userIds))
    if (rows.length !== userIds.length) {
      throw createApiError(400, 'COMMUNITY_REVIEWER_INVALID', '包含不存在的用户')
    }
    if (rows.some((row) => row.role !== 'REVIEWER')) {
      throw createApiError(400, 'COMMUNITY_REVIEWER_ROLE_REQUIRED', '只能分配审帖员角色')
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(communityBoardReviewers).where(eq(communityBoardReviewers.boardId, boardId))
    if (userIds.length > 0) {
      await tx
        .insert(communityBoardReviewers)
        .values(userIds.map((userId) => ({ boardId, userId })))
    }
  })

  return { success: true }
})
