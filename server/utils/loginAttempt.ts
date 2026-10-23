/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

import type { H3Event } from 'h3'
import { getRequestHeader } from 'h3'
import { db } from '~/drizzle/db'
import { loginAttempts } from '~/drizzle/schema'
import { getClientIP } from './ip-utils'

export async function recordLoginAttempt(
  event: H3Event,
  payload: { username?: string; result: string; detail?: string }
) {
  try {
    await db.insert(loginAttempts).values({
      username: (payload.username || '').slice(0, 100) || null,
      ip: getClientIP(event) || null,
      userAgent: String(getRequestHeader(event, 'user-agent') || '').slice(0, 300) || null,
      result: payload.result,
      detail: payload.detail ? String(payload.detail).slice(0, 500) : null
    })
  } catch (error) {
    console.error('[login-attempt] 写入失败:', payload.result, error)
  }
}
