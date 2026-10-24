import { getCommunitySettings, requireCommunityAdmin } from '~~/server/utils/community'
import { isCommunityModerationServiceConfigured } from '~~/server/utils/communityModerationService'

function maskKey(value: string | null): string | null {
  if (!value) return null
  if (value.length <= 8) return `${value.slice(0, 2)}****`
  return `${value.slice(0, 4)}****${value.slice(-2)}`
}

export default defineEventHandler(async (event) => {
  requireCommunityAdmin(event)
  const settings = await getCommunitySettings()

  return {
    success: true,
    settings: {
      enabled: settings.enabled,
      allowImages: settings.allowImages,
      maxImages: settings.maxImages,
      maxContentLength: settings.maxContentLength,
      maxCommentLength: settings.maxCommentLength,
      moderationEnabled: settings.moderationEnabled,
      moderationHitAction: settings.moderationHitAction,
      aliyunEndpoint: settings.aliyunEndpoint,
      aliyunRegionId: settings.aliyunRegionId,
      aliyunTextService: settings.aliyunTextService,
      aliyunImageService: settings.aliyunImageService,
      aliyunConnectTimeoutMs: settings.aliyunConnectTimeoutMs,
      aliyunReadTimeoutMs: settings.aliyunReadTimeoutMs,
      hasAccessKeyId: !!settings.aliyunAccessKeyId,
      hasAccessKeySecret: !!settings.aliyunAccessKeySecret,
      accessKeyIdMasked: maskKey(settings.aliyunAccessKeyId),
      moderationServiceConfigured: isCommunityModerationServiceConfigured(),
      updatedAt: settings.updatedAt
    }
  }
})
