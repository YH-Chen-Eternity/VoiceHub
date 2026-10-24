import { createApiError } from './apiError'

/**
 * 图片上传安全处理：魔数校验 + 完整解码 + 强制重编码为 WebP + 限像素/限帧 + 按体积阶梯降级。
 *
 * 设计要点：
 * - 不信任客户端声明的 MIME，只按真实字节魔数判断格式，声明与真实不一致直接拒绝；
 * - 一律经 sharp 完整解码后重编码输出 WebP，原文件不直接入库，可清除 EXIF/GPS 等元数据，
 *   同时规避 polyglot 文件、图片解码器漏洞与解压炸弹；
 * - GIF / 动态 WebP 保留动画帧；
 * - 文件名统一清洗，避免路径穿越与控制字符；
 * - sharp 使用动态 import，缺失时返回明确错误；读取接口不依赖 sharp。
 */

export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'gif'

export type NormalizedImage = {
  data: Buffer
  mimeType: string
  filename: string
  compressed: boolean
}

/** 单张图片的解码像素上限（动图按全部帧累计），防解压炸弹 */
export const IMAGE_MAX_PIXELS = 40 * 1000 * 1000
/** 图片宽度上限 */
export const IMAGE_MAX_WIDTH = 12000
/** 动图单帧高度上限（静态图等同于整图高度） */
export const IMAGE_MAX_FRAME_HEIGHT = 12000
/** 动图帧数上限 */
export const IMAGE_MAX_ANIMATION_FRAMES = 300

const MIME_BY_FORMAT: Record<ImageFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif'
}

// 仅接受与魔数一一对应的声明类型；image/jpg 作为历史别名兼容
const FORMAT_BY_MIME: Record<string, ImageFormat> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/webp': 'webp',
  'image/gif': 'gif'
}

// 文件名中需要剔除的路径分隔符与 shell/HTML 危险字符
const FILENAME_FORBIDDEN_CHARS = '\\/:*?"<>|'

/** 逐字符剔除控制字符与危险字符（避免正则控制字符告警） */
function stripForbiddenFilenameChars(value: string): string {
  let result = ''
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) continue
    if (FILENAME_FORBIDDEN_CHARS.includes(char)) continue
    result += char
  }
  return result
}

type EncodeAttempt = {
  maxDimension: number | null
  quality: number
}

// 静态图阶梯：先尝试原始尺寸，再逐步缩小尺寸并降低质量
const STATIC_ATTEMPTS: EncodeAttempt[] = [
  { maxDimension: null, quality: 82 },
  { maxDimension: 2560, quality: 82 },
  { maxDimension: 2048, quality: 76 },
  { maxDimension: 1600, quality: 70 },
  { maxDimension: 1280, quality: 62 },
  { maxDimension: 1024, quality: 56 }
]

// 动图重编码成本高，阶梯更短
const ANIMATED_ATTEMPTS: EncodeAttempt[] = [
  { maxDimension: null, quality: 78 },
  { maxDimension: 1280, quality: 72 },
  { maxDimension: 960, quality: 66 },
  { maxDimension: 720, quality: 58 }
]

let sharpPromise: Promise<any> | null = null

/** 动态加载 sharp；失败时返回明确的服务端错误并允许下次重试 */
async function loadSharp(): Promise<any> {
  if (!sharpPromise) {
    sharpPromise = (async () => {
      try {
        const imported: any = await import('sharp')
        return imported?.default || imported
      } catch {
        throw createApiError(
          500,
          'MEDIA_COMPRESSION_UNAVAILABLE',
          '服务端图片处理组件不可用，请稍后重试'
        )
      }
    })().catch((error) => {
      sharpPromise = null
      throw error
    })
  }
  return sharpPromise
}

/** 按字节魔数识别图片格式；不支持或无法识别时返回 null */
export function detectImageFormat(data: Buffer): ImageFormat | null {
  if (!Buffer.isBuffer(data) || data.length < 12) return null

  if (
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return 'png'
  }

  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpeg'

  // WebP：RIFF....WEBP
  if (data.subarray(0, 4).toString('latin1') === 'RIFF') {
    if (data.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp'
  }

  const gifHeader = data.subarray(0, 6).toString('latin1')
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') return 'gif'

  return null
}

/** 格式对应的 MIME 类型 */
export function imageFormatToMimeType(format: ImageFormat): string {
  return MIME_BY_FORMAT[format]
}

/** 清洗文件名主干（去目录、去扩展名、去危险字符），用于入库文件名 */
export function sanitizeImageBaseName(filename: string, fallback = 'image'): string {
  const basename =
    String(filename || '')
      .split(/[\\/]/)
      .pop() || ''
  const withoutExtension = basename.replace(/\.[^.]+$/, '')
  const cleaned = stripForbiddenFilenameChars(withoutExtension)
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.\-_\s]+|[.\-_\s]+$/g, '')
    .slice(0, 80)
  return cleaned || fallback
}

/** 生成 Content-Disposition 中安全的 ASCII 文件名（保留扩展名） */
export function sanitizeDownloadFilename(filename: string, format: ImageFormat): string {
  const extension = format === 'jpeg' ? 'jpg' : format
  const basename =
    String(filename || '')
      .split(/[\\/]/)
      .pop() || ''
  const withoutExtension = basename.replace(/\.[^.]+$/, '')
  const safe = withoutExtension
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 80)
  return `${safe || 'image'}.${extension}`
}

/**
 * 校验并规范化一张上传图片。
 *
 * @param params.data           原始文件字节
 * @param params.mimeType       客户端声明的 MIME（仅用于一致性校验，不作为可信来源）
 * @param params.filename       客户端文件名（会被清洗）
 * @param params.maxBytes       输出体积上限（字节），超限时按阶梯降级，仍超限则拒绝
 * @param params.fallbackName   文件名兜底主干（不含扩展名）
 */
