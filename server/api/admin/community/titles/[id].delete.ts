import { getRouterParam } from 'h3'
import { eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityTitles } from '~/drizzle/schema'
import { requireCommunityAdmin } from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'
import { COMMUNITY_RESONANCE_LEVELS } from '~~/server/utils/communityResonance'

export default defineEventHandler(async (event) => {
  requireCommunityAdmin(event)
  const titleId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(titleId) || titleId <= 0) {
    throw createApiError(400, 'COMMUNITY_TITLE_INVALID', '称号参数不正确')
  }

  const [existing] = await db
    .select({ name: communityTitles.name })
    .from(communityTitles)
    .where(eq(communityTitles.id, titleId))
    .limit(1)
  if (!existing) throw createApiError(404, 'COMMUNITY_TITLE_NOT_FOUND', '称号不存在')
  if (COMMUNITY_RESONANCE_LEVELS.some((level) => level.name === existing.name)) {
    throw createApiError(400, 'COMMUNITY_TITLE_SYSTEM_READONLY', '系统称号由共鸣规则自动授予，不能删除')
  }

  const [deleted] = await db
    .delete(communityTitles)
    .where(eq(communityTitles.id, titleId))
    .returning({ id: communityTitles.id })
  if (!deleted) throw createApiError(404, 'COMMUNITY_TITLE_NOT_FOUND', '称号不存在')

  return { success: true }
})
