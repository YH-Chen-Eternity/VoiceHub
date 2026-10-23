/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

import { requireAdmin } from '~~/server/utils/requireAdmin'
import { fetchGeoLock } from '~~/server/utils/rewriterBans'

// 查询地域锁当前状态（管理员或超级管理员）
export default defineEventHandler(async (event) => {
  requireAdmin(event, ['ADMIN', 'SUPER_ADMIN'])
  const state = await fetchGeoLock()
  return { success: true, enabled: state.enabled }
})
