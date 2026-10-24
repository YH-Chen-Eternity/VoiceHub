import { getQuery } from 'h3'
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { schedules, songs } from '~/drizzle/schema'
import { requireCommunityUser } from '~~/server/utils/community'
import {
  getActiveSemesterName,
  resolveCommunitySongVoteState
} from '~~/server/utils/communitySongVote'

export default defineEventHandler(async (event) => {
  const user = requireCommunityUser(event)
  const query = getQuery(event)
  const q = String(query.q || '').trim().slice(0, 50)
  const activeSemester = await getActiveSemesterName()

  const escaped = q.replace(/[\\%_]/g, (char) => `\\${char}`)
  const pattern = `%${escaped}%`
  const conditions = q ? [or(ilike(songs.title, pattern), ilike(songs.artist, pattern))!] : []

  // 选歌不受点赞资格限制：所有已投稿歌曲都可附到帖子，能否点赞由帖子里的爱心单独判定
  const rows = await db
    .select({
      id: songs.id,
      title: songs.title,
      artist: songs.artist,
      cover: songs.cover,
      played: songs.played,
      semester: songs.semester,
      isOwn: sql<boolean>`${songs.requesterId} = ${user.id}`,
      voteCount: sql<number>`(select count(*)::int from "Vote" v where v."songId" = ${songs.id})`,
      likedByMe: sql<boolean>`exists(select 1 from "Vote" v2 where v2."songId" = ${songs.id} and v2."userId" = ${user.id})`
    })
    .from(songs)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(songs.createdAt))
    .limit(20)

  // 单独查已发布排期，避免把排期子查询和歌曲主查询混在一起
  const scheduledRows = rows.length
    ? await db
        .selectDistinct({ songId: schedules.songId })
        .from(schedules)
        .where(
          and(
            inArray(schedules.songId, rows.map((row) => row.id)),
            eq(schedules.isDraft, false)
          )
        )
    : []
  const scheduledIds = new Set(scheduledRows.map((row) => row.songId))

  const songsWithVoteState = rows.map((row) => ({
    ...row,
    scheduled: scheduledIds.has(row.id),
    ...resolveCommunitySongVoteState(
      {
        requesterId: row.isOwn ? user.id : 0,
        semester: row.semester,
        played: row.played,
        scheduled: scheduledIds.has(row.id),
        likedByMe: row.likedByMe
      },
      user.id,
      activeSemester
    )
  }))

  return { success: true, songs: songsWithVoteState, activeSemester }
})
