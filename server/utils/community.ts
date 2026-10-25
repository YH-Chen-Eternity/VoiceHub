/**
 * VoiceHub-Plus — 回声社区公共工具：配置、身份脱敏、禁言与权限。
 * 社区不引入独立用户体系，全部复用 VoiceHub 的 User / Song / Vote / Notification。
 */
import type { H3Event } from 'h3'
import { db } from '~/drizzle/db'
import {
  communityBoardReviewers,
  communityBoards,
  communityProfiles,
  communityViolations,
  communitySettings,
  communityTitles,
  users
} from '~/drizzle/schema'
import { and, eq, gte, sql } from 'drizzle-orm'
import { createApiError } from './apiError'

export const COMMUNITY_REVIEWER_ROLE = 'REVIEWER'
export const COMMUNITY_BROADCASTER_ROLE = 'BROADCASTER'
export const COMMUNITY_POST_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  BLOCKED: 'BLOCKED'
} as const
export const COMMUNITY_CONTENT_STATUS = COMMUNITY_POST_STATUS
export const COMMUNITY_DELETE_TYPE = {
  WITHDRAW: 'WITHDRAW',
  DELETE: 'DELETE'
} as const

/** 归档保留期：撤回/删除后 30 天物理清理 */
export const COMMUNITY_ARCHIVE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export type CommunitySettingsRow = typeof communitySettings.$inferSelect

export function isCommunityAdmin(user: any): boolean {
  return !!user && ['ADMIN', 'SUPER_ADMIN'].includes(String(user.role || ''))
}

export function isCommunityReviewer(user: any): boolean {
  if (!user) return false
  return isCommunityAdmin(user) || String(user.role || '') === COMMUNITY_REVIEWER_ROLE
}

export function requireCommunityAdmin(event: H3Event): void {
  const user = event.context.user
  if (!user) throw createApiError(401, 'AUTH_UNAUTHORIZED', '请先登录')
  if (!isCommunityAdmin(user)) {
    throw createApiError(403, 'COMMON_INSUFFICIENT_PERMISSION', '只有管理员可以执行此操作')
  }
}

export function requireCommunityReviewer(event: H3Event) {
  const user = event.context.user
  if (!user) throw createApiError(401, 'AUTH_UNAUTHORIZED', '请先登录')
  if (!isCommunityReviewer(user)) {
    throw createApiError(403, 'COMMUNITY_REVIEWER_ONLY', '只有审帖员可以执行此操作')
  }
  return user
}

export function requireCommunityUser(event: H3Event) {
  const user = event.context.user
  if (!user) throw createApiError(401, 'AUTH_UNAUTHORIZED', '请先登录')
  return user
}

/** 社区配置读取（单例，缺失时自动补默认行） */
export async function getCommunitySettings(): Promise<CommunitySettingsRow> {
  const existing = await db
    .select()
    .from(communitySettings)
    .where(eq(communitySettings.id, 1))
    .limit(1)
  if (existing[0]) return existing[0]

  await db.insert(communitySettings).values({ id: 1 }).onConflictDoNothing()
  const created = await db
    .select()
    .from(communitySettings)
    .where(eq(communitySettings.id, 1))
    .limit(1)
  return created[0]!
}

/** 返回给前端的配置，绝不包含阿里云密钥 */
export function toPublicCommunitySettings(row: CommunitySettingsRow) {
  return {
    enabled: row.enabled,
    allowImages: row.allowImages,
    maxImages: row.maxImages,
    maxContentLength: row.maxContentLength,
    maxCommentLength: row.maxCommentLength,
    moderationEnabled: row.moderationEnabled,
    moderationConfigured: !!(row.aliyunAccessKeyId && row.aliyunAccessKeySecret),
    reviewRequired: true
  }
}

export async function requireCommunityEnabled(): Promise<CommunitySettingsRow> {
  const settings = await getCommunitySettings()
  if (!settings.enabled) {
    throw createApiError(403, 'COMMUNITY_DISABLED', '回声社区暂未开放')
  }
  return settings
}

