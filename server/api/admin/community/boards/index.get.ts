import { and, asc, count, countDistinct, eq, isNull, sql } from 'drizzle-orm'
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
      // 显式限定外层列，避免子查询里的 "id" 被解析成内层表主键。
      reviewerCount: sql<number>`(select count(*)::int from "CommunityBoardReviewer" r where r."boardId" = "CommunityBoard"."id")`,
      // 已撤回/删除（deletedAt 非空）的帖子不计入板块统计，避免归档数据把数字撑大
      postCount: sql<number>`(select count(*)::int from "CommunityPost" p where p."boardId" = "CommunityBoard"."id" and p."deletedAt" is null)`,
      pendingCount: sql<number>`(select count(*)::int from "CommunityPost" p where p."boardId" = "CommunityBoard"."id" and p."status" = 'PENDING' and p."deletedAt" is null)`
    })
    .from(communityBoards)
    .orderBy(asc(communityBoards.sortOrder), asc(communityBoards.id))

  // 审帖员总数按人去重：同一审帖员可负责多个板块，直接 count(*) 会把多板块重复计数
  const total = await db
    .select({ value: countDistinct(communityBoardReviewers.userId) })
    .from(communityBoardReviewers)
  const totalPosts = await db
    .select({ value: count() })
    .from(communityPosts)
    .where(and(eq(communityPosts.status, 'PENDING'), isNull(communityPosts.deletedAt)))

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
