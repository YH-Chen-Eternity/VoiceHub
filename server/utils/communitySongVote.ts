/**
 * 回声社区「贴内点赞」与 VoiceHub 原生点赞共用同一套资格规则。
 * 帖子里的爱心只是入口，真正写入的是 Vote 表，热度与点歌页完全一致。
 * 发帖选歌不套用这些规则：任何已投稿歌曲都可以附到帖子，只是不一定能点赞。
 */
import { eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { semesters } from '~/drizzle/schema'

export type CommunitySongVoteBlockCode =
  | 'NO_ACTIVE_SEMESTER'
  | 'INACTIVE_SEMESTER'
  | 'PLAYED'
  | 'SCHEDULED'
  | 'SELF'

const BLOCK_REASONS: Record<CommunitySongVoteBlockCode, string> = {
  NO_ACTIVE_SEMESTER: '当前没有进行中的学期，暂时不能点赞',
  INACTIVE_SEMESTER: '该歌曲不属于当前学期，不能点赞',
  PLAYED: '该歌曲已播放，不能点赞',
  SCHEDULED: '该歌曲已排期，不能点赞',
  SELF: '不能给自己投稿的歌曲点赞'
}

export type CommunitySongVoteState = {
  canLike: boolean
  canUnvote: boolean
  likeBlockedCode: CommunitySongVoteBlockCode | null
  likeBlockedReason: string | null
}

type SongVoteFacts = {
  requesterId: number | null
  semester: string | null
  played: boolean
  scheduled: boolean
  likedByMe: boolean
}

export async function getActiveSemesterName(): Promise<string | null> {
  const rows = await db
    .select({ name: semesters.name })
    .from(semesters)
    .where(eq(semesters.isActive, true))
    .limit(1)
  return rows[0]?.name ?? null
}

/** 返回阻断原因；null 表示这首歌在当前状态下可以被该用户点赞 */
export function resolveSongVoteBlockCode(
  facts: Pick<SongVoteFacts, 'requesterId' | 'semester' | 'played' | 'scheduled'>,
  viewerId: number,
  activeSemester: string | null
): CommunitySongVoteBlockCode | null {
  if (!activeSemester) return 'NO_ACTIVE_SEMESTER'
  if (!facts.semester || facts.semester !== activeSemester) return 'INACTIVE_SEMESTER'
  if (facts.played) return 'PLAYED'
  if (facts.scheduled) return 'SCHEDULED'
  if (facts.requesterId != null && Number(facts.requesterId) === Number(viewerId)) return 'SELF'
  return null
}

export function resolveCommunitySongVoteState(
  facts: SongVoteFacts,
  viewerId: number,
  activeSemester: string | null
): CommunitySongVoteState {
  const code = resolveSongVoteBlockCode(facts, viewerId, activeSemester)
  if (code) {
    return {
      canLike: false,
      canUnvote: false,
      likeBlockedCode: code,
      likeBlockedReason: BLOCK_REASONS[code]
    }
  }
  return facts.likedByMe
    ? { canLike: false, canUnvote: true, likeBlockedCode: null, likeBlockedReason: null }
    : { canLike: true, canUnvote: false, likeBlockedCode: null, likeBlockedReason: null }
}
