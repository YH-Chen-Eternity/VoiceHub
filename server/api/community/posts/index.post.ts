import { randomUUID } from 'node:crypto'
import { readBody } from 'h3'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityPostImages, communityPosts, mediaAssets, songs } from '~/drizzle/schema'
import {
  assertCommunityNotMuted,
  getBoardOrThrow,
  requireCommunityUser,
  requireCommunityEnabled
} from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'
import { moderateCommunityImage, moderateCommunityText } from '~~/server/utils/communityModeration'
import {
  isCommunityModerationServiceConfigured,
  moderateCommunityPostWithService
} from '~~/server/utils/communityModerationService'

function cleanText(input: unknown): string {
  return String(input ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
}

export default defineEventHandler(async (event) => {
  const user = requireCommunityUser(event)
  const settings = await requireCommunityEnabled()
  await assertCommunityNotMuted(user.id)

  if (user.status && user.status !== 'active') {
    throw createApiError(403, 'COMMUNITY_ACCOUNT_UNAVAILABLE', '账号状态异常，无法发帖')
  }

  const body = await readBody(event)
  const boardId = Number(body?.boardId)
  if (!Number.isInteger(boardId) || boardId <= 0) {
    throw createApiError(400, 'COMMUNITY_BOARD_REQUIRED', '请选择板块')
  }
  const board = await getBoardOrThrow(boardId)
  if (!board.isActive) {
    throw createApiError(400, 'COMMUNITY_BOARD_CLOSED', '该板块已关闭')
  }

  const content = cleanText(body?.content)
  if (!content) {
    throw createApiError(400, 'COMMUNITY_CONTENT_REQUIRED', '写点什么再发布吧')
  }
  if (content.length > settings.maxContentLength) {
    throw createApiError(400, 'COMMUNITY_CONTENT_TOO_LONG', `内容不能超过 ${settings.maxContentLength} 字`, {
      params: [settings.maxContentLength]
    })
  }

  let songId: number | null = null
  if (body?.songId != null && body.songId !== '') {
    const parsed = Number(body.songId)
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw createApiError(400, 'COMMUNITY_SONG_INVALID', '歌曲参数不正确')
    }
    const song = await db
      .select({ id: songs.id })
      .from(songs)
      .where(eq(songs.id, parsed))
      .limit(1)
    if (!song[0]) throw createApiError(404, 'SONG_NOT_FOUND', '歌曲不存在')
    songId = parsed
  }

  const rawImageIds = Array.isArray(body?.imageIds) ? body.imageIds : []
  const imageIds = Array.from(
    new Set(
      rawImageIds
        .map((id: unknown) => Number(id))
        .filter((id: number) => Number.isInteger(id) && id > 0)
    )
  ) as number[]

  if (imageIds.length > 0 && !settings.allowImages) {
    throw createApiError(400, 'COMMUNITY_IMAGES_DISABLED', '当前不允许发布图片')
  }
  if (imageIds.length > settings.maxImages) {
    throw createApiError(400, 'COMMUNITY_TOO_MANY_IMAGES', `最多只能上传 ${settings.maxImages} 张图片`, {
      params: [settings.maxImages]
    })
  }
  if (imageIds.length > 0) {
    const owned = await db
      .select({ id: mediaAssets.id, mimeType: mediaAssets.mimeType })
      .from(mediaAssets)
      .where(and(inArray(mediaAssets.id, imageIds), eq(mediaAssets.uploadedBy, user.id)))
    if (owned.length !== imageIds.length) {
      throw createApiError(400, 'COMMUNITY_IMAGE_INVALID', '图片无效，请重新上传')
    }
    if (owned.some((item) => !String(item.mimeType).startsWith('image/'))) {
      throw createApiError(400, 'COMMUNITY_IMAGE_INVALID', '图片格式不正确')
    }
  }

  let status = 'PENDING'
  let moderationLabel: string | null = null
  let moderationDetail: string | null = null

  if (settings.moderationEnabled && isCommunityModerationServiceConfigured()) {
    // 独立审核服务：并发处理九宫格，PASS 直接通过，其余转人工
    const publicOrigin = String(process.env.COMMUNITY_PUBLIC_ORIGIN || '').replace(/\/$/, '')
    const imageUrls =
      publicOrigin && settings.allowImages && imageIds.length > 0
        ? imageIds.map((imageId) => `${publicOrigin}/api/media/${imageId}`)
        : []
    const result = await moderateCommunityPostWithService({
      // 帖子尚未入库，使用带用户与随机后缀的临时业务 ID，仅用于审核链路追踪
      postId: `community-${user.id}-${Date.now()}-${randomUUID().slice(0, 8)}`,
      text: content,
      imageUrls,
      settings
    })
    status = result.postStatus
    moderationLabel = result.label
    moderationDetail = result.detail
  } else {
    // 未配置独立服务：保持原有直连阿里云审核逻辑
    const moderation = await moderateCommunityText(content, settings)
    if (moderation.hit) {
      moderationLabel = moderation.labels.join(',') || 'RISK'
      moderationDetail = moderation.detail
      if (settings.moderationHitAction === 'BLOCK') status = 'BLOCKED'
    }

    // 图片走人工审核；若配置了公网地址则额外调用阿里云图片审核作为辅助标记
    if (settings.allowImages && imageIds.length > 0) {
      const publicOrigin = String(process.env.COMMUNITY_PUBLIC_ORIGIN || '').replace(/\/$/, '')
      if (publicOrigin) {
        for (const imageId of imageIds) {
          const result = await moderateCommunityImage(`${publicOrigin}/api/media/${imageId}`, settings)
          if (result.hit) {
            moderationLabel = [moderationLabel, result.labels.join(',')].filter(Boolean).join(',')
            moderationDetail = [moderationDetail, result.detail].filter(Boolean).join('；')
            if (settings.moderationHitAction === 'BLOCK') status = 'BLOCKED'
          }
        }
      }
    }
  }

  const created = await db.transaction(async (tx) => {
    const [post] = await tx
      .insert(communityPosts)
      .values({
        boardId,
        authorId: user.id,
        content,
        songId,
        status,
        moderationLabel,
        moderationDetail
      })
      .returning({ id: communityPosts.id, status: communityPosts.status })

    if (imageIds.length > 0) {
      await tx.insert(communityPostImages).values(
        imageIds.map((mediaId, index) => ({
          postId: post!.id,
          mediaId,
          sortOrder: index
        }))
      )
    }
    return post!
  })

  const message =
    created.status === 'BLOCKED'
      ? '内容未通过安全审核，已被拦截'
      : created.status === 'APPROVED'
        ? '发布成功'
        : '发布成功，审核通过后会出现在回声社区'

  return { success: true, id: created.id, status: created.status, message }
})
