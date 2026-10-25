import { readBody } from 'h3'
import { and, count, eq, isNull } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityComments, communityPosts, communityReports, users } from '~/drizzle/schema'
import {
  maskCommunityName,
  requireCommunityEnabled,
  requireCommunityUser
} from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'
import { isUniqueViolation } from '~~/server/utils/db-errors'
import { checkDistributedRateLimit } from '~~/server/utils/rateLimiter'
import { getServerDate } from '~~/server/utils/serverTime'
import { SERVER_ERROR_CODES } from '~~/server/config/constants'
import type {
  CommunityReportReasonCode,
  CommunityReportTargetType
} from '~~/server/utils/communityRelations'
import {
  COMMUNITY_REPORT_REASON_CODES,
  COMMUNITY_REPORT_STATUS,
  COMMUNITY_REPORT_TARGET_TYPES,
  insertCommunityNotifications,
  listCommunityAdminIds
} from '~~/server/utils/communityRelations'

const REASON_LABELS: Record<string, string> = {
  SPAM: '刷屏广告',
  ABUSE: '辱骂攻击',
  FRAUD: '诈骗',
  PRIVACY: '隐私泄露',
  OTHER: '其他'
}

type TargetDetail = {
  targetType: 'POST' | 'COMMENT' | 'USER'
  targetId: number
  /** 被举报内容的作者 / 被举报用户 */
  authorId: number
  /** 管理端通知里的目标描述 */
  label: string
}

async function resolveTarget(targetType: string, targetId: number): Promise<TargetDetail> {
  if (targetType === 'POST') {
    const rows = await db
      .select({
        id: communityPosts.id,
        authorId: communityPosts.authorId,
        status: communityPosts.status,
        deletedAt: communityPosts.deletedAt
      })
      .from(communityPosts)
      .where(eq(communityPosts.id, targetId))
      .limit(1)
    const post = rows[0]
    if (!post || post.deletedAt || post.status !== 'APPROVED') {
      throw createApiError(404, 'COMMUNITY_REPORT_TARGET_NOT_FOUND', '内容不存在或当前不可举报')
    }
    return {
      targetType: 'POST',
      targetId: post.id,
      authorId: post.authorId,
      label: `帖子 #${post.id}`
    }
  }

  if (targetType === 'COMMENT') {
    const rows = await db
      .select({
        id: communityComments.id,
        authorId: communityComments.authorId,
        status: communityComments.status,
        deletedAt: communityComments.deletedAt,
        postStatus: communityPosts.status,
        postDeletedAt: communityPosts.deletedAt
      })
      .from(communityComments)
      .innerJoin(communityPosts, eq(communityPosts.id, communityComments.postId))
      .where(eq(communityComments.id, targetId))
      .limit(1)
    const comment = rows[0]
    if (
      !comment ||
      comment.deletedAt ||
      comment.status !== 'APPROVED' ||
      comment.postDeletedAt ||
      comment.postStatus !== 'APPROVED'
    ) {
      throw createApiError(404, 'COMMUNITY_REPORT_TARGET_NOT_FOUND', '内容不存在或当前不可举报')
    }
    return {
      targetType: 'COMMENT',
      targetId: comment.id,
      authorId: comment.authorId,
      label: `评论 #${comment.id}`
    }
  }

  const rows = await db.select({ id: users.id }).from(users).where(eq(users.id, targetId)).limit(1)
  if (!rows[0]) {
    throw createApiError(404, 'COMMUNITY_REPORT_TARGET_NOT_FOUND', '用户不存在')
  }
  return {
    targetType: 'USER',
    targetId: rows[0].id,
    authorId: rows[0].id,
    label: `用户 #${rows[0].id}`
  }
}

/**
 * 用户举报帖子 / 评论 / 用户。
 * POST /api/community/reports
 * body: { targetType: POST|COMMENT|USER, targetId, reasonCode: SPAM|ABUSE|FRAUD|PRIVACY|OTHER, detail? }
 * 返回: { success, autoHidden }
 */
