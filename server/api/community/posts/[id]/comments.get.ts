import { getRouterParam } from 'h3'
import { and, asc, count, eq, isNull, notInArray, or, sql } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import {
  communityComments,
  communityPosts,
  communityProfiles,
  communityTitles,
  users
} from '~/drizzle/schema'
import {
  buildCommunityIdentity,
  getReviewableBoardIds,
  isCommunityAdmin,
  isCommunityReviewer,
  requireCommunityUser
} from '~~/server/utils/community'
import { getBlockedUserIds } from '~~/server/utils/communityRelations'
import {
  COMMUNITY_MENTION_LIMIT,
  extractCommunityMentionTokens,
  resolveCommunityMentionUsers
} from '~~/server/utils/communityCommentMentions'
import { createApiError } from '~~/server/utils/apiError'

/** 单条评论在接口中的序列化形态（向后兼容原有字段，新增楼中楼与 @ 相关字段） */
interface CommunityCommentPayload {
  id: number
  createdAt: Date
  content: string
  status: string
  reviewNote: string | null
  parentId: number | null
  replyTo: string | null
  mentionNames: string[]
  author: {
    id: number
    className: string
    maskedName: string
    title: string | null
    displayName: string
  }
}

/** 楼中楼：顶层评论 + 其下所有回复（库表只支持一层 parentId，读取时归一化到根） */
interface CommunityCommentThread extends CommunityCommentPayload {
  replies: CommunityCommentPayload[]
}

