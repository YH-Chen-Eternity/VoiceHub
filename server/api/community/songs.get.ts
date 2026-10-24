import { getQuery } from 'h3'
import { desc, ilike, or } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { songs } from '~/drizzle/schema'
import { requireCommunityUser } from '~~/server/utils/community'

export default defineEventHandler(async (event) => {
  requireCommunityUser(event)
  const query = getQuery(event)
  const q = String(query.q || '').trim().slice(0, 50)
  const escaped = q.replace(/[\\%_]/g, (char) => `\\${char}`)
  const pattern = `%${escaped}%`

  const rows = await db
    .select({
      id: songs.id,
      title: songs.title,
      artist: songs.artist,
      cover: songs.cover,
      played: songs.played,
      semester: songs.semester
    })
    .from(songs)
    .where(q ? or(ilike(songs.title, pattern), ilike(songs.artist, pattern)) : undefined)
    .orderBy(desc(songs.createdAt))
    .limit(20)

  return { success: true, songs: rows }
})
