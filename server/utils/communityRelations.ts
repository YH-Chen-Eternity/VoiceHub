/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 *
 * 社区举报 / 拉黑 / 申诉公共工具：
 * - 拉黑关系读取（信息流、评论、举报队列统一使用双向过滤口径）；
 * - 举报与申诉的目标摘要装配（管理端列表与处理接口共用）；
 * - 举报 / 申诉处理的站内通知写入。
 */
import { and, count, eq, inArray, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import {
  communityAppeals,
  communityBlocks,
  communityBoards,
  communityComments,
  communityPosts,
  communityProfiles,
  communityReports,
  notifications,
  users
} from '~/drizzle/schema'
import { formatDateTime } from '~/utils/timeUtils'

export const COMMUNITY_REPORT_STATUS = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED'
} as const

export const COMMUNITY_REPORT_TARGET_TYPES = ['POST', 'COMMENT', 'USER'] as const
export type CommunityReportTargetType = (typeof COMMUNITY_REPORT_TARGET_TYPES)[number]

/** 举报原因：刷屏 / 辱骂攻击 / 诈骗 / 隐私泄露 / 其他 */
export const COMMUNITY_REPORT_REASON_CODES = ['SPAM', 'ABUSE', 'FRAUD', 'PRIVACY', 'OTHER'] as const
export type CommunityReportReasonCode = (typeof COMMUNITY_REPORT_REASON_CODES)[number]

/** 申诉目标：帖子 / 评论 / 禁言 */
export const COMMUNITY_APPEAL_TARGET_TYPES = ['POST', 'COMMENT', 'MUTE'] as const
export type CommunityAppealTargetType = (typeof COMMUNITY_APPEAL_TARGET_TYPES)[number]

export const COMMUNITY_REPORT_ACTIONS = ['ACCEPT_HIDE', 'ACCEPT_DELETE', 'REJECT'] as const
export type CommunityReportAction = (typeof COMMUNITY_REPORT_ACTIONS)[number]

export const COMMUNITY_APPEAL_ACTIONS = ['ACCEPT', 'REJECT'] as const
export type CommunityAppealAction = (typeof COMMUNITY_APPEAL_ACTIONS)[number]

/**
 * 双向拉黑关系：返回与 viewerId 存在任一方拉黑关系的用户 id 列表
 * （我拉黑的 + 拉黑我的）。读取失败时返回空数组，避免拖垮信息流主链路。
 */
export async function getBlockedUserIds(viewerId: number | null | undefined): Promise<number[]> {
  const viewer = Number(viewerId)
  if (!Number.isInteger(viewer) || viewer <= 0) return []
  try {
    const rows = await db
      .select({
        blockerId: communityBlocks.blockerId,
        blockedId: communityBlocks.blockedId
      })
      .from(communityBlocks)
      .where(or(eq(communityBlocks.blockerId, viewer), eq(communityBlocks.blockedId, viewer)))

    const blockedIds = new Set<number>()
    for (const row of rows) {
      const blockerId = Number(row.blockerId)
      const blockedId = Number(row.blockedId)
      if (blockerId === viewer) blockedIds.add(blockedId)
      else blockedIds.add(blockerId)
    }
    blockedIds.delete(viewer)
    return Array.from(blockedIds).filter((id) => Number.isInteger(id) && id > 0)
  } catch (error) {
    console.error('[community-relations] 读取拉黑关系失败:', error)
    return []
  }
}

/** 判断两名用户之间是否存在任一方向的拉黑关系（用于详情页 / 评论单独校验） */
export async function isBlockedBetween(
  a: number | null | undefined,
  b: number | null | undefined
): Promise<boolean> {
  const left = Number(a)
  const right = Number(b)
  if (!Number.isInteger(left) || left <= 0 || !Number.isInteger(right) || right <= 0) return false
  if (left === right) return false
  try {
    const rows = await db
      .select({ blockerId: communityBlocks.blockerId })
      .from(communityBlocks)
      .where(
        or(
          and(eq(communityBlocks.blockerId, left), eq(communityBlocks.blockedId, right)),
          and(eq(communityBlocks.blockerId, right), eq(communityBlocks.blockedId, left))
        )
      )
      .limit(1)
    return rows.length > 0
  } catch (error) {
    console.error('[community-relations] 读取拉黑关系失败:', error)
    return false
  }
}

/** 管理端用户摘要：姓名脱敏、禁言与影子封禁状态 */
export type CommunityUserSummary = {
  id: number
  name: string
  username: string | null
  shadowBanned: boolean
  banned: boolean
  bannedUntilText: string | null
  banReason: string | null
}

