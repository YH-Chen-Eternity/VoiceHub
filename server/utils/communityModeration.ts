/**
 * 阿里云内容安全（Green 2022-03-02）文本审核。
 * 未配置密钥 / 关闭审核时只走人工审核；接口异常时同样回落到人工审核，绝不自动放行。
 */
import { createHash, createHmac, randomUUID } from 'node:crypto'
import type { CommunitySettingsRow } from './community'

const GREEN_VERSION = '2022-03-02'
const PASS_LABELS = new Set(['nonLabel', 'pass', 'normal'])

export type CommunityModerationResult = {
  provider: 'aliyun' | 'local' | 'none'
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
  const canonicalHeaders =
    Object.keys(headers)
      .sort()
      .map((key) => `${key}:${String(headers[key]).trim()}`)
      .join('\n') + '\n'
  const canonicalRequest = [
    'POST',
    '/',
    canonicalQuery({}),
    canonicalHeaders,
    signedHeaders,
    hashedPayload
  ].join('\n')
  // 阿里云 V3 的 StringToSign 只有两行：算法 + CanonicalRequest 的 SHA256。
  const stringToSign = ['ACS3-HMAC-SHA256', sha256Hex(canonicalRequest)].join('\n')
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

const ALIYUN_LABEL_MAP: Record<string, string> = {
  profanity: '人身攻击',
  abuse: '人身攻击',
  insult: '人身攻击',
  ad: '联系方式引流',
  spam: '联系方式引流',
  advertising: '联系方式引流'
}

function normalizeLabel(raw: string): string {
  const label = String(raw || '').trim()
  return ALIYUN_LABEL_MAP[label.toLowerCase()] || label
}

function extractLabels(payload: any): string[] {
  const data = payload?.Data
  const labels = new Set<string>()

  const rawLabels = data?.labels ?? data?.Labels
  if (typeof rawLabels === 'string') {
    rawLabels
      .split(/[,;，；]/)
      .map((label) => normalizeLabel(label))
      .filter((label) => label && !PASS_LABELS.has(label.toLowerCase()))
      .forEach((label) => labels.add(label))
  } else if (Array.isArray(rawLabels)) {
    rawLabels
      .map((label) => normalizeLabel(String(label)))
      .filter((label) => label && !PASS_LABELS.has(label.toLowerCase()))
      .forEach((label) => labels.add(label))
  }

  const results = data?.Result
  if (Array.isArray(results)) {
    results
      .map((item: any) => normalizeLabel(String(item?.Label || '')))
      .filter((label: string) => label && !PASS_LABELS.has(label.toLowerCase()))
      .forEach((label) => labels.add(label))
  }
  return Array.from(labels)
}

/**
 * 解析阿里云返回的风险等级（审核智能体/增强版文本审核会返回 riskLevel）。
 * 缺省返回 null，调用方据此回退到「有标签即转人工」的保守策略。
 */
function extractRiskLevel(payload: any): string | null {
  const data = payload?.Data || {}
  const raw = data.riskLevel ?? data.RiskLevel
  if (raw === undefined || raw === null) return null
  const level = String(raw).trim().toLowerCase()
  return level || null
}

/** 低风险及以下直接放行（中风险及以上转人工），符合站长设定的处置口径 */
function isLowRiskLevel(level: string | null): boolean {
  return level === 'none' || level === 'low'
}

function extractUrls(text: string): string[] {
  return text.match(/(?:https?:\/\/|www\.)[^\s<>"'，。；、]+/gi) || []
}

function extractModerationDetail(payload: any, labels: string[]): string | null {
  const data = payload?.Data || {}
  const descriptions = String(data.descriptions || '').trim()
  let riskTips = ''
  try {
    const reason = JSON.parse(String(data.reason || ''))
    riskTips = String(reason?.riskTips || '').trim()
  } catch {
    riskTips = ''
  }
  const parts = [labels.join(', '), descriptions, riskTips].filter(Boolean)
  return parts.length ? parts.join('；') : null
}

/**
 * 本地确定性审核：联系方式、引流链接、隐私信息。
 * 语义类违规（恶意丑化/学生欺凌/人身攻击/引战）交给阿里云或人工审核。
 */
export function prefilterCommunityText(text: string): CommunityModerationResult | null {
  const content = String(text || '').trim()
  if (!content) return null

  const labels: string[] = []
  const reasons: string[] = []
  const add = (label: string, reason: string) => {
    if (!labels.includes(label)) labels.push(label)
    if (!reasons.includes(reason)) reasons.push(reason)
  }

  // 隐私信息优先识别，避免身份证中的数字段被当成手机号。
  if (/(?<!\d)\d{17}[\dXx](?!\d)/.test(content)) add('隐私泄露', '身份证号')
  else if (/(?<!\d)\d{16,19}(?!\d)/.test(content)) add('隐私泄露', '银行卡号')
  if (/(?:学号|学生证号)\s*[:：]?\s*\d{4,}/.test(content)) add('隐私泄露', '学号/学生证号')
  if (/(?:家庭住址|家庭地址|住址)\s*[:：]?\s*\S{2,}/.test(content)) add('隐私泄露', '家庭住址')

  if (/(?<!\d)1[3-9]\d{9}(?!\d)/.test(content)) add('联系方式引流', '手机号')
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(content)) add('联系方式引流', '邮箱')
  if (/(?:微信|weixin|wechat|vx|v信)\s*(?:号)?\s*[:：]?\s*[A-Za-z0-9_-]{5,20}/i.test(content)) {
    add('联系方式引流', '微信号')
  }
  if (/(?:QQ|企鹅号|扣扣)\s*(?:号|群)?\s*[:：]?\s*[0-9]{5,12}/i.test(content)) {
    add('联系方式引流', 'QQ号')
  }
  if (/加我\s*(?:微信|QQ|vx|v信)/i.test(content)) add('联系方式引流', '引导添加联系方式')

  // 所有站外链接一律拦截（含音乐平台链接）：社区内分享歌曲请使用「选歌」功能
  if (extractUrls(content).length > 0) add('联系方式引流', '站外链接')

  if (!labels.length) return null
  return {
    provider: 'local',
    hit: true,
    labels,
    detail: reasons.join('、'),
    error: null
  }
}

export async function moderateCommunityText(
  text: string,
  settings: CommunitySettingsRow
): Promise<CommunityModerationResult> {
  if (!settings.moderationEnabled) {
    return { provider: 'none', hit: false, labels: [], detail: null, error: null }
  }
  const local = prefilterCommunityText(text)
  if (local?.hit) return local
  if (!settings.aliyunAccessKeyId || !settings.aliyunAccessKeySecret) {
    return { provider: 'none', hit: false, labels: [], detail: null, error: null }
  }

  try {
    const payload = await callAliyunGreen(settings, 'TextModeration', settings.aliyunTextService, {
      content: text.slice(0, 10000)
    })
    const labels = extractLabels(payload)
    const riskLevel = extractRiskLevel(payload)
    // 站长口径：中风险及以上转人工；低风险及以下直接放行。
    // 接口未返回风险等级时保持旧行为（有标签即转人工），宁可多审不可漏审。
    const hit = isLowRiskLevel(riskLevel) ? false : labels.length > 0
    return {
      provider: 'aliyun',
      hit,
      labels,
      detail: hit && labels.length > 0 ? extractModerationDetail(payload, labels) : null,
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
    const riskLevel = extractRiskLevel(payload)
    const hit = isLowRiskLevel(riskLevel) ? false : labels.length > 0
    return {
      provider: 'aliyun',
      hit,
      labels,
      detail: hit && labels.length > 0 ? extractModerationDetail(payload, labels) : null,
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
