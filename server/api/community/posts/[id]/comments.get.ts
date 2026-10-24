import { getRouterParam } from 'h3'
import { asc, eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import {
  communityComments,
  communityPosts,
  communityProfiles,
  communityTitles,
  users
} from '~/drizzle/schema'
import { buildCommunityIdentity, requireCommunityUser } from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'

export default defineEventHandler(async (event) => {
  const user = requireCommunityUser(event)
  const postId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(postId) || postId <= 0) {
    throw createApiError(400, 'COMMUNITY_POST_INVALID', '帖子参数不正确')
  }

  const postRow = await db
    .select({ id: communityPosts.id, status: communityPosts.status, authorId: communityPosts.authorId })
    .from(communityPosts)
    .where(eq(communityPosts.id, postId))
    .limit(1)
  const post = postRow[0]
  if (!post) throw createApiError(404, 'COMMUNITY_POST_NOT_FOUND', '帖子不存在')
  if (post.status !== 'APPROVED' && post.authorId !== user.id) {
    throw createApiError(403, 'COMMUNITY_POST_NOT_PUBLIC', '帖子尚未公开')
  }

  const rows = await db
    .select({
      id: communityComments.id,
      createdAt: communityComments.createdAt,
      content: communityComments.content,
      authorId: communityComments.authorId,
      authorName: users.name,
      authorGrade: users.grade,
      authorClass: users.class,
      titleName: communityTitles.name
    })
    .from(communityComments)
    .innerJoin(users, eq(users.id, communityComments.authorId))
    .leftJoin(communityProfiles, eq(communityProfiles.userId, communityComments.authorId))
    .leftJoin(communityTitles, eq(communityTitles.id, communityProfiles.equippedTitleId))
    .where(eq(communityComments.postId, postId))
    .orderBy(asc(communityComments.id))
    .limit(200)

  return {
    success: true,
    comments: rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      content: row.content,
      author: {
        id: row.authorId,
        ...buildCommunityIdentity(
          { name: row.authorName, grade: row.authorGrade, class: row.authorClass },
          row.titleName
        )
      }
    }))
  }
})
