import { eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { users } from '~/drizzle/schema'
import { createApiError } from '~~/server/utils/apiError'

// 切换「我的点赞列表是否对其他同学可见」
export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createApiError(401, 'AUTH_UNAUTHORIZED_ACCESS', '未授权访问')

  const body = await readBody(event)
  if (typeof body?.likesVisible !== 'boolean') {
    throw createApiError(400, 'COMMON_INVALID_PARAMS', '参数错误')
  }

  await db
    .update(users)
    .set({ likesVisible: body.likesVisible, updatedAt: new Date() })
    .where(eq(users.id, user.id))

  return { success: true, likesVisible: body.likesVisible }
})
