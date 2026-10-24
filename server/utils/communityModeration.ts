/**
 * 阿里云内容安全（Green 2022-03-02）文本审核。
 * 未配置密钥 / 关闭审核时只走人工审核；接口异常时同样回落到人工审核，绝不自动放行。
 */
import { createHash, createHmac, randomUUID } from 'node:crypto'
import type { CommunitySettingsRow } from './community'

const GREEN_VERSION = '2022-03-02'
const PASS_LABELS = new Set(['nonLabel', 'pass', 'normal'])

export type CommunityModerationResult = {
  provider: 'aliyun' | 'none'
  hit: boolean
  labels: string[]
  detail: string | null
  error: string | null
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

function hmac256Hex(secret: string, input: string): string {
  return createHmac('sha256', secret).update(input, 'utf8').digest('hex')
}

function canonicalQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key] ?? '')}`)
    .join('&')
}

/** ACS3-HMAC-SHA256 签名（阿里云 OpenAPI V3） */
async function callAliyunGreen(
  settings: CommunitySettingsRow,
  action: 'TextModeration' | 'ImageModeration',
  service: string,
  serviceParameters: Record<string, unknown>
): Promise<any> {
  const accessKeyId = settings.aliyunAccessKeyId!.trim()
  const accessKeySecret = settings.aliyunAccessKeySecret!.trim()
  const host = settings.aliyunEndpoint.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const body = JSON.stringify({
    Service: service,
    ServiceParameters: JSON.stringify(serviceParameters)
  })
  const hashedPayload = sha256Hex(body)
  const xAcsDate = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const nonce = randomUUID()

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    host,
    'x-acs-action': action,
    'x-acs-content-sha256': hashedPayload,
    'x-acs-date': xAcsDate,
    'x-acs-signature-nonce': nonce,
    'x-acs-version': GREEN_VERSION
  }
  const signedHeaders = Object.keys(headers).sort().join(';')
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((key) => `${key}:${String(headers[key]).trim()}`)
    .join('\n')
  const canonicalRequest = [
    'POST',
    '/',
    canonicalQuery({}),
    canonicalHeaders,
    signedHeaders,
    hashedPayload
  ].join('\n')
  const stringToSign = ['ACS3-HMAC-SHA256', xAcsDate, sha256Hex(canonicalRequest)].join('\n')
  const signature = hmac256Hex(accessKeySecret, stringToSign)

  const timeoutMs = Math.min(
    Math.max(Number(settings.aliyunReadTimeoutMs) || 6000, 1000),
    15000
  )
  const response = await fetch(`https://${host}/`, {
    method: 'POST',
    headers: {
      ...headers,
      authorization: `ACS3-HMAC-SHA256 Credential=${accessKeyId},SignedHeaders=${signedHeaders},Signature=${signature}`
    },
    body,
    signal: AbortSignal.timeout(timeoutMs)
  })

  const text = await response.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`内容安全接口返回异常（HTTP ${response.status}）`)
  }
  if (!response.ok || String(json.Code) !== '200') {
    throw new Error(json?.Message || `内容安全接口调用失败（HTTP ${response.status}）`)
  }
  return json
}

function extractLabels(payload: any): string[] {
  const results = payload?.Data?.Result
  if (!Array.isArray(results)) return []
  const labels = results
    .map((item: any) => String(item?.Label || '').trim())
    .filter((label: string) => label && !PASS_LABELS.has(label.toLowerCase()))
  return Array.from(new Set(labels))
}

export async function moderateCommunityText(
  text: string,
  settings: CommunitySettingsRow
): Promise<CommunityModerationResult> {
  if (!settings.moderationEnabled) {
    return { provider: 'none', hit: false, labels: [], detail: null, error: null }
  }
  if (!settings.aliyunAccessKeyId || !settings.aliyunAccessKeySecret) {
    return { provider: 'none', hit: false, labels: [], detail: null, error: null }
  }

  try {
    const payload = await callAliyunGreen(settings, 'TextModeration', settings.aliyunTextService, {
      content: text.slice(0, 10000)
    })
    const labels = extractLabels(payload)
    return {
      provider: 'aliyun',
      hit: labels.length > 0,
      labels,
      detail: labels.length > 0 ? labels.join(', ') : null,
      error: null
    }
  } catch (error: any) {
    console.error('[community-moderation] 阿里云文本审核失败，转人工:', error?.message || error)
    return {
      provider: 'aliyun',
      hit: false,
      labels: [],
      detail: null,
      error: String(error?.message || error || '审核服务不可用')
    }
  }
}

/** 图片审核：仅在配置了可公网访问的图片地址时调用；失败不阻断，帖子仍需人工审核 */
export async function moderateCommunityImage(
  imageUrl: string,
  settings: CommunitySettingsRow
): Promise<CommunityModerationResult> {
  if (!settings.moderationEnabled) {
    return { provider: 'none', hit: false, labels: [], detail: null, error: null }
  }
  if (!settings.aliyunAccessKeyId || !settings.aliyunAccessKeySecret) {
    return { provider: 'none', hit: false, labels: [], detail: null, error: null }
  }
  if (!/^https:\/\//i.test(imageUrl)) {
    return { provider: 'none', hit: false, labels: [], detail: null, error: null }
  }

  try {
    const payload = await callAliyunGreen(settings, 'ImageModeration', settings.aliyunImageService, {
      imageUrl
    })
    const labels = extractLabels(payload)
    return {
      provider: 'aliyun',
      hit: labels.length > 0,
      labels,
      detail: labels.length > 0 ? labels.join(', ') : null,
      error: null
    }
  } catch (error: any) {
    console.error('[community-moderation] 阿里云图片审核失败，转人工:', error?.message || error)
    return {
      provider: 'aliyun',
      hit: false,
      labels: [],
      detail: null,
      error: String(error?.message || error || '审核服务不可用')
    }
  }
}
