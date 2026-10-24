import { getRouterParam, readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityBoards } from '~/drizzle/schema'
import { requireCommunityAdmin } from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'

export default defineEventHandler(async (event) => {
  requireCommunityAdmin(event)
  const boardId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(boardId) || boardId <= 0) {
    throw createApiError(400, 'COMMUNITY_BOARD_INVALID', '板块参数不正确')
  }
  const body = await readBody(event)
  const patch: Record<string, unknown> = { updatedAt: new Date() }

  if (body?.name !== undefined) {
    const name = String(body.name).trim().slice(0, 30)
    if (!name) throw createApiError(400, 'COMMUNITY_BOARD_NAME_REQUIRED', '板块名称不能为空')
    patch.name = name
  }
  if (body?.description !== undefined) {
    patch.description = String(body.description).trim().slice(0, 200)
  }
  if (body?.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))) {
    patch.sortOrder = Math.trunc(Number(body.sortOrder))
  }
  if (typeof body?.isActive === 'boolean') patch.isActive = body.isActive

  try {
    const [board] = await db
      .update(communityBoards)
      .set(patch)
      .where(eq(communityBoards.id, boardId))
      .returning()
    if (!board) throw createApiError(404, 'COMMUNITY_BOARD_NOT_FOUND', '板块不存在')
    return { success: true, board }
  } catch (error: any) {
    if (String(error?.code) === '23505' || String(error?.message || '').includes('unique')) {
      throw createApiError(409, 'COMMUNITY_BOARD_NAME_DUPLICATE', '板块名称已存在')
    }
    throw error
  }
})
