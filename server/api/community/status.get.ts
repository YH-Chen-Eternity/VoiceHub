import {
  getCommunitySettings,
  isCommunityAdmin,
  isCommunityReviewer,
  requireCommunityUser,
  resolveCommunityBanState,
  toPublicCommunitySettings,
  ensureCommunityProfile
} from '~~/server/utils/community'

export default defineEventHandler(async (event) => {
  const user = requireCommunityUser(event)
  const settings = await getCommunitySettings()
  const profile = await ensureCommunityProfile(user.id)

  return {
    success: true,
    settings: toPublicCommunitySettings(settings),
    viewer: {
      id: user.id,
      canReview: isCommunityReviewer(user),
      isCommunityAdmin: isCommunityAdmin(user),
      ban: resolveCommunityBanState(profile),
      violationCount: profile.violationCount
    }
  }
})
