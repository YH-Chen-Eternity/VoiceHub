import { and, eq, gt, inArray, isNotNull, lte } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import {
  announcements,
  communityComments,
  communityPostImages,
  communityPosts,
  mediaAssets,
  notifications
} from '~/drizzle/schema'
import {
  COMMUNITY_ARCHIVE_RETENTION_MS,
  COMMUNITY_DELETE_TYPE,
  assertCommunityBoardAccess,
  isCommunityReviewer,
  maskCommunityName
} from './community'
import { createApiError } from './apiError'

type CommunityActor = {
  id: number
  name?: string | null
  role?: string | null
}

function formatArchiveTime(date: Date): string {
  return date.toLocaleString('zh-CN', { hour12: false })
}

function actorLabel(actor: CommunityActor): string {
  return ['ADMIN', 'SUPER_ADMIN'].includes(String(actor.role || '')) ? '管理员' : '审帖员'
}

function buildPurgeAt(now: Date): Date {
  return new Date(now.getTime() + COMMUNITY_ARCHIVE_RETENTION_MS)
}

/** 软删除帖子：作者撤回 / 管理员或审帖员删除，保留 30 天后清理 */
export async function softDeleteCommunityPost(params: {
  postId: number
  actor: CommunityActor
  reason?: string
}) {
  const { postId, actor } = params
  const [post] = await db
    .select({
      id: communityPosts.id,
      authorId: communityPosts.authorId,
      boardId: communityPosts.boardId,
      deletedAt: communityPosts.deletedAt
    })
    .from(communityPosts)
    .where(eq(communityPosts.id, postId))
    .limit(1)
  if (!post) throw createApiError(404, 'COMMUNITY_POST_NOT_FOUND', '帖子不存在')
  if (post.deletedAt) throw createApiError(409, 'COMMUNITY_POST_ALREADY_REMOVED', '帖子已经被撤回或删除')

  const isAuthor = post.authorId === actor.id
  const reviewer = isCommunityReviewer(actor)
  if (!isAuthor && !reviewer) {
    throw createApiError(403, 'COMMUNITY_DELETE_FORBIDDEN', '只能撤回自己的帖子')
  }

  const deleteType = isAuthor ? COMMUNITY_DELETE_TYPE.WITHDRAW : COMMUNITY_DELETE_TYPE.DELETE
  if (deleteType === COMMUNITY_DELETE_TYPE.DELETE) {
    await assertCommunityBoardAccess(actor, post.boardId)
  }

  const now = new Date()
  const purgeAt = buildPurgeAt(now)
  const reason = String(params.reason || '').trim().slice(0, 200) || null

  const [updated] = await db
    .update(communityPosts)
    .set({
      deletedAt: now,
      deletedBy: actor.id,
      deleteType,
      deleteReason: reason,
      purgeAt,
      updatedAt: now
    })
    .where(and(eq(communityPosts.id, postId), eq(communityPosts.authorId, post.authorId)))
    .returning({ id: communityPosts.id })

  if (!updated) throw createApiError(409, 'COMMUNITY_POST_ALREADY_REMOVED', '帖子已经被撤回或删除')

  if (!isAuthor) {
    const actionText = deleteType === COMMUNITY_DELETE_TYPE.WITHDRAW ? '撤回' : '删除'
    await db.insert(notifications).values({
      userId: post.authorId,
      type: 'COMMUNITY_POST_REMOVED',
      source: 'COMMUNITY',
      title: '回声社区：帖子已被移除',
      message: `你的帖子已被${actorLabel(actor)}${maskCommunityName(actor.name)}${actionText}。${
        reason ? `原因：${reason}。` : ''
      }操作时间：${formatArchiveTime(now)}；归档数据将在 ${formatArchiveTime(purgeAt)} 自动清理。`
    })
  }

  return { success: true, deleteType, deletedAt: now, purgeAt }
}

