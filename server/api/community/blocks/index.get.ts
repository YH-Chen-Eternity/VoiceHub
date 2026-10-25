import { desc, eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityBlocks, users } from '~/drizzle/schema'
import {
  buildCommunityIdentity,
  requireCommunityEnabled,
  requireCommunityUser
} from '~~/server/utils/community'
import { formatDateTime } from '~/utils/timeUtils'

/**
 * 我拉黑的用户列表。
 * GET /api/community/blocks
 * 返回: { success, blocks: [{ id, displayName, maskedName, className, username, blockedAtText }] }
 */
export default defineEventHandler(async (event) => {
  const user = requireCommunityUser(event)
  await requireCommunityEnabled()

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      username: users.username,
      grade: users.grade,
      class: users.class,
      createdAt: communityBlocks.createdAt
    })
    .from(communityBlocks)
    .innerJoin(users, eq(users.id, communityBlocks.blockedId))
    .where(eq(communityBlocks.blockerId, user.id))
    .orderBy(desc(communityBlocks.createdAt))

  return {
    success: true,
    blocks: rows.map((row) => {
      const identity = buildCommunityIdentity(row)
      return {
        id: row.id,
        displayName: identity.displayName,
        maskedName: identity.maskedName,
        className: identity.className,
        username: row.username || null,
        blockedAtText: row.createdAt ? formatDateTime(row.createdAt) : null
      }
    })
  }
})
