import { getRouterParam, readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityPosts, notifications } from '~/drizzle/schema'
import {
  applyCommunityViolation,
  formatCommunityMuteNotice,
  getReviewableBoardIds,
  isCommunityAdmin,
  requireCommunityReviewer
} from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'

export default defineEventHandler(async (event) => {
  const user = requireCommunityReviewer(event)
  const postId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(postId) || postId <= 0) {
    throw createApiError(400, 'COMMUNITY_POST_INVALID', '帖子参数不正确')
  }

  const body = await readBody(event)
  const action = String(body?.action || '').toLowerCase()
  if (!['approve', 'reject'].includes(action)) {
    throw createApiError(400, 'COMMUNITY_REVIEW_ACTION_INVALID', '审核操作不正确')
  }
  const note = String(body?.note || '').trim().slice(0, 200)

  const postRows = await db
    .select({
      id: communityPosts.id,
      boardId: communityPosts.boardId,
      authorId: communityPosts.authorId,
      status: communityPosts.status
    })
    .from(communityPosts)
    .where(eq(communityPosts.id, postId))
    .limit(1)
  const post = postRows[0]
  if (!post) throw createApiError(404, 'COMMUNITY_POST_NOT_FOUND', '帖子不存在')

  const scopedBoardIds = await getReviewableBoardIds(user)
  if (scopedBoardIds && !scopedBoardIds.includes(post.boardId)) {
    throw createApiError(403, 'COMMUNITY_REVIEW_BOARD_FORBIDDEN', '你没有被分配到该板块')
  }

  if (!isCommunityAdmin(user) && post.status !== 'PENDING') {
    throw createApiError(409, 'COMMUNITY_REVIEW_ALREADY_HANDLED', '该帖子已审核')
  }
  if (post.status === 'APPROVED') {
    throw createApiError(409, 'COMMUNITY_REVIEW_ALREADY_HANDLED', '该帖子已通过审核')
  }

  if (action === 'approve') {
    await db
      .update(communityPosts)
      .set({
        status: 'APPROVED',
        reviewedBy: user.id,
        reviewedAt: new Date(),
        reviewNote: note || null,
        updatedAt: new Date()
      })
      .where(eq(communityPosts.id, postId))

    await db.insert(notifications).values({
      userId: post.authorId,
      type: 'COMMUNITY_POST_APPROVED',
      source: 'COMMUNITY',
      title: '回声社区：帖子已通过审核',
      message: '你发布的帖子已通过审核，现在可以在回声社区看到了。'
    })

    return { success: true, status: 'APPROVED' }
  }

  const result = await db.transaction(async (tx) => {
    await tx
      .update(communityPosts)
      .set({
        status: 'REJECTED',
        reviewedBy: user.id,
        reviewedAt: new Date(),
        reviewNote: note || null,
        updatedAt: new Date()
      })
      .where(eq(communityPosts.id, postId))
    return applyCommunityViolation(tx, post.authorId)
  })

  const muteText = formatCommunityMuteNotice(result.violationCount)

  await db.insert(notifications).values({
    userId: post.authorId,
    type: 'COMMUNITY_POST_REJECTED',
    source: 'COMMUNITY',
    title: '回声社区：帖子未通过审核',
    message: `你发布的帖子未通过审核，记违规 1 次（累计 ${result.violationCount} 次）。${
      note ? `审核说明：${note}。` : ''
    }${muteText}`
  })

  return {
    success: true,
    status: 'REJECTED',
    violationCount: result.violationCount,
    ban: {
      muted: result.banned,
      permanent: result.banned && !result.bannedUntil,
      until: result.bannedUntil,
      reason: result.banReason
    }
  }
})
