/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

import { timingSafeEqual } from 'node:crypto'
import { createApiError } from '~~/server/utils/apiError'
import { db } from '~/drizzle/db'
import { attackLogs } from '~/drizzle/schema'

const KINDS = new Set(['brute_force', 'enumeration', 'banned', 'region', 'script'])

function timingSafeEqualStr(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export default defineEventHandler(async (event) => {
  const expected = String(process.env.ATTACK_LOG_TOKEN || '')
  if (!expected) {
    throw createApiError(503, 'ATTACK_LOG_DISABLED', '攻击日志令牌未配置')
  }
  const provided = String(getHeader(event, 'x-attack-token') || '')
  if (!timingSafeEqualStr(provided, expected)) {
    throw createApiError(403, 'ATTACK_LOG_FORBIDDEN', '无权写入')
  }

  const body = await readBody(event).catch(() => null)
  if (!body || typeof body !== 'object') {
    throw createApiError(400, 'ATTACK_LOG_INVALID', '请求体无效')
  }
  const ip = String(body.ip || '').slice(0, 64)
  const kind = String(body.kind || '').slice(0, 32)
  if (!ip || !KINDS.has(kind)) {
    throw createApiError(400, 'ATTACK_LOG_INVALID', '攻击类型或 IP 无效')
  }

  await db.insert(attackLogs).values({
    ip,
    kind,
    path: body.path ? String(body.path).slice(0, 300) : null,
    count: Number.isFinite(Number(body.count)) ? Math.max(0, Math.trunc(Number(body.count))) : 0,
    userAgent: body.userAgent ? String(body.userAgent).slice(0, 300) : null,
    fingerprint: body.fingerprint ? String(body.fingerprint).slice(0, 128) : null,
    action: body.action ? String(body.action).slice(0, 32) : null,
    detail: body.detail ? String(body.detail).slice(0, 1000) : null
  })

  return { success: true }
})
