/**
 * 播放端实时状态缓存。
 *
 * /api/music/state 由客户端（目前是鸿蒙播控端）在播放/切歌时上报，
 * 服务端此前只做 SSE 广播、不保留状态；这里在内存中记录最后一条上报，
 * 供 /api/community/now-playing 读取「正在播放」。
 *
 * 限制：内存状态仅当前实例有效，进程重启或多实例部署时不共享；
 * 上报超过 5 分钟未更新视为过期（播放端每 2 秒上报一次状态）。
 */
import { getServerTimestamp } from './serverTime'

export type LiveNowPlaying = {
  songId: number
  isPlaying: boolean
  position: number
  duration: number
  updatedAt: number
}

const LIVE_TTL_MS = 5 * 60 * 1000

let liveState: LiveNowPlaying | null = null

/** 状态上报：没有歌曲 ID 时保留已知歌曲，只更新进度与播放态 */
export function recordMusicStateUpdate(input: {
  songId?: number | null
  isPlaying: boolean
  position?: number
  duration?: number
}) {
  const now = getServerTimestamp()
  const songId = Number(input.songId)
  const position = Math.max(0, Number(input.position) || 0)
  const duration = Math.max(0, Number(input.duration) || 0)

  if (Number.isInteger(songId) && songId > 0) {
    liveState = {
      songId,
      isPlaying: !!input.isPlaying,
      position,
      duration: duration || (liveState?.songId === songId ? liveState.duration : 0),
      updatedAt: now
    }
    return
  }

  if (liveState) {
    liveState = {
      ...liveState,
      isPlaying: !!input.isPlaying,
      position,
      duration: duration || liveState.duration,
      updatedAt: now
    }
  }
}

/** 切歌上报：以数据库校验后的歌曲元数据为准，位置归零 */
export function recordMusicSongChange(input: { songId?: number | null; duration?: number }) {
  const songId = Number(input.songId)
  if (!Number.isInteger(songId) || songId <= 0) return
  liveState = {
    songId,
    isPlaying: true,
    position: 0,
    duration: Math.max(0, Number(input.duration) || 0),
    updatedAt: getServerTimestamp()
  }
}

/** 读取实时播放状态；过期或从未上报返回 null */
export function getLiveNowPlaying(): LiveNowPlaying | null {
  if (!liveState) return null
  if (getServerTimestamp() - liveState.updatedAt > LIVE_TTL_MS) return null
  return liveState
}
