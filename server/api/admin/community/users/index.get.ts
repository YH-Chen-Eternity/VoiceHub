import { getQuery } from 'h3'
import { asc, count, eq, ilike, or } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityProfiles, users } from '~/drizzle/schema'
import { requireCommunityAdmin, resolveCommunityBanState } from '~~/server/utils/community'

export default defineEventHandler(async (event) => {
  requireCommunityAdmin(event)
  const query = getQuery(event)
  const q = String(query.q || '').trim().slice(0, 50)
  const page = Math.max(Number(query.page || 1) || 1, 1)
  const limit = Math.min(Math.max(Number(query.limit || 20) || 20, 1), 100)
  const offset = (page - 1) * limit

  const escaped = q.replace(/[\\%_]/g, (char) => `\\${char}`)
  const pattern = `%${escaped}%`
  const where = q
    ? or(
        ilike(users.username, pattern),
        ilike(users.name, pattern),
        ilike(users.grade, pattern),
        ilike(users.class, pattern)
      )
    : undefined

  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      grade: users.grade,
      class: users.class,
      role: users.role,
      status: users.status,
      violationCount: communityProfiles.violationCount,
      banned: communityProfiles.banned,
      bannedUntil: communityProfiles.bannedUntil,
      banReason: communityProfiles.banReason,
      communityJoinedAt: communityProfiles.createdAt
    })
    .from(users)
    .leftJoin(communityProfiles, eq(communityProfiles.userId, users.id))
    .where(where)
    .orderBy(asc(users.id))
    .limit(limit)
    .offset(offset)

  const totalRows = await db.select({ value: count() }).from(users).where(where)

  return {
    success: true,
    page,
    limit,
    total: Number(totalRows[0]?.value || 0),
    users: rows.map((row) => {
      const ban = resolveCommunityBanState(row)
      return {
        id: row.id,
        username: row.username,
        name: row.name,
        grade: row.grade,
        class: row.class,
        role: row.role,
        status: row.status,
        violationCount: Number(row.violationCount || 0),
        ban,
        communityJoinedAt: row.communityJoinedAt
      }
    })
  }
})
