/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

import { gte, sql } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { adminAuditLogs, loginAttempts } from '~/drizzle/schema'
import { requireAdmin } from '~~/server/utils/requireAdmin'
import { fetchBotScores } from '~~/server/utils/rewriterBans'
import { normalizeIp } from '~~/server/utils/ip-geo'

// 边缘安全层的 Bot 评分快照（按登录会话/指纹维度），并用近 14 天登录尝试与
// 管理审计记录把评分反查回「账号」，供管理员按账号视角查看自动化风险。
export default defineEventHandler(async (event) => {
  requireAdmin(event, ['ADMIN', 'SUPER_ADMIN'])

  const query = getQuery(event)
  const usernameFilter = typeof query.username === 'string' ? query.username.trim().toLowerCase() : ''

  const scores = await fetchBotScores()

  // 近 14 天 账号↔(ip, ua) 关联：登录尝试 + 管理审计
  const since = sql`now() - interval '14 days'`
  const [logins, audits] = await Promise.all([
    db
      .select({ username: loginAttempts.username, ip: loginAttempts.ip, ua: loginAttempts.userAgent, at: loginAttempts.createdAt })
      .from(loginAttempts)
      .where(gte(loginAttempts.createdAt, since))
      .orderBy(sql`${loginAttempts.createdAt} desc`)
      .limit(2000),
    db
      .select({ username: adminAuditLogs.actorName, ip: adminAuditLogs.ip, ua: adminAuditLogs.userAgent, at: adminAuditLogs.createdAt })
      .from(adminAuditLogs)
      .where(gte(adminAuditLogs.createdAt, since))
      .orderBy(sql`${adminAuditLogs.createdAt} desc`)
      .limit(1000)
  ])

  // 精确键 ip|ua → 账号；宽松键 ip → 账号（UA 不一致时兜底）
  const exact = new Map<string, string>()
  const byIp = new Map<string, string>()
  const put = (m: Map<string, string>, k: string, v: string) => { if (k && v && !m.has(k)) m.set(k, v) }
  for (const row of [...logins, ...audits]) {
    const name = String(row.username || '').trim()
    const ip = normalizeIp(String(row.ip || ''))
    const ua = String(row.ua || '').slice(0, 160)
    if (!name || !ip) continue
    put(exact, `${ip}|${ua}`, name)
    put(byIp, ip, name)
  }

  const rows = scores.map((s) => {
    const ip = normalizeIp(String(s.ip || ''))
    const ua = String(s.ua || '').slice(0, 160)
    const account = exact.get(`${ip}|${ua}`) || byIp.get(ip) || ''
    return { ...s, account }
  })

  const filtered = usernameFilter
    ? rows.filter((r) => (r.account || '').toLowerCase().includes(usernameFilter))
    : rows

  return { scores: filtered, total: filtered.length, scanned: scores.length }
})
