/* Modified by YH-Chen-Eternity on 2026-10-23 */

import { db } from '~/drizzle/db'
import { createSongPlayedNotifications } from '~~/server/services/notificationService'
import { songs, songReplayRequests, schedules } from '~/drizzle/schema'
import { eq, and, inArray, lte, sql } from 'drizzle-orm'
import { getBeijingTime, getBeijingEndOfDay } from '~/utils/timeUtils'
import { getClientIP } from '~~/server/utils/ip-utils'
import { restoreReplayRequestsToPending } from '~~/server/utils/scheduleReplayBinding'
import { enqueueAstrbotGroupEvent } from '~~/server/services/astrbotGroupService'
import { z } from 'zod'

const markPlayedSchema = z.object({
  songId: z.number().optional(),
  songIds: z.array(z.number()).max(100, '批量操作单次最多支持 100 首歌曲').optional(),
  unmark: z.boolean().optional()
})

export default defineEventHandler(async (event) => {
  // 检查用户认证
  const user = event.context.user

  if (!user) {
    throw createError({
      statusCode: 401,
      message: '需要登录才能标记歌曲'
    })
  }

  // 检查是否是管理员
  if (!['ADMIN', 'SUPER_ADMIN', 'SONG_ADMIN'].includes(user.role)) {
    throw createError({
      statusCode: 403,
      message: '只有管理员可以标记歌曲为已播放'
    })
  }

  const body = await readBody(event)
  const validatedDataResult = markPlayedSchema.safeParse(body)

  if (!validatedDataResult.success) {
    throw createError({
      statusCode: 400,
      message: validatedDataResult.error.issues[0]?.message || '请求参数无效'
    })
  }

  const validatedData = validatedDataResult.data

  const songIds = Array.from(
    new Set([
      ...(validatedData.songId !== undefined ? [validatedData.songId] : []),
      ...(validatedData.songIds || [])
    ])
  )

  if (songIds.length === 0) {
    throw createError({
      statusCode: 400,
      message: '歌曲ID列表不能为空'
    })
  }

  // 撤回已播放
  const isUnmark = validatedData.unmark === true

  // 广播站（SONG_ADMIN）只能标记「今天及以前」排期的歌曲：
  // 排期在明天及以后的歌曲须等到当天才能标播放，避免提前把未播出场次标成已播。
  // ADMIN / SUPER_ADMIN 不受此限制（可修正误排期）。
  let allowedSongIds = songIds
  let skippedBySchedule = 0
  if (!isUnmark && user.role === 'SONG_ADMIN') {
    const earliestSchedules = await db
      .select({
        songId: schedules.songId,
        firstPlayDate: sql<Date | string | null>`min(${schedules.playDate})`
      })
      .from(schedules)
      .where(and(inArray(schedules.songId, songIds), eq(schedules.isDraft, false)))
      .groupBy(schedules.songId)

    const endOfToday = getBeijingEndOfDay().getTime()
    const futureSongIds = new Set(
      earliestSchedules
        .filter((row) => {
          if (!row.firstPlayDate) return false
          const playTime = new Date(row.firstPlayDate).getTime()
          return Number.isFinite(playTime) && playTime > endOfToday
        })
        .map((row) => row.songId)
    )

    if (futureSongIds.size > 0) {
      allowedSongIds = songIds.filter((id) => !futureSongIds.has(id))
      skippedBySchedule = songIds.length - allowedSongIds.length

      if (allowedSongIds.length === 0) {
        throw createError({
          statusCode: 400,
          message: '广播站只能标记今天及以前排期的歌曲，所选歌曲的排期尚未到播放日期'
        })
      }
    }
  }

  // 过滤需要更新的歌曲
  const condition = !isUnmark
    ? and(inArray(songs.id, allowedSongIds), eq(songs.played, false))
    : and(inArray(songs.id, allowedSongIds), eq(songs.played, true))

  const { updatedSongsResult, updatedSongIds } = await db.transaction(async (tx) => {
    const updatedSongsResult = await tx
      .update(songs)
      .set({
        played: !isUnmark,
        playedAt: isUnmark ? null : getBeijingTime()
      })
      .where(condition)
      .returning({ id: songs.id })

    const updatedSongIds = updatedSongsResult.map((s) => s.id)

    if (updatedSongIds.length > 0) {
      if (!isUnmark) {
        // 标记已播放：履行全部待处理的重播申请
        const updatedRequests = await tx
          .update(songReplayRequests)
          .set({
            status: 'FULFILLED',
            updatedAt: new Date()
          })
          .where(
            and(
              inArray(songReplayRequests.songId, updatedSongIds),
              eq(songReplayRequests.status, 'PENDING')
            )
          )
          .returning({ id: songReplayRequests.id })

        if (updatedRequests.length > 0) {
          console.log(`将 ${updatedRequests.length} 个重播申请状态更新为 FULFILLED（歌曲已播放）`)
        }
      } else {
        // 撤回已播放：每人仅恢复最新一条，避免违反部分唯一索引
        const restoredCount = await restoreReplayRequestsToPending({
          tx,
          songIds: updatedSongIds,
          at: new Date()
        })

        if (restoredCount > 0) {
          console.log(`将 ${restoredCount} 个重播申请状态恢复为 PENDING（撤回已播放）`)
        }
      }
    }

    return { updatedSongsResult, updatedSongIds }
  })

  // 异步发送通知（同一用户多首歌曲合并为一条）
  if (!isUnmark && updatedSongIds.length > 0) {
    event.waitUntil(
      createSongPlayedNotifications(updatedSongIds).catch((err) => {
        console.error('发送歌曲已播放通知失败:', err)
      })
    )
    // 群聊推送：歌曲已播放（默认关闭，噪音较大，按需在后台开启）。
    // 批量标播放时逐首发一条，但同群同事件的合并窗口会把它们并成一条消息。
    event.waitUntil((async () => {
      try {
        const played = await db.select({ title: songs.title, artist: songs.artist })
          .from(songs).where(inArray(songs.id, updatedSongIds))
        for (const song of played) {
          await enqueueAstrbotGroupEvent('songPlayed', '歌曲已播放', `《${song.title}》- ${song.artist} 已播放`)
        }
      } catch (err: any) {
        console.error('发送群聊已播放通知失败:', err)
      }
    })())
  }

  const baseMessage = isUnmark ? '歌曲已成功撤回已播放状态' : '歌曲已成功标记为已播放'

  return {
    message:
      skippedBySchedule > 0
        ? `${baseMessage}；另有 ${skippedBySchedule} 首歌曲排期在今天之后已跳过（广播站只能标记今天及以前排期的歌曲）`
        : baseMessage,
    count: updatedSongsResult.length,
    skipped: skippedBySchedule,
    updatedSongIds: updatedSongIds
  }
})
