/* Modified by YH-Chen-Eternity on 2026-10-23 */

import { createError, defineEventHandler } from 'h3'
import { databaseManager } from '~~/server/utils/database-manager'

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN']

export default defineEventHandler(async (event) => {
  // 强制重连会中断进行中的数据库操作并回显连接细节，仅限管理员（2026-10-23 安全加固：
  // 原实现任何登录用户均可触发，可被用于干扰正常业务）
  const user = event.context.user
  if (!user || !ADMIN_ROLES.includes(user.role)) {
    throw createError({ statusCode: 403, message: '只有管理员可以执行重连操作' })
  }

  try {
    console.log(`[Reconnect API] 管理员 ${user.username} 请求强制重连`)

    // 测试数据库连接
    const connectionStatus = await databaseManager.getConnectionStatus()
    const poolStatus = await databaseManager.getConnectionPoolStatus()

    if (connectionStatus.connected) {
      console.log('[Reconnect API] 数据库连接正常')
      return {
        success: true,
        message: '数据库连接正常',
        connectionStatus,
        poolStatus,
        timestamp: new Date().toISOString()
      }
    } else {
      console.log('[Reconnect API] 数据库连接异常')
      return {
        success: false,
        message: '数据库连接异常',
        connectionStatus,
        poolStatus,
        timestamp: new Date().toISOString()
      }
    }
  } catch (error: any) {
    console.error('[Reconnect API] 重连过程中出错:', error)
    return {
      success: false,
      message: '重连过程中出错，请稍后重试或联系管理员',
      timestamp: new Date().toISOString()
    }
  }
})
