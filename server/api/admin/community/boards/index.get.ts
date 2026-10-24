import { asc, count, eq, sql } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityBoards, communityBoardReviewers, communityPosts } from '~/drizzle/schema'
import { requireCommunityAdmin } from '~~/server/utils/community'

export default defineEventHandler(async (event) => {
  requireCommunityAdmin(event)

  const boards = await db
    .select({
      id: communityBoards.id,
      name: communityBoards.name,
      description: communityBoards.description,
      sortOrder: communityBoards.sortOrder,
      isActive: communityBoards.isActive,
      createdAt: communityBoards.createdAt,
      reviewerCount: sql<number>`(select count(*)::int from "CommunityBoardReviewer" r where r."boardId" = ${communityBoards.id})`,
      postCount: sql<number>`(select count(*)::int from "CommunityPost" p where p."boardId" = ${communityBoards.id})`,
      pendingCount: sql<number>`(select count(*)::int from "CommunityPost" p where p."boardId" = ${communityBoards.id} and p."status" = 'PENDING')`
    })
    .from(communityBoards)
    .orderBy(asc(communityBoards.sortOrder), asc(communityBoards.id))

  const total = await db.select({ value: count() }).from(communityBoardReviewers)
  const totalPosts = await db.select({ value: count() }).from(communityPosts).where(eq(communityPosts.status, 'PENDING'))

  return {
    success: true,
    boards,
    summary: {
      boards: boards.length,
      reviewers: Number(total[0]?.value || 0),
      pending: Number(totalPosts[0]?.value || 0)
    }
  }
})
