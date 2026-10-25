import { and, eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { notifications } from '~/drizzle/schema'
import { SERVER_ERROR_CODES } from '~~/server/config/constants'
import { createApiError } from '~~/server/utils/apiError'
import {
  buildNotificationCategoryCountSelect,
  buildNotificationCategoryUnreadSelect
} from '~~/server/utils/notificationCategory'

/**
 * GET /api/notifications/unread-count
 *
 * 通知中心红点数据：返回社区 / 歌曲 / 系统三类通知的未读数与总数。
 * 只做聚合查询，不复用 /api/notifications 列表接口，避免为拿红点拉整页数据。
 */
export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) {
    throw createApiError(
      401,
      SERVER_ERROR_CODES.NOTIFICATION_AUTH_REQUIRED,
      '需要登录才能获取通知未读数'
    )
  }

  try {
    const ownedCondition = and(
      eq(notifications.userId, user.id),
      eq(notifications.userDeleted, false)
    )

    const [unreadRow] = await db
      .select(buildNotificationCategoryUnreadSelect())
      .from(notifications)
      .where(and(ownedCondition, eq(notifications.read, false)))
    const [totalRow] = await db
      .select(buildNotificationCategoryCountSelect())
      .from(notifications)
      .where(ownedCondition)

    return {
      success: true,
      // 各分类未读数（all 为三分类之和，也是铃铛红点使用的总数）
      unread: {
        all: Number(unreadRow?.all || 0),
        community: Number(unreadRow?.community || 0),
        song: Number(unreadRow?.song || 0),
        system: Number(unreadRow?.system || 0)
      },
      // 各分类通知总数，供前端 tab 展示或“全部已读”按钮禁用判断
      total: {
        all: Number(totalRow?.all || 0),
        community: Number(totalRow?.community || 0),
        song: Number(totalRow?.song || 0),
        system: Number(totalRow?.system || 0)
      }
    }
  } catch (error: any) {
    console.error('获取通知未读数失败:', error)
    throw createApiError(500, SERVER_ERROR_CODES.NOTIFICATION_FETCH_FAILED, '获取通知未读数失败')
  }
})
