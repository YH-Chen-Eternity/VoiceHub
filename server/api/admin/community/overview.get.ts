import { and, asc, count, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import {
  communityAppeals,
  communityBoards,
  communityComments,
  communityPosts,
  communityReports,
  users
} from '~/drizzle/schema'
import { getReviewableBoardIds, requireCommunityReviewer } from '~~/server/utils/community'
import { getServerDate, getServerTimestamp } from '~~/server/utils/serverTime'
import { formatDateTime, getBeijingEndOfDay, getBeijingStartOfDay } from '~/utils/timeUtils'

const TREND_DAYS = 7
const WORKLOAD_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000
const REVIEWED_STATUSES = ['APPROVED', 'REJECTED', 'BLOCKED']

/** 审核耗时（秒）：reviewedAt - createdAt，空值按 0 处理 */
const durationSecondsSql = (reviewedAtCol: any, createdAtCol: any) =>
  sql<number>`coalesce(avg(extract(epoch from (${reviewedAtCol} - ${createdAtCol}))), 0)`

/**
 * 审核运营看板数据。
 * 审帖员只能看到自己负责板块的数据；管理员（或未分配板块的审帖员）为全站。
 */
export default defineEventHandler(async (event) => {
  const user = requireCommunityReviewer(event)
  const scopedBoardIds = await getReviewableBoardIds(user)
  const boardIds =
    scopedBoardIds && scopedBoardIds.length > 0 ? scopedBoardIds : scopedBoardIds ? [-1] : null
  const postScope = boardIds ? inArray(communityPosts.boardId, boardIds) : undefined

  const now = getServerDate()
  const todayStart = getBeijingStartOfDay(now)
  const todayEnd = getBeijingEndOfDay(now)
  const trendStart = getBeijingStartOfDay(
    new Date(getServerTimestamp() - (TREND_DAYS - 1) * DAY_MS)
  )
  const workloadStart = new Date(getServerTimestamp() - WORKLOAD_DAYS * DAY_MS)

  const postsWhere = (extra: any) => (postScope ? and(extra, postScope) : extra)
  const commentsWhere = (extra: any) =>
    postScope
      ? and(extra, isNull(communityPosts.deletedAt), postScope)
      : and(extra, isNull(communityPosts.deletedAt))

  const [
    pendingPostRows,
    pendingCommentRows,
    todayPostStatusRows,
    todayCommentStatusRows,
    postDurationRows,
    commentDurationRows,
    trendNewPostRows,
    trendNewCommentRows,
    trendReviewedPostRows,
    trendReviewedCommentRows,
    workloadPostRows,
    workloadCommentRows,
    pendingReportTotalRows,
    pendingUserReportRows,
    pendingAppealRows,
    boardRows
  ] = await Promise.all([
    db
      .select({ value: count() })
      .from(communityPosts)
      .where(
        postsWhere(and(eq(communityPosts.status, 'PENDING'), isNull(communityPosts.deletedAt)))
      ),
    db
      .select({ value: count() })
      .from(communityComments)
      .innerJoin(communityPosts, eq(communityPosts.id, communityComments.postId))
      .where(
        commentsWhere(
          and(
            eq(communityComments.status, 'PENDING'),
            isNull(communityComments.deletedAt),
            eq(communityPosts.status, 'APPROVED')
          )
        )
      ),
    db
      .select({
        status: communityPosts.status,
        value: count(),
        avgSeconds: durationSecondsSql(communityPosts.reviewedAt, communityPosts.createdAt)
      })
      .from(communityPosts)
      .where(
        postsWhere(
          and(
            isNotNull(communityPosts.reviewedAt),
            gte(communityPosts.reviewedAt, todayStart),
            lte(communityPosts.reviewedAt, todayEnd),
            isNull(communityPosts.deletedAt),
            inArray(communityPosts.status, REVIEWED_STATUSES)
          )
        )
      )
      .groupBy(communityPosts.status),
    db
      .select({
        status: communityComments.status,
        value: count(),
        avgSeconds: durationSecondsSql(communityComments.reviewedAt, communityComments.createdAt)
      })
      .from(communityComments)
      .innerJoin(communityPosts, eq(communityPosts.id, communityComments.postId))
      .where(
        commentsWhere(
          and(
            isNotNull(communityComments.reviewedAt),
            gte(communityComments.reviewedAt, todayStart),
            lte(communityComments.reviewedAt, todayEnd),
            isNull(communityComments.deletedAt),
            inArray(communityComments.status, REVIEWED_STATUSES)
          )
        )
      )
      .groupBy(communityComments.status),
    db
      .select({
        value: count(),
        avgSeconds: durationSecondsSql(communityPosts.reviewedAt, communityPosts.createdAt)
      })
      .from(communityPosts)
      .where(
        postsWhere(
          and(
            isNotNull(communityPosts.reviewedAt),
            gte(communityPosts.reviewedAt, workloadStart),
            isNull(communityPosts.deletedAt)
          )
        )
      ),
    db
      .select({
        value: count(),
        avgSeconds: durationSecondsSql(communityComments.reviewedAt, communityComments.createdAt)
      })
      .from(communityComments)
      .innerJoin(communityPosts, eq(communityPosts.id, communityComments.postId))
      .where(
        commentsWhere(
          and(
            isNotNull(communityComments.reviewedAt),
            gte(communityComments.reviewedAt, workloadStart),
            isNull(communityComments.deletedAt)
          )
        )
      ),
    db
      .select({ createdAt: communityPosts.createdAt })
      .from(communityPosts)
      .where(
        postsWhere(and(gte(communityPosts.createdAt, trendStart), isNull(communityPosts.deletedAt)))
      ),
    db
      .select({ createdAt: communityComments.createdAt })
      .from(communityComments)
      .innerJoin(communityPosts, eq(communityPosts.id, communityComments.postId))
      .where(
        commentsWhere(
          and(gte(communityComments.createdAt, trendStart), isNull(communityComments.deletedAt))
        )
      ),
    db
      .select({ reviewedAt: communityPosts.reviewedAt })
      .from(communityPosts)
      .where(
        postsWhere(
          and(isNotNull(communityPosts.reviewedAt), gte(communityPosts.reviewedAt, trendStart))
        )
      ),
    db
      .select({ reviewedAt: communityComments.reviewedAt })
      .from(communityComments)
      .innerJoin(communityPosts, eq(communityPosts.id, communityComments.postId))
      .where(
        commentsWhere(
          and(
            isNotNull(communityComments.reviewedAt),
            gte(communityComments.reviewedAt, trendStart)
          )
        )
      ),
    db
      .select({
        reviewerId: communityPosts.reviewedBy,
        status: communityPosts.status,
        value: count(),
        avgSeconds: durationSecondsSql(communityPosts.reviewedAt, communityPosts.createdAt)
      })
      .from(communityPosts)
      .where(
        postsWhere(
          and(
            isNotNull(communityPosts.reviewedBy),
            isNotNull(communityPosts.reviewedAt),
            gte(communityPosts.reviewedAt, workloadStart),
            isNull(communityPosts.deletedAt)
          )
        )
      )
      .groupBy(communityPosts.reviewedBy, communityPosts.status),
    db
      .select({
        reviewerId: communityComments.reviewedBy,
        status: communityComments.status,
        value: count(),
        avgSeconds: durationSecondsSql(communityComments.reviewedAt, communityComments.createdAt)
      })
      .from(communityComments)
      .innerJoin(communityPosts, eq(communityPosts.id, communityComments.postId))
      .where(
        commentsWhere(
          and(
            isNotNull(communityComments.reviewedBy),
            isNotNull(communityComments.reviewedAt),
            gte(communityComments.reviewedAt, workloadStart),
            isNull(communityComments.deletedAt)
          )
        )
      )
      .groupBy(communityComments.reviewedBy, communityComments.status),
    db
      .select({ value: count() })
      .from(communityReports)
      .where(eq(communityReports.status, 'PENDING')),
    db
      .select({ value: count() })
      .from(communityReports)
      .where(and(eq(communityReports.status, 'PENDING'), eq(communityReports.targetType, 'user'))),
    db
      .select({ value: count() })
      .from(communityAppeals)
      .where(eq(communityAppeals.status, 'PENDING')),
    db
      .select({ id: communityBoards.id, name: communityBoards.name })
      .from(communityBoards)
      .where(boardIds ? inArray(communityBoards.id, boardIds) : undefined)
      .orderBy(asc(communityBoards.sortOrder), asc(communityBoards.id))
  ])

  // 今日已审：帖子 + 评论按状态合并
  const today = { reviewed: 0, postsReviewed: 0, commentsReviewed: 0, approved: 0, rejected: 0 }
  const foldToday = (rows: any[], isPost: boolean) => {
    for (const row of rows) {
      const value = Number(row.value || 0)
      today.reviewed += value
      if (isPost) today.postsReviewed += value
      else today.commentsReviewed += value
      if (row.status === 'APPROVED') today.approved += value
      if (row.status === 'REJECTED') today.rejected += value
    }
  }
  foldToday(todayPostStatusRows, true)
  foldToday(todayCommentStatusRows, false)

  // 近 30 天平均审核耗时：帖子与评论按样本数加权合并
  const postDurationCount = Number(postDurationRows[0]?.value || 0)
  const postDurationAvg = Number(postDurationRows[0]?.avgSeconds || 0)
  const commentDurationCount = Number(commentDurationRows[0]?.value || 0)
  const commentDurationAvg = Number(commentDurationRows[0]?.avgSeconds || 0)
  const durationSample = postDurationCount + commentDurationCount
  const avgSeconds =
    durationSample > 0
      ? (postDurationAvg * postDurationCount + commentDurationAvg * commentDurationCount) /
        durationSample
      : 0

  // 近 7 天趋势：按北京时间日期聚合
  const days: Array<{ date: string }> = []
  const trendMap = new Map<
    string,
    { date: string; posts: number; comments: number; reviewed: number }
  >()
  for (let i = TREND_DAYS - 1; i >= 0; i -= 1) {
    const dayKey = formatDateTime(new Date(getServerTimestamp() - i * DAY_MS), 'YYYY-MM-DD')
    if (trendMap.has(dayKey)) continue
    days.push({ date: dayKey })
    trendMap.set(dayKey, { date: dayKey, posts: 0, comments: 0, reviewed: 0 })
  }
  const dayKeyOf = (value: Date | null | undefined) =>
    value ? formatDateTime(value, 'YYYY-MM-DD') : ''
  for (const row of trendNewPostRows) {
    const bucket = trendMap.get(dayKeyOf(row.createdAt))
    if (bucket) bucket.posts += 1
  }
  for (const row of trendNewCommentRows) {
    const bucket = trendMap.get(dayKeyOf(row.createdAt))
    if (bucket) bucket.comments += 1
  }
  for (const row of [...trendReviewedPostRows, ...trendReviewedCommentRows]) {
    const bucket = trendMap.get(dayKeyOf(row.reviewedAt))
    if (bucket) bucket.reviewed += 1
  }
  const trend = days.map((day) => trendMap.get(day.date)!)

  // 审帖员工作量：近 30 天按 reviewedBy 合并帖子与评论
  const reviewerMap = new Map<
    number,
    {
      reviewerId: number
      reviewed: number
      approved: number
      rejected: number
      secondsTotal: number
    }
  >()
  const mergeWorkload = (rows: any[]) => {
    for (const row of rows) {
      const reviewerId = Number(row.reviewerId || 0)
      if (!reviewerId) continue
      const value = Number(row.value || 0)
      const entry = reviewerMap.get(reviewerId) || {
        reviewerId,
        reviewed: 0,
        approved: 0,
        rejected: 0,
        secondsTotal: 0
      }
      entry.reviewed += value
      entry.secondsTotal += Number(row.avgSeconds || 0) * value
      if (row.status === 'APPROVED') entry.approved += value
      if (row.status === 'REJECTED') entry.rejected += value
      reviewerMap.set(reviewerId, entry)
    }
  }
  mergeWorkload(workloadPostRows)
  mergeWorkload(workloadCommentRows)

  const reviewerIds = Array.from(reviewerMap.keys())
  const reviewerRows = reviewerIds.length
    ? await db
        .select({ id: users.id, name: users.name, username: users.username })
        .from(users)
        .where(inArray(users.id, reviewerIds))
    : []
  const reviewerNameMap = new Map(reviewerRows.map((row) => [row.id, row]))
  const reviewers = reviewerIds
    .map((reviewerId) => {
      const entry = reviewerMap.get(reviewerId)!
      const info = reviewerNameMap.get(reviewerId)
      return {
        id: reviewerId,
        name: info?.name || '',
        username: info?.username || '',
        reviewed: entry.reviewed,
        approved: entry.approved,
        rejected: entry.rejected,
        avgSeconds: entry.reviewed > 0 ? entry.secondsTotal / entry.reviewed : 0
      }
    })
    .sort((a, b) => b.reviewed - a.reviewed)

  // 举报：审帖员只能处理自己板块内的帖子/评论举报，用户举报仅管理员可见
  const pendingReportTotal = Number(pendingReportTotalRows[0]?.value || 0)
  const pendingUserReports = Number(pendingUserReportRows[0]?.value || 0)
  let pendingReportsActionable = pendingReportTotal
  if (boardIds) {
    const pendingReportRows = await db
      .select({ targetType: communityReports.targetType, targetId: communityReports.targetId })
      .from(communityReports)
      .where(eq(communityReports.status, 'PENDING'))
      .limit(1000)
    const postIds = pendingReportRows
      .filter((row) => row.targetType === 'post')
      .map((row) => Number(row.targetId))
    const commentIds = pendingReportRows
      .filter((row) => row.targetType === 'comment')
      .map((row) => Number(row.targetId))
    const [postTargets, commentTargets] = await Promise.all([
      postIds.length
        ? db
            .select({ id: communityPosts.id })
            .from(communityPosts)
            .where(
              and(inArray(communityPosts.id, postIds), inArray(communityPosts.boardId, boardIds))
            )
        : [],
      commentIds.length
        ? db
            .select({ id: communityComments.id })
            .from(communityComments)
            .innerJoin(communityPosts, eq(communityPosts.id, communityComments.postId))
            .where(
              and(
                inArray(communityComments.id, commentIds),
                inArray(communityPosts.boardId, boardIds)
              )
            )
        : []
    ])
    pendingReportsActionable = postTargets.length + commentTargets.length
  }
  const pendingAppeals = Number(pendingAppealRows[0]?.value || 0)

  return {
    success: true,
    generatedAt: formatDateTime(now),
    scope: {
      limited: !!boardIds,
      boardIds
    },
    queue: {
      pendingPosts: Number(pendingPostRows[0]?.value || 0),
      pendingComments: Number(pendingCommentRows[0]?.value || 0),
      pendingReports: pendingReportsActionable,
      pendingReportsTotal: pendingReportTotal,
      pendingUserReports,
      pendingAppeals
    },
    today,
    reviewDuration: {
      avgSeconds: Math.round(avgSeconds),
      sampleCount: durationSample
    },
    trend,
    reviewers,
    boards: boardRows.map((row) => ({ id: row.id, name: row.name }))
  }
})