export default defineEventHandler(async (event) => {
  const user = requireCommunityUser(event)
  const settings = await requireCommunityEnabled()

  const limit = await checkDistributedRateLimit(`community_report:user:${user.id}`, 10, 60 * 1000)
  if (!limit.isAllowed) {
    throw createApiError(
      429,
      SERVER_ERROR_CODES.COMMON_RATE_LIMITED_SECONDS,
      '举报过于频繁，请稍后重试'
    )
  }

  const body = await readBody(event).catch(() => null)
  const targetType = String(body?.targetType || '')
    .trim()
    .toUpperCase()
  if (!COMMUNITY_REPORT_TARGET_TYPES.includes(targetType as CommunityReportTargetType)) {
    throw createApiError(400, 'COMMUNITY_REPORT_TARGET_TYPE_INVALID', '举报目标类型不正确')
  }
  const targetId = Number(body?.targetId)
  if (!Number.isInteger(targetId) || targetId <= 0) {
    throw createApiError(400, 'COMMUNITY_REPORT_TARGET_INVALID', '举报目标参数不正确')
  }
  const reasonCode = String(body?.reasonCode || '')
    .trim()
    .toUpperCase()
  if (!COMMUNITY_REPORT_REASON_CODES.includes(reasonCode as CommunityReportReasonCode)) {
    throw createApiError(400, 'COMMUNITY_REPORT_REASON_INVALID', '请选择举报原因')
  }
  const detail = String(body?.detail ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
    .slice(0, 500)

  const target = await resolveTarget(targetType, targetId)
  if (target.authorId === user.id) {
    throw createApiError(400, 'COMMUNITY_REPORT_SELF', '不能举报自己')
  }

  try {
    await db.insert(communityReports).values({
      targetType: target.targetType,
      targetId: target.targetId,
      reporterId: user.id,
      reasonCode,
      detail: detail || null,
      status: COMMUNITY_REPORT_STATUS.PENDING
    })
  } catch (error) {
    // 同一举报者对同一目标只允许一条记录（唯一索引兜底并发）
    if (isUniqueViolation(error)) {
      throw createApiError(409, 'COMMUNITY_REPORT_DUPLICATE', '你已举报过该内容，请等待处理')
    }
    throw error
  }

  // 举报自动隐藏：待处理举报数达到阈值（0 = 关闭）时转为待审，公开信息流不再展示
  let autoHidden = false
  if (target.targetType !== 'USER') {
    const threshold = Number(settings.reportAutoHideThreshold || 0)
    if (threshold > 0) {
      const countRows = await db
        .select({ value: count() })
        .from(communityReports)
        .where(
          and(
            eq(communityReports.targetType, target.targetType),
            eq(communityReports.targetId, target.targetId),
            eq(communityReports.status, COMMUNITY_REPORT_STATUS.PENDING)
          )
        )
      const pendingCount = Number(countRows[0]?.value || 0)
      if (pendingCount >= threshold) {
        const now = getServerDate()
        if (target.targetType === 'POST') {
          const [updated] = await db
            .update(communityPosts)
            .set({ status: 'PENDING', updatedAt: now })
            .where(
              and(
                eq(communityPosts.id, target.targetId),
                eq(communityPosts.status, 'APPROVED'),
                isNull(communityPosts.deletedAt)
              )
            )
            .returning({ id: communityPosts.id })
          autoHidden = !!updated
        } else {
          const [updated] = await db
            .update(communityComments)
            .set({ status: 'PENDING' })
            .where(
              and(
                eq(communityComments.id, target.targetId),
                eq(communityComments.status, 'APPROVED'),
                isNull(communityComments.deletedAt)
              )
            )
            .returning({ id: communityComments.id })
          autoHidden = !!updated
        }

        if (autoHidden) {
          const adminIds = await listCommunityAdminIds()
          const reporterName = maskCommunityName(user.name)
          const reasonLabel = REASON_LABELS[reasonCode] || reasonCode
          await insertCommunityNotifications(
            adminIds.map((adminId) => ({
              userId: adminId,
              type: 'COMMUNITY_REPORT_AUTO_HIDE',
              title: '回声社区：内容因举报被自动隐藏',
              message: `${target.label}累计收到 ${pendingCount} 条待处理举报（阈值 ${threshold}），已自动转为待审核并从信息流隐藏。举报人：${reporterName}；原因：${reasonLabel}。请尽快到「举报处理」队列处理。`
            }))
          )
        }
      }
    }
  }

  return { success: true, autoHidden }
})