/** 举报 / 申诉目标摘要：内容片段、当前状态、作者、板块与待处理数 */
export type CommunityTargetSummary = {
  targetType: CommunityReportTargetType | CommunityAppealTargetType
  targetId: number
  exists: boolean
  /** 内容片段（帖子/评论；用户目标为空） */
  contentSnippet: string | null
  /** 目标当前状态（帖子/评论的 PENDING/APPROVED/...；用户目标为空） */
  status: string | null
  deletedAt: Date | null
  deletedAtText: string | null
  /** 帖子/评论作者；用户目标即被举报人本人 */
  author: CommunityUserSummary | null
  board: { id: number; name: string } | null
  /** 评论所属帖子 id */
  postId: number | null
  /** 该目标当前的待处理举报数 */
  pendingCount: number
  /** 待处理申诉数（仅申诉摘要） */
  pendingAppealCount?: number
}

function targetKey(targetType: string, targetId: number): string {
  return `${targetType}:${targetId}`
}

function uniqueIds(values: number[]): number[] {
  return Array.from(new Set(values.filter((id) => Number.isInteger(id) && id > 0)))
}

function snippet(content: string | null | undefined): string | null {
  const text = String(content || '').trim()
  if (!text) return null
  return text.length > 120 ? `${text.slice(0, 120)}…` : text
}

function userSummary(row: any | undefined | null): CommunityUserSummary | null {
  if (!row) return null
  return {
    id: Number(row.id),
    name: String(row.name || row.username || '已注销用户'),
    username: row.username || null,
    shadowBanned: !!row.shadowBanned,
    banned: !!row.banned,
    bannedUntilText: row.bannedUntil ? formatDateTime(row.bannedUntil) : null,
    banReason: row.banReason || null
  }
}

/** 批量统计目标当前的待处理举报数 */
async function loadPendingReportCounts(
  targets: Array<{ targetType: string; targetId: number }>
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (!targets.length) return result
  const postIds = uniqueIds(targets.filter((t) => t.targetType === 'POST').map((t) => t.targetId))
  const commentIds = uniqueIds(
    targets.filter((t) => t.targetType === 'COMMENT').map((t) => t.targetId)
  )
  const userIds = uniqueIds(targets.filter((t) => t.targetType === 'USER').map((t) => t.targetId))

  const conditions: SQL[] = []
  if (postIds.length) {
    conditions.push(
      and(eq(communityReports.targetType, 'POST'), inArray(communityReports.targetId, postIds))!
    )
  }
  if (commentIds.length) {
    conditions.push(
      and(
        eq(communityReports.targetType, 'COMMENT'),
        inArray(communityReports.targetId, commentIds)
      )!
    )
  }
  if (userIds.length) {
    conditions.push(
      and(eq(communityReports.targetType, 'USER'), inArray(communityReports.targetId, userIds))!
    )
  }
  if (!conditions.length) return result

  const rows = await db
    .select({
      targetType: communityReports.targetType,
      targetId: communityReports.targetId,
      value: count()
    })
    .from(communityReports)
    .where(and(eq(communityReports.status, COMMUNITY_REPORT_STATUS.PENDING), or(...conditions)))
    .groupBy(communityReports.targetType, communityReports.targetId)

  for (const row of rows) {
    result.set(targetKey(row.targetType, Number(row.targetId)), Number(row.value || 0))
  }
  return result
}

/**
 * 批量装配举报 / 申诉目标摘要。
 * 目标被物理删除时返回 exists=false 的占位摘要，管理端列表仍可展示举报记录。
 */
