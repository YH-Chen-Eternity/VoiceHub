/**
 * VoiceHub-Plus — 通知中心分类工具。
 *
 * Notification 表没有 category 字段，这里统一用 `type` / `source` 推导三类通知：
 * - community：社区互动（source = COMMUNITY，或 type 以 `COMMUNITY_` 开头）；
 * - song：点歌、投票、播放、联合投稿、重播等歌曲相关通知；
 * - system：其余系统通知（公告、审核提醒等）。
 *
 * 列表筛选、未读计数、全部已读三处共用同一套 SQL 口径，避免口径漂移。
 * 通知表与索引保持原样，不新增分类列。
 */
import { sql, type SQL } from 'drizzle-orm'
import { notifications } from '~/drizzle/schema'

export type NotificationCategory = 'all' | 'community' | 'song' | 'system'

/** 通知中心分类（含“全部”） */
export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  'all',
  'community',
  'song',
  'system'
]

/**
 * 把外部传入的分类参数归一化：
 * - 缺省 / 空字符串 → all（保持旧调用不带参数时的行为）
 * - 非法分类 → null（调用方返回 400）
 */
export function normalizeNotificationCategory(value: unknown): NotificationCategory | null {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
  if (!normalized) return 'all'
  return (NOTIFICATION_CATEGORIES as string[]).includes(normalized)
    ? (normalized as NotificationCategory)
    : null
}

// 用 left() 判断前缀，避免 SQL LIKE 里 `_` 通配符与会话转义带来的歧义
const isCommunityNotificationSql = sql<boolean>`(${notifications.source} = 'COMMUNITY' or left(${notifications.type}, 10) = 'COMMUNITY_')`
const isSongNotificationSql = sql<boolean>`(left(${notifications.type}, 5) = 'SONG_' or left(${notifications.type}, 14) = 'COLLABORATION_' or ${notifications.type} in ('SONG', 'REPLAY_REJECTED'))`

/** 单个分类的 WHERE 条件；`all` 返回 undefined（不追加条件） */
export function buildNotificationCategoryCondition(
  category: NotificationCategory
): SQL | undefined {
  if (category === 'all') return undefined
  if (category === 'community') return isCommunityNotificationSql
  if (category === 'song') return isSongNotificationSql
  // system = 既不是社区也不是歌曲
  return sql`not ${isCommunityNotificationSql} and not ${isSongNotificationSql}`
}

/** 聚合查询用的 SELECT 字段：各分类通知总数 */
export function buildNotificationCategoryCountSelect() {
  return {
    all: sql<number>`count(*)::int`,
    community: sql<number>`coalesce(sum(case when ${isCommunityNotificationSql} then 1 else 0 end), 0)::int`,
    song: sql<number>`coalesce(sum(case when not ${isCommunityNotificationSql} and ${isSongNotificationSql} then 1 else 0 end), 0)::int`,
    system: sql<number>`coalesce(sum(case when not ${isCommunityNotificationSql} and not ${isSongNotificationSql} then 1 else 0 end), 0)::int`
  }
}

/** 聚合查询用的 SELECT 字段：各分类未读通知数 */
export function buildNotificationCategoryUnreadSelect() {
  return buildNotificationCategoryCountSelect()
}

/** 单条通知的分类（与 SQL 口径一致，供列表接口给前端打标） */
export function resolveNotificationCategory(
  type: string | null | undefined,
  source: string | null | undefined
): Exclude<NotificationCategory, 'all'> {
  const normalizedType = String(type || '').toUpperCase()
  const normalizedSource = String(source || '').toUpperCase()
  if (normalizedSource === 'COMMUNITY' || normalizedType.startsWith('COMMUNITY_')) {
    return 'community'
  }
  if (
    normalizedType === 'SONG' ||
    normalizedType === 'REPLAY_REJECTED' ||
    normalizedType.startsWith('SONG_') ||
    normalizedType.startsWith('COLLABORATION_')
  ) {
    return 'song'
  }
  return 'system'
}

/**
 * 点击通知后跳转的前端 route。
 * 目前站内只有首页一个页面，通过 `?tab=` 切换面板：
 * - 社区 → 社区 tab（帖子详情由 CommunityFeed 内部打开，通知表无 postId 字段，暂不能精确到单帖）
 * - 歌曲 → 歌曲 tab
 * - 系统 → 不跳转（仅标记已读）
 */
export function resolveNotificationTarget(input: {
  type: string | null | undefined
  source: string | null | undefined
  songId?: number | null
}): { category: Exclude<NotificationCategory, 'all'>; path: string | null } {
  const category = resolveNotificationCategory(input.type, input.source)
  if (category === 'community') return { category, path: '/?tab=community' }
  if (category === 'song') {
    return {
      category,
      path: input.songId ? `/?tab=songs&songId=${input.songId}` : '/?tab=songs'
    }
  }
  return { category, path: null }
}
