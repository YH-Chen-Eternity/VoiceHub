import { getQuery } from 'h3'
import { and, count, desc, eq, inArray } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityReports, users } from '~/drizzle/schema'
import { getReviewableBoardIds, requireCommunityReviewer } from '~~/server/utils/community'
import { formatDateTime } from '~/utils/timeUtils'
import type { CommunityReportTargetType } from '~~/server/utils/communityRelations'
import {
  COMMUNITY_REPORT_TARGET_TYPES,
  buildCommunityReportScope,
  loadCommunityTargetSummaries
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
 * 管理端举报队列。
 * GET /api/admin/community/reports?status=PENDING|ACCEPTED|REJECTED|ALL&targetType=&page=1&pageSize=20
 * 鉴权：管理员 / 超级管理员 / 审帖员（审帖员仅限负责板块的帖子、评论举报）
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
  const targetType = COMMUNITY_REPORT_TARGET_TYPES.includes(
    requestedType as CommunityReportTargetType
  )
    ? requestedType
    : ''
  const page = Math.max(Number(query.page || 1) || 1, 1)
  const pageSize = Math.min(Math.max(Number(query.pageSize || 20) || 20, 1), 50)

  const scopedBoardIds = await getReviewableBoardIds(user)
  const scope = buildCommunityReportScope(scopedBoardIds)

  const filterConditions = []
  if (status !== 'ALL') filterConditions.push(eq(communityReports.status, status))
  if (targetType) filterConditions.push(eq(communityReports.targetType, targetType))
  if (scope) filterConditions.push(scope)
  const where = filterConditions.length ? and(...filterConditions) : undefined

  const [statsRows, totalRows, reportRows] = await Promise.all([
    db
      .select({ status: communityReports.status, value: count() })
      .from(communityReports)
      .where(scope)
      .groupBy(communityReports.status),
    db.select({ value: count() }).from(communityReports).where(where),
    db
      .select({
        id: communityReports.id,
        createdAt: communityReports.createdAt,
        targetType: communityReports.targetType,
        targetId: communityReports.targetId,
        reasonCode: communityReports.reasonCode,
        detail: communityReports.detail,
        status: communityReports.status,
        handledBy: communityReports.handledBy,
        handledAt: communityReports.handledAt,
        resultNote: communityReports.resultNote,
        actionTaken: communityReports.actionTaken,
        reporterId: users.id,
        reporterName: users.name,
        reporterUsername: users.username
      })
      .from(communityReports)
      .innerJoin(users, eq(users.id, communityReports.reporterId))
      .where(where)
      .orderBy(desc(communityReports.createdAt), desc(communityReports.id))
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

  const summaries = await loadCommunityTargetSummaries(
    reportRows.map((row) => ({ targetType: row.targetType, targetId: Number(row.targetId) }))
  )

  const handlerIds = Array.from(
    new Set(
      reportRows.map((row) => Number(row.handledBy)).filter((id) => Number.isInteger(id) && id > 0)
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
    reports: reportRows.map((row) => {
      const summary = summaries.get(`${row.targetType}:${Number(row.targetId)}`)
      const handler = row.handledBy ? handlerMap.get(Number(row.handledBy)) : undefined
      return {
        id: row.id,
        createdAt: row.createdAt,
        createdAtText: row.createdAt ? formatDateTime(row.createdAt) : null,
        targetType: row.targetType,
        targetId: Number(row.targetId),
        reasonCode: row.reasonCode,
        detail: row.detail || null,
        status: row.status,
        actionTaken: row.actionTaken || null,
        resultNote: row.resultNote || null,
        handledAt: row.handledAt || null,
        handledAtText: row.handledAt ? formatDateTime(row.handledAt) : null,
        handledBy: handler ? userRef(handler) : null,
        reporter: userRef({
          id: row.reporterId,
          name: row.reporterName,
          username: row.reporterUsername
        }),
        target: summary || null
      }
    })
  }
})
