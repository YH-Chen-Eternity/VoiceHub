import { getQuery } from 'h3'
import {
  getCommunitySettings,
  isCommunityAdmin,
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
  const q = String(query.q || '').trim().slice(0, 50)
  const sort = query.sort === 'hot' ? 'hot' : 'latest'

  const posts = await loadCommunityPosts({
    viewerId: user.id,
    boardId,
    // 最热排序不支持游标翻页，只返回第一页（前端在热门模式隐藏“加载更多”）
    beforeId: sort === 'hot' ? undefined : beforeId,
    limit,
    status: mine ? undefined : 'APPROVED',
    authorId: mine ? user.id : undefined,
    q: q || undefined,
    sort
  })

  return {
    success: true,
    posts,
    nextCursor:
      sort === 'latest' && posts.length === limit ? posts[posts.length - 1]?.id ?? null : null,
    permissions: {
      // 管理员可在信息流直接置顶/取消置顶
      canPin: isCommunityAdmin(user)
    }
  }
})
