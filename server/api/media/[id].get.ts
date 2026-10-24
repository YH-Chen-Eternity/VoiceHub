// Copyright (C) 2026 YH-Chen
//
// This file is part of VoiceHub-Plus (an unofficial community edition),
// based on VoiceHub <https://github.com/laoshuikaixue/VoiceHub>.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.
import { getQuery, getRouterParam, setResponseHeaders } from 'h3'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import {
  announcements,
  communityPostImages,
  communityPosts,
  mediaAssets
} from '~/drizzle/schema'
import { createApiError } from '~~/server/utils/apiError'
import { verifyMediaToken } from '~~/server/utils/mediaToken'
import {
  detectImageFormat,
  imageFormatToMimeType,
  sanitizeDownloadFilename
} from '~~/server/utils/imageSecurity'

// 公开读取上传的图片（公告栏图片走这里，避免依赖构建期资源清单）
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createApiError(400, 'COMMON_INVALID_PARAMS', '参数错误')
  }

  const [row] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, id)).limit(1)
  if (!row) {
    throw createApiError(404, 'MEDIA_NOT_FOUND', '图片不存在')
  }

  // 可见性：管理员/审帖员、上传者、审核链路签名令牌、已启用的公告或被公开帖子引用
  const viewer = event.context.user
  const privileged =
    !!viewer && ['ADMIN', 'SUPER_ADMIN', 'REVIEWER'].includes(String(viewer.role || ''))
  let allowed =
    privileged ||
    (!!viewer && row.uploadedBy === viewer.id) ||
    verifyMediaToken(id, getQuery(event).mt)

  if (!allowed) {
    const [announcementRef] = await db
      .select({ id: announcements.id })
      .from(announcements)
      .where(and(eq(announcements.imageId, id), eq(announcements.enabled, true)))
      .limit(1)
    allowed = !!announcementRef
  }

  if (!allowed) {
    const [postImage] = await db
      .select({ postId: communityPostImages.postId })
      .from(communityPostImages)
      .innerJoin(communityPosts, eq(communityPosts.id, communityPostImages.postId))
      .where(
        and(
          eq(communityPostImages.mediaId, id),
          eq(communityPosts.status, 'APPROVED'),
          isNull(communityPosts.deletedAt)
        )
      )
      .limit(1)
    allowed = !!postImage
  }

  if (!allowed) {
    throw createApiError(404, 'MEDIA_NOT_FOUND', '图片不存在')
  }

  // 不信任库中记录的 mimeType，按字节魔数判定内容类型；
  // 历史脏数据（例如伪装成图片的 HTML/脚本）一律返回 415，避免内容嗅探与存储型 XSS
  const data = Buffer.from(row.data, 'base64')
  const format = detectImageFormat(data)
  if (!format) {
    throw createApiError(415, 'MEDIA_CONTENT_UNSUPPORTED', '图片内容不合法，无法展示')
  }

  setResponseHeaders(event, {
    'Content-Type': imageFormatToMimeType(format),
    'Content-Length': data.length,
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `inline; filename="${sanitizeDownloadFilename(row.filename, format)}"`,
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'public, max-age=604800, immutable'
  })
  return data
})
