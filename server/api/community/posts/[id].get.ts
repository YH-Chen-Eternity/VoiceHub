import { getRouterParam } from 'h3'
import {
  isCommunityAdmin,
  isCommunityReviewer,
  requireCommunityUser
} from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'
import { getCommunityPostById } from '~~/server/utils/communityFeed'

export default defineEventHandler(async (event) => {
  const user = requireCommunityUser(event)
  const postId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(postId) || postId <= 0) {
    throw createApiError(400, 'COMMUNITY_POST_INVALID', '帖子参数不正确')
  }

  const post = await getCommunityPostById(postId, user.id)
  if (!post) throw createApiError(404, 'COMMUNITY_POST_NOT_FOUND', '帖子不存在')

  const privileged = isCommunityReviewer(user) || isCommunityAdmin(user)
  if (post.status !== 'APPROVED' && post.author.id !== user.id && !privileged) {
    throw createApiError(404, 'COMMUNITY_POST_NOT_FOUND', '帖子不存在')
  }

  return { success: true, post }
})
