import { getQuery } from 'h3'
import {
  getCommunitySettings,
  isCommunityReviewer,
  requireCommunityUser
} from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'
import { loadCommunityPosts } from '~~/server/utils/communityFeed'

export default defineEventHandler(async (event) => {
  const user = requireCommunityUser(event)
  const settings = await getCommunitySettings()
  if (!settings.enabled && !isCommunityReviewer(user)) {
    throw createApiError(403, 'COMMUNITY_DISABLED', '回声社区暂未开放')
  }

  const query = getQuery(event)
  const boardId = Number(query.boardId || 0) || undefined
  const beforeId = Number(query.beforeId || 0) || undefined
  const limit = Math.min(Math.max(Number(query.limit || 20) || 20, 1), 30)
  const mine = query.mine === '1' || query.mine === 'true'

  const posts = await loadCommunityPosts({
    viewerId: user.id,
    boardId,
    beforeId,
    limit,
    status: mine ? undefined : 'APPROVED',
    authorId: mine ? user.id : undefined
  })

  return {
    success: true,
    posts,
    nextCursor: posts.length === limit ? posts[posts.length - 1]?.id ?? null : null
  }
})
