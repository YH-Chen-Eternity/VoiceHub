export const COMMUNITY_IMAGE_MAX_BYTES = 3 * 1024 * 1024
export const COMMUNITY_IMAGE_MAX_UPLOAD_BYTES = 15 * 1024 * 1024

const SUPPORTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const TARGET_DIMENSIONS = [2560, 2048, 1600, 1280, 1024]

export function isCommunityImageType(type: string): boolean {
  return SUPPORTED_TYPES.includes(String(type || '').toLowerCase())
}

/**
 * 浏览器端自动压缩：超过 3MB 的静态图片缩放到 3MB 以内。
 * GIF 保留原文件交给服务端按动画压缩，避免浏览器丢失动画帧。
 */
export async function compressCommunityImageFile(
  file: File
): Promise<{ file: File; compressed: boolean }> {
  if (file.size <= COMMUNITY_IMAGE_MAX_BYTES) return { file, compressed: false }
  if (file.type === 'image/gif') return { file, compressed: false }
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
    return { file, compressed: false }
  }

  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file)
    const sourceWidth = bitmap.width
    const sourceHeight = bitmap.height

    for (let index = 0; index < TARGET_DIMENSIONS.length; index += 1) {
      const maxDimension = TARGET_DIMENSIONS[index]!
      const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight))
      const width = Math.max(1, Math.round(sourceWidth * scale))
      const height = Math.max(1, Math.round(sourceHeight * scale))

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) break
      context.drawImage(bitmap, 0, 0, width, height)

      for (const quality of [0.85, 0.75, 0.65]) {
        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, 'image/webp', quality)
        })
        if (blob && blob.size <= COMMUNITY_IMAGE_MAX_BYTES) {
          const filename = file.name.replace(/\.[^.]+$/, '') || 'community-image'
          return {
            file: new File([blob], `${filename}.webp`, { type: 'image/webp' }),
            compressed: true
          }
        }
      }
    }
  } catch {
    // 浏览器不支持时退回原图，由服务端 sharp 处理
  } finally {
    bitmap?.close?.()
  }

  return { file, compressed: false }
}
