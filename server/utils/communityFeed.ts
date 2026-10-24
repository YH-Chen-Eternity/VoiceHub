import { asc, desc, eq, inArray, lt, and, sql } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import {
  communityBoards,
  communityPostImages,
  communityPosts,
  communityProfiles,
  communityTitles,
  songs,
  users
} from '~/drizzle/schema'
import { buildCommunityIdentity } from './community'

type LoadOptions = {
  viewerId?: number | null
  postId?: number
  status?: string
  boardId?: number
  boardIds?: number[]
  authorId?: number
  beforeId?: number
  limit?: number
}

export function serializeSong(song: any) {
  if (!song?.songId) return null
  return {
    id: song.songId,
    title: song.songTitle,
    artist: song.songArtist,
    cover: song.songCover ?? null,
    played: !!song.songPlayed,
    voteCount: Number(song.voteCount || 0),
    likedByMe: !!song.likedByMe
  }
}

/** 统一装配帖子（身份脱敏、歌曲、点赞数、评论数、配图） */
export async function loadCommunityPosts(options: LoadOptions) {
  const viewerId = options.viewerId ?? 0
  const conditions: any[] = []
  if (options.postId) conditions.push(eq(communityPosts.id, options.postId))
  if (options.status) conditions.push(eq(communityPosts.status, options.status))
  if (options.boardId) conditions.push(eq(communityPosts.boardId, options.boardId))
  if (options.boardIds) conditions.push(inArray(communityPosts.boardId, options.boardIds))
  if (options.authorId) conditions.push(eq(communityPosts.authorId, options.authorId))
  if (options.beforeId) conditions.push(lt(communityPosts.id, options.beforeId))

  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 50)
  const rows = await db
    .select({
      id: communityPosts.id,
      createdAt: communityPosts.createdAt,
      updatedAt: communityPosts.updatedAt,
      boardId: communityPosts.boardId,
      boardName: communityBoards.name,
      content: communityPosts.content,
      status: communityPosts.status,
      moderationLabel: communityPosts.moderationLabel,
      moderationDetail: communityPosts.moderationDetail,
      reviewNote: communityPosts.reviewNote,
      reviewedAt: communityPosts.reviewedAt,
      authorId: communityPosts.authorId,
      authorName: users.name,
      authorGrade: users.grade,
      authorClass: users.class,
      titleName: communityTitles.name,
      songId: songs.id,
      songTitle: songs.title,
      songArtist: songs.artist,
      songCover: songs.cover,
      songPlayed: songs.played,
      songIdForVote: communityPosts.songId,
      voteCount: sql<number>`(select count(*)::int from "Vote" v where v."songId" = ${communityPosts.songId})`,
      likedByMe: sql<boolean>`exists(select 1 from "Vote" v2 where v2."songId" = ${communityPosts.songId} and v2."userId" = ${viewerId})`,
      commentCount: sql<number>`(select count(*)::int from "CommunityComment" c where c."postId" = ${communityPosts.id})`
    })
    .from(communityPosts)
    .innerJoin(users, eq(users.id, communityPosts.authorId))
    .leftJoin(communityProfiles, eq(communityProfiles.userId, communityPosts.authorId))
    .leftJoin(communityTitles, eq(communityTitles.id, communityProfiles.equippedTitleId))
    .leftJoin(songs, eq(songs.id, communityPosts.songId))
    .leftJoin(communityBoards, eq(communityBoards.id, communityPosts.boardId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(communityPosts.id))
    .limit(limit)

  const ids = rows.map((row) => row.id)
  const imageRows = ids.length
    ? await db
        .select({
          postId: communityPostImages.postId,
          mediaId: communityPostImages.mediaId
        })
        .from(communityPostImages)
        .where(inArray(communityPostImages.postId, ids))
        .orderBy(asc(communityPostImages.sortOrder))
    : []

  const imagesByPost = new Map<number, Array<{ id: number; url: string }>>()
  for (const image of imageRows) {
    const list = imagesByPost.get(image.postId) || []
    list.push({ id: image.mediaId, url: `/api/media/${image.mediaId}` })
    imagesByPost.set(image.postId, list)
  }

  return rows.map((row) => {
    const song = row.songIdForVote
      ? {
          songId: row.songIdForVote,
          songTitle: row.songTitle,
          songArtist: row.songArtist,
          songCover: row.songCover,
          songPlayed: row.songPlayed,
          voteCount: row.voteCount,
          likedByMe: row.likedByMe
        }
      : null
    return {
      id: row.id,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      board: { id: row.boardId, name: row.boardName },
      content: row.content,
      status: row.status,
      author: {
        id: row.authorId,
        ...buildCommunityIdentity(
          { name: row.authorName, grade: row.authorGrade, class: row.authorClass },
          row.titleName
        )
      },
      song: serializeSong(song),
      images: imagesByPost.get(row.id) || [],
      commentCount: Number(row.commentCount || 0),
      moderationLabel: row.moderationLabel || null,
      moderationDetail: row.moderationDetail || null,
      reviewNote: row.reviewNote || null,
      reviewedAt: row.reviewedAt || null
    }
  })
}

export async function getCommunityPostById(postId: number, viewerId?: number | null) {
  const rows = await loadCommunityPosts({ postId, viewerId, limit: 1 })
  return rows[0] || null
}
