/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

import { getQuery, setHeader } from 'h3'
import { sql } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { requireAdmin } from '~~/server/utils/requireAdmin'
import { legacyActionLabel } from '~~/server/utils/adminAuditCatalog'
import { normalizeIp, resolveIpLocations } from '~~/server/utils/ip-geo'

const LOGIN_RESULT_LABELS: Record<string, string> = {
  success: '登录成功',
  wrong_password: '登录失败（密码错误）',
  no_user: '登录失败（账号不存在）',
  status_rejected: '登录被拒（账号状态异常）',
  account_locked: '登录被拒（IP 已锁定）'
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.trunc(parsed), min), max)
}

// 原始 SQL 返回的 timestamp 可能是 Date、ISO 字符串或 "YYYY-MM-DD HH:mm:ss+00"
function toIsoString(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  const text = String(value).trim()
  const normalized = text.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')
  const withZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : `${normalized}Z`
  const date = new Date(withZone)
  return Number.isNaN(date.getTime()) ? text : date.toISOString()
}

export default defineEventHandler(async (event) => {
  requireAdmin(event, ['ADMIN', 'SUPER_ADMIN'])
  setHeader(event, 'Cache-Control', 'no-store')

  const query = getQuery(event)
  const type = query.type === 'login' || query.type === 'action' ? String(query.type) : ''
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 80) : ''
  const hours = clampInt(query.hours, 0, 0, 24 * 30)
  const page = clampInt(query.page, 1, 1, 10000)
  const pageSize = clampInt(query.pageSize, 50, 20, 200)
  const offset = (page - 1) * pageSize
  const like = `%${q}%`

  const loginConditions = [sql`u.role IN ('ADMIN', 'SUPER_ADMIN', 'SONG_ADMIN')`]
  const actionConditions = [sql`TRUE`]
  if (hours > 0) {
    loginConditions.push(sql`la."createdAt" >= now() - (${hours} || ' hours')::interval`)
    actionConditions.push(sql`aal."createdAt" >= now() - (${hours} || ' hours')::interval`)
  }

  const loginBranch = sql`
    SELECT
      'login'::text AS type,
      la.id AS id,
      la.username AS actor_name,
      u.id AS actor_id,
      la.result AS action,
      NULL::text AS target,
      la.detail AS detail,
      la.ip AS ip,
      la."userAgent" AS user_agent,
      la."createdAt" AT TIME ZONE 'UTC' AS created_at
    FROM "LoginAttempt" la
    INNER JOIN "User" u ON u.username = la.username
    WHERE ${sql.join(loginConditions, sql` AND `)}
  `

  const actionBranch = sql`
    SELECT
      'action'::text AS type,
      aal.id AS id,
      aal."actorName" AS actor_name,
      aal."actorId" AS actor_id,
      aal.action AS action,
      aal.target AS target,
      aal.detail AS detail,
      aal.ip AS ip,
      aal."userAgent" AS user_agent,
      aal."createdAt" AT TIME ZONE 'UTC' AS created_at
    FROM "AdminAuditLog" aal
    WHERE ${sql.join(actionConditions, sql` AND `)}
  `

  const branches = []
  if (type !== 'action') branches.push(loginBranch)
  if (type !== 'login') branches.push(actionBranch)
  const entriesCte = sql`WITH entries AS (${sql.join(branches, sql` UNION ALL `)})`
  const searchWhere = q
    ? sql`WHERE (
        actor_name ILIKE ${like}
        OR action ILIKE ${like}
        OR COALESCE(target, '') ILIKE ${like}
        OR COALESCE(detail, '') ILIKE ${like}
      )`
    : sql``

  const [pageResult, countResult] = await Promise.all([
    db.execute(sql`
      ${entriesCte}
      SELECT * FROM entries
      ${searchWhere}
      ORDER BY created_at DESC, type ASC, id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `),
    db.execute(sql`
      ${entriesCte}
      SELECT count(*)::int AS total FROM entries
      ${searchWhere}
    `)
  ])

  const rows = pageResult as unknown as Array<Record<string, any>>
  const total = Number((countResult as unknown as Array<{ total?: number }>)[0]?.total || 0)
  const locations = await resolveIpLocations(rows.map((row) => String(row.ip || '')).filter(Boolean))

  const logs = rows.map((row) => {
    const rawTarget = row.target ? String(row.target) : null
    const legacyPath = rawTarget && rawTarget.startsWith('/api/admin') ? rawTarget : null
    const action = String(row.action || '')
    const actionLabel =
      row.type === 'login'
        ? LOGIN_RESULT_LABELS[action] || `登录事件（${action || 'unknown'}）`
        : legacyActionLabel(action) || action || '管理操作'

    return {
      id: `${row.type}-${row.id}`,
      type: row.type,
      actorId: row.actor_id == null ? null : Number(row.actor_id),
      actorName: row.actor_name ? String(row.actor_name) : null,
      action,
      actionLabel,
      target: legacyPath ? null : rawTarget,
      detail: row.detail ? String(row.detail) : legacyPath ? action : null,
      ip: row.ip ? String(row.ip) : null,
      location: locations.get(normalizeIp(String(row.ip || ''))) || null,
      userAgent: row.user_agent ? String(row.user_agent) : null,
      createdAt: toIsoString(row.created_at)
    }
  })

  return {
    logs,
    total,
    page,
    pageSize,
    filters: { type, q, hours }
  }
})
