import { getQuery } from 'h3'
import { and, count, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import {
  communityBoards,
  communityComments,
  communityPostImages,
  communityPosts,
  users
} from '~/drizzle/schema'
import { getReviewableBoardIds, requireCommunityReviewer } from '~~/server/utils/community'
import { purgeExpiredCommunityContent } from '~~/server/utils/communityArchive'
import { createApiError } from '~~/server/utils/apiError'

type AnyRecord = Record<string, any>

function actorView(map: Map<number, AnyRecord>, id: number | null | undefined) {
  if (!id) return null
  const row = map.get(Number(id))
  if (!row) return { id: Number(id), name: '已注销用户', username: null }
  return { id: row.id, name: row.name, username: row.username }
}

export default defineEventHandler(async (event) => {
  const user = requireCommunityReviewer(event)
  const query = getQuery(event)
  const type = String(query.type || 'posts') === 'comments' ? 'comments' : 'posts'
  const boardId = Number(query.boardId || 0) || undefined
  const limit = Math.min(Math.max(Number(query.limit || 30) || 30, 1), 100)

  const scopedBoardIds = await getReviewableBoardIds(user)
  if (boardId && scopedBoardIds && !scopedBoardIds.includes(boardId)) {
    throw createApiError(403, 'COMMUNITY_REVIEW_BOARD_FORBIDDEN', '你没有被分配到该板块')
  }

  await purgeExpiredCommunityContent()

  const boardScope = boardId
    ? eq(communityPosts.boardId, boardId)
    : scopedBoardIds
      ? inArray(communityPosts.boardId, scopedBoardIds.length ? scopedBoardIds : [-1])
      : undefined

  const boards = await db
    .select({ id: communityBoards.id, name: communityBoards.name })
    .from(communityBoards)
    .where(
      scopedBoardIds
        ? inArray(communityBoards.id, scopedBoardIds.length ? scopedBoardIds : [-1])
        : undefined
    )

  const [postStatRows, commentStatRows] = await Promise.all([
    db
      .select({ value: count() })
      .from(communityPosts)
      .where(and(isNotNull(communityPosts.deletedAt), boardScope)),
    db
      .select({ value: count() })
      .from(communityComments)
      .innerJoin(communityPosts, eq(communityPosts.id, communityComments.postId))
      .where(and(isNotNull(communityComments.deletedAt), boardScope))
  ])

  const stats = {
    posts: Number(postStatRows[0]?.value || 0),
    comments: Number(commentStatRows[0]?.value || 0)
  }

  const actorIds = new Set<number>()
  const actorMap = new Map<number, AnyRecord>()
  const loadActors = async () => {
    const ids = Array.from(actorIds)
    if (!ids.length) return
    const rows = await db
      .select({ id: users.id, name: users.name, username: users.username })
      .from(users)
      .where(inArray(users.id, ids))
    for (const row of rows) actorMap.set(row.id, row)
  }

  if (type === 'comments') {
    const rows = await db
      .select({
        id: communityComments.id,
        createdAt: communityComments.createdAt,
        content: communityComments.content,
        status: communityComments.status,
        reviewNote: communityComments.reviewNote,
        deletedAt: communityComments.deletedAt,
        deletedBy: communityComments.deletedBy,
        deleteType: communityComments.deleteType,
        deleteReason: communityComments.deleteReason,
        purgeAt: communityComments.purgeAt,
        authorId: communityComments.authorId,
        authorName: users.name,
        authorUsername: users.username,
        postId: communityPosts.id,
        postContent: communityPosts.content,
        postDeletedAt: communityPosts.deletedAt,
        boardId: communityPosts.boardId,
        boardName: communityBoards.name
      })
      .from(communityComments)
      .innerJoin(communityPosts, eq(communityPosts.id, communityComments.postId))
      .innerJoin(communityBoards, eq(communityBoards.id, communityPosts.boardId))
      .innerJoin(users, eq(users.id, communityComments.authorId))
      .where(and(isNotNull(communityComments.deletedAt), boardScope))
      .orderBy(desc(communityComments.deletedAt))
      .limit(limit)

    for (const row of rows) if (row.deletedBy) actorIds.add(row.deletedBy)
    await loadActors()

    return {
      success: true,
      type,
      stats,
      boards,
      posts: [],
      comments: rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        content: row.content,
        status: row.status,
        reviewNote: row.reviewNote,
        deletedAt: row.deletedAt,
        deleteType: row.deleteType,
        deleteReason: row.deleteReason,
        purgeAt: row.purgeAt,
        deletedBy: actorView(actorMap, row.deletedBy),
        author: { id: row.authorId, name: row.authorName, username: row.authorUsername },
        board: { id: row.boardId, name: row.boardName },
        post: {
          id: row.postId,
          content: row.postContent,
          deletedAt: row.postDeletedAt
        }
      }))
    }
  }

  const postRows = await db
    .select({
      id: communityPosts.id,
      createdAt: communityPosts.createdAt,
      content: communityPosts.content,
      status: communityPosts.status,
      deletedAt: communityPosts.deletedAt,
      deletedBy: communityPosts.deletedBy,
      deleteType: communityPosts.deleteType,
      deleteReason: communityPosts.deleteReason,
      purgeAt: communityPosts.purgeAt,
      authorId: communityPosts.authorId,
      authorName: users.name,
      authorUsername: users.username,
      boardId: communityPosts.boardId,
      boardName: communityBoards.name
    })
    .from(communityPosts)
    .innerJoin(communityBoards, eq(communityBoards.id, communityPosts.boardId))
    .innerJoin(users, eq(users.id, communityPosts.authorId))
    .where(and(isNotNull(communityPosts.deletedAt), boardScope))
    .orderBy(desc(communityPosts.deletedAt))
    .limit(limit)

  const postIds = postRows.map((row) => row.id)
  const imageRows = postIds.length
    ? await db
        .select({
          postId: communityPostImages.postId,
          mediaId: communityPostImages.mediaId,
          sortOrder: communityPostImages.sortOrder
        })
        .from(communityPostImages)
        .where(inArray(communityPostImages.postId, postIds))
        .orderBy(communityPostImages.sortOrder)
    : []

  const commentRows = postIds.length
    ? await db
        .select({
          id: communityComments.id,
          createdAt: communityComments.createdAt,
          content: communityComments.content,
          status: communityComments.status,
          reviewNote: communityComments.reviewNote,
          deletedAt: communityComments.deletedAt,
          deletedBy: communityComments.deletedBy,
          deleteType: communityComments.deleteType,
          deleteReason: communityComments.deleteReason,
          purgeAt: communityComments.purgeAt,
          postId: communityComments.postId,
          authorId: communityComments.authorId,
          authorName: users.name,
          authorUsername: users.username
        })
        .from(communityComments)
        .innerJoin(users, eq(users.id, communityComments.authorId))
        .where(inArray(communityComments.postId, postIds))
        .orderBy(communityComments.id)
    : []

  for (const row of postRows) if (row.deletedBy) actorIds.add(row.deletedBy)
  for (const row of commentRows) if (row.deletedBy) actorIds.add(row.deletedBy)
  await loadActors()

  const imagesByPost = new Map<number, Array<{ id: number; url: string }>>()
  for (const image of imageRows) {
    const list = imagesByPost.get(image.postId) || []
    list.push({ id: image.mediaId, url: `/api/media/${image.mediaId}` })
    imagesByPost.set(image.postId, list)
  }
  const commentsByPost = new Map<number, AnyRecord[]>()
  for (const row of commentRows) {
    const list = commentsByPost.get(row.postId) || []
    list.push({
      id: row.id,
      createdAt: row.createdAt,
      content: row.content,
      status: row.status,
      reviewNote: row.reviewNote,
      deletedAt: row.deletedAt,
      deleteType: row.deleteType,
      deleteReason: row.deleteReason,
      purgeAt: row.purgeAt,
      deletedBy: actorView(actorMap, row.deletedBy),
      author: { id: row.authorId, name: row.authorName, username: row.authorUsername }
    })
    commentsByPost.set(row.postId, list)
  }

  return {
    success: true,
    type,
    stats,
    boards,
    comments: [],
    posts: postRows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      content: row.content,
      status: row.status,
      deletedAt: row.deletedAt,
      deleteType: row.deleteType,
      deleteReason: row.deleteReason,
      purgeAt: row.purgeAt,
      deletedBy: actorView(actorMap, row.deletedBy),
      author: { id: row.authorId, name: row.authorName, username: row.authorUsername },
      board: { id: row.boardId, name: row.boardName },
      images: imagesByPost.get(row.id) || [],
      comments: commentsByPost.get(row.id) || []
    }))
  }
})
