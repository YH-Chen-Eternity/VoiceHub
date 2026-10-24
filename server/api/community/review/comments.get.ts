import { getQuery } from 'h3'
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import {
  communityBoards,
  communityComments,
  communityPosts,
  communityProfiles,
  communityTitles,
  users
} from '~/drizzle/schema'
import {
  buildCommunityIdentity,
  getReviewableBoardIds,
  isCommunityAdmin,
  requireCommunityReviewer
} from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'BLOCKED']

export default defineEventHandler(async (event) => {
  const user = requireCommunityReviewer(event)
  const query = getQuery(event)
  const status = STATUSES.includes(String(query.status || '').toUpperCase())
    ? String(query.status).toUpperCase()
    : 'PENDING'
  const boardId = Number(query.boardId || 0) || undefined

  const scopedBoardIds = await getReviewableBoardIds(user)
  if (boardId && scopedBoardIds && !scopedBoardIds.includes(boardId)) {
    throw createApiError(403, 'COMMUNITY_REVIEW_BOARD_FORBIDDEN', '你没有被分配到该板块')
  }

  const boardScope = boardId
    ? eq(communityPosts.boardId, boardId)
    : scopedBoardIds
      ? inArray(communityPosts.boardId, scopedBoardIds.length ? scopedBoardIds : [-1])
      : undefined

  const rows = await db
    .select({
      id: communityComments.id,
      createdAt: communityComments.createdAt,
      content: communityComments.content,
      status: communityComments.status,
      moderationLabel: communityComments.moderationLabel,
      moderationDetail: communityComments.moderationDetail,
      reviewNote: communityComments.reviewNote,
      reviewedAt: communityComments.reviewedAt,
      authorId: communityComments.authorId,
      authorName: users.name,
      authorGrade: users.grade,
      authorClass: users.class,
      titleName: communityTitles.name,
      postId: communityPosts.id,
      postContent: communityPosts.content,
      boardId: communityPosts.boardId,
      boardName: communityBoards.name
    })
    .from(communityComments)
    .innerJoin(communityPosts, eq(communityPosts.id, communityComments.postId))
    .innerJoin(communityBoards, eq(communityBoards.id, communityPosts.boardId))
    .innerJoin(users, eq(users.id, communityComments.authorId))
    .leftJoin(communityProfiles, eq(communityProfiles.userId, communityComments.authorId))
    .leftJoin(communityTitles, eq(communityTitles.id, communityProfiles.equippedTitleId))
    .where(
      and(
        eq(communityComments.status, status),
        isNull(communityComments.deletedAt),
        isNull(communityPosts.deletedAt),
        boardScope
      )
    )
    .orderBy(desc(communityComments.id))
    .limit(50)

  const statsRows = await db
    .select({ status: communityComments.status, value: count() })
    .from(communityComments)
    .innerJoin(communityPosts, eq(communityPosts.id, communityComments.postId))
    .where(and(isNull(communityComments.deletedAt), isNull(communityPosts.deletedAt), boardScope))
    .groupBy(communityComments.status)

  const stats: Record<string, number> = { PENDING: 0, APPROVED: 0, REJECTED: 0, BLOCKED: 0 }
  for (const row of statsRows) stats[row.status] = Number(row.value || 0)

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
    comments: rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      content: row.content,
      status: row.status,
      moderationLabel: row.moderationLabel,
      moderationDetail: row.moderationDetail,
      reviewNote: row.reviewNote,
      reviewedAt: row.reviewedAt,
      author: {
        id: row.authorId,
        ...buildCommunityIdentity(
          { name: row.authorName, grade: row.authorGrade, class: row.authorClass },
          row.titleName
        )
      },
      post: {
        id: row.postId,
        content: row.postContent
      },
      board: { id: row.boardId, name: row.boardName }
    })),
    stats,
    boards,
    scope: {
      limited: !isCommunityAdmin(user) && !!scopedBoardIds,
      boardIds: scopedBoardIds
    }
  }
})