/** 姓名脱敏：保留首字与末字，中间用 * 代替（两字姓名保留首字） */
export function maskCommunityName(name: string | null | undefined): string {
  const trimmed = String(name || '').trim()
  if (!trimmed) return '同学'
  if (trimmed.length === 1) return `${trimmed}*`
  if (trimmed.length === 2) return `${trimmed[0]}*`
  return `${trimmed[0]}${'*'.repeat(trimmed.length - 2)}${trimmed[trimmed.length - 1]}`
}

export function formatCommunityClass(grade: string | null | undefined, klass: string | null | undefined): string {
  const g = String(grade || '').trim()
  const c = String(klass || '').trim()
  if (!g && !c) return ''
  if (!c) return g
  if (c.endsWith('班')) return `${g}${c}`
  return `${g}${c}班`
}

export function buildCommunityIdentity(
  user: { name?: string | null; grade?: string | null; class?: string | null },
  titleName?: string | null
) {
  const className = formatCommunityClass(user.grade, user.class)
  return {
    className,
    maskedName: maskCommunityName(user.name),
    title: titleName || null,
    displayName: `${className}${maskCommunityName(user.name)}`
  }
}

export type CommunityBanState = {
  muted: boolean
  permanent: boolean
  until: Date | null
  reason: string | null
}

export function resolveCommunityBanState(
  profile:
    | { banned?: boolean | null; bannedUntil?: Date | string | null; banReason?: string | null }
    | null
    | undefined,
  now = new Date()
): CommunityBanState {
  if (!profile?.banned) return { muted: false, permanent: false, until: null, reason: null }
  if (profile.bannedUntil && new Date(profile.bannedUntil) <= now) {
    return { muted: false, permanent: false, until: null, reason: null }
  }
  return {
    muted: true,
    permanent: !profile.bannedUntil,
    until: profile.bannedUntil ? new Date(profile.bannedUntil) : null,
    reason: profile.banReason || null
  }
}

/** 确保社区档案存在 */
export async function ensureCommunityProfile(userId: number) {
  const existing = await db
    .select()
    .from(communityProfiles)
    .where(eq(communityProfiles.userId, userId))
    .limit(1)
  if (existing[0]) {
    // 到期禁言惰性解除，避免依赖定时任务
    const state = resolveCommunityBanState(existing[0])
    if (!state.muted && existing[0].banned) {
      await db
        .update(communityProfiles)
        .set({ banned: false, bannedUntil: null, banReason: null, updatedAt: new Date() })
        .where(eq(communityProfiles.userId, userId))
      return { ...existing[0], banned: false, bannedUntil: null, banReason: null }
    }
    return existing[0]
  }

  await db.insert(communityProfiles).values({ userId }).onConflictDoNothing()
  const created = await db
    .select()
    .from(communityProfiles)
    .where(eq(communityProfiles.userId, userId))
    .limit(1)
  return created[0]!
}

/** 发帖/评论前的禁言校验 */
export async function assertCommunityNotMuted(userId: number): Promise<void> {
  const profile = await ensureCommunityProfile(userId)
  const state = resolveCommunityBanState(profile)
  if (!state.muted) return
  if (state.permanent) {
    throw createApiError(403, 'COMMUNITY_BANNED_PERMANENT', '你已被永久禁言，无法发布内容')
  }
  throw createApiError(403, 'COMMUNITY_MUTED', '你当前处于禁言状态，无法发布内容', {
    until: state.until?.toISOString() || null,
    reason: state.reason
  })
}

/** 管理员返回 null（不受限）；审帖员只返回已分配板块，未分配时为空集 */
export async function getReviewableBoardIds(user: any): Promise<number[] | null> {
  if (isCommunityAdmin(user)) return null
  const { communityBoardReviewers } = await import('~/drizzle/schema')
  const rows = await db
    .select({ boardId: communityBoardReviewers.boardId })
    .from(communityBoardReviewers)
    .where(eq(communityBoardReviewers.userId, user.id))
  return rows.map((row) => row.boardId)
}

