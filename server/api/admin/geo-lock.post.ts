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
import { setGeoLock } from '~~/server/utils/rewriterBans'

const bodySchema = z.object({
  enabled: z.union([z.boolean(), z.literal(1), z.literal(0), z.literal('true'), z.literal('false')])
}).strict()

// 切换地域锁（开启=仅中国大陆+CDN 放行；关闭=所有 IP 放行）。管理员或超级管理员可操作。
export default defineEventHandler(async (event) => {
  requireAdmin(event, ['ADMIN', 'SUPER_ADMIN'])

  const raw = await readBody(event).catch(() => ({}))
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    throw createApiError(400, 'INVALID_PARAMS', '请求参数不合法')
  }
  const enabled = parsed.data.enabled === true || parsed.data.enabled === 1 || parsed.data.enabled === 'true'

  const result = await setGeoLock(enabled)
  return { success: true, enabled: result }
})
