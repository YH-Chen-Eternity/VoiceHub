import { and, asc, eq, gte, lte } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { playTimes, schedules, songs, users } from '~/drizzle/schema'
import { buildCommunityIdentity, requireCommunityUser } from '~~/server/utils/community'
import { getLiveNowPlaying } from '~~/server/utils/nowPlayingLive'
import { getServerDate, getServerTimestamp } from '~~/server/utils/serverTime'
import { formatDateTime, parseToBeijingTime } from '~/utils/timeUtils'

const HOUR_MS = 60 * 60 * 1000
const RANGE_HOURS = 36
const ANONYMOUS_REQUESTER = '匿名同学'

type ScheduleSongRow = {
  scheduleId: number
  playDate: Date
  sequence: number
  schedulePlayed: boolean
  playTimeId: number | null
  songId: number
  title: string
  artist: string
  cover: string | null
  durationSeconds: number | null
  submissionAnonymous: boolean
  songPlayed: boolean
  requesterName: string | null
  requesterGrade: string | null
  requesterClass: string | null
  playTimeName: string | null
  playTimeStart: string | null
  playTimeEnd: string | null
  playTimeEnabled: boolean | null
}

function buildSong(row: {
  songId: number
  title: string
  artist: string
  cover: string | null
  durationSeconds: number | null
  submissionAnonymous: boolean
  requesterName: string | null
  requesterGrade: string | null
  requesterClass: string | null
}) {
  const requesterName = row.submissionAnonymous
    ? ANONYMOUS_REQUESTER
    : row.requesterName
      ? buildCommunityIdentity({
          name: row.requesterName,
          grade: row.requesterGrade,
          class: row.requesterClass
        }).displayName
      : null
  return {
    id: row.songId,
    title: row.title,
    artist: row.artist,
    cover: row.cover || null,
    durationSeconds: row.durationSeconds || null,
    requesterName
  }
}

/** 判断北京时间 HH:mm 是否落在播出时段内；未配置起止视为全天 */
function isWithinPlayTime(startTime: string | null, endTime: string | null, currentHm: string) {
  const start = String(startTime || '').trim()
  const end = String(endTime || '').trim()
  if (start && end) {
    return start <= end
      ? currentHm >= start && currentHm < end
      : currentHm >= start || currentHm < end
  }
  if (start) return currentHm >= start
  if (end) return currentHm < end
  return true
}

function isUnplayed(row: ScheduleSongRow) {
  return !row.schedulePlayed && !row.songPlayed
}

/**
 * 社区侧栏「正在播放」。
 *
 * 数据来源（优先级）：
 * 1. 实时上报：/api/music/state 的内存态（目前只有鸿蒙播控端上报状态，5 分钟内有效）；
 * 2. 排期推断：已发布排期 + 播出时段窗口内的第一首未播放歌曲（无人上报时的兜底）；
 * 3. 都没有时返回 playing:false（并提供今天的下一首排期，便于展示「下一首」）。
 *
 * 数据源异常一律返回 playing:false，不向前端抛错。
 */
