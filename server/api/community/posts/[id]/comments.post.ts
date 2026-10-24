import { randomUUID } from 'node:crypto'
import { getRouterParam, readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityComments, communityPosts, notifications } from '~/drizzle/schema'
import {
  assertCommunityNotMuted,
  getCommunitySettings,
  requireCommunityUser,
  requireCommunityEnabled
} from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'
import { moderateCommunityText } from '~~/server/utils/communityModeration'
import {
  isCommunityModerationServiceConfigured,
  moderateCommunityPostWithService
} from '~~/server/utils/communityModerationService'

function cleanText(input: unknown): string {
  return String(input ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
}

export default defineEventHandler(async (event) => {
  const user = requireCommunityUser(event)
  const settings = await requireCommunityEnabled()
  await assertCommunityNotMuted(user.id)

  const postId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(postId) || postId <= 0) {
    throw createApiError(400, 'COMMUNITY_POST_INVALID', '帖子参数不正确')
  }

  const postRow = await db
    .select({
      id: communityPosts.id,
      status: communityPosts.status,
      authorId: communityPosts.authorId,
      deletedAt: communityPosts.deletedAt
    })
    .from(communityPosts)
    .where(eq(communityPosts.id, postId))
    .limit(1)
  const post = postRow[0]
  if (!post || post.deletedAt) throw createApiError(404, 'COMMUNITY_POST_NOT_FOUND', '帖子不存在')
  if (post.status !== 'APPROVED') {
    throw createApiError(403, 'COMMUNITY_POST_NOT_PUBLIC', '帖子尚未公开，暂时不能评论')
  }

  const body = await readBody(event)
  if (
    (Array.isArray(body?.imageIds) && body.imageIds.length > 0) ||
    (Array.isArray(body?.images) && body.images.length > 0)
  ) {
    throw createApiError(400, 'COMMUNITY_COMMENT_IMAGES_UNSUPPORTED', '评论不支持图片')
  }

  const content = cleanText(body?.content)
  if (!content) throw createApiError(400, 'COMMUNITY_COMMENT_REQUIRED', '评论内容不能为空')
  if (content.length > settings.maxCommentLength) {
    throw createApiError(400, 'COMMUNITY_COMMENT_TOO_LONG', `评论不能超过 ${settings.maxCommentLength} 字`, {
      params: [settings.maxCommentLength]
    })
  }

  let status = 'PENDING'
  let moderationLabel: string | null = null
  let moderationDetail: string | null = null

  if (settings.moderationEnabled && isCommunityModerationServiceConfigured()) {
    const result = await moderateCommunityPostWithService({
      postId: `comment-${user.id}-${Date.now()}-${randomUUID().slice(0, 8)}`,
      text: content,
      imageUrls: [],
      settings
    })
    status = result.postStatus
    moderationLabel = result.label
    moderationDetail = result.detail
  } else {
    const moderation = await moderateCommunityText(content, settings)
    if (moderation.hit) {
      moderationLabel = moderation.labels.join(',') || 'RISK'
      moderationDetail = moderation.detail
      if (settings.moderationHitAction === 'BLOCK') status = 'BLOCKED'
    }
  }

  if (status === 'BLOCKED') {
    throw createApiError(400, 'COMMUNITY_COMMENT_BLOCKED', '评论未通过安全审核')
  }

  const [comment] = await db
    .insert(communityComments)
    .values({
      postId,
      authorId: user.id,
      content,
      status,
      moderationLabel,
      moderationDetail
    })
    .returning({ id: communityComments.id, createdAt: communityComments.createdAt })

  if (status === 'APPROVED' && post.authorId !== user.id) {
    await db.insert(notifications).values({
      userId: post.authorId,
      type: 'COMMUNITY_COMMENT',
      source: 'COMMUNITY',
      title: '回声社区有新评论',
      message: `你的帖子收到一条新评论：${content.slice(0, 50)}`,
      songId: null
    })
  }

  return {
    success: true,
    status,
    message: status === 'APPROVED' ? '评论成功' : '评论已提交，审核通过后会显示',
    comment
  }
})
