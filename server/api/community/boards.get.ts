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
      postCount: sql<number>`(select count(*)::int from "CommunityPost" p where p."boardId" = ${communityBoards.id} and p."status" = 'APPROVED')`
    })
    .from(communityBoards)
    .where(isCommunityReviewer(user) ? undefined : eq(communityBoards.isActive, true))
    .orderBy(asc(communityBoards.sortOrder), asc(communityBoards.id))

  return { success: true, boards }
})
