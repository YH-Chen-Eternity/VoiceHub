import { asc, sql } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { communityTitles } from '~/drizzle/schema'
import { requireCommunityAdmin } from '~~/server/utils/community'
import {
  COMMUNITY_RESONANCE_LEVELS,
  ensureCommunityTitle
} from '~~/server/utils/communityResonance'

export default defineEventHandler(async (event) => {
  requireCommunityAdmin(event)

  // 共鸣系统称号：即使尚未有人达成，也预先建好，便于管理员查看/了解规则
  for (const level of COMMUNITY_RESONANCE_LEVELS) {
    await ensureCommunityTitle(level.name, level.description)
  }

  const systemNames = new Set(COMMUNITY_RESONANCE_LEVELS.map((level) => level.name))
  const titles = await db
    .select({
      id: communityTitles.id,
      name: communityTitles.name,
      description: communityTitles.description,
      createdAt: communityTitles.createdAt,
      holderCount: sql<number>`(select count(*)::int from "CommunityUserTitle" ut where ut."titleId" = ${communityTitles.id})`
    })
    .from(communityTitles)
    .orderBy(asc(communityTitles.id))

  return {
    success: true,
    titles: titles.map((title) => ({
      ...title,
      // 系统称号由共鸣规则自动授予，不可手动编辑/删除
      system: systemNames.has(title.name),
      threshold:
        COMMUNITY_RESONANCE_LEVELS.find((level) => level.name === title.name)?.threshold ?? null
    }))
  }
})
