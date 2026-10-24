/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

// Copyright (C) 2026 YH-Chen
//
// 用户管理「强制更新」：管理员要求某个已有账号在下次进入站点时先更新密码 / 用户名 / 两者。
// 密码沿用 User.forcePasswordChange（与重置密码、首次登录策略同一套拦截链路），
// 用户名使用新增的 User.forceUsernameChange。
import { eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { users } from '~/drizzle/schema'
import { createApiError } from '~~/server/utils/apiError'
import { createSystemNotification } from '~~/server/services/notificationService'
import { writeAdminAudit } from '~~/server/utils/adminAudit'

export default defineEventHandler(async (event) => {
  const operator = event.context.user
  if (!operator || !['ADMIN', 'SUPER_ADMIN'].includes(operator.role)) {
    throw createApiError(403, 'AUTH_FORBIDDEN', '没有权限执行该操作')
  }

  const targetId = Number.parseInt(String(event.context.params?.id || ''), 10)
  if (!Number.isInteger(targetId) || targetId <= 0) {
    throw createApiError(400, 'COMMON_INVALID_PARAMS', '无效的用户ID')
  }

  if (targetId === 1) {
    throw createApiError(403, 'AUTH_FORBIDDEN', '无法修改系统初始超级管理员')
  }
  if (targetId === operator.id) {
    throw createApiError(400, 'AUTH_FORBIDDEN', '禁止在用户管理中修改自己的账户')
  }

  const body = await readBody<{ password?: unknown; username?: unknown } | null>(event)
  const forcePassword = body?.password === true
  const forceUsername = body?.username === true

  const [target] = await db
    .select({
      id: users.id,
      name: users.name,
      username: users.username,
      role: users.role,
      forcePasswordChange: users.forcePasswordChange,
      forceUsernameChange: users.forceUsernameChange
    })
    .from(users)
    .where(eq(users.id, targetId))
    .limit(1)

  if (!target) {
    throw createApiError(404, 'USER_NOT_FOUND', '用户不存在')
  }

  // 越级保护：普通管理员不得操作超级管理员
  if (target.role === 'SUPER_ADMIN' && operator.role !== 'SUPER_ADMIN') {
    throw createApiError(403, 'AUTH_FORBIDDEN', '权限不足：普通管理员无法修改超级管理员信息')
  }

  if (!forcePassword && !forceUsername && !target.forcePasswordChange && !target.forceUsernameChange) {
    throw createApiError(400, 'COMMON_INVALID_PARAMS', '请至少选择一项需要用户更新的内容')
  }

  await db
    .update(users)
    .set({
      forcePasswordChange: forcePassword,
      forceUsernameChange: forceUsername,
      updatedAt: new Date()
    })
    .where(eq(users.id, targetId))

  // 站内通知：让用户知道是管理员的要求，而不是系统故障
  const items = [forcePassword ? '登录密码' : '', forceUsername ? '用户名' : ''].filter(Boolean)
  if (items.length > 0) {
    try {
      await createSystemNotification(
        targetId,
        '账号信息需要更新',
        `管理员要求您更新${items.join('和')}，请在进入站点后按页面提示完成更新。`
      )
    } catch (error: any) {
      console.warn('发送强制更新通知失败:', error)
    }
  }

  await writeAdminAudit(event, {
    action: 'USER_FORCE_UPDATE',
    target: `#${target.id} ${target.name || target.username}`,
    detail: items.length > 0 ? `要求更新：${items.join('、')}` : '已取消强制更新要求'
  })

  return {
    success: true,
    message:
      items.length > 0
        ? `已要求该用户更新${items.join('和')}`
        : '已取消该用户的强制更新要求',
    forcePasswordChange: forcePassword,
    forceUsernameChange: forceUsername
  }
})