export async function loadCommunityTargetSummaries(
  targets: Array<{ targetType: string; targetId: number }>
): Promise<Map<string, CommunityTargetSummary>> {
  const result = new Map<string, CommunityTargetSummary>()
  if (!targets.length) return result

  const postIds = uniqueIds(targets.filter((t) => t.targetType === 'POST').map((t) => t.targetId))
  const commentIds = uniqueIds(
    targets.filter((t) => t.targetType === 'COMMENT').map((t) => t.targetId)
  )
  const userIds = uniqueIds(
    targets.filter((t) => t.targetType === 'USER' || t.targetType === 'MUTE').map((t) => t.targetId)
  )

  const [pendingCounts, postRows, commentRows, userRows] = await Promise.all([
    loadPendingReportCounts(targets),
    postIds.length
      ? db
          .select({
            id: communityPosts.id,
            content: communityPosts.content,
            status: communityPosts.status,
            deletedAt: communityPosts.deletedAt,
            boardId: communityPosts.boardId,
            boardName: communityBoards.name,
            authorId: users.id,
            authorName: users.name,
            authorUsername: users.username,
            shadowBanned: communityProfiles.shadowBanned,
            banned: communityProfiles.banned,
            bannedUntil: communityProfiles.bannedUntil,
            banReason: communityProfiles.banReason
          })
          .from(communityPosts)
          .innerJoin(users, eq(users.id, communityPosts.authorId))
          .leftJoin(communityProfiles, eq(communityProfiles.userId, users.id))
          .leftJoin(communityBoards, eq(communityBoards.id, communityPosts.boardId))
          .where(inArray(communityPosts.id, postIds))
      : Promise.resolve([] as any[]),
    commentIds.length
      ? db
          .select({
            id: communityComments.id,
            content: communityComments.content,
            status: communityComments.status,
            deletedAt: communityComments.deletedAt,
            postId: communityPosts.id,
            boardId: communityPosts.boardId,
            boardName: communityBoards.name,
            authorId: users.id,
            authorName: users.name,
            authorUsername: users.username,
            shadowBanned: communityProfiles.shadowBanned,
            banned: communityProfiles.banned,
            bannedUntil: communityProfiles.bannedUntil,
            banReason: communityProfiles.banReason
          })
          .from(communityComments)
          .innerJoin(communityPosts, eq(communityPosts.id, communityComments.postId))
          .innerJoin(users, eq(users.id, communityComments.authorId))
          .leftJoin(communityProfiles, eq(communityProfiles.userId, users.id))
          .leftJoin(communityBoards, eq(communityBoards.id, communityPosts.boardId))
          .where(inArray(communityComments.id, commentIds))
      : Promise.resolve([] as any[]),
    userIds.length
      ? db
          .select({
            id: users.id,
            name: users.name,
            username: users.username,
            shadowBanned: communityProfiles.shadowBanned,
            banned: communityProfiles.banned,
            bannedUntil: communityProfiles.bannedUntil,
            banReason: communityProfiles.banReason
          })
          .from(users)
          .leftJoin(communityProfiles, eq(communityProfiles.userId, users.id))
          .where(inArray(users.id, userIds))
      : Promise.resolve([] as any[])
  ])

  for (const row of postRows as any[]) {
    result.set(targetKey('POST', Number(row.id)), {
      targetType: 'POST',
      targetId: Number(row.id),
      exists: true,
      contentSnippet: snippet(row.content),
      status: row.status || null,
      deletedAt: row.deletedAt || null,
      deletedAtText: row.deletedAt ? formatDateTime(row.deletedAt) : null,
      author: userSummary({
        id: row.authorId,
        name: row.authorName,
        username: row.authorUsername,
        shadowBanned: row.shadowBanned,
        banned: row.banned,
        bannedUntil: row.bannedUntil,
        banReason: row.banReason
      }),
      board: row.boardId ? { id: Number(row.boardId), name: row.boardName || '' } : null,
      postId: Number(row.id),
      pendingCount: 0
    })
  }

  for (const row of commentRows as any[]) {
    result.set(targetKey('COMMENT', Number(row.id)), {
      targetType: 'COMMENT',
      targetId: Number(row.id),
      exists: true,
      contentSnippet: snippet(row.content),
      status: row.status || null,
      deletedAt: row.deletedAt || null,
      deletedAtText: row.deletedAt ? formatDateTime(row.deletedAt) : null,
      author: userSummary({
        id: row.authorId,
        name: row.authorName,
        username: row.authorUsername,
        shadowBanned: row.shadowBanned,
        banned: row.banned,
        bannedUntil: row.bannedUntil,
        banReason: row.banReason
      }),
      board: row.boardId ? { id: Number(row.boardId), name: row.boardName || '' } : null,
      postId: Number(row.postId),
      pendingCount: 0
    })
  }

  const userMap = new Map<number, CommunityUserSummary>()
  for (const row of userRows as any[]) {
    const summary = userSummary(row)
    if (summary) userMap.set(summary.id, summary)
  }
  for (const target of targets) {
    if (target.targetType !== 'USER' && target.targetType !== 'MUTE') continue
    const summary = userMap.get(target.targetId) || null
    result.set(targetKey(target.targetType, target.targetId), {
      targetType: target.targetType as CommunityReportTargetType | CommunityAppealTargetType,
      targetId: target.targetId,
      exists: !!summary,
      contentSnippet: null,
      status: null,
      deletedAt: null,
      deletedAtText: null,
      author: summary,
      board: null,
      postId: null,
      pendingCount: 0
    })
  }

  for (const [key, value] of result) {
    value.pendingCount = pendingCounts.get(key) || 0
  }
  return result
}

