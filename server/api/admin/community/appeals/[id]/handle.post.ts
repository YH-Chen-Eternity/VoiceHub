import { getRouterParam, readBody } from 'h3'
import { and, eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import {
  communityAppeals,
  communityComments,
  communityPosts,
  communityProfiles
} from '~/drizzle/schema'
import { assertCommunityBoardAccess, requireCommunityReviewer } from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'
import { writeAdminAudit } from '~~/server/utils/adminAudit'
import { getServerDate } from '~~/server/utils/serverTime'
import type { CommunityAppealAction } from '~~/server/utils/communityRelations'
import {
  COMMUNITY_APPEAL_ACTIONS,
  COMMUNITY_REPORT_STATUS,
  insertCommunityNotifications,
  loadCommunityTargetSummaries
} from '~~/server/utils/communityRelations'

const ACTION_LABELS: Record<string, string> = {
  ACCEPT: '通过并恢复',
  REJECT: '驳回'
}

/**
 * 处理社区申诉。
 * POST /api/admin/community/appeals/:id/handle
 * body: { action: ACCEPT|REJECT, resultNote? }
 * - MUTE：ACCEPT 解除禁言；
 * - POST / COMMENT：ACCEPT 恢复软删除内容（清除 deletedAt / purgeAt）；
 * - REJECT：仅记录驳回结果。
 */
export default defineEventHandler(async (event) => {
  const user = requireCommunityReviewer(event)

  const appealId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(appealId) || appealId <= 0) {
    throw createApiError(400, 'COMMUNITY_APPEAL_INVALID', '申诉参数不正确')
  }

  const body = await readBody(event).catch(() => null)
  const action = String(body?.action || '')
    .trim()
    .toUpperCase()
  if (!COMMUNITY_APPEAL_ACTIONS.includes(action as CommunityAppealAction)) {
    throw createApiError(400, 'COMMUNITY_APPEAL_ACTION_INVALID', '处理操作不正确')
  }
  const resultNote = String(body?.resultNote ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
    .slice(0, 300)

  const appealRows = await db
    .select()
    .from(communityAppeals)
    .where(eq(communityAppeals.id, appealId))
    .limit(1)
  const appeal = appealRows[0]
  if (!appeal) {
    throw createApiError(404, 'COMMUNITY_APPEAL_NOT_FOUND', '申诉记录不存在')
  }
  if (appeal.status !== COMMUNITY_REPORT_STATUS.PENDING) {
    throw createApiError(409, 'COMMUNITY_APPEAL_ALREADY_HANDLED', '该申诉已处理')
  }

  const targetId = Number(appeal.targetId)
  const summaries = await loadCommunityTargetSummaries([
    { targetType: appeal.targetType, targetId }
  ])
  const summary = summaries.get(`${appeal.targetType}:${targetId}`) || null

  // 审帖员只能处理负责板块的帖子/评论申诉；禁言申诉不归属板块
  if (summary?.board) {
    await assertCommunityBoardAccess(user, summary.board.id)
  }
  if (action === 'ACCEPT' && appeal.targetType !== 'MUTE' && !summary?.exists) {
    throw createApiError(409, 'COMMUNITY_APPEAL_TARGET_GONE', '目标内容已被清理，无法恢复')
  }

  const now = getServerDate()
  const status =
    action === 'ACCEPT' ? COMMUNITY_REPORT_STATUS.ACCEPTED : COMMUNITY_REPORT_STATUS.REJECTED
  const noteText = resultNote || null
  let restored = false

  await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(communityAppeals)
      .set({ status, handledBy: user.id, handledAt: now, resultNote: noteText })
      .where(
        and(
          eq(communityAppeals.id, appealId),
          eq(communityAppeals.status, COMMUNITY_REPORT_STATUS.PENDING)
        )
      )
      .returning({ id: communityAppeals.id })
    if (!claimed) {
      throw createApiError(409, 'COMMUNITY_APPEAL_ALREADY_HANDLED', '该申诉已处理')
    }

    if (action !== 'ACCEPT') return

    if (appeal.targetType === 'POST') {
      const [updated] = await tx
        .update(communityPosts)
        .set({
          deletedAt: null,
          deletedBy: null,
          deleteType: null,
          deleteReason: null,
          purgeAt: null,
          updatedAt: now
        })
        .where(eq(communityPosts.id, targetId))
        .returning({ id: communityPosts.id })
      restored = !!updated
      return
    }

    if (appeal.targetType === 'COMMENT') {
      const [updated] = await tx
        .update(communityComments)
        .set({
          deletedAt: null,
          deletedBy: null,
          deleteType: null,
          deleteReason: null,
          purgeAt: null
        })
        .where(eq(communityComments.id, targetId))
        .returning({ id: communityComments.id })
      restored = !!updated
      return
    }

    // MUTE：解除禁言
    await tx.insert(communityProfiles).values({ userId: appeal.userId }).onConflictDoNothing()
    const [updated] = await tx
      .update(communityProfiles)
      .set({ banned: false, bannedUntil: null, banReason: null, updatedAt: now })
      .where(eq(communityProfiles.userId, appeal.userId))
      .returning({ userId: communityProfiles.userId })
    restored = !!updated
  })

  const targetLabel =
    appeal.targetType === 'POST' ? '帖子' : appeal.targetType === 'COMMENT' ? '评论' : '禁言'
  const acceptedMessage =
    appeal.targetType === 'MUTE'
      ? `你提交的禁言申诉已通过，禁言已解除。${noteText ? `处理备注：${noteText}` : ''}`
      : `你提交的${targetLabel}申诉已通过，内容已恢复。${noteText ? `处理备注：${noteText}` : ''}`
  const rejectedMessage = `你提交的${targetLabel}申诉未通过。${
    noteText ? `处理备注：${noteText}` : ''
  }`

  await insertCommunityNotifications([
    {
      userId: appeal.userId,
      type: 'COMMUNITY_APPEAL_HANDLED',
      title: action === 'ACCEPT' ? '回声社区：申诉已通过' : '回声社区：申诉未通过',
      message: action === 'ACCEPT' ? acceptedMessage : rejectedMessage
    }
  ])

  await writeAdminAudit(event, {
    action: `COMMUNITY_APPEAL_${action}`,
    target: `社区申诉 #${appealId}`,
    detail: `申诉人：用户 #${appeal.userId}；目标：${appeal.targetType} #${targetId}；处理：${
      ACTION_LABELS[action] || action
    }${restored ? '（已恢复）' : ''}${noteText ? `；备注：${noteText}` : ''}`
  })

  return { success: true, status, restored }
})
