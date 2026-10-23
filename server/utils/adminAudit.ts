/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

import type { H3Event } from 'h3'
import { db } from '~/drizzle/db'
import { adminAuditLogs } from '~/drizzle/schema'
import { getClientIP } from '~~/server/utils/ip-utils'

export interface AdminAuditPayload {
  action: string
  target?: string | null
  detail?: string | null
}

export interface AdminAuditContext {
  actorId: number | null
  actorName: string | null
  ip: string | null
  userAgent: string | null
}

export function captureAdminAuditContext(event: H3Event): AdminAuditContext {
  const user = event?.context?.user
  const clientIp = getClientIP(event)
  const userAgent = String(event?.node?.req?.headers?.['user-agent'] || '').slice(0, 300)

  return {
    actorId: user?.id ?? null,
    actorName: user?.username ? String(user.username).slice(0, 100) : null,
    ip: clientIp && clientIp !== 'unknown' ? clientIp.slice(0, 64) : null,
    userAgent: userAgent || null
  }
}

export async function writeAdminAuditRecord(context: AdminAuditContext, payload: AdminAuditPayload) {
  try {
    await db.insert(adminAuditLogs).values({
      actorId: context.actorId,
      actorName: context.actorName,
      action: String(payload.action || 'ADMIN_ACTION').slice(0, 200),
      target: payload.target ? String(payload.target).slice(0, 300) : null,
      detail: payload.detail ? String(payload.detail).slice(0, 1000) : null,
      ip: context.ip,
      userAgent: context.userAgent
    })
  } catch (error) {
    console.error('[admin-audit] 写入审计失败:', payload.action, error)
  }
}

export async function writeAdminAudit(event: H3Event, payload: AdminAuditPayload) {
  await writeAdminAuditRecord(captureAdminAuditContext(event), payload)
}
