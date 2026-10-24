import { asc, eq, sql } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityBoards } from '~/drizzle/schema'
import {
  getCommunitySettings,
  isCommunityReviewer,
  requireCommunityUser
} from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'

export default defineEventHandler(async (event) => {
  const user = requireCommunityUser(event)
  const settings = await getCommunitySettings()
  if (!settings.enabled && !isCommunityReviewer(user)) {
    throw createApiError(403, 'COMMUNITY_DISABLED', '回声社区暂未开放')
  }

  const boards = await db
    .select({
      id: communityBoards.id,
      name: communityBoards.name,
      description: communityBoards.description,
      sortOrder: communityBoards.sortOrder,
      isActive: communityBoards.isActive,
      // 必须显式写外层表名：Drizzle 在子查询里会把 ${communityBoards.id} 渲染成不带表名的 "id"，
      // PostgreSQL 会优先绑定到内层 p.id，导致所有板块拿到同一个全局计数。
      // 已撤回/删除的帖子（deletedAt 非空）不再计入板块帖子数，恢复归档后自动 +1
      postCount: sql<number>`(select count(*)::int from "CommunityPost" p where p."boardId" = "CommunityBoard"."id" and p."status" = 'APPROVED' and p."deletedAt" is null)`
    })
    .from(communityBoards)
    .where(isCommunityReviewer(user) ? undefined : eq(communityBoards.isActive, true))
    .orderBy(asc(communityBoards.sortOrder), asc(communityBoards.id))

  return { success: true, boards }
})
