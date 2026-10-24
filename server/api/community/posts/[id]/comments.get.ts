import { getRouterParam } from 'h3'
import { and, asc, eq, isNull, or } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import {
  communityComments,
  communityPosts,
  communityProfiles,
  communityTitles,
  users
} from '~/drizzle/schema'
import {
  buildCommunityIdentity,
  isCommunityReviewer,
  requireCommunityUser
} from '~~/server/utils/community'
import { createApiError } from '~~/server/utils/apiError'

export default defineEventHandler(async (event) => {
  const user = requireCommunityUser(event)
  const postId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(postId) || postId <= 0) {
    throw createApiError(400, 'COMMUNITY_POST_INVALID', '帖子参数不正确')
  }

  const postRow = await db
    .select({
      id: communityPosts.id,
      status: communityPosts.status,
      authorId: communityPosts.authorId,
      deletedAt: communityPosts.deletedAt
    })
    .from(communityPosts)
    .where(eq(communityPosts.id, postId))
    .limit(1)
  const post = postRow[0]
  if (!post || post.deletedAt) throw createApiError(404, 'COMMUNITY_POST_NOT_FOUND', '帖子不存在')

  const privileged = isCommunityReviewer(user) || post.authorId === user.id
  if (post.status !== 'APPROVED' && !privileged) {
    throw createApiError(403, 'COMMUNITY_POST_NOT_PUBLIC', '帖子尚未公开')
  }

  const visibility = isCommunityReviewer(user)
    ? isNull(communityComments.deletedAt)
    : and(
        isNull(communityComments.deletedAt),
        or(eq(communityComments.status, 'APPROVED'), eq(communityComments.authorId, user.id))
      )

  const rows = await db
    .select({
      id: communityComments.id,
      createdAt: communityComments.createdAt,
      content: communityComments.content,
      status: communityComments.status,
      reviewNote: communityComments.reviewNote,
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
    .where(and(eq(communityComments.postId, postId), visibility))
    .orderBy(asc(communityComments.id))
    .limit(200)

  return {
    success: true,
    comments: rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      content: row.content,
      status: row.status,
      reviewNote: row.reviewNote,
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
