import { db } from '~/drizzle/db'
import { schedules, songBlacklists, songs, votes, requestTimes } from '~/drizzle/schema'
import { eq, sql } from 'drizzle-orm'
import {
  insertSongRejectedNotification,
  dispatchSongRejectedChannels
} from '../../../services/notificationService'

export default defineEventHandler(async (event) => {
  // 检查用户认证和权限
  const user = event.context.user
  if (!user || !['SONG_ADMIN', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throw createError({
      statusCode: 403,
      message: '没有权限访问'
    })
  }

  const body = await readBody(event)

  if (!body.songId) {
    throw createError({
      statusCode: 400,
      message: '歌曲ID不能为空'
    })
  }

  if (!body.reason || !body.reason.trim()) {
    throw createError({
      statusCode: 400,
      message: '驳回原因不能为空'
    })
  }

  try {
    // 使用事务确保驳回操作的原子性
    const result = await db.transaction(async (tx) => {
      // 在事务中重新检查歌曲是否存在
      const songResult = await tx.select().from(songs).where(eq(songs.id, body.songId)).limit(1)
      const song = songResult[0]

      if (!song) {
        throw createError({
          statusCode: 404,
          message: '歌曲不存在或已被删除'
        })
      }

      console.log(`开始驳回歌曲: ${song.title} (ID: ${body.songId})`)

      // 如果选择加入黑名单，先添加到黑名单
      if (body.addToBlacklist) {
        try {
          await tx.insert(songBlacklists).values({
            type: 'SONG',
            value: `${song.title} - ${song.artist}`,
            reason: `歌曲驳回: ${body.reason.trim()}`,
            createdBy: user.id
          })
          console.log(`歌曲已添加到黑名单`)
        } catch (error: any) {
          // 如果黑名单中已存在相同歌曲，忽略错误继续执行
          console.log(`黑名单添加失败，可能已存在: ${error.message}`)
        }
      }

      // 删除歌曲的所有投票
      await tx.delete(votes).where(eq(votes.songId, body.songId))
      console.log(`删除了投票记录`)

      // 删除歌曲的所有排期
      await tx.delete(schedules).where(eq(schedules.songId, body.songId))
      console.log(`删除了排期记录`)

      // 如果有 hitRequestId，减少对应时段的已接纳数量
      if (song.hitRequestId) {
        try {
          await tx
            .update(requestTimes)
            .set({
              accepted: sql`GREATEST(0, accepted - 1)`
            })
            .where(eq(requestTimes.id, song.hitRequestId))
          console.log(`已减少投稿时段 ${song.hitRequestId} 的接纳数量`)
        } catch (error: any) {
          console.error(`减少投稿时段接纳数量失败: ${error.message}`)
        }
      }

      // 删除歌曲
      const deletedSong = await tx.delete(songs).where(eq(songs.id, body.songId)).returning()
      console.log(`歌曲删除完成`)

      // 站内驳回通知与删除同事务落库，保证不丢；邮件/MeoW/AstrBot 在提交后再异步外发
      let notification: {
        userId: number
        created: boolean
        message: string
        title: string
        artist: string
      } | null = null
      if (song.requesterId) {
        const ins = await insertSongRejectedNotification(
          tx,
          song.requesterId,
          { title: song.title, artist: song.artist },
          body.reason.trim()
        )
        notification = {
          userId: song.requesterId,
          created: ins.created,
          message: ins.message,
          title: song.title,
          artist: song.artist
        }
      }

      return {
        success: true,
        deletedSong: deletedSong[0],
        addedToBlacklist: body.addToBlacklist,
        notification
      }
    })

    // 事务提交后异步外发邮件 / MeoW / AstrBot，失败不影响驳回结果
    let notificationSent = false
    if (result.notification && result.notification.created) {
      const n = result.notification
      void dispatchSongRejectedChannels(
        n.userId,
        { title: n.title, artist: n.artist },
        body.reason.trim(),
        n.message
      ).catch((error) => {
        console.error(`驳回通知外发失败: ${error.message}`)
      })

      notificationSent = true
    }

    console.log(`歌曲驳回操作完成: ${body.songId}`)

    const { notification: _notify, ...resultData } = result
    return {
      success: true,
      message: '歌曲驳回成功',
      data: {
        ...resultData,
        notificationSent
      }
    }
  } catch (error: any) {
    console.error('驳回歌曲失败:', error)

    // 如果是我们抛出的错误，直接重新抛出
    if (error.statusCode) {
      throw error
    }

    // 其他错误
    throw createError({
      statusCode: 500,
      message: '驳回歌曲失败: ' + error.message
    })
  }
})
