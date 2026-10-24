import { readBody } from 'h3'
import { db } from '~/drizzle/db'
import { communityBoards } from '~/drizzle/schema'
import { requireCommunityAdmin } from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'

function clean(input: unknown, max: number): string {
  return String(input ?? '').trim().slice(0, max)
}

export default defineEventHandler(async (event) => {
  requireCommunityAdmin(event)
  const body = await readBody(event)
  const name = clean(body?.name, 30)
  if (!name) throw createApiError(400, 'COMMUNITY_BOARD_NAME_REQUIRED', '板块名称不能为空')

  try {
    const [board] = await db
      .insert(communityBoards)
      .values({
        name,
        description: clean(body?.description, 200),
        sortOrder: Number.isFinite(Number(body?.sortOrder)) ? Math.trunc(Number(body.sortOrder)) : 0,
        isActive: body?.isActive !== false
      })
      .returning()
    return { success: true, board }
  } catch (error: any) {
    if (String(error?.code) === '23505' || String(error?.message || '').includes('unique')) {
      throw createApiError(409, 'COMMUNITY_BOARD_NAME_DUPLICATE', '板块名称已存在')
    }
    throw error
  }
})
