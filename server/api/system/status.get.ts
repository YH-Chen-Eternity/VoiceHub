/* Modified by YH-Chen-Eternity on 2026-10-23 */

import { createError, defineEventHandler } from 'h3'
import { databaseManager } from '~~/server/utils/database-manager'
import { getInstanceId } from '~~/server/utils/instance-id'
import { isTelemetryEnabled } from '~~/server/utils/telemetry'

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN']

export default defineEventHandler(async (event) => {
  // 系统状态含实例 ID、连接池细节与内部错误信息，仅限管理员（2026-10-23 安全加固：
  // 原实现任何登录用户均可读取，构成信息泄露）
  const user = event.context.user
  if (!user || !ADMIN_ROLES.includes(user.role)) {
    throw createError({ statusCode: 403, message: '只有管理员可以查看系统状态' })
  }

  try {
    const instanceId = await getInstanceId()
    const telemetryEnabled = await isTelemetryEnabled()

    // 获取数据库连接状态
    const dbStatus = await databaseManager.getConnectionStatus()
    let poolStatus = null
    try {
      poolStatus = await databaseManager.getConnectionPoolStatus()
    } catch (poolError) {
      console.warn('[System Status] Failed to get database pool status:', poolError)
    }

    // 数据库连接测试结果
    const dbTestResult = dbStatus.connected
    const dbError = dbStatus.connected ? null : dbStatus.error

    // 获取系统信息
    const systemInfo = {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        external: Math.round(process.memoryUsage().external / 1024 / 1024)
      }
    }

    // 返回完整的系统状态
    return {
      status: 'ok',
      instance: {
        instanceId,
        telemetryEnabled
      },
      database: {
        connected: dbTestResult,
        poolStatus: poolStatus,
        connectionInfo: dbStatus,
        error: dbError
      },
      system: systemInfo
    }
  } catch (error) {
    // 细节只进服务端日志，响应不暴露内部错误（2026-10-23 安全加固）
    console.error('[System Status] 获取系统状态失败:', error)

    return {
      status: 'error',
      error: '获取系统状态失败',
      database: {
        connected: false,
        poolStatus: null,
        error: '获取数据库状态失败'
      }
    }
  }
})
