import { desc, eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { songs, users, votes } from '~/drizzle/schema'
import { createApiError } from '~~/server/utils/apiError'

// 我的点赞列表 + 可见性设置
export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createApiError(401, 'AUTH_UNAUTHORIZED_ACCESS', '未授权访问')

  const [me] = await db
    .select({ likesVisible: users.likesVisible })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1)

  const rows = await db
    .select({
      songId: songs.id,
      title: songs.title,
      artist: songs.artist,
      played: songs.played,
      votedAt: votes.createdAt
    })
    .from(votes)
    .innerJoin(songs, eq(songs.id, votes.songId))
    .where(eq(votes.userId, user.id))
    .orderBy(desc(votes.createdAt))
    .limit(500)

  return {
    success: true,
    data: {
      likesVisible: me?.likesVisible !== false,
      total: rows.length,
      songs: rows
    }
  }
})