/** 审帖员只能操作被分配板块；管理员无限制 */
export async function assertCommunityBoardAccess(user: any, boardId: number): Promise<void> {
  const scopedBoardIds = await getReviewableBoardIds(user)
  if (scopedBoardIds && !scopedBoardIds.includes(boardId)) {
    throw createApiError(403, 'COMMUNITY_REVIEW_BOARD_FORBIDDEN', '你没有被分配到该板块')
  }
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

/**
 * 审核驳回后的违规计数与自动禁言。
 * 帖子与评论共用，必须在事务内调用。
 */
export async function applyCommunityViolation(
  tx: any,
  authorId: number,
  options: { sourceType?: 'POST' | 'COMMENT'; sourceId?: number; reason?: string } = {}
) {
  await tx.insert(communityProfiles).values({ userId: authorId }).onConflictDoNothing()

  // 违规按「近 30 天」滚动统计：先落一条违规记录，再回算窗口内数量，
  // 历史违规超过 30 天后自动不再计入，不会永久累计。
  await tx.insert(communityViolations).values({
    userId: authorId,
    sourceType: options.sourceType ?? null,
    sourceId: options.sourceId ?? null,
    reason: options.reason ?? null
  })
  const since = new Date(Date.now() - THIRTY_DAYS_MS)
  const [{ value: rollingCount }] = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(communityViolations)
    .where(
      and(
        eq(communityViolations.userId, authorId),
        gte(communityViolations.createdAt, since)
      )
    )
  const [profile] = await tx
    .update(communityProfiles)
    .set({
      violationCount: Number(rollingCount || 0),
      updatedAt: new Date()
    })
    .where(eq(communityProfiles.userId, authorId))
    .returning()

  const violationCount = Number(profile?.violationCount || 0)
  const currentState = resolveCommunityBanState(profile)
  let banned = profile?.banned ?? false
  let bannedUntil = profile?.bannedUntil ?? null
  let banReason = profile?.banReason ?? null

  if (violationCount >= 6) {
    banned = true
    bannedUntil = null
    banReason = `近 30 天累计 ${violationCount} 次违规，永久禁言`
  } else if (violationCount >= 3 && !currentState.muted) {
    banned = true
    bannedUntil = new Date(Date.now() + THIRTY_DAYS_MS)
    banReason = `近 30 天累计 ${violationCount} 次违规，禁言 30 天`
  }

  if (banned !== profile?.banned || bannedUntil !== profile?.bannedUntil) {
    await tx
      .update(communityProfiles)
      .set({ banned, bannedUntil, banReason, updatedAt: new Date() })
      .where(eq(communityProfiles.userId, authorId))
  }

  return { violationCount, banned, bannedUntil, banReason }
}

export function formatCommunityMuteNotice(violationCount: number): string {
  if (violationCount >= 6) return '你的账号已被永久禁言（近 30 天违规次数达到上限）。'
  if (violationCount >= 3) return '你已被禁言 30 天（近 30 天违规次数达到 3 次）。'
  return ''
}

/** 带称号的用户身份（用于评论等单条场景） */
export async function getCommunityUserIdentity(userId: number) {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      grade: users.grade,
      class: users.class,
      titleName: communityTitles.name
    })
    .from(users)
    .leftJoin(communityProfiles, eq(communityProfiles.userId, users.id))
    .leftJoin(communityTitles, eq(communityTitles.id, communityProfiles.equippedTitleId))
    .where(eq(users.id, userId))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return { id: row.id, ...buildCommunityIdentity(row, row.titleName) }
}

export async function getBoardOrThrow(boardId: number) {
  const rows = await db
    .select()
    .from(communityBoards)
    .where(eq(communityBoards.id, boardId))
    .limit(1)
  const board = rows[0]
  if (!board) throw createApiError(404, 'COMMUNITY_BOARD_NOT_FOUND', '板块不存在')
  return board
}

