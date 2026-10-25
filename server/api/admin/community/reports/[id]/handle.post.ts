import { getRouterParam, readBody } from 'h3'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import {
  communityComments,
  communityPosts,
  communityProfiles,
  communityReports,
  users
} from '~/drizzle/schema'
import {
  COMMUNITY_ARCHIVE_RETENTION_MS,
  assertCommunityBoardAccess,
  isCommunityAdmin,
  requireCommunityReviewer
} from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'
import { writeAdminAudit } from '~~/server/utils/adminAudit'
import { getServerDate } from '~~/server/utils/serverTime'
import type { CommunityReportAction } from '~~/server/utils/communityRelations'
import {
  COMMUNITY_REPORT_ACTIONS,
  COMMUNITY_REPORT_STATUS,
  insertCommunityNotifications,
  loadCommunityTargetSummaries
} from '~~/server/utils/communityRelations'

const ACTION_LABELS: Record<string, string> = {
  ACCEPT_HIDE: '通过并隐藏',
  ACCEPT_DELETE: '通过并删除',
  REJECT: '驳回'
}

/**
 * 处理社区举报。
 * POST /api/admin/community/reports/:id/handle
 * body: { action: ACCEPT_HIDE|ACCEPT_DELETE|REJECT, resultNote? }
 * - POST / COMMENT：ACCEPT_HIDE → 转为待审并隐藏；ACCEPT_DELETE → 软删除保留 30 天；
 * - USER：ACCEPT_HIDE → 影子封禁（本人可见、他人不可见）；ACCEPT_DELETE 不适用；
 * - REJECT：仅标记处理结果。
 */
