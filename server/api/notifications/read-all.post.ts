import { and, eq } from 'drizzle-orm'
import { getQuery, readBody } from 'h3'
import { db } from '~/drizzle/db'
import { notifications } from '~/drizzle/schema'
import { SERVER_ERROR_CODES } from '~~/server/config/constants'
import { createApiError } from '~~/server/utils/apiError'
import { createNotificationReadUpdate } from '~~/server/utils/important-notification-policy'
import {
  buildNotificationCategoryCondition,
  buildNotificationCategoryUnreadSelect,
  normalizeNotificationCategory
} from '~~/server/utils/notificationCategory'

/**
 * POST /api/notifications/read-all
 *
 * 全部标记为已读。分类可选（query.category 或 body.category，取值 all|community|song|system）：
 * - 不传 category / 传 all：沿用旧行为，标记该用户全部未读通知；
 * - 传其它分类：只清空对应分类未读，供通知中心“当前分类全部已读”使用。
 *
 * 响应额外返回剩余未读数，前端可直接刷新分类红点。
 */
export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) {
    throw createApiError(401, SERVER_ERROR_CODES.NOTIFICATION_AUTH_REQUIRED, '需要登录才能标记通知')
  }

  try {
    const query = getQuery(event)
    let body: any = null
    try {
      body = await readBody(event)
    } catch {
      // 旧调用不带请求体，忽略空 body 解析错误
      body = null
    }
    const category = normalizeNotificationCategory(body?.category ?? query.category)
    if (!category) {
      throw createApiError(400, SERVER_ERROR_CODES.COMMON_INVALID_PARAMS, '通知分类参数不正确')
    }

    const conditions = [
      eq(notifications.userId, user.id),
      eq(notifications.userDeleted, false),
      eq(notifications.read, false)
    ]
    const categoryCondition = buildNotificationCategoryCondition(category)
    if (categoryCondition) conditions.push(categoryCondition)

    const updatedNotifications = await db
      .update(notifications)
      .set(createNotificationReadUpdate())
      .where(and(...conditions))
      .returning({ id: notifications.id })

    // 更新后剩余未读：通知中心用它同步分类红点，无需再发一次 unread-count 请求
    const [unreadRow] = await db
      .select(buildNotificationCategoryUnreadSelect())
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, user.id),
          eq(notifications.userDeleted, false),
          eq(notifications.read, false)
        )
      )

    return {
      success: true,
      count: updatedNotifications.length,
      category,
      unread: {
        all: Number(unreadRow?.all || 0),
        community: Number(unreadRow?.community || 0),
        song: Number(unreadRow?.song || 0),
        system: Number(unreadRow?.system || 0)
      }
    }
  } catch (error: any) {
    if ((error as { statusCode?: number })?.statusCode === 400) throw error
    console.error('标记所有通知失败:', error)
    throw createApiError(500, SERVER_ERROR_CODES.NOTIFICATION_MARK_READ_FAILED, '标记所有通知失败')
  }
})
