/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

import type { H3Event } from 'h3'
import { getQuery } from 'h3'
import { timingSafeEqual } from 'node:crypto'
import { createApiError } from './apiError'

export function assertBackupTriggerToken(event: H3Event) {
  const expected = String(process.env.BACKUP_TRIGGER_TOKEN || '').trim()
  if (!expected) return

  const query = getQuery(event)
  const provided = String(
    query.token || event?.node?.req?.headers?.['x-backup-token'] || ''
  ).trim()
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw createApiError(403, 'AUTH_FORBIDDEN', '无效的备份触发令牌')
  }
}
