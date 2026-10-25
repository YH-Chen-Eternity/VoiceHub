import { readBody } from 'h3'
import { and, eq, inArray, isNull, ne } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityComments, communityPosts, notifications } from '~/drizzle/schema'
import {
  applyCommunityViolation,
  formatCommunityMuteNotice,
  getReviewableBoardIds,
  isCommunityAdmin,
  requireCommunityReviewer
} from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'
import { writeAdminAudit } from '~~/server/utils/adminAudit'
import { getServerDate } from '~~/server/utils/serverTime'

const MAX_BATCH = 50
const CONTENT_TYPES = ['post', 'comment']
const ACTIONS = ['approve', 'reject']

type BatchTarget = {
  id: number
  boardId: number
  authorId: number
  status: string
  postAuthorId?: number
}

type SkippedItem = {
  id: number
  code: string
  message: string
}

/**
 * 批量通过/驳回社区帖子与评论。
 * 权限与单条审核一致：审帖员仅限负责板块且只能处理 PENDING，管理员可复核；
 * 驳回按条累计违规（与逐条审核口径一致），并写管理审计与站内通知。
 */
export default defineEventHandler(async (event) => {
  const user = requireCommunityReviewer(event)
  const body = await readBody(event)

  const type = String(body?.type || '')
    .trim()
    .toLowerCase()
  const action = String(body?.action || '')
    .trim()
    .toLowerCase()
  if (!CONTENT_TYPES.includes(type)) {
    throw createApiError(400, 'COMMUNITY_BATCH_TYPE_INVALID', '批量审核类型不正确')
  }
  if (!ACTIONS.includes(action)) {
    throw createApiError(400, 'COMMUNITY_BATCH_ACTION_INVALID', '批量审核操作不正确')
  }

  const rawIds = Array.isArray(body?.ids) ? body.ids : []
  const ids: number[] = Array.from(
    new Set(
      rawIds.map((id: unknown) => Number(id)).filter((id: number) => Number.isInteger(id) && id > 0)
    )
  )
  if (!ids.length) {
    throw createApiError(400, 'COMMUNITY_BATCH_IDS_REQUIRED', '请选择要审核的内容')
  }
  if (ids.length > MAX_BATCH) {
    throw createApiError(400, 'COMMUNITY_BATCH_TOO_MANY', `单次最多批量审核 ${MAX_BATCH} 条`, {
      params: [MAX_BATCH]
    })
  }
  const note = String(body?.note || '')
    .trim()
    .slice(0, 200)
  const admin = isCommunityAdmin(user)
  const scopedBoardIds = await getReviewableBoardIds(user)
  const now = getServerDate()

  // 1. 读取目标并做权限/状态预检
  const targetMap = new Map<number, BatchTarget>()
  if (type === 'post') {
    const rows = await db
      .select({
        id: communityPosts.id,
        boardId: communityPosts.boardId,
        authorId: communityPosts.authorId,
        status: communityPosts.status
      })
      .from(communityPosts)
      .where(and(inArray(communityPosts.id, ids), isNull(communityPosts.deletedAt)))
    for (const row of rows) targetMap.set(row.id, row)
  } else {
    const rows = await db
      .select({
        id: communityComments.id,
        authorId: communityComments.authorId,
        status: communityComments.status,
        postId: communityPosts.id,
        boardId: communityPosts.boardId,
        postAuthorId: communityPosts.authorId,
        postStatus: communityPosts.status,
        postDeletedAt: communityPosts.deletedAt
      })
      .from(communityComments)
      .innerJoin(communityPosts, eq(communityPosts.id, communityComments.postId))
      .where(and(inArray(communityComments.id, ids), isNull(communityComments.deletedAt)))
    for (const row of rows) {
      if (row.postDeletedAt || row.postStatus !== 'APPROVED') continue
      targetMap.set(row.id, {
        id: row.id,
        boardId: row.boardId,
        authorId: row.authorId,
        status: row.status,
        postAuthorId: row.postAuthorId
      })
    }
  }

  const skipped: SkippedItem[] = []
  const eligible: BatchTarget[] = []
  for (const id of ids) {
    const target = targetMap.get(id)
    if (!target) {
      skipped.push({ id, code: 'NOT_FOUND', message: '内容不存在、已删除或所属帖子未公开' })
      continue
    }
    if (scopedBoardIds && !scopedBoardIds.includes(target.boardId)) {
      skipped.push({ id, code: 'FORBIDDEN', message: '没有该板块的审核权限' })
      continue
    }
    if (action === 'approve') {
      if (target.status === 'APPROVED') {
        skipped.push({ id, code: 'ALREADY_HANDLED', message: '内容已通过审核' })
        continue
      }
      if (!admin && target.status !== 'PENDING') {
        skipped.push({ id, code: 'ALREADY_HANDLED', message: '内容已被其他审帖员处理' })
        continue
      }
    } else if (target.status !== 'PENDING') {
      skipped.push({ id, code: 'ALREADY_HANDLED', message: '内容已被其他审帖员处理' })
      continue
    }
    eligible.push(target)
  }

  // 2. 事务内条件更新，驳回时按条累计违规
  const approvedRows: BatchTarget[] = []
  const rejectedRows: BatchTarget[] = []
  const violationByAuthor = new Map<
    number,
    { violationCount: number; banned: boolean; bannedUntil: Date | null; banReason: string | null }
  >()

  await db.transaction(async (tx) => {
    const eligibleIds = eligible.map((target) => target.id)
    if (!eligibleIds.length) return
    const targetById = new Map(eligible.map((target) => [target.id, target]))

    if (action === 'approve') {
      if (type === 'post') {
        const updated = await tx
          .update(communityPosts)
          .set({
            status: 'APPROVED',
            reviewedBy: user.id,
            reviewedAt: now,
            reviewNote: note || null,
            updatedAt: now
          })
          .where(
            and(
              inArray(communityPosts.id, eligibleIds),
              isNull(communityPosts.deletedAt),
              ne(communityPosts.status, 'APPROVED'),
              admin ? undefined : eq(communityPosts.status, 'PENDING')
            )
          )
          .returning({ id: communityPosts.id, authorId: communityPosts.authorId })
        for (const row of updated) {
          approvedRows.push({ ...targetById.get(row.id)!, authorId: row.authorId })
        }
      } else {
        const updated = await tx
          .update(communityComments)
          .set({
            status: 'APPROVED',
            reviewedBy: user.id,
            reviewedAt: now,
            reviewNote: note || null
          })
          .where(
            and(
              inArray(communityComments.id, eligibleIds),
              isNull(communityComments.deletedAt),
              ne(communityComments.status, 'APPROVED'),
              admin ? undefined : eq(communityComments.status, 'PENDING')
            )
          )
          .returning({ id: communityComments.id, authorId: communityComments.authorId })
        for (const row of updated) {
          approvedRows.push({ ...targetById.get(row.id)!, authorId: row.authorId })
        }
      }
    } else if (type === 'post') {
      const updated = await tx
        .update(communityPosts)
        .set({
          status: 'REJECTED',
          reviewedBy: user.id,
          reviewedAt: now,
          reviewNote: note || null,
          updatedAt: now
        })
        .where(
          and(
            inArray(communityPosts.id, eligibleIds),
            isNull(communityPosts.deletedAt),
            eq(communityPosts.status, 'PENDING')
          )
        )
        .returning({ id: communityPosts.id, authorId: communityPosts.authorId })
      for (const row of updated) {
        rejectedRows.push({ ...targetById.get(row.id)!, authorId: row.authorId })
        violationByAuthor.set(row.authorId, await applyCommunityViolation(tx, row.authorId))
      }
    } else {
      const updated = await tx
        .update(communityComments)
        .set({
          status: 'REJECTED',
          reviewedBy: user.id,
          reviewedAt: now,
          reviewNote: note || null
        })
        .where(
          and(
            inArray(communityComments.id, eligibleIds),
            isNull(communityComments.deletedAt),
            eq(communityComments.status, 'PENDING')
          )
        )
        .returning({ id: communityComments.id, authorId: communityComments.authorId })
      for (const row of updated) {
        rejectedRows.push({ ...targetById.get(row.id)!, authorId: row.authorId })
        violationByAuthor.set(row.authorId, await applyCommunityViolation(tx, row.authorId))
      }
    }

    // 并发下条件更新可能少生效，未生效的补记为已处理
    const updatedIds = new Set([...approvedRows, ...rejectedRows].map((row) => row.id))
    for (const target of eligible) {
      if (!updatedIds.has(target.id)) {
        skipped.push({ id: target.id, code: 'ALREADY_HANDLED', message: '内容已被其他审帖员处理' })
      }
    }
  })

  const contentTypeLabel = type === 'post' ? '帖子' : '评论'
  const notificationRows: Array<typeof notifications.$inferInsert> = []

  // 3. 审核通过通知：按作者聚合，避免批量操作轰炸收件箱
  const approvedCountByAuthor = new Map<number, number>()
  if (action === 'approve') {
    for (const row of approvedRows) {
      approvedCountByAuthor.set(row.authorId, (approvedCountByAuthor.get(row.authorId) || 0) + 1)
    }
    for (const [authorId, total] of approvedCountByAuthor) {
      notificationRows.push({
        userId: authorId,
        type: type === 'post' ? 'COMMUNITY_POST_APPROVED' : 'COMMUNITY_COMMENT_APPROVED',
        source: 'COMMUNITY',
        title: `回声社区：${contentTypeLabel}已通过审核`,
        message:
          total > 1
            ? `你的 ${total} 条${contentTypeLabel}已通过审核。`
            : `你的${contentTypeLabel}已通过审核，现在可以在回声社区看到了。`
      })
    }
    // 评论通过后补发帖主通知（与单条审核口径一致）
    if (type === 'comment') {
      const countByPostAuthor = new Map<number, number>()
      for (const row of approvedRows) {
        if (!row.postAuthorId || row.postAuthorId === row.authorId) continue
        countByPostAuthor.set(row.postAuthorId, (countByPostAuthor.get(row.postAuthorId) || 0) + 1)
      }
      for (const [postAuthorId, total] of countByPostAuthor) {
        notificationRows.push({
          userId: postAuthorId,
          type: 'COMMUNITY_COMMENT',
          source: 'COMMUNITY',
          title: '回声社区有新评论',
          message: `你的帖子收到 ${total} 条通过审核的新评论。`
        })
      }
    }
  } else {
    // 4. 驳回通知：按作者聚合，附带累计违规与禁言提示
    const rejectedCountByAuthor = new Map<number, number>()
    for (const row of rejectedRows) {
      rejectedCountByAuthor.set(row.authorId, (rejectedCountByAuthor.get(row.authorId) || 0) + 1)
    }
    for (const [authorId, total] of rejectedCountByAuthor) {
      const violation = violationByAuthor.get(authorId)
      const violationCount = Number(violation?.violationCount || 0)
      notificationRows.push({
        userId: authorId,
        type: type === 'post' ? 'COMMUNITY_POST_REJECTED' : 'COMMUNITY_COMMENT_REJECTED',
        source: 'COMMUNITY',
        title: `回声社区：${contentTypeLabel}未通过审核`,
        message: `你的 ${total} 条${contentTypeLabel}未通过审核，记违规 ${total} 次（近 30 天累计 ${violationCount} 次）。${
          note ? `审核说明：${note}。` : ''
        }${formatCommunityMuteNotice(violationCount)}`
      })
    }
  }

  if (notificationRows.length) {
    try {
      await db.insert(notifications).values(notificationRows)
    } catch (error) {
      console.error('[community] 批量审核通知写入失败:', error)
    }
  }

  const processed = approvedRows.length + rejectedRows.length
  const updatedIds = [...approvedRows, ...rejectedRows].map((row) => row.id)
  await writeAdminAudit(event, {
    action: 'COMMUNITY_BATCH_REVIEW',
    target: `社区${contentTypeLabel} #${ids.join(',')}`,
    detail: `批量${action === 'approve' ? '通过' : '驳回'} ${processed} 条${
      note ? `；审核说明：${note}` : ''
    }`
  })

  return {
    success: true,
    type,
    action,
    requested: ids.length,
    processed,
    updatedIds,
    skipped,
    violations: Array.from(violationByAuthor.entries()).map(([authorId, violation]) => ({
      authorId,
      violationCount: violation.violationCount,
      muted: violation.banned,
      permanent: violation.banned && !violation.bannedUntil,
      until: violation.bannedUntil,
      reason: violation.banReason
    }))
  }
})
