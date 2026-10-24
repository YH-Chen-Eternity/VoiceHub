import { getRouterParam, readBody } from 'h3'
import { requireCommunityAdmin } from '~~/server/utils/community'
import { softDeleteCommunityPost } from '~~/server/utils/communityArchive'
import { createApiError } from '~~/server/utils/apiError'

export default defineEventHandler(async (event) => {
  requireCommunityAdmin(event)
  const postId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(postId) || postId <= 0) {
    throw createApiError(400, 'COMMUNITY_POST_INVALID', '帖子参数不正确')
  }

  const body = await readBody(event).catch(() => null)
  const reason = typeof body?.reason === 'string' ? body.reason : ''
  return softDeleteCommunityPost({ postId, actor: event.context.user, reason })
})
