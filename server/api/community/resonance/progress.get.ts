import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { songs, users, votes } from '~/drizzle/schema'
import { buildCommunityIdentity, requireCommunityUser } from '~~/server/utils/community'
import { COMMUNITY_RESONANCE_LEVELS, listUserResonance } from '~~/server/utils/communityResonance'

/**
 * 共鸣进度：统计「我点赞过 TA 投稿的歌曲数」与「TA 点赞过我投稿的歌曲数」，
 * 两者各自达到 50 / 100 才能获得对应称号（不是加起来算）。
 */
export default defineEventHandler(async (event) => {
  const user = requireCommunityUser(event)

  const sentRows = await db
    .select({ partnerId: songs.requesterId, count: sql<number>`count(*)::int` })
    .from(votes)
    .innerJoin(songs, eq(songs.id, votes.songId))
    .where(eq(votes.userId, user.id))
    .groupBy(songs.requesterId)

  const receivedRows = await db
    .select({ partnerId: votes.userId, count: sql<number>`count(*)::int` })
    .from(votes)
    .innerJoin(songs, eq(songs.id, votes.songId))
    .where(
      and(
        eq(songs.requesterId, user.id),
        sql`${votes.userId} <> ${user.id}`
      )
    )
    .groupBy(votes.userId)

  const map = new Map<number, { sent: number; received: number }>()
  for (const row of sentRows) {
    if (!row.partnerId || row.partnerId === user.id) continue
    map.set(row.partnerId, { sent: Number(row.count || 0), received: 0 })
  }
  for (const row of receivedRows) {
    if (!row.partnerId) continue
    const entry = map.get(row.partnerId) || { sent: 0, received: 0 }
    entry.received = Number(row.count || 0)
    map.set(row.partnerId, entry)
  }

  const partnerIds = [...map.keys()]
  const partnerRows = partnerIds.length
    ? await db
        .select({
          id: users.id,
          name: users.name,
          grade: users.grade,
          class: users.class
        })
        .from(users)
        .where(inArray(users.id, partnerIds))
    : []
  const partnerById = new Map(partnerRows.map((row) => [row.id, row]))

  const partners = partnerIds
    .map((partnerId) => {
      const entry = map.get(partnerId)!
      const partner = partnerById.get(partnerId)
      if (!partner) return null
      const minCount = Math.min(entry.sent, entry.received)
      const nextLevel = COMMUNITY_RESONANCE_LEVELS.find((level) => minCount < level.threshold)
      const achievedLevels = COMMUNITY_RESONANCE_LEVELS.filter(
        (level) => entry.sent >= level.threshold && entry.received >= level.threshold
      ).map((level) => level.threshold)
      return {
        partner: {
          id: partner.id,
          ...buildCommunityIdentity(
            { name: partner.name, grade: partner.grade, class: partner.class },
            null
          )
        },
        sentCount: entry.sent,
        receivedCount: entry.received,
        minCount,
        achievedLevels,
        nextThreshold: nextLevel?.threshold ?? null,
        gapToNext: nextLevel ? Math.max(0, nextLevel.threshold - minCount) : 0
      }
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.minCount - a.minCount || b.sentCount + b.receivedCount - (a.sentCount + a.receivedCount))
    .slice(0, 10)

  return {
    success: true,
    levels: COMMUNITY_RESONANCE_LEVELS.map((level) => ({
      threshold: level.threshold,
      name: level.name,
      description: level.description
    })),
    achievements: await listUserResonance(user.id),
    partners
  }
})
