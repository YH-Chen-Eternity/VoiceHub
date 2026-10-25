import { createError, defineEventHandler, readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { songs } from '~/drizzle/schema'
import { getClientIP } from '~~/server/utils/ip-utils'
import { checkDistributedRateLimit } from '~~/server/utils/rateLimiter'
import { getServerTimestamp } from '~~/server/utils/serverTime'
import { broadcastMusicState, broadcastSongChange } from './websocket'
import { recordMusicSongChange, recordMusicStateUpdate } from '~~/server/utils/nowPlayingLive'

const clampNumber = (value: unknown, min: number, max: number, fallback = 0) => {
  // Number(null) === 0，必须先排除空值，否则音量会被广播成 0
  if (value === null || value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

const optionalInt = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : undefined
}

export default defineEventHandler(async (event) => {
  try {
    const limit = await checkDistributedRateLimit(
      `music_state:${getClientIP(event)}`,
      1200,
      60 * 1000
    )
    if (!limit.isAllowed) {
      throw createError({ statusCode: 429, message: '状态上报过于频繁' })
    }

    const body = await readBody(event)

    // 验证请求数据
    if (!body || typeof body !== 'object') {
      throw createError({
        statusCode: 400,
        message: '无效的请求数据'
      })
    }

    const { type, data } = body

    switch (type) {
      case 'state_update':
        // 音乐状态更新
        if (data && typeof data === 'object') {
          const musicState = {
            songId:
              Number.isInteger(Number(data.songId)) && Number(data.songId) > 0
                ? Number(data.songId)
                : undefined,
            isPlaying: Boolean(data.isPlaying),
            position: clampNumber(data.position, 0, 86400),
            duration: clampNumber(data.duration, 0, 86400),
            volume: clampNumber(data.volume, 0, 1, 1),
            playlistIndex: optionalInt(data.playlistIndex),
            timestamp: getServerTimestamp()
          }

          // 记录最后一条播放状态，供社区「正在播放」卡片读取（内存态，见 nowPlayingLive）
          recordMusicStateUpdate({
            songId: musicState.songId,
            isPlaying: musicState.isPlaying,
            position: musicState.position,
            duration: musicState.duration
          })

          // 广播状态更新
          broadcastMusicState(musicState)

          return {
            success: true,
            message: '音乐状态已更新'
          }
        }
        break

      case 'song_change': {
        // 歌曲切换
        if (!data || typeof data !== 'object') break

        const songId = Number(data.songId)
        if (!Number.isInteger(songId) || songId <= 0) {
          throw createError({ statusCode: 400, message: '无效的歌曲 ID' })
        }

        // 元数据以数据库为准，禁止客户端伪造标题、歌手与封面
        const [song] = await db
          .select({
            id: songs.id,
            title: songs.title,
            artist: songs.artist,
            cover: songs.cover,
            durationSeconds: songs.durationSeconds
          })
          .from(songs)
          .where(eq(songs.id, songId))
          .limit(1)

        if (!song) {
          throw createError({ statusCode: 404, message: '歌曲不存在' })
        }

        const reportedDuration = Number(data.duration)
        // 切歌：先更新内存播放态，再广播
        recordMusicSongChange({
          songId: song.id,
          duration:
            Number.isFinite(reportedDuration) && reportedDuration > 0
              ? clampNumber(reportedDuration, 1, 86400)
              : song.durationSeconds || 0
        })
        broadcastSongChange({
          songId: song.id,
          title: song.title,
          artist: song.artist,
          cover: song.cover || '',
          // 客户端未知时长（0）时回落到数据库时长
          duration:
            Number.isFinite(reportedDuration) && reportedDuration > 0
              ? clampNumber(reportedDuration, 1, 86400)
              : song.durationSeconds || 0,
          playlistIndex: optionalInt(data.playlistIndex),
          timestamp: getServerTimestamp()
        })

        return {
          success: true,
          message: '歌曲切换已广播'
        }
      }

      case 'position_update':
        // 播放位置更新
        if (data && typeof data === 'object') {
          const positionState = {
            songId:
              Number.isInteger(Number(data.songId)) && Number(data.songId) > 0
                ? Number(data.songId)
                : undefined,
            isPlaying: Boolean(data.isPlaying),
            position: clampNumber(data.position, 0, 86400),
            duration: clampNumber(data.duration, 0, 86400),
            volume: clampNumber(data.volume, 0, 1, 1),
            timestamp: getServerTimestamp()
          }

          // 位置更新同样刷新内存播放态
          recordMusicStateUpdate({
            songId: positionState.songId,
            isPlaying: positionState.isPlaying,
            position: positionState.position,
            duration: positionState.duration
          })

          // 广播位置更新
          broadcastMusicState(positionState)

          return {
            success: true,
            message: '播放位置已更新'
          }
        }
        break

      default:
        throw createError({
          statusCode: 400,
          message: '不支持的操作类型'
        })
    }

    throw createError({
      statusCode: 400,
      message: '无效的请求数据'
    })
  } catch (error: any) {
    console.error('Music state update error:', error)

    if (error.statusCode) {
      throw error
    }

    throw createError({
      statusCode: 500,
      message: '服务器内部错误'
    })
  }
})
