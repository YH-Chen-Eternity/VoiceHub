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

export type CommunityArchiveContentType = 'post' | 'comment'

/** 归档内容类型归一化：兼容 post/posts、comment/comments 两种写法 */
function normalizeArchiveContentType(value: unknown): CommunityArchiveContentType {
  const type = String(value || '')
    .trim()
    .toLowerCase()
  if (type === 'post' || type === 'posts') return 'post'
  if (type === 'comment' || type === 'comments') return 'comment'
  throw createApiError(400, 'COMMUNITY_ARCHIVE_TYPE_INVALID', '归档类型不正确，仅支持 post / comment')
}

export interface RestoredCommunityPostSummary {
  id: number
  boardId: number
  authorId: number
  status: string
  createdAt: Date
}

export interface RestoredCommunityCommentSummary {
  id: number
  postId: number
  authorId: number
  status: string
  createdAt: Date
}

export type RestoreArchivedCommunityResult =
  | { success: true; type: 'post'; post: RestoredCommunityPostSummary }
  | { success: true; type: 'comment'; comment: RestoredCommunityCommentSummary }

/**
 * 从归档中恢复帖子/评论（管理后台“恢复/撤回归档”）。
 * - 只处理仍处于归档状态（deletedAt 非空）的记录，正常数据返回 409；
 * - purgeAt 已过期说明清理任务随时会物理删除，返回 409 由前端提示；
 * - 事务 + 行锁：与 community-archive-purge 清理任务并发时只会有一方成功；
 * - 审帖员只能恢复自己负责板块的内容（与归档列表可见范围一致）。
 */
export async function restoreArchivedCommunityContent(params: {
  type: CommunityArchiveContentType | string
  id: number
  actor: CommunityActor
}): Promise<RestoreArchivedCommunityResult> {
  const type = normalizeArchiveContentType(params.type)
  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) {
    throw createApiError(400, 'COMMUNITY_ARCHIVE_INVALID', '归档记录参数不正确')
  }
  const now = new Date()

  if (type === 'post') {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          id: communityPosts.id,
          boardId: communityPosts.boardId,
          authorId: communityPosts.authorId,
          deletedAt: communityPosts.deletedAt,
          purgeAt: communityPosts.purgeAt
        })
        .from(communityPosts)
        .where(eq(communityPosts.id, id))
        .for('update')
        .limit(1)

      if (!row) {
        throw createApiError(404, 'COMMUNITY_ARCHIVE_NOT_FOUND', '归档帖子不存在或已被自动清理')
      }
      if (!row.deletedAt) {
        throw createApiError(409, 'COMMUNITY_ARCHIVE_NOT_ARCHIVED', '该帖子不在归档中，无需恢复')
      }
      if (row.purgeAt && row.purgeAt.getTime() <= now.getTime()) {
        throw createApiError(409, 'COMMUNITY_ARCHIVE_EXPIRED', '该帖子的归档保留期已过，无法恢复')
      }
      await assertCommunityBoardAccess(params.actor, row.boardId)

      const [restored] = await tx
        .update(communityPosts)
        .set({
          deletedAt: null,
          deletedBy: null,
          deleteType: null,
          deleteReason: null,
          purgeAt: null,
          updatedAt: now
        })
        .where(and(eq(communityPosts.id, id), isNotNull(communityPosts.deletedAt)))
        .returning({
          id: communityPosts.id,
          boardId: communityPosts.boardId,
          authorId: communityPosts.authorId,
          status: communityPosts.status,
          createdAt: communityPosts.createdAt
        })
      if (!restored) {
        throw createApiError(409, 'COMMUNITY_ARCHIVE_NOT_ARCHIVED', '该帖子不在归档中，无需恢复')
      }

      return { success: true as const, type: 'post' as const, post: restored }
    })
  }

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: communityComments.id,
        postId: communityComments.postId,
        authorId: communityComments.authorId,
        deletedAt: communityComments.deletedAt,
        purgeAt: communityComments.purgeAt,
        postDeletedAt: communityPosts.deletedAt,
        boardId: communityPosts.boardId
      })
      .from(communityComments)
      .innerJoin(communityPosts, eq(communityPosts.id, communityComments.postId))
      .where(eq(communityComments.id, id))
      .for('update', { of: communityComments })
      .limit(1)

    if (!row) {
      throw createApiError(404, 'COMMUNITY_ARCHIVE_NOT_FOUND', '归档评论不存在或已被自动清理')
    }
    if (!row.deletedAt) {
      throw createApiError(409, 'COMMUNITY_ARCHIVE_NOT_ARCHIVED', '该评论不在归档中，无需恢复')
    }
    if (row.purgeAt && row.purgeAt.getTime() <= now.getTime()) {
      throw createApiError(409, 'COMMUNITY_ARCHIVE_EXPIRED', '该评论的归档保留期已过，无法恢复')
    }
    // 所属帖子仍在归档：单独恢复评论后依旧不可见，要求先恢复帖子
    if (row.postDeletedAt) {
      throw createApiError(409, 'COMMUNITY_ARCHIVE_POST_ARCHIVED', '所属帖子仍在归档中，请先恢复帖子')
    }
    await assertCommunityBoardAccess(params.actor, row.boardId)

    const [restored] = await tx
      .update(communityComments)
      .set({
        deletedAt: null,
        deletedBy: null,
        deleteType: null,
        deleteReason: null,
        purgeAt: null
      })
      .where(and(eq(communityComments.id, id), isNotNull(communityComments.deletedAt)))
      .returning({
        id: communityComments.id,
        postId: communityComments.postId,
        authorId: communityComments.authorId,
        status: communityComments.status,
        createdAt: communityComments.createdAt
      })
    if (!restored) {
      throw createApiError(409, 'COMMUNITY_ARCHIVE_NOT_ARCHIVED', '该评论不在归档中，无需恢复')
    }

    return { success: true as const, type: 'comment' as const, comment: restored }
  })
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
      // 删除时重新校验 purgeAt：管理后台恢复操作会清空 purgeAt，
      // 若只按 id 删除，刚恢复的帖子会被这条已在途的清理语句误删
      const deleted = await db
        .delete(communityPosts)
        .where(
          and(
            inArray(communityPosts.id, postIds),
            isNotNull(communityPosts.purgeAt),
            lte(communityPosts.purgeAt, now)
          )
        )
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
