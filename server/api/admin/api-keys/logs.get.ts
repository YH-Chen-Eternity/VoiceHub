import { ApiLogService } from '~~/server/services/apiLogService'

/**
 * 获取API访问日志
 * GET /api/admin/api-keys/logs
 */
export default defineEventHandler(async (event) => {
  // 检查用户权限 - 只有超级管理员可以查看 API 日志
  const user = event.context.user
  if (!user || user.role !== 'SUPER_ADMIN') {
    throw createError({
      statusCode: 403,
      message: '只有超级管理员可以查看 API 日志'
    })
  }

  const query = getQuery(event)
  const page = parseInt(query.page as string) || 1
  const limit = parseInt(query.limit as string) || 50
  const apiKeyId = query.apiKeyId as string
  const endpoint = query.endpoint as string
  const method = query.method as string
  const statusCode = query.statusCode ? parseInt(query.statusCode as string) : undefined
  const startDate = query.startDate as string
  const endDate = query.endDate as string
  const ipAddress = query.ipAddress as string

  const offset = (page - 1) * limit

  try {
    // 使用ApiLogService获取日志
    const result = await ApiLogService.getLogs({
      apiKeyId,
      endpoint,
      method: method?.toUpperCase(),
      statusCode,
      ipAddress,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      page,
      limit
    })

    // 获取统计信息
    const stats = await ApiLogService.getStats({
      apiKeyId,
      startDate: startDate || undefined,
      endDate: endDate || undefined
    })

    return {
      logs: result.logs,
      pagination: result.pagination,
      stats: stats.basic
    }
  } catch (error: any) {
    console.error('获取 API 访问日志失败:', error)
    throw createError({
      statusCode: 500,
      message: '获取 API 访问日志失败'
    })
  }
})
