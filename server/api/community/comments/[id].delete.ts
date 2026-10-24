import { getRouterParam, readBody } from 'h3'
import { requireCommunityUser } from '~~/server/utils/community'
import { softDeleteCommunityComment } from '~~/server/utils/communityArchive'
import { createApiError } from '~~/server/utils/apiError'

export default defineEventHandler(async (event) => {
  const user = requireCommunityUser(event)
  const commentId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(commentId) || commentId <= 0) {
    throw createApiError(400, 'COMMUNITY_COMMENT_INVALID', '评论参数不正确')
  }

  const body = await readBody(event).catch(() => null)
  const reason = typeof body?.reason === 'string' ? body.reason : ''

  return softDeleteCommunityComment({ commentId, actor: user, reason })
})
