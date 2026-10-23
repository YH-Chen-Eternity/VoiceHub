/* Modified by YH-Chen-Eternity on 2026-10-23 */

import { createError, defineEventHandler, getHeader, getQuery } from 'h3'
import { db } from '~/drizzle/db'
import { users } from '~/drizzle/schema'
import { asc } from 'drizzle-orm'
import { formatDateTime } from '~/utils/timeUtils'
import { buildUserFilterConditions } from '~~/server/utils/user-filter'
import { verifyEmailCode } from '~~/server/utils/email-verification'

// 用户导出：按当前筛选条件返回全量用户（不分页），时间字段统一格式化为北京时间字符串，
// role/status 保留原始枚举值交由前端按界面语言本地化，实际生成 .xlsx 由前端完成。
export default defineEventHandler(async (event) => {
  try {
    const user = event.context.user

    if (!user || !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      throw createError({
        statusCode: 403,
        message: '只有系统管理员可以导出用户列表'
      })
    }

    // 导出前必须通过邮箱验证码（一次性，5 分钟有效）
    const exportCode = String(getHeader(event, 'x-export-code') || '').trim()
    if (!user.email) {
      throw createError({ statusCode: 403, message: '当前账号未绑定邮箱，无法导出，请先在账号设置中绑定邮箱' })
    }
    if (!exportCode) {
      throw createError({ statusCode: 403, message: '导出前需要邮箱验证码' })
    }
    if (!(await verifyEmailCode(user.email, exportCode))) {
      throw createError({ statusCode: 403, message: '邮箱验证码错误或已过期' })
    }

    const query = getQuery(event)
    const whereClause = buildUserFilterConditions(query)

    const userList = await db.query.users.findMany({
      where: whereClause,
      orderBy: asc(users.id),
      columns: {
        id: true,
        name: true,
        username: true,
        role: true,
        grade: true,
        class: true,
        status: true,
        statusChangedAt: true,
        lastLogin: true,
        lastLoginIp: true,
        passwordChangedAt: true,
        forcePasswordChange: true,
        meowNickname: true,
        meowBoundAt: true,
        email: true,
        emailVerified: true,
        remark: true,
        createdAt: true,
        updatedAt: true
      },
      with: {
        identities: {
          columns: {
            provider: true
          }
        }
      }
    })

    const exportedUsers = userList.map((row) => ({
      id: row.id,
      name: row.name,
      username: row.username,
      role: row.role,
      grade: row.grade,
      class: row.class,
      status: row.status,
      email: row.email,
      emailVerified: row.emailVerified,
      meowNickname: row.meowNickname,
      remark: row.remark,
      lastLogin: row.lastLogin ? formatDateTime(row.lastLogin) : null,
      lastLoginIp: row.lastLoginIp,
      statusChangedAt: row.statusChangedAt ? formatDateTime(row.statusChangedAt) : null,
      passwordChangedAt: row.passwordChangedAt ? formatDateTime(row.passwordChangedAt) : null,
      meowBoundAt: row.meowBoundAt ? formatDateTime(row.meowBoundAt) : null,
      forcePasswordChange: row.forcePasswordChange,
      createdAt: row.createdAt ? formatDateTime(row.createdAt) : null,
      updatedAt: row.updatedAt ? formatDateTime(row.updatedAt) : null,
      providers: (row.identities || []).map((identity) => identity.provider)
    }))

    return {
      success: true,
      count: exportedUsers.length,
      users: exportedUsers
    }
  } catch (error: any) {
    console.error('导出用户列表失败:', error)
    throw createError({
      statusCode: error.statusCode || 500,
      message: error.statusMessage || error.message || '导出用户列表失败'
    })
  }
})
