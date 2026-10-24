import { createApiError } from './apiError'

export const COMMUNITY_IMAGE_MAX_BYTES = 3 * 1024 * 1024
export const COMMUNITY_IMAGE_MAX_UPLOAD_BYTES = 15 * 1024 * 1024

const TARGET_DIMENSIONS = [2560, 2048, 1600, 1280, 1024]
const TARGET_QUALITIES = [82, 75, 65, 55]

type NormalizedImage = {
  data: Buffer
  mimeType: string
  filename: string
  compressed: boolean
}

/**
 * 超过 3MB 的图片由 sharp 自动压缩为 WebP；GIF 保留动画。
 * sharp 未安装或压缩失败时给出明确错误，前端会先做一次压缩兜底。
 */
export async function normalizeCommunityImage(params: {
  data: Buffer
  mimeType: string
  filename: string
}): Promise<NormalizedImage> {
  if (params.data.length <= COMMUNITY_IMAGE_MAX_BYTES) {
    return {
      data: params.data,
      mimeType: params.mimeType,
      filename: params.filename,
      compressed: false
    }
  }

  let sharpFactory: any
  try {
    // @ts-ignore sharp 为可选依赖，首次部署安装依赖后即可用
    const imported: any = await import('sharp')
    sharpFactory = imported?.default || imported
  } catch {
    throw createApiError(
      400,
      'MEDIA_COMPRESSION_UNAVAILABLE',
      '图片超过 3MB，服务端压缩组件不可用，请先在本地压缩后上传'
    )
  }

  const animated = params.mimeType === 'image/gif'
  for (let index = 0; index < TARGET_DIMENSIONS.length; index += 1) {
    const maxDimension = TARGET_DIMENSIONS[index]!
    const quality = TARGET_QUALITIES[index]!
    try {
      const pipeline = sharpFactory(params.data, { animated }).rotate().resize({
        width: maxDimension,
        height: maxDimension,
        fit: 'inside',
        withoutEnlargement: true
      })
      const output = await pipeline.webp({ quality, smartSubsample: true }).toBuffer()
      if (output.length <= COMMUNITY_IMAGE_MAX_BYTES) {
        const base = params.filename.replace(/\.[^.]+$/, '') || 'community-image'
        return {
          data: output,
          mimeType: 'image/webp',
          filename: `${base}.webp`,
          compressed: true
        }
      }
    } catch {
      // 尝试下一档参数
    }
  }

  throw createApiError(400, 'MEDIA_TOO_LARGE', '图片压缩后仍超过 3MB，请更换图片或先手动压缩')
}
