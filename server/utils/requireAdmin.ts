/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

import type { H3Event } from 'h3'
import { createApiError } from './apiError'

export function requireAdmin(event: H3Event, roles: string[] = ['ADMIN', 'SUPER_ADMIN']) {
  const user = event?.context?.user
  if (!user) {
    throw createApiError(401, 'AUTH_UNAUTHORIZED', '请先登录')
  }
  if (!roles.includes(user.role)) {
    throw createApiError(403, 'AUTH_FORBIDDEN', '无权执行该操作')
  }
  return user
}

export function requireSuperAdmin(event: H3Event) {
  return requireAdmin(event, ['SUPER_ADMIN'])
}
