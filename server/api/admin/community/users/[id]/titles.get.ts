import { getRouterParam } from 'h3'
import { asc, eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityProfiles, communityTitles, communityUserTitles, users } from '~/drizzle/schema'
import { requireCommunityAdmin } from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'

export default defineEventHandler(async (event) => {
  requireCommunityAdmin(event)
  const userId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(userId) || userId <= 0) {
    throw createApiError(400, 'COMMUNITY_USER_INVALID', '用户参数不正确')
  }
  const target = await db
    .select({ id: users.id, name: users.name, username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!target[0]) throw createApiError(404, 'USER_NOT_FOUND', '用户不存在')

  const allTitles = await db
    .select({ id: communityTitles.id, name: communityTitles.name, description: communityTitles.description })
    .from(communityTitles)
    .orderBy(asc(communityTitles.id))

  const granted = await db
    .select({ titleId: communityUserTitles.titleId, grantedAt: communityUserTitles.grantedAt })
    .from(communityUserTitles)
    .where(eq(communityUserTitles.userId, userId))

  const profile = await db
    .select({ equippedTitleId: communityProfiles.equippedTitleId })
    .from(communityProfiles)
    .where(eq(communityProfiles.userId, userId))
    .limit(1)

  return {
    success: true,
    user: target[0],
    titles: allTitles,
    grantedTitleIds: granted.map((row) => row.titleId),
    equippedTitleId: profile[0]?.equippedTitleId ?? null
  }
})
