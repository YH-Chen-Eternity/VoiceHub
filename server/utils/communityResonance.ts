import { and, eq, sql } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import {
  communityProfiles,
  communityResonance,
  communityTitles,
  communityUserTitles,
  notifications,
  users
} from '~/drizzle/schema'
import { sendAccountEmail } from './accountNotifications'
import {
  buildCommunityIdentity,
  ensureCommunityProfile,
  getCommunityUserIdentity
} from './community'

export const COMMUNITY_RESONANCE_LEVELS = [
  {
    threshold: 50,
    name: '共鸣',
    description: '与同一位同学相互点赞 50 首歌曲'
  },
  {
    threshold: 200,
    name: '70亿人中寻找永恒',
    description: '与同一位同学相互点赞 200 首歌曲'
  }
] as const

type ResonanceLevel = (typeof COMMUNITY_RESONANCE_LEVELS)[number]

type MutualSong = { id: number; title: string; artist: string }

type PartnerRow = {
  partnerId: number
  mutualCount: number
  firstMutualAt: Date | string
}

async function ensureCommunityTitle(name: string, description: string): Promise<number> {
  await db.insert(communityTitles).values({ name, description }).onConflictDoNothing()
  const [row] = await db
    .select({ id: communityTitles.id })
    .from(communityTitles)
    .where(eq(communityTitles.name, name))
    .limit(1)
  return row!.id
}

async function listMutualSongs(userId: number, partnerId: number): Promise<MutualSong[]> {
  const rows = await db.execute(sql`
    SELECT s."id" AS "id", s."title" AS "title", s."artist" AS "artist"
    FROM "Vote" mine
    JOIN "Vote" theirs ON theirs."songId" = mine."songId" AND theirs."userId" = ${partnerId}
    JOIN "Song" s ON s."id" = mine."songId"
    WHERE mine."userId" = ${userId}
    ORDER BY s."title" ASC, s."id" ASC
  `)
  return (rows as unknown as Array<{ id: number; title: string; artist: string }>).map((row) => ({
    id: Number(row.id),
    title: String(row.title || ''),
    artist: String(row.artist || '')
  }))
}

async function listPartners(userId: number): Promise<PartnerRow[]> {
  const rows = await db.execute(sql`
    SELECT v."userId" AS "partnerId",
           count(*)::int AS "mutualCount",
           min(GREATEST(mine."createdAt", v."createdAt")) AS "firstMutualAt"
    FROM "Vote" mine
    JOIN "Vote" v ON v."songId" = mine."songId" AND v."userId" <> ${userId}
    WHERE mine."userId" = ${userId}
    GROUP BY v."userId"
    ORDER BY "firstMutualAt" ASC, v."userId" ASC
  `)
  return (rows as unknown as Array<{ partnerId: number; mutualCount: number; firstMutualAt: string }>).map(
    (row) => ({
      partnerId: Number(row.partnerId),
      mutualCount: Number(row.mutualCount),
      firstMutualAt: row.firstMutualAt
    })
  )
}

async function equipResonanceTitle(userId: number, titleId: number, level: ResonanceLevel) {
  await ensureCommunityProfile(userId)
  const [profile] = await db
    .select({ equippedTitleId: communityProfiles.equippedTitleId })
    .from(communityProfiles)
    .where(eq(communityProfiles.userId, userId))
    .limit(1)
  if (!profile) return
  if (profile.equippedTitleId) {
    if (level.threshold !== 200) return
    const lower = COMMUNITY_RESONANCE_LEVELS.find((item) => item.threshold === 50)!
    const lowerTitleId = await ensureCommunityTitle(lower.name, lower.description)
    if (profile.equippedTitleId !== lowerTitleId) return
  }
  await db
    .update(communityProfiles)
    .set({ equippedTitleId: titleId, updatedAt: new Date() })
    .where(eq(communityProfiles.userId, userId))
}

async function notifyResonance(params: {
  userId: number
  partnerId: number
  level: ResonanceLevel
  titleId: number
  mutualCount: number
  songs: MutualSong[]
  achievedAt: Date
}) {
  const partner = await getCommunityUserIdentity(params.partnerId)
  const partnerName = partner?.displayName || '一位同学'
  const songNames = params.songs.map((song) => `《${song.title}》`)
  const preview = songNames.slice(0, 10).join('、')
  const more = songNames.length > 10 ? ` 等 ${songNames.length} 首` : ''

  await db.insert(notifications).values({
    userId: params.userId,
    type: 'COMMUNITY_RESONANCE',
    source: 'COMMUNITY',
    title: `回声社区：获得「${params.level.name}」称号`,
    message: `你与${partnerName}相互点赞的歌曲达到 ${params.mutualCount} 首，获得称号「${params.level.name}」。共同喜欢的歌：${preview}${more}。该记录仅你本人可见。`
  })

  await sendAccountEmail(params.userId, 'community.resonance.awarded', {
    titleName: params.level.name,
    partnerName,
    mutualCount: params.mutualCount,
    songList: params.songs.map((song) => `${song.title} - ${song.artist}`).join('\n'),
    achievedAt: params.achievedAt.toLocaleString('zh-CN', { hour12: false })
  }).catch(() => {})
}

