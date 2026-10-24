import {
  getCommunitySettings,
  getReviewableBoardIds,
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
  const reviewBoardIds = await getReviewableBoardIds(user)

  return {
    success: true,
    settings: toPublicCommunitySettings(settings),
    viewer: {
      id: user.id,
      canReview:
        isCommunityReviewer(user) &&
        (isCommunityAdmin(user) || (reviewBoardIds?.length ?? 0) > 0),
      isCommunityAdmin: isCommunityAdmin(user),
      reviewBoardIds,
      ban: resolveCommunityBanState(profile),
      violationCount: profile.violationCount
    }
  }
})
