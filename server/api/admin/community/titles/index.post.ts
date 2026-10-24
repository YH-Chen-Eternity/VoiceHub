import { readBody } from 'h3'
import { db } from '~/drizzle/db'
import { communityTitles } from '~/drizzle/schema'
import { requireCommunityAdmin } from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'

export default defineEventHandler(async (event) => {
  requireCommunityAdmin(event)
  const body = await readBody(event)
  const name = String(body?.name || '').trim().slice(0, 20)
  if (!name) throw createApiError(400, 'COMMUNITY_TITLE_NAME_REQUIRED', '称号名称不能为空')

  try {
    const [title] = await db
      .insert(communityTitles)
      .values({ name, description: String(body?.description || '').trim().slice(0, 100) })
      .returning()
    return { success: true, title }
  } catch (error: any) {
    if (String(error?.code) === '23505' || String(error?.message || '').includes('unique')) {
      throw createApiError(409, 'COMMUNITY_TITLE_NAME_DUPLICATE', '称号名称已存在')
    }
    throw error
  }
})
