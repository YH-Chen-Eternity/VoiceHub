/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

import { requireAdmin } from '~~/server/utils/requireAdmin'
import { fetchRewriterBans } from '~~/server/utils/rewriterBans'

export default defineEventHandler(async (event) => {
  requireAdmin(event, ['ADMIN', 'SUPER_ADMIN'])
  const snapshot = await fetchRewriterBans()
  return { success: true, ...snapshot }
})
