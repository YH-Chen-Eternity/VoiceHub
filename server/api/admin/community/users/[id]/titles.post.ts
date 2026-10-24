import { getRouterParam, readBody } from 'h3'
import { and, eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityProfiles, communityTitles, communityUserTitles } from '~/drizzle/schema'
import { requireCommunityAdmin } from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'

export default defineEventHandler(async (event) => {
  const admin = event.context.user
  requireCommunityAdmin(event)
  const userId = Number(getRouterParam(event, 'id'))
  const body = await readBody(event)
  const titleId = Number(body?.titleId)
  if (!Number.isInteger(userId) || userId <= 0 || !Number.isInteger(titleId) || titleId <= 0) {
    throw createApiError(400, 'COMMUNITY_TITLE_INVALID', '参数不正确')
  }
  const action = String(body?.action || '').toLowerCase()
  if (!['grant', 'revoke'].includes(action)) {
    throw createApiError(400, 'COMMUNITY_TITLE_ACTION_INVALID', '操作不正确')
  }

  const title = await db
    .select({ id: communityTitles.id })
    .from(communityTitles)
    .where(eq(communityTitles.id, titleId))
    .limit(1)
  if (!title[0]) throw createApiError(404, 'COMMUNITY_TITLE_NOT_FOUND', '称号不存在')

  if (action === 'grant') {
    await db
      .insert(communityUserTitles)
      .values({ userId, titleId, grantedBy: admin?.id ?? null })
      .onConflictDoNothing()
  } else {
    await db
      .delete(communityUserTitles)
      .where(and(eq(communityUserTitles.userId, userId), eq(communityUserTitles.titleId, titleId)))
    await db
      .update(communityProfiles)
      .set({ equippedTitleId: null, updatedAt: new Date() })
      .where(and(eq(communityProfiles.userId, userId), eq(communityProfiles.equippedTitleId, titleId)))
  }

  const granted = await db
    .select({ titleId: communityUserTitles.titleId })
    .from(communityUserTitles)
    .where(eq(communityUserTitles.userId, userId))

  return { success: true, grantedTitleIds: granted.map((row) => row.titleId) }
})
