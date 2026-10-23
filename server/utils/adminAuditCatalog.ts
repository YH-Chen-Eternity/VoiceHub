/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

import { eq, inArray } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { schedules, songs, users } from '~/drizzle/schema'

export interface AdminAuditDescriptor {
  action: string
  target?: string | null
  detail?: string | null
}

const LEGACY_ACTIONS: Record<string, string> = {
  SONG_MARK_PLAYED_BULK: '批量标记歌曲已播放',
  USER_RESET_PASSWORD: '重置用户密码',
  USER_EXPORT: '导出用户数据'
}

const AUDITED_GET_PATHS = new Set([
  '/api/admin/users/export',
  '/api/admin/card-codes/export',
  '/api/admin/backup/download'
])

function clip(value: unknown, max: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function positiveIds(value: unknown): number[] {
  const list = Array.isArray(value) ? value : value == null ? [] : [value]
  return [...new Set(list.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
}

function routeId(pathname: string): number {
  const match = pathname.match(/\/(\d+)(?:\/|$)/)
  return match ? Number(match[1]) : 0
}

async function songLabel(ids: number[]): Promise<string | null> {
  if (!ids.length) return null
  const unique = [...new Set(ids)].slice(0, 20)
  try {
    const rows = await db
      .select({ id: songs.id, title: songs.title, artist: songs.artist })
      .from(songs)
      .where(inArray(songs.id, unique))
    const byId = new Map(rows.map((row) => [row.id, row]))
    const labels = ids.slice(0, 5).map((id) => {
      const row = byId.get(id)
      if (!row) return `歌曲 #${id}`
      return `《${row.title}》${row.artist ? ` - ${row.artist}` : ''}`
    })
    return `${labels.join('、')}${ids.length > 5 ? ` 等 ${ids.length} 首` : ''}`
  } catch {
    return ids.length === 1 ? `歌曲 #${ids[0]}` : `${ids.length} 首歌曲`
  }
}

async function scheduleLabel(id: number): Promise<string | null> {
  if (!id) return null
  try {
    const rows = await db
      .select({
        id: schedules.id,
        playDate: schedules.playDate,
        title: songs.title,
        artist: songs.artist
      })
      .from(schedules)
      .leftJoin(songs, eq(schedules.songId, songs.id))
      .where(eq(schedules.id, id))
      .limit(1)
    const row = rows[0]
    if (!row) return `排期 #${id}`
    const song = row.title ? `《${row.title}》${row.artist ? ` - ${row.artist}` : ''}` : ''
    const date = row.playDate ? String(row.playDate).slice(0, 10) : ''
    return [song, date && `(${date})`].filter(Boolean).join(' ') || `排期 #${id}`
  } catch {
    return `排期 #${id}`
  }
}

async function userLabel(id: number): Promise<string | null> {
  if (!id) return null
  try {
    const rows = await db
      .select({ username: users.username, name: users.name })
      .from(users)
      .where(eq(users.id, id))
      .limit(1)
    const row = rows[0]
    if (!row) return `用户 #${id}`
    return `${row.username}${row.name ? `（${row.name}）` : ''}`
  } catch {
    return `用户 #${id}`
  }
}

function actionLabelForPath(method: string, pathname: string): string | null {
  const p = pathname.replace(/\/+$/, '').toLowerCase()
  const m = method.toUpperCase()

  if (p === '/api/admin/schedule/draft' && m === 'POST') return '加入排期'
  if (p === '/api/admin/schedule/bulk-draft' && m === 'POST') return '批量加入排期草稿'
  if (p === '/api/admin/schedule/publish' && m === 'POST') return '发布排期'
  if (p === '/api/admin/schedule/bulk-publish' && m === 'POST') return '批量发布排期'
  if (p === '/api/admin/schedule/remove' && m === 'POST') return '移除排期'
  if (p === '/api/admin/schedule/remove-all-date' && m === 'POST') return '批量移除排期'
  if (p === '/api/admin/schedule/move-date' && m === 'POST') return '调整排期日期'
  if (p === '/api/admin/schedule/copy' && m === 'POST') return '复制排期'
  if (p === '/api/admin/schedule/sequence' && m === 'POST') return '调整排期顺序'
  if (p === '/api/admin/schedule/song-pool' && m === 'POST') return '加入备选歌曲池'
  if (p === '/api/admin/schedule/song-pool' && m === 'DELETE') return '移出备选歌曲池'
  if (p === '/api/admin/schedule' && m === 'POST') return '保存排期'

  if (p === '/api/admin/songs/reject' && m === 'POST') return '驳回歌曲'
  if (p === '/api/admin/songs/batch-reject' && m === 'POST') return '批量驳回歌曲'
  if (p === '/api/admin/songs/delete' && m === 'POST') return '删除歌曲'
  if (p === '/api/admin/songs/mark-played' && m === 'POST') return '标记歌曲已播放'
  if (p === '/api/admin/songs/duration' && m === 'POST') return '更新歌曲时长'
  if (p === '/api/admin/songs/cover' && m === 'POST') return '更新歌曲封面'

  if (p === '/api/admin/review/users/decide' && m === 'POST') return '审核用户'
  if (p === '/api/admin/review/notes/decide' && m === 'POST') return '审核公开留言'
  if (p === '/api/admin/replay-requests/reject' && m === 'POST') return '驳回重播申请'

  if (p === '/api/admin/announcements' && m === 'POST') return '发布公告'
  if (/^\/api\/admin\/announcements\/\d+$/.test(p) && m === 'PUT') return '修改公告'
  if (/^\/api\/admin\/announcements\/\d+$/.test(p) && m === 'DELETE') return '删除公告'

  if (p === '/api/admin/card-codes/create' && m === 'POST') return '生成点歌券'
  if (p === '/api/admin/card-codes/update' && m === 'POST') return '更新点歌券'
  if (p === '/api/admin/card-codes/delete' && m === 'POST') return '删除点歌券'
  if (/^\/api\/admin\/card-codes\/\d+$/.test(p) && m === 'PUT') return '修改点歌券'
  if (p === '/api/admin/card-codes/export' && m === 'GET') return '导出点歌券'

  if (/^\/api\/admin\/play-times\/\d+$/.test(p) && ['PUT', 'DELETE'].includes(m)) {
    return m === 'PUT' ? '修改播放时段' : '删除播放时段'
  }
  if ((p === '/api/admin/play-times' || p === '/api/admin/play-times/index') && m === 'POST') return '创建播放时段'
  if (/^\/api\/admin\/request-times\/\d+$/.test(p) && ['PUT', 'DELETE'].includes(m)) {
    return m === 'PUT' ? '修改投稿时段' : '删除投稿时段'
  }
  if ((p === '/api/admin/request-times' || p === '/api/admin/request-times/index') && m === 'POST') return '创建投稿时段'

  if (p === '/api/admin/semesters' && m === 'POST') return '创建学期'
  if (/^\/api\/admin\/semesters\/\d+$/.test(p) && m === 'PUT') return '修改学期'
  if (/^\/api\/admin\/semesters\/\d+$/.test(p) && m === 'DELETE') return '删除学期'
  if (p === '/api/admin/semesters/set-active' && m === 'POST') return '切换当前学期'

  if (p === '/api/admin/blacklist' && m === 'POST') return '添加黑名单'
  if (/^\/api\/admin\/blacklist\/\d+$/.test(p) && ['PUT', 'PATCH'].includes(m)) return '修改黑名单'
  if (/^\/api\/admin\/blacklist\/\d+$/.test(p) && m === 'DELETE') return '移除黑名单'

  if (p === '/api/admin/users' && m === 'POST') return '创建用户'
  if (p === '/api/admin/users/batch' && m === 'POST') return '批量创建用户'
  if (p === '/api/admin/users/batch-status' && m === 'PUT') return '批量修改用户状态'
  if (p === '/api/admin/users/batch-update' && m === 'POST') return '批量更新用户'
  if (p === '/api/admin/users/batch-grade-update' && m === 'POST') return '批量调整年级'
  if (p === '/api/admin/users/export' && m === 'GET') return '导出用户数据'
  if (/^\/api\/admin\/users\/\d+$/.test(p) && m === 'PUT') return '修改用户资料'
  if (/^\/api\/admin\/users\/\d+$/.test(p) && m === 'DELETE') return '删除用户'
  if (/^\/api\/admin\/users\/\d+\/approval$/.test(p) && m === 'POST') return '审核用户注册'
  if (/^\/api\/admin\/users\/\d+\/status$/.test(p) && m === 'PUT') return '修改用户状态'
  if (/^\/api\/admin\/users\/\d+\/reset-password$/.test(p) && m === 'POST') return '重置用户密码'

  if (p === '/api/admin/system-settings' && m === 'POST') return '更新系统设置'
  if (p === '/api/admin/system-settings/clear-aggregate-bindings' && m === 'POST') return '清理聚合账号绑定'
  if (p === '/api/admin/system-settings/env-oauth-import' && m === 'POST') return '导入 OAuth 环境配置'
  if (p === '/api/admin/smtp/reload' && m === 'POST') return '重载邮件服务配置'
  if (p === '/api/admin/smtp/test-connection' && m === 'POST') return '测试 SMTP 连接'
  if (p === '/api/admin/smtp/test-email' && m === 'POST') return '发送 SMTP 测试邮件'

  if (p.startsWith('/api/admin/backup/')) {
    if (p === '/api/admin/backup/export' && m === 'POST') return '导出数据库备份'
    if (p === '/api/admin/backup/restore' && m === 'POST') return '恢复数据库备份'
    if (p === '/api/admin/backup/restore-chunk' && m === 'POST') return '上传恢复备份分片'
    if (p === '/api/admin/backup/upload' && m === 'POST') return '上传备份文件'
    if (p.startsWith('/api/admin/backup/delete/') && m === 'DELETE') return '删除备份文件'
    if (p === '/api/admin/backup/clear' && m === 'POST') return '清理备份文件'
    if (p === '/api/admin/backup/history-clear' && m === 'POST') return '清理备份记录'
    if (p === '/api/admin/backup/auto-config' && m === 'PUT') return '修改自动备份配置'
    if (p.startsWith('/api/admin/backup/test-') && m === 'POST') return '测试备份通道'
    if (p.startsWith('/api/admin/backup/download') && m === 'GET') return '下载备份文件'
  }

  if (p === '/api/admin/database/reset' && m === 'POST') return '重置数据库'
  if (p === '/api/admin/database/cleanup' && m === 'POST') return '清理数据库'
  if ((p === '/api/admin/database/fix-sequence' || p === '/api/admin/fix-sequence') && m === 'POST') {
    return '修复数据库自增序列'
  }

  if (p === '/api/admin/users/export' && m === 'GET') return '导出用户数据'
  if (p === '/api/admin/media' && m === 'POST') return '上传媒体文件'

  if (p === '/api/admin/music-source-plugins' && m === 'POST') return '添加音乐源插件'
  if (/^\/api\/admin\/music-source-plugins\/[^/]+$/.test(p) && ['PUT', 'DELETE'].includes(m)) {
    return m === 'PUT' ? '修改音乐源插件' : '删除音乐源插件'
  }
  if (/^\/api\/admin\/music-source-plugins\/[^/]+\/(enabled|refresh|test)$/.test(p) && ['PATCH', 'POST'].includes(m)) {
    return p.endsWith('/enabled') ? '切换音乐源插件状态' : p.endsWith('/refresh') ? '刷新音乐源插件' : '测试音乐源插件'
  }
  if (p === '/api/admin/music-source-plugins/order' && m === 'PUT') return '调整音乐源插件顺序'

  if (p === '/api/admin/notifications/send' && m === 'POST') return '发送通知'
  if (/^\/api\/admin\/notifications\/history\/[^/]+$/.test(p) && m === 'DELETE') return '删除通知记录'
  if (/^\/api\/admin\/notifications\/history\/[^/]+$/.test(p) && m === 'PUT') return '修改通知记录'

  if (p === '/api/admin/api-keys' && m === 'POST') return '创建 API 密钥'
  if (/^\/api\/admin\/api-keys\/[^/]+$/.test(p) && m === 'PUT') return '修改 API 密钥'
  if (/^\/api\/admin\/api-keys\/[^/]+$/.test(p) && m === 'DELETE') return '删除 API 密钥'

  if (p === '/api/admin/email-templates' && m === 'POST') return '保存邮件模板'
  if (p === '/api/admin/email-templates' && m === 'DELETE') return '删除邮件模板'
  if (p === '/api/admin/email-templates/preview' && m === 'POST') return '预览邮件模板'

  if (p === '/api/admin/grade-class' && m === 'POST') return '添加年级班级'
  if (/^\/api\/admin\/grade-class\/\d+$/.test(p) && m === 'DELETE') return '删除年级班级'
  if (/^\/api\/admin\/grade-class\/by-grade$/.test(p) && m === 'DELETE') return '按年级删除班级'
  if (p === '/api/admin/grade-class/initialize' && m === 'POST') return '初始化年级班级'

  if (p === '/api/admin/permanent-bans' && m === 'POST') return '解除封禁'

  return null
}

export function isAuditedGetPath(method: string, pathname: string): boolean {
  if (method.toUpperCase() !== 'GET') return false
  const p = pathname.replace(/\/+$/, '').toLowerCase()
  return AUDITED_GET_PATHS.has(p) || p.startsWith('/api/admin/backup/download/')
}

export function legacyActionLabel(action: string): string | null {
  if (!action) return null
  if (LEGACY_ACTIONS[action]) return LEGACY_ACTIONS[action]
  const match = action.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\/api\/admin\S*)$/i)
  if (!match) return null
  return actionLabelForPath(match[1], match[2])
}

function targetFromBody(body: any): string | null {
  if (!body || typeof body !== 'object') return null
  for (const key of ['title', 'songTitle', 'name', 'username', 'value', 'target', 'email']) {
    const value = body[key]
    if (typeof value === 'string' && value.trim()) return clip(value, 200)
  }
  return null
}

function reasonText(body: any): string {
  const reason = typeof body?.reason === 'string' ? clip(body.reason, 300) : ''
  return reason ? `原因：${reason}` : ''
}

export async function describeAdminAction(
  method: string,
  pathname: string,
  body: any
): Promise<AdminAuditDescriptor> {
  const m = method.toUpperCase()
  const p = pathname.replace(/\/+$/, '').toLowerCase()
  const label = actionLabelForPath(m, p) || (m === 'DELETE' ? '删除管理数据' : m === 'POST' ? '执行管理操作' : '更新管理数据')
  const detailParts: string[] = [`${m} ${p}`]
  let target: string | null = null

  const idFromBody = positiveIds(body?.songIds ?? body?.songId)
  const replayIds = positiveIds(body?.replayRequestIds ?? body?.replayRequestId ?? body?.requestId ?? body?.id)
  const scheduleIds = positiveIds(
    body?.scheduleIds ?? body?.scheduleId ?? (Array.isArray(body?.schedules) ? body.schedules.map((item: any) => item?.scheduleId ?? item?.id) : [])
  )
  const userIds = positiveIds(body?.userIds ?? body?.userId ?? body?.id)

  if (p.includes('/schedule/')) {
    if (p.endsWith('/draft')) {
      target = await songLabel(idFromBody)
      if (body?.playDate) detailParts.push(`播放日期：${clip(body.playDate, 20)}`)
      if (body?.replayRequestId) detailParts.push(`重播申请 #${Number(body.replayRequestId)}`)
    } else if (p.endsWith('/bulk-draft')) {
      const ids = positiveIds((body?.songs || []).map((item: any) => item?.songId))
      target = await songLabel(ids)
      if (body?.playDate) detailParts.push(`播放日期：${clip(body.playDate, 20)}`)
    } else if (p.endsWith('/bulk-publish')) {
      const count = Array.isArray(body?.songs) ? body.songs.length : 0
      target = count ? `${count} 首歌曲` : null
      if (body?.playDate) detailParts.push(`播放日期：${clip(body.playDate, 20)}`)
    } else if (p.endsWith('/publish') || p.endsWith('/remove')) {
      target = await scheduleLabel(scheduleIds[0] || 0)
      if (p.endsWith('/publish') && body?.songId) target = await songLabel(positiveIds(body.songId))
    } else if (p.endsWith('/remove-all-date')) {
      target = scheduleIds.length ? `${scheduleIds.length} 条排期` : null
    } else if (p.endsWith('/move-date') || p.endsWith('/copy')) {
      if (body?.fromDate || body?.toDate) {
        detailParts.push(`日期：${clip(body?.fromDate, 20) || '-'} → ${clip(body?.toDate, 20) || '-'}`)
      }
    } else if (p.endsWith('/sequence')) {
      const count = Array.isArray(body?.schedules) ? body.schedules.length : 0
      if (count) detailParts.push(`调整 ${count} 条排期`)
    } else if (p.endsWith('/song-pool')) {
      target = await songLabel(positiveIds(body?.songIds ?? body?.songId))
    }
  } else if (p === '/api/admin/songs/reject' || p === '/api/admin/songs/delete') {
    target = await songLabel(idFromBody)
    const reason = reasonText(body)
    if (reason) detailParts.push(reason)
    if (body?.addToBlacklist) detailParts.push('同时加入黑名单')
  } else if (p === '/api/admin/songs/batch-reject') {
    target = await songLabel(idFromBody)
    const reason = reasonText(body)
    if (reason) detailParts.push(reason)
    if (body?.addToBlacklist) detailParts.push('同时加入黑名单')
  } else if (p === '/api/admin/songs/mark-played') {
    target = await songLabel(idFromBody)
    if (body?.unmark === true) detailParts[0] = `${m} ${p}（撤回已播放）`
  } else if (p === '/api/admin/songs/duration') {
    target = await songLabel(idFromBody)
    if (body?.durationSeconds) detailParts.push(`时长：${Number(body.durationSeconds)} 秒`)
  } else if (p === '/api/admin/songs/cover') {
    target = await songLabel(idFromBody)
  } else if (p === '/api/admin/review/users/decide') {
    const kind = String(body?.kind || 'register')
    if (kind === 'purge') {
      detailParts.push('清理到期注销账号')
    } else {
      target = kind === 'name' ? `改名申请 #${Number(body?.id) || 0}` : await userLabel(Number(body?.id) || 0)
      detailParts.push(body?.approve === true ? '结果：通过' : '结果：拒绝')
      const reason = reasonText(body)
      if (reason) detailParts.push(reason)
    }
  } else if (p === '/api/admin/review/notes/decide') {
    target = `${body?.kind === 'replay' ? '重播留言' : '歌曲留言'} #${Number(body?.id) || 0}`
    detailParts.push(body?.approve === true ? '结果：通过' : '结果：驳回')
  } else if (p === '/api/admin/replay-requests/reject') {
    target = `重播申请 #${replayIds[0] || Number(body?.id) || 0}`
    const reason = reasonText(body)
    if (reason) detailParts.push(reason)
  } else if (p.startsWith('/api/admin/users/') && !/^\/api\/admin\/users\/(batch|export|options)/.test(p)) {
    const id = routeId(p) || userIds[0]
    target = await userLabel(id)
    if (p.endsWith('/approval')) {
      detailParts.push(body?.action === 'approve' ? '结果：通过' : '结果：拒绝')
      const reason = reasonText(body)
      if (reason) detailParts.push(reason)
    } else if (p.endsWith('/status')) {
      if (body?.status) detailParts.push(`新状态：${clip(body.status, 20)}`)
      const reason = reasonText(body)
      if (reason) detailParts.push(reason)
    } else if (p.endsWith('/reset-password')) {
      detailParts.push('已设置临时密码并要求下次登录修改')
    } else {
      if (body?.role) detailParts.push(`角色：${clip(body.role, 20)}`)
      if (body?.username) detailParts.push(`用户名：${clip(body.username, 60)}`)
    }
  } else if (p === '/api/admin/users') {
    target = typeof body?.username === 'string' ? clip(body.username, 100) : null
    if (body?.role) detailParts.push(`角色：${clip(body.role, 20)}`)
  } else if (p === '/api/admin/users/batch' || p === '/api/admin/users/batch-update') {
    const count = Array.isArray(body?.users) ? body.users.length : Array.isArray(body?.ids) ? body.ids.length : 0
    if (count) target = `${count} 个用户`
  } else if (p === '/api/admin/users/batch-status') {
    const count = positiveIds(body?.ids ?? body?.userIds).length
    if (count) target = `${count} 个用户`
    if (body?.status) detailParts.push(`新状态：${clip(body.status, 20)}`)
  } else if (p === '/api/admin/users/batch-grade-update') {
    const count = positiveIds(body?.ids ?? body?.userIds).length
    if (count) target = `${count} 个用户`
    if (body?.grade) detailParts.push(`年级：${clip(body.grade, 20)}`)
  } else if (p === '/api/admin/users/export') {
    target = null
  } else if (p.startsWith('/api/admin/announcements')) {
    const text = typeof body?.text === 'string' ? clip(body.text, 100) : ''
    target = text || `公告 #${routeId(p) || 0}`
  } else if (p.startsWith('/api/admin/card-codes/')) {
    if (p.endsWith('/create')) {
      const count = Number(body?.count) || (Array.isArray(body?.codes) ? body.codes.length : 0)
      target = count ? `${count} 张点歌券` : null
      if (body?.prefix) detailParts.push(`前缀：${clip(body.prefix, 20)}`)
      if (body?.note) detailParts.push(`备注：${clip(body.note, 100)}`)
    } else if (p.endsWith('/export')) {
      target = null
    } else {
      target = `点歌券 #${routeId(p) || Number(body?.id) || 0}`
    }
  } else if (p.startsWith('/api/admin/permanent-bans')) {
    target = `${body?.type === 'fp' ? '指纹' : 'IP'} ${clip(body?.value, 128)}`
  } else if (p === '/api/admin/system-settings') {
    const keys = body && typeof body === 'object' ? Object.keys(body).slice(0, 12) : []
    if (keys.length) detailParts.push(`字段：${keys.join('、')}`)
  } else if (p === '/api/admin/database/reset') {
    detailParts.push('高风险操作：清空业务数据')
  } else if (p === '/api/admin/database/cleanup') {
    detailParts.push('清理过期/孤立数据')
  } else if (p === '/api/admin/smtp/test-email') {
    target = typeof body?.to === 'string' ? clip(body.to, 200) : null
  } else if (p.startsWith('/api/admin/backup/delete/')) {
    target = decodeURIComponent(p.slice('/api/admin/backup/delete/'.length)).slice(0, 200)
  } else if (p.startsWith('/api/admin/notifications/')) {
    if (p.endsWith('/send')) {
      target = typeof body?.title === 'string' ? clip(body.title, 100) : null
    } else {
      target = `通知批次 ${p.split('/').pop()}`
    }
  } else if (p.startsWith('/api/admin/music-source-plugins')) {
    target = typeof body?.name === 'string' ? clip(body.name, 100) : `插件 ${p.split('/')[4] || ''}`.trim()
  } else if (p.startsWith('/api/admin/api-keys')) {
    target = typeof body?.name === 'string' ? clip(body.name, 100) : `API 密钥 #${routeId(p) || 0}`
  } else if (p.startsWith('/api/admin/email-templates')) {
    target = typeof body?.name === 'string' ? clip(body.name, 100) : null
  } else if (p.startsWith('/api/admin/grade-class')) {
    target =
      [body?.grade, body?.class].filter((value) => typeof value === 'string' && value.trim()).join(' ') ||
      `年级班级 #${routeId(p) || 0}`
  } else if (p.startsWith('/api/admin/blacklist')) {
    target = typeof body?.value === 'string' ? clip(body.value, 200) : `黑名单 #${routeId(p) || 0}`
  } else if (p.startsWith('/api/admin/semesters')) {
    target = typeof body?.name === 'string' ? clip(body.name, 100) : `学期 #${routeId(p) || 0}`
  } else if (p.startsWith('/api/admin/play-times') || p.startsWith('/api/admin/request-times')) {
    target = typeof body?.name === 'string' ? clip(body.name, 100) : null
    if (body?.startTime || body?.endTime) detailParts.push(`时段：${clip(body?.startTime, 10)}-${clip(body?.endTime, 10)}`)
  } else if (p === '/api/admin/media') {
    target = typeof body?.filename === 'string' ? clip(body.filename, 100) : null
  }

  if (!target) target = targetFromBody(body)
  if (p === '/api/admin/schedule/draft' && body?.songId && !target) target = `歌曲 #${body.songId}`

  return {
    action: label,
    target: target ? clip(target, 200) : null,
    detail: detailParts.filter(Boolean).join(' · ').slice(0, 1000)
  }
}