export default defineEventHandler(async (event) => {
  requireCommunityUser(event)

  try {
    // 1. 实时上报
    const live = getLiveNowPlaying()
    if (live?.isPlaying) {
      const [songRow] = await db
        .select({
          id: songs.id,
          title: songs.title,
          artist: songs.artist,
          cover: songs.cover,
          durationSeconds: songs.durationSeconds,
          submissionAnonymous: songs.submissionAnonymous,
          requesterName: users.name,
          requesterGrade: users.grade,
          requesterClass: users.class
        })
        .from(songs)
        .leftJoin(users, eq(users.id, songs.requesterId))
        .where(eq(songs.id, live.songId))
        .limit(1)

      if (songRow) {
        return {
          success: true,
          playing: true,
          source: 'live',
          song: buildSong({ ...songRow, songId: songRow.id }),
          scheduleId: null,
          startedAt: new Date(
            live.updatedAt - Math.max(0, Number(live.position) || 0) * 1000
          ).toISOString(),
          positionSeconds: Number(live.position) || 0,
          durationSeconds: Number(live.duration) || songRow.durationSeconds || null,
          next: null
        }
      }
    }

    // 2. 排期推断：取前后 36 小时内的已发布排期，避免跨天边界漏数据
    const serverNow = getServerDate()
    const todayStr = formatDateTime(serverNow, 'YYYY-MM-DD')
    const currentHm = formatDateTime(serverNow, 'HH:mm')
    const rangeStart = new Date(getServerTimestamp() - RANGE_HOURS * HOUR_MS)
    const rangeEnd = new Date(getServerTimestamp() + RANGE_HOURS * HOUR_MS)

    const rows = (await db
      .select({
        scheduleId: schedules.id,
        playDate: schedules.playDate,
        sequence: schedules.sequence,
        schedulePlayed: schedules.played,
        playTimeId: schedules.playTimeId,
        songId: songs.id,
        title: songs.title,
        artist: songs.artist,
        cover: songs.cover,
        durationSeconds: songs.durationSeconds,
        submissionAnonymous: songs.submissionAnonymous,
        songPlayed: songs.played,
        requesterName: users.name,
        requesterGrade: users.grade,
        requesterClass: users.class,
        playTimeName: playTimes.name,
        playTimeStart: playTimes.startTime,
        playTimeEnd: playTimes.endTime,
        playTimeEnabled: playTimes.enabled
      })
      .from(schedules)
      .innerJoin(songs, eq(songs.id, schedules.songId))
      .leftJoin(users, eq(users.id, songs.requesterId))
      .leftJoin(playTimes, eq(playTimes.id, schedules.playTimeId))
      .where(
        and(
          eq(schedules.isDraft, false),
          gte(schedules.playDate, rangeStart),
          lte(schedules.playDate, rangeEnd)
        )
      )
      .orderBy(asc(schedules.playDate), asc(schedules.sequence))) as unknown as ScheduleSongRow[]

    const playTimeRows = await db
      .select({
        id: playTimes.id,
        startTime: playTimes.startTime,
        endTime: playTimes.endTime
      })
      .from(playTimes)
      .where(eq(playTimes.enabled, true))

    const activePlayTimeIds = new Set(
      playTimeRows
        .filter((item) => isWithinPlayTime(item.startTime, item.endTime, currentHm))
        .map((item) => item.id)
    )
    const hasConfiguredPlayTime = playTimeRows.length > 0

    const todayRows = rows.filter((row) => formatDateTime(row.playDate, 'YYYY-MM-DD') === todayStr)
    // 只有配置了播出时段且当前处于时段内，才把当天第一首未播歌曲视为正在播放；
    // 未配置时段时无法判断播出时间，不臆造「正在播放」，只给出「下一首」
    const candidates = hasConfiguredPlayTime
      ? todayRows
          .filter(isUnplayed)
          .filter((row) => !!row.playTimeId && activePlayTimeIds.has(row.playTimeId))
      : []

    const current = candidates[0]
    if (current) {
      const startTimeStr = String(current.playTimeStart || '').trim()
      let startedAt: string | null = null
      if (startTimeStr) {
        try {
          startedAt = parseToBeijingTime(`${todayStr} ${startTimeStr}:00`).toISOString()
        } catch {
          startedAt = null
        }
      }
      return {
        success: true,
        playing: true,
        source: 'schedule',
        song: buildSong(current),
        scheduleId: current.scheduleId,
        startedAt,
        positionSeconds: null,
        durationSeconds: current.durationSeconds || null,
        playTime: current.playTimeId
          ? {
              id: current.playTimeId,
              name: current.playTimeName || '',
              startTime: current.playTimeStart || null,
              endTime: current.playTimeEnd || null
            }
          : null,
        next: null
      }
    }

    // 今天还有未播排期时给「下一首」，否则看后续日期
    const nextRow = rows
      .filter((row) => formatDateTime(row.playDate, 'YYYY-MM-DD') >= todayStr)
      .filter(isUnplayed)[0]
    const next = nextRow
      ? {
          song: buildSong(nextRow),
          scheduleId: nextRow.scheduleId,
          date: formatDateTime(nextRow.playDate, 'YYYY-MM-DD'),
          playTimeName: nextRow.playTimeName || '',
          plannedStartAt: nextRow.playTimeStart
            ? (() => {
                try {
                  return parseToBeijingTime(
                    `${formatDateTime(nextRow.playDate, 'YYYY-MM-DD')} ${String(
                      nextRow.playTimeStart
                    ).trim()}:00`
                  ).toISOString()
                } catch {
                  return null
                }
              })()
            : null
        }
      : null

    return {
      success: true,
      playing: false,
      source: 'schedule',
      song: null,
      scheduleId: null,
      startedAt: null,
      positionSeconds: null,
      durationSeconds: null,
      next
    }
  } catch (error: any) {
    if (error?.statusCode) throw error
    console.error('[community] 正在播放查询失败:', error)
    return {
      success: true,
      playing: false,
      source: 'none',
      song: null,
      scheduleId: null,
      startedAt: null,
      next: null
    }
  }
})
