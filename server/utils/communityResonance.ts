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
    description: '互相点赞对方投稿的歌曲各 50 首'
  },
  {
    threshold: 100,
    name: '70亿个灵魂都在找同个永恒',
    description: '互相点赞对方投稿的歌曲各 100 首'
  }
] as const

type ResonanceLevel = (typeof COMMUNITY_RESONANCE_LEVELS)[number]

type ResonanceSong = { id: number; title: string; artist: string }

type DirectionalSongs = {
  /** 我点赞对方投稿的歌曲 */
  sent: ResonanceSong[]
  /** 对方点赞我投稿的歌曲 */
  received: ResonanceSong[]
}

type PartnerRow = {
  partnerId: number
  sentCount: number
  receivedCount: number
  mutualCount: number
  firstAt: Date | string
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

function mapSongs(rows: unknown): ResonanceSong[] {
  return (rows as Array<{ id: number; title: string; artist: string }>).map((row) => ({
    id: Number(row.id),
    title: String(row.title || ''),
    artist: String(row.artist || '')
  }))
}

async function listDirectionalSongs(userId: number, partnerId: number): Promise<DirectionalSongs> {
  const sentRows = await db.execute(sql`
    SELECT s."id" AS "id", s."title" AS "title", s."artist" AS "artist"
    FROM "Vote" v
    JOIN "Song" s ON s."id" = v."songId"
    WHERE v."userId" = ${userId}
      AND s."requesterId" = ${partnerId}
      AND s."requesterId" <> ${userId}
    ORDER BY s."title" ASC, s."id" ASC
  `)

  const receivedRows = await db.execute(sql`
    SELECT s."id" AS "id", s."title" AS "title", s."artist" AS "artist"
    FROM "Vote" v
    JOIN "Song" s ON s."id" = v."songId"
    WHERE v."userId" = ${partnerId}
      AND s."requesterId" = ${userId}
      AND v."userId" <> ${userId}
    ORDER BY s."title" ASC, s."id" ASC
  `)

  return { sent: mapSongs(sentRows), received: mapSongs(receivedRows) }
}

/**
 * 找出与当前用户形成“双向投稿互赞”的伙伴。
 * sentCount = 我点赞对方投稿的歌数，receivedCount = 对方点赞我投稿的歌数。
 * firstAt 取两个方向第一次都出现点赞的时间，用于确定首位伙伴。
 */
async function listPartners(userId: number): Promise<PartnerRow[]> {
  const rows = await db.execute(sql`
    WITH sent AS (
      SELECT s."requesterId" AS partner_id,
             count(*)::int AS sent_count,
             min(v."createdAt") AS first_sent
      FROM "Vote" v
      JOIN "Song" s ON s."id" = v."songId"
      WHERE v."userId" = ${userId}
        AND s."requesterId" IS NOT NULL
        AND s."requesterId" <> ${userId}
      GROUP BY s."requesterId"
    ),
    received AS (
      SELECT v."userId" AS partner_id,
             count(*)::int AS received_count,
             min(v."createdAt") AS first_received
      FROM "Vote" v
      JOIN "Song" s ON s."id" = v."songId"
      WHERE s."requesterId" = ${userId}
        AND v."userId" <> ${userId}
      GROUP BY v."userId"
    )
    SELECT COALESCE(sent.partner_id, received.partner_id) AS "partnerId",
           COALESCE(sent.sent_count, 0)::int AS "sentCount",
           COALESCE(received.received_count, 0)::int AS "receivedCount",
           LEAST(COALESCE(sent.sent_count, 0), COALESCE(received.received_count, 0))::int AS "mutualCount",
           GREATEST(
             COALESCE(sent.first_sent, received.first_received),
             COALESCE(received.first_received, sent.first_sent)
           ) AS "firstAt"
    FROM sent
    FULL OUTER JOIN received ON received.partner_id = sent.partner_id
    WHERE COALESCE(sent.sent_count, 0) > 0
      AND COALESCE(received.received_count, 0) > 0
    ORDER BY "firstAt" ASC NULLS LAST, "partnerId" ASC
  `)

  return (
    rows as unknown as Array<{
      partnerId: number
      sentCount: number
      receivedCount: number
      mutualCount: number
      firstAt: string
    }>
  ).map((row) => ({
    partnerId: Number(row.partnerId),
    sentCount: Number(row.sentCount),
    receivedCount: Number(row.receivedCount),
    mutualCount: Number(row.mutualCount),
    firstAt: row.firstAt
  }))
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
    // 仅允许低档「共鸣」升级到高档；用户主动佩戴了其他称号时不覆盖。
    if (level.threshold !== 100) return
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
  sentCount: number
  receivedCount: number
  songs: DirectionalSongs
  achievedAt: Date
}) {
  const partner = await getCommunityUserIdentity(params.partnerId)
  const partnerName = partner?.displayName || '一位同学'
  const mutualCount = Math.min(params.sentCount, params.receivedCount)
  const preview = [
    ...params.songs.sent.slice(0, 5).map((song) => `你点赞《${song.title}》`),
    ...params.songs.received.slice(0, 5).map((song) => `TA 点赞《${song.title}》`)
  ].join('、')

  await db.insert(notifications).values({
    userId: params.userId,
    type: 'COMMUNITY_RESONANCE',
    source: 'COMMUNITY',
    title: `回声社区：获得「${params.level.name}」称号`,
    message: `你点赞了${partnerName}投稿的 ${params.sentCount} 首，${partnerName}点赞了你投稿的 ${params.receivedCount} 首，获得称号「${params.level.name}」。${preview ? `${preview}等。` : ''}该记录仅你本人可见。`
  })

  await sendAccountEmail(params.userId, 'community.resonance.awarded', {
    titleName: params.level.name,
    partnerName,
    sentCount: params.sentCount,
    receivedCount: params.receivedCount,
    mutualCount,
    sentSongList: params.songs.sent.map((song) => `${song.title} - ${song.artist}`).join('\n'),
    receivedSongList: params.songs.received.map((song) => `${song.title} - ${song.artist}`).join('\n'),
    achievedAt: params.achievedAt.toLocaleString('zh-CN', { hour12: false })
  }).catch(() => {})
}

