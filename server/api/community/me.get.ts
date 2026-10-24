import { and, count, eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import {
  communityComments,
  communityPosts,
  communityTitles,
  communityUserTitles,
  songs,
  users
} from '~/drizzle/schema'
import {
  buildCommunityIdentity,
  ensureCommunityProfile,
  getCommunitySettings,
  isCommunityAdmin,
  isCommunityReviewer,
  requireCommunityUser,
  resolveCommunityBanState,
  toPublicCommunitySettings
} from '~~/server/utils/community'

export default defineEventHandler(async (event) => {
  const user = requireCommunityUser(event)
  const settings = await getCommunitySettings()
  const profile = await ensureCommunityProfile(user.id)

  const userRows = await db
    .select({
      id: users.id,
      name: users.name,
      grade: users.grade,
      class: users.class,
      likesVisible: users.likesVisible
    })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1)
  const me = userRows[0]

  const titles = await db
    .select({
      id: communityTitles.id,
      name: communityTitles.name,
      description: communityTitles.description
    })
    .from(communityUserTitles)
    .innerJoin(communityTitles, eq(communityTitles.id, communityUserTitles.titleId))
    .where(eq(communityUserTitles.userId, user.id))

  let favoriteSong = null
  if (profile.favoriteSongId) {
    const rows = await db
      .select({
        id: songs.id,
        title: songs.title,
        artist: songs.artist,
        cover: songs.cover,
        played: songs.played
      })
      .from(songs)
      .where(eq(songs.id, profile.favoriteSongId))
      .limit(1)
    favoriteSong = rows[0] || null
  }

  const postCount = await db
    .select({ value: count() })
    .from(communityPosts)
    .where(and(eq(communityPosts.authorId, user.id), eq(communityPosts.status, 'APPROVED')))
  const commentCount = await db
    .select({ value: count() })
    .from(communityComments)
    .where(eq(communityComments.authorId, user.id))

  return {
    success: true,
    settings: toPublicCommunitySettings(settings),
    user: me ? { id: me.id, ...buildCommunityIdentity(me) } : null,
    profile: {
      favoriteSongId: profile.favoriteSongId,
      showFavorite: profile.showFavorite,
      showLikedSongs: profile.showLikedSongs,
      equippedTitleId: profile.equippedTitleId,
      violationCount: profile.violationCount
    },
    privacy: {
      showFavorite: profile.showFavorite,
      showLikedSongs: profile.showLikedSongs,
      likesVisible: me?.likesVisible ?? true
    },
    favoriteSong,
    titles,
    ban: resolveCommunityBanState(profile),
    stats: {
      posts: Number(postCount[0]?.value || 0),
      comments: Number(commentCount[0]?.value || 0)
    },
    permissions: {
      canReview: isCommunityReviewer(user),
      isCommunityAdmin: isCommunityAdmin(user)
    }
  }
})
