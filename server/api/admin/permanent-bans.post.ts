/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

import { isIP } from 'node:net'
import { createApiError } from '~~/server/utils/apiError'
import { requireAdmin } from '~~/server/utils/requireAdmin'
import { unbanRewriterTarget } from '~~/server/utils/rewriterBans'

export default defineEventHandler(async (event) => {
  requireAdmin(event, ['SUPER_ADMIN'])

  const body = await readBody(event).catch(() => null)
  const type = body?.type === 'fp' ? 'fp' : 'ip'
  const value = String(body?.value || '').trim()

  if (!value || value.length > 128) {
    throw createApiError(400, 'PERMANENT_BAN_INVALID', '解封目标无效')
  }
  if (type === 'ip' && !isIP(value)) {
    throw createApiError(400, 'PERMANENT_BAN_INVALID', 'IP 地址格式无效')
  }
  if (type === 'fp' && !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw createApiError(400, 'PERMANENT_BAN_INVALID', '指纹格式无效')
  }

  const removed = await unbanRewriterTarget(type, value)
  return { success: true, removed }
})