/** 批量统计目标的待处理申诉数 */
export async function loadPendingAppealCounts(
  targets: Array<{ targetType: string; targetId: number }>
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (!targets.length) return result
  const postIds = uniqueIds(targets.filter((t) => t.targetType === 'POST').map((t) => t.targetId))
  const commentIds = uniqueIds(
    targets.filter((t) => t.targetType === 'COMMENT').map((t) => t.targetId)
  )
  const userIds = uniqueIds(targets.filter((t) => t.targetType === 'MUTE').map((t) => t.targetId))

  const conditions: SQL[] = []
  if (postIds.length) {
    conditions.push(
      and(eq(communityAppeals.targetType, 'POST'), inArray(communityAppeals.targetId, postIds))!
    )
  }
  if (commentIds.length) {
    conditions.push(
      and(
        eq(communityAppeals.targetType, 'COMMENT'),
        inArray(communityAppeals.targetId, commentIds)
      )!
    )
  }
  if (userIds.length) {
    conditions.push(
      and(eq(communityAppeals.targetType, 'MUTE'), inArray(communityAppeals.targetId, userIds))!
    )
  }
  if (!conditions.length) return result

  const rows = await db
    .select({
      targetType: communityAppeals.targetType,
      targetId: communityAppeals.targetId,
      value: count()
    })
    .from(communityAppeals)
    .where(and(eq(communityAppeals.status, COMMUNITY_REPORT_STATUS.PENDING), or(...conditions)))
    .groupBy(communityAppeals.targetType, communityAppeals.targetId)

  for (const row of rows) {
    result.set(targetKey(row.targetType, Number(row.targetId)), Number(row.value || 0))
  }
  return result
}

/**
 * 管理端举报队列的可见范围：管理员不限；审帖员只看负责板块的帖子/评论举报，
 * 用户举报不归属板块，对所有审帖员可见。
 */
export function buildCommunityReportScope(scopedBoardIds: number[] | null): SQL | undefined {
  if (!scopedBoardIds) return undefined
  const boardIds = scopedBoardIds.length ? scopedBoardIds : [-1]
  const postSubQuery = db
    .select({ id: communityPosts.id })
    .from(communityPosts)
    .where(inArray(communityPosts.boardId, boardIds))
  const commentSubQuery = db
    .select({ id: communityComments.id })
    .from(communityComments)
    .innerJoin(communityPosts, eq(communityPosts.id, communityComments.postId))
    .where(inArray(communityPosts.boardId, boardIds))
  return or(
    eq(communityReports.targetType, 'USER'),
    and(eq(communityReports.targetType, 'POST'), inArray(communityReports.targetId, postSubQuery)),
    and(
      eq(communityReports.targetType, 'COMMENT'),
      inArray(communityReports.targetId, commentSubQuery)
    )
  )!
}

/** 管理端申诉队列的可见范围：MUTE 申诉不归属板块，对审帖员可见 */
export function buildCommunityAppealScope(scopedBoardIds: number[] | null): SQL | undefined {
  if (!scopedBoardIds) return undefined
  const boardIds = scopedBoardIds.length ? scopedBoardIds : [-1]
  const postSubQuery = db
    .select({ id: communityPosts.id })
    .from(communityPosts)
    .where(inArray(communityPosts.boardId, boardIds))
  const commentSubQuery = db
    .select({ id: communityComments.id })
    .from(communityComments)
    .innerJoin(communityPosts, eq(communityPosts.id, communityComments.postId))
    .where(inArray(communityPosts.boardId, boardIds))
  return or(
    eq(communityAppeals.targetType, 'MUTE'),
    and(eq(communityAppeals.targetType, 'POST'), inArray(communityAppeals.targetId, postSubQuery)),
    and(
      eq(communityAppeals.targetType, 'COMMENT'),
      inArray(communityAppeals.targetId, commentSubQuery)
    )
  )!
}

export type CommunityNotificationInput = {
  userId: number
  type: string
  title: string
  message: string
}

/** 批量写入社区站内通知（失败只记录日志，不阻断管理操作） */
export async function insertCommunityNotifications(
  items: CommunityNotificationInput[]
): Promise<void> {
  const rows = items
    .filter((item) => Number.isInteger(item.userId) && item.userId > 0 && item.message)
    .map((item) => ({
      userId: item.userId,
      type: item.type,
      source: 'COMMUNITY',
      title: item.title,
      message: item.message
    }))
  if (!rows.length) return
  try {
    await db.insert(notifications).values(rows)
  } catch (error) {
    console.error('[community-relations] 写入社区通知失败:', error)
  }
}

/** 所有管理员 / 超级管理员 id（举报自动隐藏等事件需要提醒） */
export async function listCommunityAdminIds(): Promise<number[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.role, ['ADMIN', 'SUPER_ADMIN']))
  return rows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0)
}
