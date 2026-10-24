import { asc, sql } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityTitles } from '~/drizzle/schema'
import { requireCommunityAdmin } from '~~/server/utils/community'

export default defineEventHandler(async (event) => {
  requireCommunityAdmin(event)

  const titles = await db
    .select({
      id: communityTitles.id,
      name: communityTitles.name,
      description: communityTitles.description,
      createdAt: communityTitles.createdAt,
      holderCount: sql<number>`(select count(*)::int from "CommunityUserTitle" ut where ut."titleId" = ${communityTitles.id})`
    })
    .from(communityTitles)
    .orderBy(asc(communityTitles.id))

  return { success: true, titles }
})