/**
 * 为某一对用户授予共鸣称号。
 * 每个用户在每个阈值上只保留第一位伙伴；已存在记录的一侧不会重复授予。
 */
async function awardPair(
  userId: number,
  partnerId: number,
  level: ResonanceLevel,
  sentCount: number,
  receivedCount: number,
  songs: DirectionalSongs,
  titleId: number
) {
  const now = new Date()
  const mutualCount = Math.min(sentCount, receivedCount)

  const sides = [
    {
      ownerId: userId,
      otherId: partnerId,
      sentCount,
      receivedCount,
      sentSongs: songs.sent,
      receivedSongs: songs.received
    },
    {
      ownerId: partnerId,
      otherId: userId,
      sentCount: receivedCount,
      receivedCount: sentCount,
      sentSongs: songs.received,
      receivedSongs: songs.sent
    }
  ]

  for (const side of sides) {
    const [inserted] = await db
      .insert(communityResonance)
      .values({
        userId: side.ownerId,
        partnerId: side.otherId,
        titleId,
        threshold: level.threshold,
        sentCount: side.sentCount,
        receivedCount: side.receivedCount,
        mutualCount,
        songsSnapshot: JSON.stringify({
          sent: side.sentSongs,
          received: side.receivedSongs
        })
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
      sentCount: side.sentCount,
      receivedCount: side.receivedCount,
      songs: { sent: side.sentSongs, received: side.receivedSongs },
      achievedAt: now
    })
  }
}

/**
 * 投票后评估：只有两个方向都达到阈值才授予。
 * 50 首 -> 共鸣；100 首 -> 70亿个灵魂都在找同个永恒。
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

    const candidate = partners.find(
      (partner) =>
        partner.sentCount >= level.threshold && partner.receivedCount >= level.threshold
    )
    if (!candidate) continue

    let titleId = titleCache.get(level.threshold)
    if (!titleId) {
      titleId = await ensureCommunityTitle(level.name, level.description)
      titleCache.set(level.threshold, titleId)
    }

    const songs = await listDirectionalSongs(userId, candidate.partnerId)
    await awardPair(
      userId,
      candidate.partnerId,
      level,
      candidate.sentCount,
      candidate.receivedCount,
      songs,
      titleId
    )
  }
}

/** 当前用户可见的共鸣记录（仅本人） */
export async function listUserResonance(userId: number) {
  const rows = await db
    .select({
      id: communityResonance.id,
      createdAt: communityResonance.createdAt,
      threshold: communityResonance.threshold,
      sentCount: communityResonance.sentCount,
      receivedCount: communityResonance.receivedCount,
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
    let sent: ResonanceSong[] = []
    let received: ResonanceSong[] = []
    let legacy = false
    try {
      const parsed = JSON.parse(row.songsSnapshot)
      if (Array.isArray(parsed)) {
        // 旧版记录：只有共同点赞歌曲数组
        sent = mapSongs(parsed)
        legacy = true
      } else if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.sent)) sent = mapSongs(parsed.sent)
        if (Array.isArray(parsed.received)) received = mapSongs(parsed.received)
      }
    } catch {
      sent = []
      received = []
    }
    return {
      id: row.id,
      createdAt: row.createdAt,
      threshold: row.threshold,
      sentCount: Number(row.sentCount || 0),
      receivedCount: Number(row.receivedCount || 0),
      mutualCount: row.mutualCount,
      legacy,
      titleName: row.titleName || '',
      partner: {
        id: row.partnerId,
        ...buildCommunityIdentity(
          { name: row.partnerName, grade: row.partnerGrade, class: row.partnerClass },
          null
        )
      },
      songsSent: sent,
      songsReceived: received,
      songs: [...sent, ...received]
    }
  })
}
