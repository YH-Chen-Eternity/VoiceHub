/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

import { createApiError } from './apiError'

export interface RewriterBansSnapshot {
  permanent: { ip: string; at: number; count: number; detail: string }[]
  locks: { ip: string; until: number }[]
  fps: { fp: string; until: number; ip: string }[]
}

const rewriterBase = () =>
  String(process.env.REWRITER_INTERNAL_URL || 'http://rewriter:3001').replace(/\/+$/, '')

async function callRewriter<T>(
  path: string,
  options: { method?: 'GET' | 'POST'; body?: Record<string, unknown> } = {}
): Promise<T> {
  const token = String(process.env.ATTACK_LOG_TOKEN || '')
  if (!token) {
    throw createApiError(503, 'REWRITER_TOKEN_MISSING', '边缘安全层未配置访问令牌')
  }
  try {
    return await $fetch<T>(`${rewriterBase()}${path}`, {
      method: options.method || 'GET',
      body: options.body,
      headers: { 'x-attack-token': token },
      timeout: 5000
    })
  } catch (error) {
    console.error('[permanent-bans] 调用边缘安全层失败:', path, error)
    throw createApiError(502, 'REWRITER_UNAVAILABLE', '边缘安全层暂不可用，请稍后重试')
  }
}

export async function fetchRewriterBans(): Promise<RewriterBansSnapshot> {
  const result = await callRewriter<Partial<RewriterBansSnapshot>>('/__internal/bans')
  return {
    permanent: Array.isArray(result?.permanent) ? result.permanent : [],
    locks: Array.isArray(result?.locks) ? result.locks : [],
    fps: Array.isArray(result?.fps) ? result.fps : []
  }
}

export async function unbanRewriterTarget(type: 'ip' | 'fp', value: string) {
  const result = await callRewriter<{ removed?: number }>('/__internal/unban', {
    method: 'POST',
    body: { type, value }
  })
  return Number(result?.removed || 0)
}

export async function fetchGeoLock(): Promise<{ enabled: boolean }> {
  const result = await callRewriter<{ enabled?: boolean }>('/__internal/geo-lock')
  return { enabled: !!result?.enabled }
}

export async function setGeoLock(enabled: boolean) {
  const result = await callRewriter<{ enabled?: boolean }>('/__internal/geo-lock', {
    method: 'POST',
    body: { enabled }
  })
  return !!result?.enabled
}

export interface BotScoreRow {
  key: string
  score: number
  reasons: string[]
  ip: string
  ua: string
  first: number
  last: number
  reports: number
  human: number
  signed: number
  unsigned: number
}

export async function fetchBotScores(): Promise<BotScoreRow[]> {
  const result = await callRewriter<{ scores?: BotScoreRow[] }>('/__internal/bot-scores')
  return Array.isArray(result?.scores) ? result.scores : []
}

export async function banRewriterIp(ip: string, detail: string) {
  const result = await callRewriter<{ success?: boolean }>('/__internal/ban', {
    method: 'POST',
    body: { ip, detail }
  })
  return !!result?.success
}

export async function fetchTrustedIps(): Promise<string[]> {
  const result = await callRewriter<{ ips?: string[] }>('/__internal/trusted-ips')
  return Array.isArray(result?.ips) ? result.ips : []
}

export async function updateTrustedIps(action: 'add' | 'remove', ip: string): Promise<{ ips: string[]; removed?: number }> {
  const result = await callRewriter<{ ips?: string[]; removed?: number }>('/__internal/trusted-ips', {
    method: 'POST',
    body: { action, ip }
  })
  return { ips: Array.isArray(result?.ips) ? result.ips : [], removed: result?.removed }
}