export default defineEventHandler(async (event) => {
  const user = requireCommunityReviewer(event)

  const reportId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(reportId) || reportId <= 0) {
    throw createApiError(400, 'COMMUNITY_REPORT_INVALID', '举报参数不正确')
  }

  const body = await readBody(event).catch(() => null)
  const action = String(body?.action || '')
    .trim()
    .toUpperCase()
  if (!COMMUNITY_REPORT_ACTIONS.includes(action as CommunityReportAction)) {
    throw createApiError(400, 'COMMUNITY_REPORT_ACTION_INVALID', '处理操作不正确')
  }
  const resultNote = String(body?.resultNote ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
    .slice(0, 300)

  const reportRows = await db
    .select()
    .from(communityReports)
    .where(eq(communityReports.id, reportId))
    .limit(1)
  const report = reportRows[0]
  if (!report) {
    throw createApiError(404, 'COMMUNITY_REPORT_NOT_FOUND', '举报记录不存在')
  }
  if (report.status !== COMMUNITY_REPORT_STATUS.PENDING) {
    throw createApiError(409, 'COMMUNITY_REPORT_ALREADY_HANDLED', '该举报已处理')
  }

  const targetId = Number(report.targetId)
  const summaries = await loadCommunityTargetSummaries([
    { targetType: report.targetType, targetId }
  ])
  const summary = summaries.get(`${report.targetType}:${targetId}`) || null

  // 审帖员只能处理负责板块的帖子/评论；用户举报不归属板块
  if (summary?.board) {
    await assertCommunityBoardAccess(user, summary.board.id)
  }

  if (report.targetType === 'USER') {
    if (action === 'ACCEPT_DELETE') {
      throw createApiError(
        400,
        'COMMUNITY_REPORT_ACTION_INVALID',
        '用户举报不支持删除操作，请选择影子封禁或驳回'
      )
    }
    // 影子封禁不得针对管理员，与拉黑接口保持同一约束（审帖员不得限制管理员内容展示）
    if (action === 'ACCEPT_HIDE') {
      const [targetUser] = await db
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, targetId))
        .limit(1)
      if (isCommunityAdmin(targetUser)) {
        throw createApiError(400, 'COMMUNITY_REPORT_ADMIN_FORBIDDEN', '不能对管理员执行内容展示限制')
      }
    }
  }

  const now = getServerDate()
  const label =
    report.targetType === 'POST'
      ? `帖子 #${targetId}`
      : report.targetType === 'COMMENT'
        ? `评论 #${targetId}`
        : `用户 #${targetId}`
  const status =
    action === 'REJECT' ? COMMUNITY_REPORT_STATUS.REJECTED : COMMUNITY_REPORT_STATUS.ACCEPTED
  const noteText = resultNote || null

  // 内容侧动作结果：hidden / deleted / shadowBanned / none
  let contentAction: 'hidden' | 'deleted' | 'shadowBanned' | 'none' = 'none'

  await db.transaction(async (tx) => {
    // 条件更新举报记录，保证同一条举报只会被处理一次
    const [claimed] = await tx
      .update(communityReports)
      .set({
        status,
        handledBy: user.id,
        handledAt: now,
        resultNote: noteText,
        actionTaken: action
      })
      .where(
        and(
          eq(communityReports.id, reportId),
          eq(communityReports.status, COMMUNITY_REPORT_STATUS.PENDING)
        )
      )
      .returning({ id: communityReports.id })
    if (!claimed) {
      throw createApiError(409, 'COMMUNITY_REPORT_ALREADY_HANDLED', '该举报已处理')
    }

    if (action === 'REJECT') return

    if (report.targetType === 'POST') {
      if (action === 'ACCEPT_HIDE') {
        const [updated] = await tx
          .update(communityPosts)
          .set({ status: 'PENDING', updatedAt: now })
          .where(and(eq(communityPosts.id, targetId), isNull(communityPosts.deletedAt)))
          .returning({ id: communityPosts.id })
        if (updated) contentAction = 'hidden'
      } else {
        const [updated] = await tx
          .update(communityPosts)
          .set({
            deletedAt: now,
            deletedBy: user.id,
            deleteType: 'DELETE',
            deleteReason: resultNote || '举报成立',
            purgeAt: new Date(now.getTime() + COMMUNITY_ARCHIVE_RETENTION_MS),
            updatedAt: now
          })
          .where(and(eq(communityPosts.id, targetId), isNull(communityPosts.deletedAt)))
          .returning({ id: communityPosts.id })
        if (updated) contentAction = 'deleted'
      }
      return
    }

    if (report.targetType === 'COMMENT') {
      if (action === 'ACCEPT_HIDE') {
        const [updated] = await tx
          .update(communityComments)
          .set({ status: 'PENDING' })
          .where(and(eq(communityComments.id, targetId), isNull(communityComments.deletedAt)))
          .returning({ id: communityComments.id })
        if (updated) contentAction = 'hidden'
      } else {
        const [updated] = await tx
          .update(communityComments)
          .set({
            deletedAt: now,
            deletedBy: user.id,
            deleteType: 'DELETE',
            deleteReason: resultNote || '举报成立',
            purgeAt: new Date(now.getTime() + COMMUNITY_ARCHIVE_RETENTION_MS)
          })
          .where(and(eq(communityComments.id, targetId), isNull(communityComments.deletedAt)))
          .returning({ id: communityComments.id })
        if (updated) contentAction = 'deleted'
      }
      return
    }

    // USER + ACCEPT_HIDE：影子封禁
    await tx
      .insert(communityProfiles)
      .values({ userId: targetId, shadowBanned: true })
      .onConflictDoUpdate({
        target: communityProfiles.userId,
        set: { shadowBanned: true, updatedAt: now }
      })
    contentAction = 'shadowBanned'
  })

  // 通知举报人与被举报人
  const notifications: Array<{ userId: number; title: string; message: string }> = []
  const acceptText = action === 'REJECT' ? '未通过' : '已成立'
  notifications.push({
    userId: report.reporterId,
    title: action === 'REJECT' ? '回声社区：举报已处理' : '回声社区：举报成立',
    message: `你举报的${label}经复核${acceptText}。${
      action === 'ACCEPT_HIDE' && report.targetType !== 'USER'
        ? '内容已被隐藏并转为待审核。'
        : action === 'ACCEPT_DELETE'
          ? '内容已被删除（保留 30 天归档）。'
          : action === 'ACCEPT_HIDE' && report.targetType === 'USER'
            ? '该用户已被限制内容展示。'
            : ''
    }${noteText ? `处理备注：${noteText}` : ''}`
  })

  const targetAuthorId = summary?.author?.id || (report.targetType === 'USER' ? targetId : 0)
  if (targetAuthorId) {
    if (action === 'ACCEPT_HIDE' && report.targetType !== 'USER') {
      notifications.push({
        userId: targetAuthorId,
        title: '回声社区：内容已隐藏',
        message: `你发布的${label.replace(' ', '')}因被举报，已被管理员隐藏并转为待审核。${
          noteText ? `原因：${noteText}。` : ''
        }如认为处理有误，可通过社区申诉入口提交申诉。`
      })
    } else if (action === 'ACCEPT_DELETE') {
      notifications.push({
        userId: targetAuthorId,
        title: '回声社区：内容已被删除',
        message: `你发布的${label.replace(' ', '')}因被举报已被管理员删除，归档保留 30 天。${
          noteText ? `原因：${noteText}。` : ''
        }可通过社区申诉入口提交申诉。`
      })
    } else if (action === 'ACCEPT_HIDE' && report.targetType === 'USER') {
      notifications.push({
        userId: targetAuthorId,
        title: '回声社区：内容展示受限',
        message: `你的社区内容展示已受限（仅你本人和管理员可见）。${
          noteText ? `原因：${noteText}。` : ''
        }如认为处理有误，可通过社区申诉入口提交申诉。`
      })
    }
  }

  await insertCommunityNotifications(
    notifications.map((item) => ({
      userId: item.userId,
      type: 'COMMUNITY_REPORT_HANDLED',
      title: item.title,
      message: item.message
    }))
  )

  await writeAdminAudit(event, {
    action: `COMMUNITY_REPORT_${action}`,
    target: `社区举报 #${reportId}`,
    detail: `目标：${report.targetType} #${targetId}；处理：${ACTION_LABELS[action] || action}；内容动作：${contentAction}${
      noteText ? `；备注：${noteText}` : ''
    }`
  })

  return { success: true, status, actionTaken: action, contentAction }
})
