import { createHash } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { mediaAssets } from '~/drizzle/schema'

/** 对规范化后的图片字节做 sha256，用于同一上传者的重复图片复用 */
export function hashMediaData(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/** 查找同一上传者已存在的相同图片；找到时直接复用，避免重复入库 */
export async function findReusableMediaAsset(params: { sha256: string; uploadedBy: number }) {
  const [row] = await db
    .select({
      id: mediaAssets.id,
      filename: mediaAssets.filename,
      mimeType: mediaAssets.mimeType,
      byteSize: mediaAssets.byteSize
    })
    .from(mediaAssets)
    .where(
      and(eq(mediaAssets.sha256, params.sha256), eq(mediaAssets.uploadedBy, params.uploadedBy))
    )
    .orderBy(asc(mediaAssets.id))
    .limit(1)
  return row || null
}
