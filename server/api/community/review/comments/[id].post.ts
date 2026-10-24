import { getRouterParam, readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityComments, communityPosts, notifications } from '~/drizzle/schema'
import {
  applyCommunityViolation,
  assertCommunityBoardAccess,
  formatCommunityMuteNotice,
  isCommunityAdmin,
  requireCommunityReviewer
} from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'

export default defineEventHandler(async (event) => {
  const user = requireCommunityReviewer(event)
  const commentId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(commentId) || commentId <= 0) {
    throw createApiError(400, 'COMMUNITY_COMMENT_INVALID', '评论参数不正确')
  }

  const body = await readBody(event)
  const action = String(body?.action || '').toLowerCase()
  if (!['approve', 'reject'].includes(action)) {
    throw createApiError(400, 'COMMUNITY_REVIEW_ACTION_INVALID', '审核操作不正确')
  }
  const note = String(body?.note || '').trim().slice(0, 200)

  const [row] = await db
    .select({
      id: communityComments.id,
      status: communityComments.status,
      content: communityComments.content,
      authorId: communityComments.authorId,
      postId: communityComments.postId,
      postAuthorId: communityPosts.authorId,
      postStatus: communityPosts.status,
      postDeletedAt: communityPosts.deletedAt,
      boardId: communityPosts.boardId
    })
    .from(communityComments)
    .innerJoin(communityPosts, eq(communityPosts.id, communityComments.postId))
    .where(eq(communityComments.id, commentId))
    .limit(1)
  if (!row) throw createApiError(404, 'COMMUNITY_COMMENT_NOT_FOUND', '评论不存在')
  if (row.postDeletedAt) throw createApiError(409, 'COMMUNITY_POST_NOT_FOUND', '评论所属帖子已被移除')
  if (row.postStatus !== 'APPROVED') {
    throw createApiError(409, 'COMMUNITY_POST_NOT_PUBLIC', '帖子尚未公开，无法审核评论')
  }

  await assertCommunityBoardAccess(user, row.boardId)

  if (!isCommunityAdmin(user) && row.status !== 'PENDING') {
    throw createApiError(409, 'COMMUNITY_REVIEW_ALREADY_HANDLED', '该评论已审核')
  }
  if (row.status === 'APPROVED' && action === 'approve') {
    throw createApiError(409, 'COMMUNITY_REVIEW_ALREADY_HANDLED', '该评论已通过审核')
  }

  if (action === 'approve') {
    await db
      .update(communityComments)
      .set({
        status: 'APPROVED',
        reviewedBy: user.id,
        reviewedAt: new Date(),
        reviewNote: note || null
      })
      .where(eq(communityComments.id, commentId))

    await db.insert(notifications).values({
      userId: row.authorId,
      type: 'COMMUNITY_COMMENT_APPROVED',
      source: 'COMMUNITY',
      title: '回声社区：评论已通过审核',
      message: '你的评论已通过审核，现在可以在回声社区看到了。'
    })

    if (row.postAuthorId !== row.authorId) {
      await db.insert(notifications).values({
        userId: row.postAuthorId,
        type: 'COMMUNITY_COMMENT',
        source: 'COMMUNITY',
        title: '回声社区有新评论',
        message: `你的帖子收到一条新评论：${row.content.slice(0, 50)}`
      })
    }

    return { success: true, status: 'APPROVED' }
  }

  const result = await db.transaction(async (tx) => {
    await tx
      .update(communityComments)
      .set({
        status: 'REJECTED',
        reviewedBy: user.id,
        reviewedAt: new Date(),
        reviewNote: note || null
      })
      .where(eq(communityComments.id, commentId))
    return applyCommunityViolation(tx, row.authorId)
  })

  await db.insert(notifications).values({
    userId: row.authorId,
    type: 'COMMUNITY_COMMENT_REJECTED',
    source: 'COMMUNITY',
    title: '回声社区：评论未通过审核',
    message: `你的评论未通过审核，记违规 1 次（累计 ${result.violationCount} 次）。${
      note ? `审核说明：${note}。` : ''
    }${formatCommunityMuteNotice(result.violationCount)}`
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
