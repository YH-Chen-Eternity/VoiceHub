import { and, desc, eq, lt } from 'drizzle-orm'
import { getQuery } from 'h3'
import { db } from '~/drizzle/db'
import { notifications } from '~/drizzle/schema'
import { SERVER_ERROR_CODES } from '~~/server/config/constants'
import { createApiError } from '~~/server/utils/apiError'
import { serializeNotificationSender } from '~~/server/utils/important-notification-policy'
import {
  buildNotificationCategoryCondition,
  normalizeNotificationCategory,
  resolveNotificationTarget
} from '~~/server/utils/notificationCategory'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

/**
 * GET /api/notifications/list
 *
 * 通知中心专用列表接口（与 /api/notifications 的分页/搜索口径独立）：
 * - category=all|community|song|system（默认 all）
 * - unreadOnly=true 只返回未读（也兼容 filter=unread）
 * - beforeId 游标分页：返回 id 更小的下一页，按 id 倒序，避免翻页时新增通知造成错位
 * - limit 默认 20，最大 50
 *
 * 每条通知额外带 category 与 target（点击跳转 route），前端无需自己判断类型。
 */
export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) {
    throw createApiError(401, SERVER_ERROR_CODES.NOTIFICATION_AUTH_REQUIRED, '需要登录才能获取通知')
  }

  try {
    const query = getQuery(event)
    const category = normalizeNotificationCategory(query.category)
    if (!category) {
      throw createApiError(400, SERVER_ERROR_CODES.COMMON_INVALID_PARAMS, '通知分类参数不正确')
    }

    const unreadOnly =
      query.unreadOnly === 'true' || query.unreadOnly === '1' || query.filter === 'unread'
    const parsedLimit = Number.parseInt(String(query.limit ?? ''), 10)
    const limit = Number.isInteger(parsedLimit)
      ? Math.min(MAX_LIMIT, Math.max(1, parsedLimit))
      : DEFAULT_LIMIT
    const parsedBeforeId = Number.parseInt(String(query.beforeId ?? ''), 10)
    const beforeId = Number.isInteger(parsedBeforeId) && parsedBeforeId > 0 ? parsedBeforeId : null

    const conditions = [eq(notifications.userId, user.id), eq(notifications.userDeleted, false)]
    if (unreadOnly) conditions.push(eq(notifications.read, false))
    if (beforeId) conditions.push(lt(notifications.id, beforeId))
    const categoryCondition = buildNotificationCategoryCondition(category)
    if (categoryCondition) conditions.push(categoryCondition)

    // 多取一条用于判断是否还有下一页，避免 count 查询
    const rows = await db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.id))
      .limit(limit + 1)
    const hasMore = rows.length > limit
    const pageRows = hasMore ? rows.slice(0, limit) : rows

    const notificationsPayload = pageRows.map((row) => {
      const { senderId, senderName, senderUsername, ...data } = row
      const target = resolveNotificationTarget({
        type: row.type,
        source: row.source,
        songId: row.songId
      })
      return {
        ...data,
        // 与 /api/notifications 列表保持同一发送人契约：原始列折叠为 sender 对象
        sender: serializeNotificationSender({ senderId, senderName, senderUsername }),
        // 分类与点击跳转目标由服务端统一推导，前端无需判断 type 前缀
        category: target.category,
        target
      }
    })

    return {
      success: true,
      notifications: notificationsPayload,
      pagination: {
        limit,
        hasMore,
        // 下一页游标：把 nextCursor 原样作为 beforeId 传回即可
        nextCursor:
          hasMore && notificationsPayload.length > 0
            ? notificationsPayload[notificationsPayload.length - 1]!.id
            : null
      }
    }
  } catch (error: any) {
    if ((error as { statusCode?: number })?.statusCode === 400) throw error
    console.error('获取通知列表失败:', error)
    throw createApiError(500, SERVER_ERROR_CODES.NOTIFICATION_FETCH_FAILED, '获取通知列表失败')
  }
})