export async function normalizeUploadedImage(params: {
  data: Buffer
  mimeType: string
  filename: string
  maxBytes: number
  fallbackName?: string
}): Promise<NormalizedImage> {
  const { data, maxBytes } = params

  if (!Buffer.isBuffer(data) || data.length === 0) {
    throw createApiError(400, 'MEDIA_NO_FILE', '请选择要上传的图片')
  }

  const declaredMime = String(params.mimeType || '')
    .toLowerCase()
    .split(';')[0]!
    .trim()
  const declaredFormat = FORMAT_BY_MIME[declaredMime]
  if (!declaredFormat) {
    throw createApiError(400, 'MEDIA_TYPE_UNSUPPORTED', '仅支持 PNG / JPEG / WebP / GIF 格式')
  }

  const detected = detectImageFormat(data)
  if (!detected) {
    throw createApiError(
      400,
      'MEDIA_TYPE_UNSUPPORTED',
      '文件内容不是有效的 PNG / JPEG / WebP / GIF 图片'
    )
  }
  if (detected !== declaredFormat) {
    throw createApiError(
      400,
      'MEDIA_IMAGE_MISMATCH',
      '图片实际内容与声明的类型不一致，请重新选择文件'
    )
  }

  const sharpFactory = await loadSharp()

  // 先只解析文件头做尺寸/帧数校验；limitInputPixels=0 仅放开头部探测，不触发像素解码
  let metadata: any
  try {
    metadata = await sharpFactory(data, { animated: true, limitInputPixels: 0 }).metadata()
  } catch {
    throw createApiError(400, 'MEDIA_IMAGE_INVALID', '图片文件已损坏或无法解析，请更换图片')
  }

  if (String(metadata?.format || '') !== detected) {
    throw createApiError(400, 'MEDIA_IMAGE_INVALID', '图片文件已损坏或无法解析，请更换图片')
  }

  const width = Number(metadata?.width || 0)
  const height = Number(metadata?.height || 0)
  const frames = Math.max(1, Number(metadata?.pages || 1))
  const pageHeight =
    frames > 1 ? Number(metadata?.pageHeight || Math.floor(height / frames)) : height

  if (!width || !pageHeight) {
    throw createApiError(400, 'MEDIA_IMAGE_INVALID', '图片文件已损坏或无法解析，请更换图片')
  }
  if (width > IMAGE_MAX_WIDTH || pageHeight > IMAGE_MAX_FRAME_HEIGHT) {
    throw createApiError(
      400,
      'MEDIA_IMAGE_TOO_LARGE',
      `图片分辨率超出限制（宽或高不能超过 ${IMAGE_MAX_WIDTH} 像素），请先缩小后再上传`
    )
  }
  if (frames > IMAGE_MAX_ANIMATION_FRAMES) {
    throw createApiError(
      400,
      'MEDIA_IMAGE_TOO_LARGE',
      `动图帧数不能超过 ${IMAGE_MAX_ANIMATION_FRAMES} 帧，请更换图片`
    )
  }

  const decodedPixels = width * pageHeight * frames
  if (decodedPixels > IMAGE_MAX_PIXELS) {
    throw createApiError(
      400,
      'MEDIA_IMAGE_TOO_LARGE',
      '图片解码像素超出限制（动图按全部帧累计），请先压缩后再上传'
    )
  }

  const animated = frames > 1
  const attempts = animated ? ANIMATED_ATTEMPTS : STATIC_ATTEMPTS
  const maxMb = Math.max(1, Math.round(maxBytes / (1024 * 1024)))

  let output: Buffer | null = null
  let attemptIndex = 0

  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index]!
    try {
      let pipeline = sharpFactory(data, {
        animated,
        // 已按全部帧累计校验过像素上限，这里用同一上限兜底解码
        limitInputPixels: IMAGE_MAX_PIXELS
      }).rotate()
      if (attempt.maxDimension) {
        pipeline = pipeline.resize({
          width: attempt.maxDimension,
          height: attempt.maxDimension,
          fit: 'inside',
          withoutEnlargement: true
        })
      }
      // 不调用 withMetadata：输出 WebP 默认丢弃 EXIF/GPS/ICC 等元数据
      const buffer: Buffer = await pipeline
        .webp({ quality: attempt.quality, effort: animated ? 3 : 4, smartSubsample: true })
        .toBuffer()
      if (buffer.length <= maxBytes) {
        output = buffer
        attemptIndex = index
        break
      }
    } catch (error: any) {
      if (String(error?.message || '').includes('pixel limit')) {
        throw createApiError(
          400,
          'MEDIA_IMAGE_TOO_LARGE',
          '图片解码像素超出限制（动图按全部帧累计），请先压缩后再上传'
        )
      }
      throw createApiError(400, 'MEDIA_IMAGE_INVALID', '图片文件已损坏或无法解析，请更换图片')
    }
  }

  if (!output) {
    throw createApiError(
      400,
      'MEDIA_TOO_LARGE',
      `图片压缩后仍超过 ${maxMb}MB，请更换图片或先手动压缩`
    )
  }

  const baseName = sanitizeImageBaseName(params.filename, params.fallbackName || 'image')

  return {
    data: output,
    mimeType: MIME_BY_FORMAT.webp,
    filename: `${baseName}.webp`,
    // 原始文件已超体积上限，或原始尺寸无法达标需要降级时才视为「已压缩」
    compressed: data.length > maxBytes || attemptIndex > 0
  }
}
