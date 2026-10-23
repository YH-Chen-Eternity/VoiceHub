/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

// Copyright (C) 2026 YH-Chen
//
// 用户管理「批量强制更新」：一次给多个账号下发「下次进入站点时必须更新密码 / 用户名」。
// 与单用户接口 /api/admin/users/:id/force-update 共用 User.forcePasswordChange / forceUsernameChange，
// 拦截链路（verify / 全局弹窗 / 敏感接口 403）完全一致。
import { z } from 'zod'
import { inArray } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { users } from '~/drizzle/schema'
import { createApiError } from '~~/server/utils/apiError'
import { createSystemNotification } from '~~/server/services/notificationService'
import { writeAdminAudit } from '~~/server/utils/adminAudit'

const batchSchema = z.object({
  userIds: z.array(z.number().int().positive()).min(1, '请至少选择一位用户').max(200, '单次最多 200 位用户'),
  password: z.boolean(),
  username: z.boolean()
})

export default defineEventHandler(async (event) => {
  const operator = event.context.user
  if (!operator || !['ADMIN', 'SUPER_ADMIN'].includes(operator.role)) {
    throw createApiError(403, 'AUTH_FORBIDDEN', '没有权限执行该操作')
  }

  const parsed = batchSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createApiError(
      400,
      'COMMON_INVALID_PARAMS',
      parsed.error.issues[0]?.message || '请求参数无效'
    )
  }

  const { password, username } = parsed.data
  if (!password && !username) {
    throw createApiError(400, 'COMMON_INVALID_PARAMS', '请至少选择一项需要用户更新的内容')
  }

  const targetIds = [...new Set(parsed.data.userIds)]

  const targets = await db
    .select({
      id: users.id,
      name: users.name,
      username: users.username,
      role: users.role
    })
    .from(users)
    .where(inArray(users.id, targetIds))

  const foundIds = new Set(targets.map((item) => item.id))
  const skipped: Array<{ id: number; name: string; reason: string }> = targetIds
    .filter((id) => !foundIds.has(id))
    .map((id) => ({ id, name: `#${id}`, reason: '用户不存在' }))

  const allowed: number[] = []
  for (const target of targets) {
    if (target.id === 1) {
      skipped.push({ id: target.id, name: target.name || target.username, reason: '系统初始超级管理员' })
      continue
    }
    if (target.id === operator.id) {
      skipped.push({ id: target.id, name: target.name || target.username, reason: '当前登录账号' })
      continue
    }
    if (target.role === 'SUPER_ADMIN' && operator.role !== 'SUPER_ADMIN') {
      skipped.push({ id: target.id, name: target.name || target.username, reason: '权限不足' })
      continue
    }
    allowed.push(target.id)
  }

  if (allowed.length === 0) {
    throw createApiError(
      400,
      'COMMON_INVALID_PARAMS',
      `没有可操作的用户（${skipped.map((item) => `${item.name}：${item.reason}`).join('；')}）`
    )
  }

  await db
    .update(users)
    .set({
      forcePasswordChange: password,
      forceUsernameChange: username,
      updatedAt: new Date()
    })
    .where(inArray(users.id, allowed))

  // 站内通知：分小批发送，避免一次打出几百条并发写
  const items = [password ? '登录密码' : '', username ? '用户名' : ''].filter(Boolean)
  const notifyMessage = `管理员要求您更新${items.join('和')}，请在进入站点后按页面提示完成更新。`
  for (let i = 0; i < allowed.length; i += 20) {
    const chunk = allowed.slice(i, i + 20)
    await Promise.allSettled(
      chunk.map((id) => createSystemNotification(id, '账号信息需要更新', notifyMessage))
    )
  }

  await writeAdminAudit(event, {
    action: 'USER_FORCE_UPDATE_BATCH',
    target: `${allowed.length} 位用户`,
    detail:
      `要求更新：${items.join('、')}；ID：${allowed.slice(0, 20).join(',')}` +
      (allowed.length > 20 ? ` 等 ${allowed.length} 人` : '') +
      (skipped.length > 0 ? `；跳过 ${skipped.length} 人` : '')
  })

  const skippedText = skipped.length > 0 ? `，${skipped.length} 位已跳过` : ''
  return {
    success: true,
    message: `已向 ${allowed.length} 位用户下发强制更新（${items.join('、')}）${skippedText}`,
    updated: allowed.length,
    updatedIds: allowed,
    skipped
  }
})
