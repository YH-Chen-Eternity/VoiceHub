import { getRouterParam } from 'h3'
import { and, eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityBlocks, users } from '~/drizzle/schema'
import {
  isCommunityAdmin,
  requireCommunityEnabled,
  requireCommunityUser
} from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'
import { checkDistributedRateLimit } from '~~/server/utils/rateLimiter'
import { SERVER_ERROR_CODES } from '~~/server/config/constants'
import { getServerDate } from '~~/server/utils/serverTime'

/**
 * 拉黑 / 取消拉黑用户（切换式）。
 * POST /api/community/blocks/:userId
 * 返回: { success, blocked }
 */
export default defineEventHandler(async (event) => {
  const user = requireCommunityUser(event)
  await requireCommunityEnabled()

  const limit = await checkDistributedRateLimit(`community_block:user:${user.id}`, 30, 60 * 1000)
  if (!limit.isAllowed) {
    throw createApiError(
      429,
      SERVER_ERROR_CODES.COMMON_RATE_LIMITED_SECONDS,
      '操作过于频繁，请稍后重试'
    )
  }

  const targetId = Number(getRouterParam(event, 'userId'))
  if (!Number.isInteger(targetId) || targetId <= 0) {
    throw createApiError(400, 'COMMUNITY_BLOCK_TARGET_INVALID', '用户参数不正确')
  }
  if (targetId === user.id) {
    throw createApiError(400, 'COMMUNITY_BLOCK_SELF', '不能拉黑自己')
  }

  const targetRows = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, targetId))
    .limit(1)
  const target = targetRows[0]
  if (!target) {
    throw createApiError(404, 'COMMUNITY_BLOCK_TARGET_NOT_FOUND', '用户不存在')
  }
  if (isCommunityAdmin(target)) {
    throw createApiError(400, 'COMMUNITY_BLOCK_ADMIN_FORBIDDEN', '不能拉黑管理员')
  }

  const existing = await db
    .select({ blockerId: communityBlocks.blockerId })
    .from(communityBlocks)
    .where(and(eq(communityBlocks.blockerId, user.id), eq(communityBlocks.blockedId, targetId)))
    .limit(1)

  if (existing[0]) {
    await db
      .delete(communityBlocks)
      .where(and(eq(communityBlocks.blockerId, user.id), eq(communityBlocks.blockedId, targetId)))
    return { success: true, blocked: false }
  }

  await db
    .insert(communityBlocks)
    .values({ blockerId: user.id, blockedId: targetId, createdAt: getServerDate() })
    .onConflictDoNothing()
  return { success: true, blocked: true }
})
