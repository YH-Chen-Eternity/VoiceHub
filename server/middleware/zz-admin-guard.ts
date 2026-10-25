/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

import { getMethod, getRequestHeader, getRequestURL, readBody } from 'h3'
import { createApiError } from '~~/server/utils/apiError'
import {
  captureAdminAuditContext,
  writeAdminAuditRecord,
  type AdminAuditPayload
} from '~~/server/utils/adminAudit'
import { describeAdminAction, isAuditedGetPath } from '~~/server/utils/adminAuditCatalog'

// 与歌曲管理员后台可见页面一致；这些路由内部仍各自校验 SONG_ADMIN 及以上权限
// 放歌员：只读概览与排期，不允许改任何数据
const BROADCASTER_ALLOWED_PATTERNS = [
  /^\/api\/admin\/stats(?:\/|$)/,
  /^\/api\/admin\/activities$/,
  /^\/api\/admin\/schedule\/full$/,
  /^\/api\/admin\/schedule\/song-pool$/,
  /^\/api\/admin\/replay-requests(?:\/|$)/,
  /^\/api\/admin\/semesters(?:\/|$)/,
  /^\/api\/admin\/play-times(?:\/|$)/
]

const SONG_ADMIN_ALLOWED_PATTERNS = [
  /^\/api\/admin\/schedule(?:\/|$)/,
  /^\/api\/admin\/songs(?:\/|$)/,
  /^\/api\/admin\/play-times(?:\/|$)/,
  /^\/api\/admin\/request-times(?:\/|$)/,
  /^\/api\/admin\/semesters(?:\/|$)/,
  /^\/api\/admin\/card-codes(?:\/|$)/,
  /^\/api\/admin\/stats(?:\/|$)/,
  /^\/api\/admin\/activities$/,
  /^\/api\/admin\/replay-requests(?:\/|$)/
]

async function readAuditBody(event: any) {
  const contentType = String(getRequestHeader(event, 'content-type') || '').toLowerCase()
  if (!contentType.includes('application/json')) return null
  const contentLength = Number(getRequestHeader(event, 'content-length') || 0)
  if (Number.isFinite(contentLength) && contentLength > 64 * 1024) return null
  try {
    return await readBody(event)
  } catch {
    return null
  }
}

export default defineEventHandler(async (event) => {
  const pathname = getRequestURL(event).pathname
  if (!pathname.startsWith('/api/')) return
  const lower = pathname.toLowerCase()
  if (!lower.startsWith('/api/admin')) return

  const user = event.context.user
  if (!user) {
    throw createApiError(401, 'AUTH_UNAUTHORIZED', '请先登录')
  }
  const role = String(user.role || '')
  // 审帖员仅允许访问社区管理子路径（归档/举报/申诉等接口内部各自校验角色与板块）
  const reviewerCommunityPath = role === 'REVIEWER' && lower.startsWith('/api/admin/community/')
  if (!['ADMIN', 'SUPER_ADMIN', 'SONG_ADMIN', 'BROADCASTER'].includes(role) && !reviewerCommunityPath) {
    throw createApiError(403, 'AUTH_FORBIDDEN', '无权访问管理接口')
  }
  if (reviewerCommunityPath) return

  const method = getMethod(event).toUpperCase()
  if (role === 'SONG_ADMIN' && !SONG_ADMIN_ALLOWED_PATTERNS.some((pattern) => pattern.test(lower))) {
    throw createApiError(403, 'AUTH_FORBIDDEN', '该接口仅系统管理员可访问')
  }
  if (role === 'BROADCASTER') {
    if (method !== 'GET' || !BROADCASTER_ALLOWED_PATTERNS.some((pattern) => pattern.test(lower))) {
      throw createApiError(403, 'AUTH_FORBIDDEN', '放歌员仅可查看排期相关信息')
    }
  }

  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
  if (!mutating && !isAuditedGetPath(method, lower)) return

  const body = mutating ? await readAuditBody(event) : null
  let payload: AdminAuditPayload
  try {
    payload = await describeAdminAction(method, pathname, body)
  } catch (error: any) {
    console.error('[admin-audit] 生成动作描述失败:', error)
    payload = { action: `${method} ${lower}`, target: null, detail: `${method} ${lower}` }
  }

  // 记录发生在响应完成后，只保留真正执行成功的操作；失败请求由 LoginAttempt / 运行日志覆盖
  const context = captureAdminAuditContext(event)
  const finalize = () => {
    const status = event.node?.res?.statusCode || 200
    if (status >= 400) return
    void writeAdminAuditRecord(context, payload)
  }
  const response = event.node?.res
  if (response && typeof response.once === 'function') {
    response.once('finish', finalize)
  } else {
    finalize()
  }
})