/**
 * 为某一对用户授予共鸣称号。
 * 每个用户在每个阈值上只保留第一位达成伙伴：已存在记录的一侧不会重复授予。
 */
async function awardPair(
  userId: number,
  partnerId: number,
  level: ResonanceLevel,
  mutualCount: number,
  songs: MutualSong[],
  titleId: number
) {
  const now = new Date()
  const snapshot = JSON.stringify(songs)

  const sides = [
    { ownerId: userId, otherId: partnerId },
    { ownerId: partnerId, otherId: userId }
  ]

  for (const side of sides) {
    const [inserted] = await db
      .insert(communityResonance)
      .values({
        userId: side.ownerId,
        partnerId: side.otherId,
        titleId,
        threshold: level.threshold,
        mutualCount,
        songsSnapshot: snapshot
      })
      .onConflictDoNothing()
      .returning({ id: communityResonance.id })
    if (!inserted) continue

    await db
      .insert(communityUserTitles)
      .values({ userId: side.ownerId, titleId, grantedBy: null })
      .onConflictDoNothing()
    await equipResonanceTitle(side.ownerId, titleId, level)
    await notifyResonance({
      userId: side.ownerId,
      partnerId: side.otherId,
      level,
      titleId,
      mutualCount,
      songs,
      achievedAt: now
    })
  }
}

/**
 * 投票后评估：找出与当前用户共同点赞数首次达到 50 / 200 的第一位伙伴。
 * 任何异常都不应影响投票主流程。
 */
export async function evaluateCommunityResonance(userId: number): Promise<void> {
  const partners = await listPartners(userId)
  if (!partners.length) return

  const titleCache = new Map<number, number>()
  for (const level of COMMUNITY_RESONANCE_LEVELS) {
    const existing = await db
      .select({ id: communityResonance.id })
      .from(communityResonance)
      .where(
        and(
          eq(communityResonance.userId, userId),
          eq(communityResonance.threshold, level.threshold)
        )
      )
      .limit(1)
    if (existing[0]) continue

    const candidate = partners.find((partner) => partner.mutualCount >= level.threshold)
    if (!candidate) continue

    let titleId = titleCache.get(level.threshold)
    if (!titleId) {
      titleId = await ensureCommunityTitle(level.name, level.description)
      titleCache.set(level.threshold, titleId)
    }

    const songs = await listMutualSongs(userId, candidate.partnerId)
    await awardPair(userId, candidate.partnerId, level, candidate.mutualCount, songs, titleId)
  }
}

/** 当前用户可见的共鸣记录（仅本人） */
export async function listUserResonance(userId: number) {
  const rows = await db
    .select({
      id: communityResonance.id,
      createdAt: communityResonance.createdAt,
      threshold: communityResonance.threshold,
      mutualCount: communityResonance.mutualCount,
      songsSnapshot: communityResonance.songsSnapshot,
      titleName: communityTitles.name,
      partnerId: communityResonance.partnerId,
      partnerName: users.name,
      partnerGrade: users.grade,
      partnerClass: users.class
    })
    .from(communityResonance)
    .leftJoin(communityTitles, eq(communityTitles.id, communityResonance.titleId))
    .innerJoin(users, eq(users.id, communityResonance.partnerId))
    .where(eq(communityResonance.userId, userId))
    .orderBy(communityResonance.threshold)

  return rows.map((row) => {
    let songs: MutualSong[] = []
    try {
      const parsed = JSON.parse(row.songsSnapshot)
      if (Array.isArray(parsed)) songs = parsed
    } catch {
      songs = []
    }
    return {
      id: row.id,
      createdAt: row.createdAt,
      threshold: row.threshold,
      mutualCount: row.mutualCount,
      titleName: row.titleName || '',
      partner: {
        id: row.partnerId,
        ...buildCommunityIdentity(
          { name: row.partnerName, grade: row.partnerGrade, class: row.partnerClass },
          null
        )
      },
      songs
    }
  })
}
