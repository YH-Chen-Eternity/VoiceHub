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
import { readMultipartFormData } from 'h3'
import { db } from '~/drizzle/db'
import { mediaAssets } from '~/drizzle/schema'
import { createApiError } from '~~/server/utils/apiError'
import { normalizeUploadedImage } from '~~/server/utils/imageSecurity'

// 图片上传：校验后存库（base64）+ 通过 /api/media/[id] 转发。
// 之所以不落 public 目录：Nitro 的资源清单在构建期烘焙，运行时新增文件一律 404。
const MAX_BYTES = 2 * 1024 * 1024

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user || !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throw createApiError(403, 'COMMON_INSUFFICIENT_PERMISSION', '权限不足')
  }

  const form = await readMultipartFormData(event)
  const file = form?.find((part) => part.name === 'file' && part.data?.length)
  if (!file) {
    throw createApiError(400, 'MEDIA_NO_FILE', '请选择要上传的图片')
  }

  const mime = String(file.type || '').toLowerCase()
  if (file.data.length > MAX_BYTES) {
    throw createApiError(400, 'MEDIA_TOO_LARGE', '图片不能超过 2MB，请先压缩')
  }

  // 与社区图片共用同一套安全处理：魔数校验 + 完整解码 + 去元数据重编码为 WebP
  const normalized = await normalizeUploadedImage({
    data: file.data,
    mimeType: mime,
    filename: file.filename || 'announcement-image',
    maxBytes: MAX_BYTES,
    fallbackName: 'announcement-image'
  })

  const [row] = await db
    .insert(mediaAssets)
    .values({
      filename: normalized.filename,
      mimeType: normalized.mimeType,
      byteSize: normalized.data.length,
      data: normalized.data.toString('base64'),
      uploadedBy: user.id
    })
    .returning({ id: mediaAssets.id })

  if (!row) {
    throw createApiError(500, 'MEDIA_SAVE_FAILED', '图片保存失败，请稍后重试')
  }

  return { success: true, id: row.id, url: `/api/media/${row.id}` }
})
