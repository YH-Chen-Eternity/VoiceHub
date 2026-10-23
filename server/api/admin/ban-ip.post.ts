/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

import { z } from 'zod'
import { requireAdmin } from '~~/server/utils/requireAdmin'
import { createApiError } from '~~/server/utils/apiError'
import { banRewriterIp } from '~~/server/utils/rewriterBans'
import { isPrivateIp } from '~~/server/utils/ip-geo'
import { getClientIP } from '~~/server/utils/ip-utils'
import { writeAdminAudit } from '~~/server/utils/adminAudit'

const bodySchema = z.object({
  ip: z.string().trim().min(1).max(45),
  detail: z.string().trim().max(300).optional()
}).strict()

const IP_RE = /^(\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F:]{2,45})$/

// 手动封禁 IP（攻击日志面板填写）。管理员或超级管理员可操作。
export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event, ['ADMIN', 'SUPER_ADMIN'])

  const raw = await readBody(event).catch(() => ({}))
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    throw createApiError(400, 'INVALID_PARAMS', '请填写有效的 IP 地址')
  }
  const ip = parsed.data.ip.replace(/^::ffff:/i, '')
  if (!IP_RE.test(ip)) {
    throw createApiError(400, 'INVALID_IP', 'IP 地址格式不正确')
  }
  // 防呆：内网/本机地址不可封；当前请求来源 IP 不可封（防自锁）
  if (isPrivateIp(ip)) {
    throw createApiError(400, 'PRIVATE_IP', '不能封禁内网/私有地址')
  }
  if (ip === getClientIP(event)) {
    throw createApiError(400, 'SELF_IP', '不能封禁当前登录来源 IP')
  }

  const detail = parsed.data.detail || `manual ban by ${admin.username || admin.id}`
  await banRewriterIp(ip, detail)
  await writeAdminAudit(event, { action: 'EDGE_BAN_IP', target: ip, detail })

  return { success: true, ip }
})
