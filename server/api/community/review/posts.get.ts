import { getQuery } from 'h3'
import { count, eq, inArray, isNull, and } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityBoards, communityPosts } from '~/drizzle/schema'
import {
  getReviewableBoardIds,
  isCommunityAdmin,
  requireCommunityReviewer
} from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'
import { loadCommunityPosts } from '~~/server/utils/communityFeed'

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'BLOCKED']

export default defineEventHandler(async (event) => {
  const user = requireCommunityReviewer(event)
  const query = getQuery(event)
  const status = STATUSES.includes(String(query.status || '').toUpperCase())
    ? String(query.status).toUpperCase()
    : 'PENDING'
  const requestedBoardId = Number(query.boardId || 0) || undefined

  const scopedBoardIds = await getReviewableBoardIds(user)
  if (requestedBoardId && scopedBoardIds && !scopedBoardIds.includes(requestedBoardId)) {
    throw createApiError(403, 'COMMUNITY_REVIEW_BOARD_FORBIDDEN', '你没有被分配到该板块')
  }

  const boardFilter = requestedBoardId
    ? eq(communityPosts.boardId, requestedBoardId)
    : scopedBoardIds
      ? scopedBoardIds.length
        ? inArray(communityPosts.boardId, scopedBoardIds)
        : eq(communityPosts.boardId, -1)
      : undefined

  const posts = await loadCommunityPosts({
    viewerId: user.id,
    status,
    boardId: requestedBoardId,
    boardIds: requestedBoardId ? undefined : scopedBoardIds || undefined,
    limit: 30
  })

  const statsRows = await db
    .select({ status: communityPosts.status, value: count() })
    .from(communityPosts)
    .where(and(isNull(communityPosts.deletedAt), boardFilter))
    .groupBy(communityPosts.status)

  const stats: Record<string, number> = { PENDING: 0, APPROVED: 0, REJECTED: 0, BLOCKED: 0 }
  for (const row of statsRows) {
    stats[row.status] = Number(row.value || 0)
  }

  const boards = await db
    .select({ id: communityBoards.id, name: communityBoards.name })
    .from(communityBoards)
    .where(
      scopedBoardIds
        ? inArray(communityBoards.id, scopedBoardIds.length ? scopedBoardIds : [-1])
        : undefined
    )

  return {
    success: true,
    posts,
    stats,
    boards,
    scope: {
      limited: !isCommunityAdmin(user) && !!scopedBoardIds,
      boardIds: scopedBoardIds
    }
  }
})
