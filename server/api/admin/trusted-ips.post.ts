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
import { updateTrustedIps } from '~~/server/utils/rewriterBans'
import { isPrivateIp } from '~~/server/utils/ip-geo'
import { writeAdminAudit } from '~~/server/utils/adminAudit'

const bodySchema = z.object({
  action: z.union([z.literal('add'), z.literal('remove')]),
  ip: z.string().trim().min(1).max(45)
}).strict()

const IP_RE = /^(\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F:]{2,45})$/

// 出口白名单（TRUSTED_IPS）增删。加入后该 IP 绕过攻击锁定与地域闸。管理员或超级管理员可操作。
export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event, ['ADMIN', 'SUPER_ADMIN'])

  const raw = await readBody(event).catch(() => ({}))
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    throw createApiError(400, 'INVALID_PARAMS', '请求参数不合法')
  }
  const ip = parsed.data.ip.replace(/^::ffff:/i, '')
  if (!IP_RE.test(ip)) {
    throw createApiError(400, 'INVALID_IP', 'IP 地址格式不正确')
  }
  if (parsed.data.action === 'add' && isPrivateIp(ip)) {
    throw createApiError(400, 'PRIVATE_IP', '内网/私有地址无需加入白名单')
  }

  const result = await updateTrustedIps(parsed.data.action, ip)
  await writeAdminAudit(event, {
    action: parsed.data.action === 'add' ? 'EDGE_TRUSTED_IP_ADD' : 'EDGE_TRUSTED_IP_REMOVE',
    target: ip,
    detail: `by ${admin.username || admin.id}`
  })

  return { success: true, ips: result.ips, removed: result.removed }
})
