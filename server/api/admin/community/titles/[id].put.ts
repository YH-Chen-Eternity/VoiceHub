import { getRouterParam, readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityTitles } from '~/drizzle/schema'
import { requireCommunityAdmin } from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'

export default defineEventHandler(async (event) => {
  requireCommunityAdmin(event)
  const titleId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(titleId) || titleId <= 0) {
    throw createApiError(400, 'COMMUNITY_TITLE_INVALID', '称号参数不正确')
  }
  const body = await readBody(event)
  const patch: Record<string, unknown> = {}
  if (body?.name !== undefined) {
    const name = String(body.name).trim().slice(0, 20)
    if (!name) throw createApiError(400, 'COMMUNITY_TITLE_NAME_REQUIRED', '称号名称不能为空')
    patch.name = name
  }
  if (body?.description !== undefined) {
    patch.description = String(body.description).trim().slice(0, 100)
  }

  try {
    const [title] = await db
      .update(communityTitles)
      .set(patch)
      .where(eq(communityTitles.id, titleId))
      .returning()
    if (!title) throw createApiError(404, 'COMMUNITY_TITLE_NOT_FOUND', '称号不存在')
    return { success: true, title }
  } catch (error: any) {
    if (String(error?.code) === '23505' || String(error?.message || '').includes('unique')) {
      throw createApiError(409, 'COMMUNITY_TITLE_NAME_DUPLICATE', '称号名称已存在')
    }
    throw error
  }
})
