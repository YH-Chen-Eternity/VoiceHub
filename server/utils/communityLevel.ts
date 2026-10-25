/**
 * 社区活跃等级：按发帖、评论与获赞计算 1-10 级。
 * 只做纯计算，数据统计在调用方（/api/community/users/[id]）。
 */

export type CommunityLevelDefinition = {
  level: number
  name: string
  minScore: number
}

/** 等级门槛与称号，按分数升序 */
export const COMMUNITY_LEVELS: CommunityLevelDefinition[] = [
  { level: 1, name: '校园新声', minScore: 0 },
  { level: 2, name: '初露锋芒', minScore: 12 },
  { level: 3, name: '活跃乐评人', minScore: 35 },
  { level: 4, name: '社区常客', minScore: 80 },
  { level: 5, name: '回声使者', minScore: 150 },
  { level: 6, name: '人气创作者', minScore: 260 },
  { level: 7, name: '社区达人', minScore: 420 },
  { level: 8, name: '乐评领袖', minScore: 640 },
  { level: 9, name: '校园名人', minScore: 920 },
  { level: 10, name: '传说之声', minScore: 1300 }
]

/** 计分权重：发帖 > 评论 > 获赞，获赞为累计值 */
export const COMMUNITY_LEVEL_WEIGHTS = {
  post: 3,
  comment: 2,
  receivedPostLike: 2,
  receivedSongLike: 1
} as const

export type CommunityLevelStats = {
  posts: number
  comments: number
  postLikesReceived: number
  songLikesReceived: number
}

export type CommunityLevelState = {
  level: number
  levelName: string
  score: number
  /** 当前等级门槛 */
  currentThreshold: number
  /** 下一级门槛，满级时为 null */
  nextThreshold: number | null
  nextLevelName: string | null
  /** 到下一级还差的分数，满级为 0 */
  remaining: number
  /** 当前等级内进度，0-1，满级为 1 */
  progress: number
}

/** 计算社区活跃等级 */
export function resolveCommunityLevel(stats: CommunityLevelStats): CommunityLevelState {
  const score =
    Math.max(0, Number(stats.posts) || 0) * COMMUNITY_LEVEL_WEIGHTS.post +
    Math.max(0, Number(stats.comments) || 0) * COMMUNITY_LEVEL_WEIGHTS.comment +
    Math.max(0, Number(stats.postLikesReceived) || 0) * COMMUNITY_LEVEL_WEIGHTS.receivedPostLike +
    Math.max(0, Number(stats.songLikesReceived) || 0) * COMMUNITY_LEVEL_WEIGHTS.receivedSongLike

  let index = 0
  for (let i = 0; i < COMMUNITY_LEVELS.length; i += 1) {
    if (score >= COMMUNITY_LEVELS[i]!.minScore) index = i
  }

  const current = COMMUNITY_LEVELS[index]!
  const next = COMMUNITY_LEVELS[index + 1] || null
  const span = next ? next.minScore - current.minScore : 0
  const earned = score - current.minScore

  return {
    level: current.level,
    levelName: current.name,
    score,
    currentThreshold: current.minScore,
    nextThreshold: next ? next.minScore : null,
    nextLevelName: next ? next.name : null,
    remaining: next ? Math.max(0, next.minScore - score) : 0,
    progress: next ? Math.min(1, Math.max(0, span > 0 ? earned / span : 1)) : 1
  }
}
