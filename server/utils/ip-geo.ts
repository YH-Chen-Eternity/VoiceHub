/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

import { isIP } from 'node:net'
import { buildRedisKey, getRedisClient } from './redis'

export interface IpLocation {
  country: string
  region: string
  city: string
  isChina: boolean
  label: string
}

const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60
const FAILURE_CACHE_TTL_SECONDS = 10 * 60
const BATCH_SIZE = 100
const memoryCache = new Map<string, { value: IpLocation | null; expiresAt: number }>()

export function normalizeIp(value: string): string {
  return String(value || '')
    .trim()
    .replace(/^\[|\]$/g, '')
    .replace(/^::ffff:/i, '')
}

export function isPrivateIp(ip: string): boolean {
  const normalized = normalizeIp(ip)
  if (!normalized) return true
  if (normalized === '::1' || normalized.toLowerCase() === 'localhost') return true
  if (/^127\./.test(normalized) || /^10\./.test(normalized) || /^192\.168\./.test(normalized)) return true
  if (/^169\.254\./.test(normalized)) return true
  const match172 = normalized.match(/^172\.(\d+)\./)
  if (match172 && Number(match172[1]) >= 16 && Number(match172[1]) <= 31) return true
  if (/^(fc|fd|fe8|fe9|fea|feb)/i.test(normalized)) return true
  return false
}

function buildLabel(country: string, region: string, city: string, isChina: boolean): string {
  if (isChina) return [region, city].filter(Boolean).join(' ') || country || '中国'
  return [country, region, city].filter(Boolean).join(' ') || '未知'
}

function privateLocation(): IpLocation {
  return { country: '', region: '', city: '', isChina: false, label: '内网地址' }
}

async function readCached(ip: string): Promise<{ hit: boolean; value: IpLocation | null }> {
  const memory = memoryCache.get(ip)
  if (memory && memory.expiresAt > Date.now()) {
    return { hit: true, value: memory.value }
  }
  try {
    const redis = await getRedisClient()
    if (!redis) return { hit: false, value: null }
    const raw = await redis.get(buildRedisKey('geoip', ip))
    if (raw == null) return { hit: false, value: null }
    const value = raw === 'null' ? null : (JSON.parse(raw) as IpLocation)
    memoryCache.set(ip, { value, expiresAt: Date.now() + 6 * 60 * 60 * 1000 })
    return { hit: true, value }
  } catch {
    return { hit: false, value: null }
  }
}

async function writeCached(ip: string, value: IpLocation | null) {
  const ttl = value ? CACHE_TTL_SECONDS : FAILURE_CACHE_TTL_SECONDS
  memoryCache.set(ip, { value, expiresAt: Date.now() + Math.min(ttl, 6 * 60 * 60) * 1000 })
  try {
    const redis = await getRedisClient()
    if (!redis) return
    await redis.set(buildRedisKey('geoip', ip), JSON.stringify(value), { EX: ttl })
  } catch {
    // 缓存失败不影响审计查询
  }
}

async function fetchBatch(ips: string[]): Promise<Map<string, IpLocation | null>> {
  const result = new Map<string, IpLocation | null>()
  for (let start = 0; start < ips.length; start += BATCH_SIZE) {
    const chunk = ips.slice(start, start + BATCH_SIZE)
    try {
      const response = await $fetch<any[]>(
        'http://ip-api.com/batch?fields=status,message,country,countryCode,regionName,city,query&lang=zh-CN',
        { method: 'POST', body: chunk, timeout: 5000 }
      )
      chunk.forEach((ip, index) => {
        const item = Array.isArray(response) ? response[index] : null
        if (!item || item.status !== 'success') {
          result.set(ip, null)
          return
        }
        const country = String(item.country || '')
        const region = String(item.regionName || '')
        const city = String(item.city || '')
        const isChina = String(item.countryCode || '').toUpperCase() === 'CN'
        result.set(ip, { country, region, city, isChina, label: buildLabel(country, region, city, isChina) })
      })
    } catch (error: any) {
      console.warn('[geoip] 批量归属地查询失败:', error instanceof Error ? error.message : error)
      chunk.forEach((ip) => result.set(ip, null))
    }
  }
  return result
}

export async function resolveIpLocations(input: string[]): Promise<Map<string, IpLocation | null>> {
  const result = new Map<string, IpLocation | null>()
  const pending: string[] = []
  const unique: string[] = []
  const seen = new Set<string>()

  for (const raw of input) {
    const ip = normalizeIp(raw)
    if (!ip || seen.has(ip)) continue
    seen.add(ip)
    if (isPrivateIp(ip)) {
      result.set(ip, privateLocation())
      continue
    }
    if (!isIP(ip)) {
      result.set(ip, null)
      continue
    }
    unique.push(ip)
  }

  const cachedList = await Promise.all(
    unique.map(async (ip) => ({ ip, ...(await readCached(ip)) }))
  )
  for (const item of cachedList) {
    if (item.hit) {
      result.set(item.ip, item.value)
    } else {
      result.set(item.ip, null)
      pending.push(item.ip)
    }
  }

  if (pending.length) {
    const fetched = await fetchBatch(pending)
    await Promise.all(
      pending.map(async (ip) => {
        const value = fetched.get(ip) ?? null
        result.set(ip, value)
        await writeCached(ip, value)
      })
    )
  }

  return result
}
