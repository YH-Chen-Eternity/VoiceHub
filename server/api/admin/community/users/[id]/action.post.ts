import { getRouterParam, readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityProfiles, notifications, users } from '~/drizzle/schema'
import {
  ensureCommunityProfile,
  requireCommunityAdmin,
  resolveCommunityBanState
} from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'

export default defineEventHandler(async (event) => {
  requireCommunityAdmin(event)
  const userId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(userId) || userId <= 0) {
    throw createApiError(400, 'COMMUNITY_USER_INVALID', '用户参数不正确')
  }
  const targetRows = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1)
  if (!targetRows[0]) throw createApiError(404, 'USER_NOT_FOUND', '用户不存在')

  await ensureCommunityProfile(userId)
  const body = await readBody(event)
  const action = String(body?.action || '').toLowerCase()
  const reason = String(body?.reason || '').trim().slice(0, 200) || null

  let patch: Record<string, unknown> = { updatedAt: new Date() }
  let message = ''

  if (action === 'reset-violations') {
    patch = {
      ...patch,
      violationCount: 0,
      banned: false,
      bannedUntil: null,
      banReason: null
    }
    message = '违规记录已重置，禁言已解除'
  } else if (action === 'ban') {
    const days = Number(body?.days)
    patch = {
      ...patch,
      banned: true,
      bannedUntil:
        Number.isFinite(days) && days > 0 ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null,
      banReason: reason || '管理员禁言'
    }
    message = Number.isFinite(days) && days > 0 ? `已禁言 ${Math.trunc(days)} 天` : '已永久禁言'
  } else if (action === 'unban') {
    patch = { ...patch, banned: false, bannedUntil: null, banReason: null }
    message = '已解除禁言'
  } else {
    throw createApiError(400, 'COMMUNITY_USER_ACTION_INVALID', '操作不正确')
  }

  const [profile] = await db
    .update(communityProfiles)
    .set(patch)
    .where(eq(communityProfiles.userId, userId))
    .returning()

  if (action === 'ban') {
    await db.insert(notifications).values({
      userId,
      type: 'COMMUNITY_MUTED',
      source: 'COMMUNITY',
      title: '回声社区：账号被禁言',
      message: `${message}${reason ? `。原因：${reason}` : ''}`
    })
  } else if (action === 'unban' || action === 'reset-violations') {
    await db.insert(notifications).values({
      userId,
      type: 'COMMUNITY_UNMUTED',
      source: 'COMMUNITY',
      title: '回声社区：禁言已解除',
      message
    })
  }

  return {
    success: true,
    message,
    profile: {
      violationCount: Number(profile?.violationCount || 0),
      ban: resolveCommunityBanState(profile)
    }
  }
})