export default defineEventHandler(async (event) => {
  const user = requireCommunityUser(event)
  const postId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(postId) || postId <= 0) {
    throw createApiError(400, 'COMMUNITY_POST_INVALID', '帖子参数不正确')
  }

  const postRow = await db
    .select({
      id: communityPosts.id,
      boardId: communityPosts.boardId,
      status: communityPosts.status,
      authorId: communityPosts.authorId,
      deletedAt: communityPosts.deletedAt
    })
    .from(communityPosts)
    .where(eq(communityPosts.id, postId))
    .limit(1)
  const post = postRow[0]
  if (!post || post.deletedAt) throw createApiError(404, 'COMMUNITY_POST_NOT_FOUND', '帖子不存在')

  const scopedBoardIds = await getReviewableBoardIds(user)
  const canReviewBoard = !scopedBoardIds || scopedBoardIds.includes(post.boardId)
  const reviewerForBoard = canReviewBoard && isCommunityReviewer(user)
  const privileged = reviewerForBoard || post.authorId === user.id
  if (post.status !== 'APPROVED' && !privileged) {
    throw createApiError(403, 'COMMUNITY_POST_NOT_PUBLIC', '帖子尚未公开')
  }

  // 审核状态可见性保持原逻辑：审帖员可见该帖全部评论，普通用户只看已通过 + 自己的评论
  const visibility = reviewerForBoard
    ? isNull(communityComments.deletedAt)
    : and(
        isNull(communityComments.deletedAt),
        or(eq(communityComments.status, 'APPROVED'), eq(communityComments.authorId, user.id))
      )

  // 拉黑关系 + 影子封禁过滤（作者本人与管理员/审帖员不受影响）
  const extraConditions: any[] = []
  const blockedIds = await getBlockedUserIds(user.id)
  if (blockedIds.length) extraConditions.push(notInArray(communityComments.authorId, blockedIds))
  if (!isCommunityAdmin(user)) {
    extraConditions.push(
      or(
        eq(communityComments.authorId, user.id),
        sql`not exists (select 1 from "CommunityProfile" cp where cp."userId" = ${communityComments.authorId} and cp."shadowBanned" = true)`
      )!
    )
  }

  const rows = await db
    .select({
      id: communityComments.id,
      createdAt: communityComments.createdAt,
      content: communityComments.content,
      status: communityComments.status,
      reviewNote: communityComments.reviewNote,
      parentId: communityComments.parentId,
      authorId: communityComments.authorId,
      authorName: users.name,
      authorGrade: users.grade,
      authorClass: users.class,
      titleName: communityTitles.name
    })
    .from(communityComments)
    .innerJoin(users, eq(users.id, communityComments.authorId))
    .leftJoin(communityProfiles, eq(communityProfiles.userId, communityComments.authorId))
    .leftJoin(communityTitles, eq(communityTitles.id, communityProfiles.equippedTitleId))
    .where(and(eq(communityComments.postId, postId), visibility, ...extraConditions))
    .orderBy(asc(communityComments.id))
    .limit(200)

  // 一次性解析整页正文里的 @ token，避免逐条评论重复查 users 表
  const mentionTokens: string[] = []
  for (const row of rows) {
    mentionTokens.push(...extractCommunityMentionTokens(row.content))
  }
  const mentionUserByToken = await resolveCommunityMentionUsers(mentionTokens)

  const rowById = new Map(rows.map((row) => [row.id, row]))
  const identityOf = (row: (typeof rows)[number]) =>
    buildCommunityIdentity(
      { name: row.authorName, grade: row.authorGrade, class: row.authorClass },
      row.titleName
    )

  const comments: CommunityCommentPayload[] = rows.map((row) => {
    // 父评论可能因审核状态对当前用户不可见，此时 replyTo 留空但保留 parentId
    const parent = row.parentId ? rowById.get(row.parentId) : undefined
    const mentioned: string[] = []
    const seenMentionUserIds = new Set<number>()
    for (const token of extractCommunityMentionTokens(row.content)) {
      const mentionedUser = mentionUserByToken.get(token)
      if (!mentionedUser || seenMentionUserIds.has(mentionedUser.id)) continue
      seenMentionUserIds.add(mentionedUser.id)
      mentioned.push(mentionedUser.displayName)
      if (mentioned.length >= COMMUNITY_MENTION_LIMIT) break
    }

    return {
      id: row.id,
      createdAt: row.createdAt,
      content: row.content,
      status: row.status,
      reviewNote: row.reviewNote,
      parentId: row.parentId ?? null,
      replyTo: parent ? identityOf(parent).displayName : null,
      mentionNames: mentioned,
      author: {
        id: row.authorId,
        ...identityOf(row)
      }
    }
  })

  // 组装楼中楼：父评论不可见的回复提升为顶层，深层回复统一挂到根评论下
  const commentById = new Map(comments.map((comment) => [comment.id, comment]))
  const findRoot = (comment: CommunityCommentPayload): CommunityCommentPayload => {
    let current = comment
    for (let guard = 0; guard < 20; guard += 1) {
      const parent = current.parentId ? commentById.get(current.parentId) : undefined
      if (!parent) return current
      current = parent
    }
    // 理论上不存在环（parentId 只会指向已存在的评论），兜底避免脏数据导致死循环
    return current
  }

  const threadByRootId = new Map<number, CommunityCommentThread>()
  const threads: CommunityCommentThread[] = []
  for (const comment of comments) {
    const root = findRoot(comment)
    if (root.id !== comment.id) continue
    const thread: CommunityCommentThread = { ...comment, replies: [] }
    threadByRootId.set(comment.id, thread)
    threads.push(thread)
  }
  for (const comment of comments) {
    if (threadByRootId.has(comment.id)) continue
    const thread = threadByRootId.get(findRoot(comment).id)
    if (thread) thread.replies.push(comment)
  }

  const byCreatedAtAsc = (a: { createdAt: Date; id: number }, b: { createdAt: Date; id: number }) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id - b.id
  threads.sort(byCreatedAtAsc)
  for (const thread of threads) thread.replies.sort(byCreatedAtAsc)

  // 评论总数只统计已通过审核且未删除的评论（与帖子列表 commentCount 口径一致）
  const totalCountRows = await db
    .select({ count: count() })
    .from(communityComments)
    .where(
      and(
        eq(communityComments.postId, postId),
        isNull(communityComments.deletedAt),
        eq(communityComments.status, 'APPROVED'),
        ...extraConditions
      )
    )

  return {
    success: true,
    // 向后兼容：保留原有扁平 comments 数组与字段，新增 parentId/replyTo/mentionNames
    comments,
    // 楼中楼结构由服务端组装好，前端可直接渲染，无需自己拼树
    threads,
    total: Number(totalCountRows[0]?.count || 0)
  }
})
