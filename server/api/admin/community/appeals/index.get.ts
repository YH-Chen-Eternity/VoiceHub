import { getQuery } from 'h3'
import { and, count, desc, eq, inArray } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityAppeals, users } from '~/drizzle/schema'
import { getReviewableBoardIds, requireCommunityReviewer } from '~~/server/utils/community'
import { formatDateTime } from '~/utils/timeUtils'
import type { CommunityAppealTargetType } from '~~/server/utils/communityRelations'
import {
  COMMUNITY_APPEAL_TARGET_TYPES,
  buildCommunityAppealScope,
  loadCommunityTargetSummaries,
  loadPendingAppealCounts
} from '~~/server/utils/communityRelations'

const STATUS_FILTERS = ['PENDING', 'ACCEPTED', 'REJECTED', 'ALL']

type UserRef = { id: number; name: string; username: string | null }

function userRef(
  row: { id: number; name: string | null; username: string | null } | undefined
): UserRef | null {
  if (!row) return null
  return {
    id: Number(row.id),
    name: String(row.name || row.username || '已注销用户'),
    username: row.username || null
  }
}

/**
 * 管理端申诉队列。
 * GET /api/admin/community/appeals?status=PENDING|ACCEPTED|REJECTED|ALL&targetType=&page=1&pageSize=20
 * 鉴权：管理员 / 超级管理员 / 审帖员（审帖员仅限负责板块的帖子、评论申诉；禁言申诉不归属板块）
 */
export default defineEventHandler(async (event) => {
  const user = requireCommunityReviewer(event)
  const query = getQuery(event)

  const requestedStatus = String(query.status || 'PENDING')
    .trim()
    .toUpperCase()
  const status = STATUS_FILTERS.includes(requestedStatus) ? requestedStatus : 'PENDING'
  const requestedType = String(query.targetType || '')
    .trim()
    .toUpperCase()
  const targetType = COMMUNITY_APPEAL_TARGET_TYPES.includes(
    requestedType as CommunityAppealTargetType
  )
    ? requestedType
    : ''
  const page = Math.max(Number(query.page || 1) || 1, 1)
  const pageSize = Math.min(Math.max(Number(query.pageSize || 20) || 20, 1), 50)

  const scopedBoardIds = await getReviewableBoardIds(user)
  const scope = buildCommunityAppealScope(scopedBoardIds)

  const filterConditions = []
  if (status !== 'ALL') filterConditions.push(eq(communityAppeals.status, status))
  if (targetType) filterConditions.push(eq(communityAppeals.targetType, targetType))
  if (scope) filterConditions.push(scope)
  const where = filterConditions.length ? and(...filterConditions) : undefined

  const [statsRows, totalRows, appealRows] = await Promise.all([
    db
      .select({ status: communityAppeals.status, value: count() })
      .from(communityAppeals)
      .where(scope)
      .groupBy(communityAppeals.status),
    db.select({ value: count() }).from(communityAppeals).where(where),
    db
      .select({
        id: communityAppeals.id,
        createdAt: communityAppeals.createdAt,
        targetType: communityAppeals.targetType,
        targetId: communityAppeals.targetId,
        reason: communityAppeals.reason,
        status: communityAppeals.status,
        handledBy: communityAppeals.handledBy,
        handledAt: communityAppeals.handledAt,
        resultNote: communityAppeals.resultNote,
        applicantId: users.id,
        applicantName: users.name,
        applicantUsername: users.username
      })
      .from(communityAppeals)
      .innerJoin(users, eq(users.id, communityAppeals.userId))
      .where(where)
      .orderBy(desc(communityAppeals.createdAt), desc(communityAppeals.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize)
  ])

  const total = Number(totalRows[0]?.value || 0)
  const stats = { PENDING: 0, ACCEPTED: 0, REJECTED: 0, total: 0 }
  for (const row of statsRows) {
    const key = String(row.status || '')
    if (key === 'PENDING' || key === 'ACCEPTED' || key === 'REJECTED') {
      stats[key] = Number(row.value || 0)
    }
    stats.total += Number(row.value || 0)
  }

  const targets = appealRows.map((row) => ({
    targetType: row.targetType,
    targetId: Number(row.targetId)
  }))
  const [summaries, pendingCounts] = await Promise.all([
    loadCommunityTargetSummaries(targets),
    loadPendingAppealCounts(targets)
  ])

  const handlerIds = Array.from(
    new Set(
      appealRows.map((row) => Number(row.handledBy)).filter((id) => Number.isInteger(id) && id > 0)
    )
  )
  const handlerRows = handlerIds.length
    ? await db
        .select({ id: users.id, name: users.name, username: users.username })
        .from(users)
        .where(inArray(users.id, handlerIds))
    : []
  const handlerMap = new Map(handlerRows.map((row) => [row.id, row]))

  return {
    success: true,
    status,
    targetType: targetType || 'ALL',
    stats,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(Math.ceil(total / pageSize), 1)
    },
    appeals: appealRows.map((row) => {
      const key = `${row.targetType}:${Number(row.targetId)}`
      const summary = summaries.get(key)
      const handler = row.handledBy ? handlerMap.get(Number(row.handledBy)) : undefined
      return {
        id: row.id,
        createdAt: row.createdAt,
        createdAtText: row.createdAt ? formatDateTime(row.createdAt) : null,
        targetType: row.targetType,
        targetId: Number(row.targetId),
        reason: row.reason,
        status: row.status,
        resultNote: row.resultNote || null,
        handledAt: row.handledAt || null,
        handledAtText: row.handledAt ? formatDateTime(row.handledAt) : null,
        handledBy: handler ? userRef(handler) : null,
        applicant: userRef({
          id: row.applicantId,
          name: row.applicantName,
          username: row.applicantUsername
        }),
        target: summary
          ? {
              ...summary,
              pendingAppealCount: pendingCounts.get(key) || 0
            }
          : null
      }
    })
  }
})
