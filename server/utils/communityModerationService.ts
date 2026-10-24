/**
 * 独立审核服务（moderation-service）客户端。
 *
 * 配置 COMMUNITY_MODERATION_SERVICE_URL 后优先走独立服务：
 * - PASS            -> APPROVED（直接放行）
 * - MANUAL_REVIEW   -> PENDING（转人工）
 * - API_UNAVAILABLE -> PENDING（API 不可用，绝不自动放行）
 *
 * 未配置时由调用方回落到原有直连阿里云审核。
 * 调用失败、超时、返回异常一律按 API_UNAVAILABLE 处理，帖子保持 PENDING。
 */
import type { CommunitySettingsRow } from './community'

const DEFAULT_TIMEOUT_MS = 25000
const PASS_LABELS = new Set(['nonlabel', 'non_label', 'pass', 'normal'])
export type ModerationServiceStatus = 'PASS' | 'MANUAL_REVIEW' | 'API_UNAVAILABLE'

export type ModerationServiceResult = {
  configured: boolean
  status: ModerationServiceStatus
  postStatus: 'APPROVED' | 'PENDING' | 'BLOCKED'
  labels: string[]
  label: string | null
  detail: string | null
  reason: string
  failedImages: number
}

export type ModerationServiceInput = {
  postId: string
  text: string
  imageUrls: string[]
  settings: CommunitySettingsRow
}

function serviceUrl(): string {
  return String(process.env.COMMUNITY_MODERATION_SERVICE_URL || '')
    .trim()
    .replace(/\/+$/, '')
}

function serviceTimeoutMs(): number {
  const configured = Number(process.env.COMMUNITY_MODERATION_SERVICE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  if (!Number.isFinite(configured)) return DEFAULT_TIMEOUT_MS
  return Math.min(Math.max(Math.trunc(configured), 1000), 60000)
}

export function isCommunityModerationServiceConfigured(): boolean {
  return /^https?:\/\//i.test(serviceUrl())
}

function extractLabels(payload: any): string[] {
  const labels = new Set<string>()
  const results = Array.isArray(payload?.per_image_results) ? payload.per_image_results : []
  for (const item of results) {
    const items = Array.isArray(item?.labels) ? item.labels : []
    for (const raw of items) {
      const label = String(raw || '').trim()
      if (label && !PASS_LABELS.has(label.toLowerCase())) labels.add(label)
    }
  }
  return Array.from(labels)
}

function parseStatus(payload: any): ModerationServiceStatus {
  const status = String(payload?.overall_status || '').trim().toUpperCase()
  if (status === 'PASS' || status === 'MANUAL_REVIEW' || status === 'API_UNAVAILABLE') {
    return status
  }
  throw new Error(`审核服务返回未知状态：${status || '空'}`)
}

/**
 * PASS 直接通过；MANUAL_REVIEW 默认转人工。
 * 若后台命中策略为 BLOCK 且存在明确风险标签，则直接拦截；
 * 仅因图片失败/服务不可用导致的 MANUAL_REVIEW 不拦截。
 */
function resolvePostStatus(
  status: ModerationServiceStatus,
  settings: CommunitySettingsRow,
  labels: string[]
): 'APPROVED' | 'PENDING' | 'BLOCKED' {
  if (status === 'PASS') return 'APPROVED'
  if (
    status === 'MANUAL_REVIEW' &&
    settings.moderationHitAction === 'BLOCK' &&
    labels.length > 0
  ) {
    return 'BLOCKED'
  }
  return 'PENDING'
}

function resolveLabel(
  status: ModerationServiceStatus,
  labels: string[],
  failedImages: number
): string | null {
  if (labels.length > 0) return labels.join(',')
  if (status === 'API_UNAVAILABLE') return '审核服务不可用'
  if (failedImages > 0) return `图片审核失败(${failedImages})`
  if (status === 'MANUAL_REVIEW') return '需人工复核'
  return null
}

function resolveDetail(
  status: ModerationServiceStatus,
  reason: string,
  labels: string[],
  failedImages: number
): string | null {
  const parts: string[] = []
  if (reason) parts.push(reason)
  if (failedImages > 0) parts.push(`失败图片 ${failedImages} 张`)
  if (labels.length > 0) parts.push(`标签：${labels.join(', ')}`)
  if (!parts.length && status === 'API_UNAVAILABLE') parts.push('审核服务不可用，已转人工')
  return parts.length ? parts.join('；') : null
}

function unavailableResult(detail: string): ModerationServiceResult {
  return {
    configured: true,
    status: 'API_UNAVAILABLE',
    postStatus: 'PENDING',
    labels: [],
    label: '审核服务不可用',
    detail,
    reason: '审核服务不可用，转人工',
    failedImages: 0
  }
}

export async function moderateCommunityPostWithService(
  input: ModerationServiceInput
): Promise<ModerationServiceResult> {
  const baseUrl = serviceUrl()
  if (!baseUrl) {
    return unavailableResult('未配置 COMMUNITY_MODERATION_SERVICE_URL')
  }

  const timeoutMs = serviceTimeoutMs()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    const serviceToken = String(process.env.COMMUNITY_MODERATION_SERVICE_TOKEN || '').trim()
    if (serviceToken) headers['x-moderation-token'] = serviceToken

    const response = await fetch(`${baseUrl}/audit`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        post_id: String(input.postId),
        text: input.text.slice(0, 2000),
        image_urls: input.imageUrls.slice(0, 9)
      }),
      signal: controller.signal
    })

    const raw = await response.text()
    let payload: any = null
    try {
      payload = JSON.parse(raw)
    } catch {
      throw new Error(`审核服务返回非 JSON（HTTP ${response.status}）`)
    }
    if (!response.ok) {
      throw new Error(
        String(payload?.detail || payload?.message || `审核服务 HTTP ${response.status}`)
      )
    }

    const status = parseStatus(payload)
    const labels = extractLabels(payload)
    const failedImages = Array.isArray(payload?.failed_images) ? payload.failed_images.length : 0
    const reason = String(payload?.reason || '').trim()

    return {
      configured: true,
      status,
      postStatus: resolvePostStatus(status, input.settings, labels),
      labels,
      label: resolveLabel(status, labels, failedImages),
      detail: resolveDetail(status, reason, labels, failedImages),
      reason: reason || status,
      failedImages
    }
  } catch (error: any) {
    const message =
      error?.name === 'AbortError'
        ? `审核服务超时（${timeoutMs}ms）`
        : String(error?.message || error || '审核服务调用失败')
    // 只记录错误摘要，不记录图片 URL / 凭证
    console.error('[community-moderation-service] 调用失败，转人工:', message)
    return unavailableResult(message)
  } finally {
    clearTimeout(timer)
  }
}
