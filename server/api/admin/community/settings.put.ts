import { readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communitySettings } from '~/drizzle/schema'
import { getCommunitySettings, requireCommunityAdmin } from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'

const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i
const NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.trunc(parsed), min), max)
}

export default defineEventHandler(async (event) => {
  requireCommunityAdmin(event)
  const body = await readBody(event)
  const current = await getCommunitySettings()

  const patch: Record<string, unknown> = { updatedAt: new Date() }

  if (typeof body?.enabled === 'boolean') patch.enabled = body.enabled
  if (typeof body?.allowImages === 'boolean') patch.allowImages = body.allowImages
  if (typeof body?.moderationEnabled === 'boolean') patch.moderationEnabled = body.moderationEnabled
  if (Object.prototype.hasOwnProperty.call(body || {}, 'maxImages')) {
    patch.maxImages = clampInt(body.maxImages, 1, 9, current.maxImages)
  }
  if (Object.prototype.hasOwnProperty.call(body || {}, 'maxContentLength')) {
    patch.maxContentLength = clampInt(body.maxContentLength, 50, 5000, current.maxContentLength)
  }
  if (Object.prototype.hasOwnProperty.call(body || {}, 'maxCommentLength')) {
    patch.maxCommentLength = clampInt(body.maxCommentLength, 20, 1000, current.maxCommentLength)
  }
  if (Object.prototype.hasOwnProperty.call(body || {}, 'aliyunConnectTimeoutMs')) {
    patch.aliyunConnectTimeoutMs = clampInt(
      body.aliyunConnectTimeoutMs,
      500,
      15000,
      current.aliyunConnectTimeoutMs
    )
  }
  if (Object.prototype.hasOwnProperty.call(body || {}, 'aliyunReadTimeoutMs')) {
    patch.aliyunReadTimeoutMs = clampInt(
      body.aliyunReadTimeoutMs,
      1000,
      30000,
      current.aliyunReadTimeoutMs
    )
  }
  if (typeof body?.moderationHitAction === 'string') {
    const action = body.moderationHitAction.toUpperCase()
    if (!['MANUAL', 'BLOCK'].includes(action)) {
      throw createApiError(400, 'COMMUNITY_SETTINGS_INVALID', '命中策略只能为 MANUAL 或 BLOCK')
    }
    patch.moderationHitAction = action
  }
  if (typeof body?.aliyunEndpoint === 'string' && body.aliyunEndpoint.trim()) {
    const endpoint = body.aliyunEndpoint.trim()
    if (!HOST_RE.test(endpoint) || endpoint.length > 200) {
      throw createApiError(400, 'COMMUNITY_SETTINGS_INVALID', '内容安全 Endpoint 格式不正确')
    }
    patch.aliyunEndpoint = endpoint
  }
  if (typeof body?.aliyunRegionId === 'string' && body.aliyunRegionId.trim()) {
    const region = body.aliyunRegionId.trim()
    if (!NAME_RE.test(region)) {
      throw createApiError(400, 'COMMUNITY_SETTINGS_INVALID', 'RegionId 格式不正确')
    }
    patch.aliyunRegionId = region
  }
  if (typeof body?.aliyunTextService === 'string' && body.aliyunTextService.trim()) {
    const service = body.aliyunTextService.trim()
    if (!NAME_RE.test(service)) {
      throw createApiError(400, 'COMMUNITY_SETTINGS_INVALID', '文本审核 Service 格式不正确')
    }
    patch.aliyunTextService = service
  }
  if (typeof body?.aliyunImageService === 'string' && body.aliyunImageService.trim()) {
    const service = body.aliyunImageService.trim()
    if (!NAME_RE.test(service)) {
      throw createApiError(400, 'COMMUNITY_SETTINGS_INVALID', '图片审核 Service 格式不正确')
    }
    patch.aliyunImageService = service
  }

  // 密钥写入采用「留空保持原值」策略，避免前端回显时覆盖
  if (body?.clearAliyunAccessKeyId === true) {
    patch.aliyunAccessKeyId = null
  } else if (typeof body?.aliyunAccessKeyId === 'string' && body.aliyunAccessKeyId.trim()) {
    patch.aliyunAccessKeyId = body.aliyunAccessKeyId.trim().slice(0, 128)
  }
  if (body?.clearAliyunAccessKeySecret === true) {
    patch.aliyunAccessKeySecret = null
  } else if (typeof body?.aliyunAccessKeySecret === 'string' && body.aliyunAccessKeySecret.trim()) {
    patch.aliyunAccessKeySecret = body.aliyunAccessKeySecret.trim().slice(0, 256)
  }

  const [updated] = await db
    .update(communitySettings)
    .set(patch)
    .where(eq(communitySettings.id, 1))
    .returning()

  return {
    success: true,
    settings: {
      enabled: updated?.enabled,
      allowImages: updated?.allowImages,
      maxImages: updated?.maxImages,
      maxContentLength: updated?.maxContentLength,
      maxCommentLength: updated?.maxCommentLength,
      moderationEnabled: updated?.moderationEnabled,
      moderationHitAction: updated?.moderationHitAction,
      aliyunEndpoint: updated?.aliyunEndpoint,
      aliyunRegionId: updated?.aliyunRegionId,
      aliyunTextService: updated?.aliyunTextService,
      aliyunImageService: updated?.aliyunImageService,
      aliyunConnectTimeoutMs: updated?.aliyunConnectTimeoutMs,
      aliyunReadTimeoutMs: updated?.aliyunReadTimeoutMs,
      hasAccessKeyId: !!updated?.aliyunAccessKeyId,
      hasAccessKeySecret: !!updated?.aliyunAccessKeySecret
    }
  }
})
