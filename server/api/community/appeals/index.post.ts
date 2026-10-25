import { readBody } from 'h3'
import { and, eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityAppeals, communityComments, communityPosts } from '~/drizzle/schema'
import {
  ensureCommunityProfile,
  requireCommunityEnabled,
  requireCommunityUser,
  resolveCommunityBanState
} from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'
import { checkDistributedRateLimit } from '~~/server/utils/rateLimiter'
import { SERVER_ERROR_CODES } from '~~/server/config/constants'
import type { CommunityAppealTargetType } from '~~/server/utils/communityRelations'
import {
  COMMUNITY_APPEAL_TARGET_TYPES,
  COMMUNITY_REPORT_STATUS
} from '~~/server/utils/communityRelations'

/** 已被处置的内容（软删除或审核驳回/屏蔽）才允许申诉 */
function isAppealableContent(deletedAt: Date | null, status: string): boolean {
  if (deletedAt) return true
  return status === 'REJECTED' || status === 'BLOCKED'
}

async function resolveAppealTarget(
  userId: number,
  targetType: string,
  requestTargetId: number
): Promise<number> {
  if (targetType === 'POST') {
    const rows = await db
      .select({
        id: communityPosts.id,
        authorId: communityPosts.authorId,
        status: communityPosts.status,
        deletedAt: communityPosts.deletedAt
      })
      .from(communityPosts)
      .where(eq(communityPosts.id, requestTargetId))
      .limit(1)
    const post = rows[0]
    if (!post) throw createApiError(404, 'COMMUNITY_APPEAL_TARGET_NOT_FOUND', '帖子不存在')
    if (post.authorId !== userId) {
      throw createApiError(403, 'COMMUNITY_APPEAL_FORBIDDEN', '只能申诉自己发布的内容')
    }
    if (!isAppealableContent(post.deletedAt, post.status)) {
      throw createApiError(400, 'COMMUNITY_APPEAL_NOT_AVAILABLE', '该内容当前无法申诉')
    }
    return post.id
  }

  if (targetType === 'COMMENT') {
    const rows = await db
      .select({
        id: communityComments.id,
        authorId: communityComments.authorId,
        status: communityComments.status,
        deletedAt: communityComments.deletedAt
      })
      .from(communityComments)
      .where(eq(communityComments.id, requestTargetId))
      .limit(1)
    const comment = rows[0]
    if (!comment) throw createApiError(404, 'COMMUNITY_APPEAL_TARGET_NOT_FOUND', '评论不存在')
    if (comment.authorId !== userId) {
      throw createApiError(403, 'COMMUNITY_APPEAL_FORBIDDEN', '只能申诉自己发布的内容')
    }
    if (!isAppealableContent(comment.deletedAt, comment.status)) {
      throw createApiError(400, 'COMMUNITY_APPEAL_NOT_AVAILABLE', '该内容当前无法申诉')
    }
    return comment.id
  }

  // 禁言申诉：目标是本人，直接使用当前用户 id，避免伪造他人禁言申诉
  const profile = await ensureCommunityProfile(userId)
  const banState = resolveCommunityBanState(profile)
  if (!banState.muted) {
    throw createApiError(400, 'COMMUNITY_APPEAL_NOT_MUTED', '你当前没有被禁言，无需申诉')
  }
  return userId
}

/**
 * 提交社区申诉（被删帖 / 被删评论 / 被禁言）。
 * POST /api/community/appeals
 * body: { targetType: POST|COMMENT|MUTE, targetId, reason }
 * 返回: { success, appeal: { id, status } }
 */
export default defineEventHandler(async (event) => {
  const user = requireCommunityUser(event)
  await requireCommunityEnabled()

  const limit = await checkDistributedRateLimit(
    `community_appeal:user:${user.id}`,
    5,
    10 * 60 * 1000
  )
  if (!limit.isAllowed) {
    throw createApiError(
      429,
      SERVER_ERROR_CODES.COMMON_RATE_LIMITED_SECONDS,
      '申诉提交过于频繁，请稍后重试'
    )
  }

  const body = await readBody(event).catch(() => null)
  const targetType = String(body?.targetType || '')
    .trim()
    .toUpperCase()
  if (!COMMUNITY_APPEAL_TARGET_TYPES.includes(targetType as CommunityAppealTargetType)) {
    throw createApiError(400, 'COMMUNITY_APPEAL_TARGET_TYPE_INVALID', '申诉目标类型不正确')
  }
  const requestTargetId = Number(body?.targetId)
  if (!Number.isInteger(requestTargetId) || requestTargetId <= 0) {
    throw createApiError(400, 'COMMUNITY_APPEAL_TARGET_INVALID', '申诉目标参数不正确')
  }
  const reason = String(body?.reason ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
    .slice(0, 500)
  if (reason.length < 5) {
    throw createApiError(400, 'COMMUNITY_APPEAL_REASON_TOO_SHORT', '申诉理由至少 5 个字')
  }

  const targetId = await resolveAppealTarget(user.id, targetType, requestTargetId)

  const pendingRows = await db
    .select({ id: communityAppeals.id })
    .from(communityAppeals)
    .where(
      and(
        eq(communityAppeals.userId, user.id),
        eq(communityAppeals.targetType, targetType),
        eq(communityAppeals.targetId, targetId),
        eq(communityAppeals.status, COMMUNITY_REPORT_STATUS.PENDING)
      )
    )
    .limit(1)
  if (pendingRows[0]) {
    throw createApiError(409, 'COMMUNITY_APPEAL_PENDING', '你已提交过该申诉，请等待处理')
  }

  const inserted = await db
    .insert(communityAppeals)
    .values({
      userId: user.id,
      targetType,
      targetId,
      reason,
      status: COMMUNITY_REPORT_STATUS.PENDING
    })
    .returning({ id: communityAppeals.id, status: communityAppeals.status })

  return { success: true, appeal: inserted[0] || null }
})
