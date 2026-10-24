import { createApiError } from './apiError'
import { normalizeUploadedImage, type NormalizedImage } from './imageSecurity'

// 社区图片：入库体积上限 3MB，原始上传上限 15MB
export const COMMUNITY_IMAGE_MAX_BYTES = 3 * 1024 * 1024
export const COMMUNITY_IMAGE_MAX_UPLOAD_BYTES = 15 * 1024 * 1024

/**
 * 规范化社区上传图片：魔数校验、完整解码、去元数据并重编码为 WebP，必要时按阶梯压缩到 3MB 内。
 * 安全逻辑统一由 server/utils/imageSecurity.ts 提供，此处仅固定社区体积上限。
 */
export async function normalizeCommunityImage(params: {
  data: Buffer
  mimeType: string
  filename: string
}): Promise<NormalizedImage> {
  if (!Buffer.isBuffer(params.data) || params.data.length === 0) {
    throw createApiError(400, 'MEDIA_NO_FILE', '请选择要上传的图片')
  }
  if (params.data.length > COMMUNITY_IMAGE_MAX_UPLOAD_BYTES) {
    throw createApiError(400, 'MEDIA_TOO_LARGE', '图片原始文件不能超过 15MB')
  }

  return normalizeUploadedImage({
    data: params.data,
    mimeType: params.mimeType,
    filename: params.filename,
    maxBytes: COMMUNITY_IMAGE_MAX_BYTES,
    fallbackName: 'community-image'
  })
}
