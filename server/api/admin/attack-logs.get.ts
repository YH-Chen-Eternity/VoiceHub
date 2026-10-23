/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { attackLogs } from '~/drizzle/schema'
import { requireAdmin } from '~~/server/utils/requireAdmin'
import { normalizeIp, resolveIpLocations } from '~~/server/utils/ip-geo'

export default defineEventHandler(async (event) => {
  requireAdmin(event, ['ADMIN', 'SUPER_ADMIN'])

  const query = getQuery(event)
  const limitRaw = Number(query.limit || 200)
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 200, 1), 500)
  const kind = typeof query.kind === 'string' ? query.kind : ''
  const hoursRaw = Number(query.hours || 0)
  const hours = Number.isFinite(hoursRaw) ? Math.min(Math.max(hoursRaw, 0), 24 * 30) : 0

  const conditions = []
  if (kind) conditions.push(eq(attackLogs.kind, kind))
  if (hours > 0) conditions.push(gte(attackLogs.createdAt, sql`now() - (${hours} || ' hours')::interval`))
  const where = conditions.length ? and(...conditions) : undefined

  const rows = await db
    .select()
    .from(attackLogs)
    .where(where)
    .orderBy(desc(attackLogs.createdAt))
    .limit(limit)

  // 富化每条攻击日志的 IP 地理位置（适配 IPv4 / IPv6，内网/私有地址标记为内网）。
  const locations = await resolveIpLocations(
    rows.map((row) => String(row.ip || '')).filter(Boolean)
  )
  const logs = rows.map((row) => ({
    ...row,
    location: locations.get(normalizeIp(String(row.ip || ''))) || null
  }))

  return { logs, total: logs.length }
})