/** 软删除评论：作者撤回 / 管理员或审帖员删除，保留 30 天后清理 */
export async function softDeleteCommunityComment(params: {
  commentId: number
  actor: CommunityActor
  reason?: string
}) {
  const { commentId, actor } = params
  const [row] = await db
    .select({
      id: communityComments.id,
      authorId: communityComments.authorId,
      postId: communityComments.postId,
      deletedAt: communityComments.deletedAt,
      boardId: communityPosts.boardId
    })
    .from(communityComments)
    .innerJoin(communityPosts, eq(communityPosts.id, communityComments.postId))
    .where(eq(communityComments.id, commentId))
    .limit(1)
  if (!row) throw createApiError(404, 'COMMUNITY_COMMENT_NOT_FOUND', '评论不存在')
  if (row.deletedAt) {
    throw createApiError(409, 'COMMUNITY_COMMENT_ALREADY_REMOVED', '评论已经被撤回或删除')
  }

  const isAuthor = row.authorId === actor.id
  const reviewer = isCommunityReviewer(actor)
  if (!isAuthor && !reviewer) {
    throw createApiError(403, 'COMMUNITY_DELETE_FORBIDDEN', '只能撤回自己的评论')
  }

  const deleteType = isAuthor ? COMMUNITY_DELETE_TYPE.WITHDRAW : COMMUNITY_DELETE_TYPE.DELETE
  if (deleteType === COMMUNITY_DELETE_TYPE.DELETE) {
    await assertCommunityBoardAccess(actor, row.boardId)
  }

  const now = new Date()
  const purgeAt = buildPurgeAt(now)
  const reason = String(params.reason || '').trim().slice(0, 200) || null

  const [updated] = await db
    .update(communityComments)
    .set({
      deletedAt: now,
      deletedBy: actor.id,
      deleteType,
      deleteReason: reason,
      purgeAt
    })
    .where(and(eq(communityComments.id, commentId), eq(communityComments.authorId, row.authorId)))
    .returning({ id: communityComments.id })

  if (!updated) {
    throw createApiError(409, 'COMMUNITY_COMMENT_ALREADY_REMOVED', '评论已经被撤回或删除')
  }

  if (!isAuthor) {
    const actionText = deleteType === COMMUNITY_DELETE_TYPE.WITHDRAW ? '撤回' : '删除'
    await db.insert(notifications).values({
      userId: row.authorId,
      type: 'COMMUNITY_COMMENT_REMOVED',
      source: 'COMMUNITY',
      title: '回声社区：评论已被移除',
      message: `你的评论已被${actorLabel(actor)}${maskCommunityName(actor.name)}${actionText}。${
        reason ? `原因：${reason}。` : ''
      }操作时间：${formatArchiveTime(now)}；归档数据将在 ${formatArchiveTime(purgeAt)} 自动清理。`
    })
  }

  return { success: true, deleteType, deletedAt: now, purgeAt }
}

async function purgePostMedia(mediaIds: number[]): Promise<void> {
  if (!mediaIds.length) return
  const [usedByPosts, usedByAnnouncements] = await Promise.all([
    db
      .select({ mediaId: communityPostImages.mediaId })
      .from(communityPostImages)
      .where(inArray(communityPostImages.mediaId, mediaIds)),
    db
      .select({ imageId: announcements.imageId })
      .from(announcements)
      .where(inArray(announcements.imageId, mediaIds))
  ])
  const stillUsed = new Set<number>([
    ...usedByPosts.map((row) => Number(row.mediaId)),
    ...usedByAnnouncements
      .map((row) => (row.imageId == null ? null : Number(row.imageId)))
      .filter((id): id is number => id != null)
  ])
  const removable = mediaIds.filter((id) => !stillUsed.has(id))
  if (removable.length) {
    await db.delete(mediaAssets).where(inArray(mediaAssets.id, removable))
  }
}

/** 物理清理超过 30 天的归档帖子与评论，返回清理数量 */
export async function purgeExpiredCommunityContent(): Promise<{
  posts: number
  comments: number
}> {
  const now = new Date()
  const expiredPosts = await db
    .select({ id: communityPosts.id })
    .from(communityPosts)
    .where(and(isNotNull(communityPosts.purgeAt), lte(communityPosts.purgeAt, now)))
    .limit(200)

  let posts = 0
  if (expiredPosts.length) {
    const candidateIds = expiredPosts.map((row) => row.id)
    // 帖子删除会级联评论；若其中仍有未满 30 天的单独归档评论，延后整帖清理
    const pendingCommentRows = await db
      .select({ postId: communityComments.postId })
      .from(communityComments)
      .where(
        and(
          inArray(communityComments.postId, candidateIds),
          isNotNull(communityComments.purgeAt),
          gt(communityComments.purgeAt, now)
        )
      )
    const pendingPosts = new Set(pendingCommentRows.map((row) => row.postId))
    const postIds = candidateIds.filter((id) => !pendingPosts.has(id))

    if (postIds.length) {
      const imageRows = await db
        .select({ mediaId: communityPostImages.mediaId })
        .from(communityPostImages)
        .where(inArray(communityPostImages.postId, postIds))
      const mediaIds = Array.from(new Set(imageRows.map((row) => Number(row.mediaId))))
      const deleted = await db
        .delete(communityPosts)
        .where(inArray(communityPosts.id, postIds))
        .returning({ id: communityPosts.id })
      posts = deleted.length
      await purgePostMedia(mediaIds)
    }
  }

  const expiredComments = await db
    .delete(communityComments)
    .where(and(isNotNull(communityComments.purgeAt), lte(communityComments.purgeAt, now)))
    .returning({ id: communityComments.id })

  return { posts, comments: expiredComments.length }
}
