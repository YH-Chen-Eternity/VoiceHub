import { getRouterParam } from 'h3'
import { readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityPosts } from '~/drizzle/schema'
import { requireCommunityAdmin } from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'
import { writeAdminAudit } from '~~/server/utils/adminAudit'

/** 管理员置顶/取消置顶帖子：POST /api/admin/community/posts/:id/pin，body { pinned: boolean } */
export default defineEventHandler(async (event) => {
  requireCommunityAdmin(event)

  const postId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(postId) || postId <= 0) {
    throw createApiError(400, 'COMMUNITY_POST_INVALID', '帖子参数不正确')
  }
  const body = await readBody(event)
  const pinned = Boolean(body?.pinned)

  const [updated] = await db
    .update(communityPosts)
    .set({ pinned, updatedAt: new Date() })
    .where(eq(communityPosts.id, postId))
    .returning({ id: communityPosts.id, pinned: communityPosts.pinned })

  if (!updated) throw createApiError(404, 'COMMUNITY_POST_NOT_FOUND', '帖子不存在')

  await writeAdminAudit(event, {
    action: pinned ? 'COMMUNITY_POST_PIN' : 'COMMUNITY_POST_UNPIN',
    target: `社区帖子 #${postId}`,
    detail: pinned ? '管理员置顶帖子' : '管理员取消置顶帖子'
  })

  return { success: true, pinned: updated.pinned }
})
