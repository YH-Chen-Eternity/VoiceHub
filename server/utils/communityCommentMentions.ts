/**
 * VoiceHub-Plus — 回声社区评论 @ 提醒解析与互动通知投递。
 *
 * 评论正文里的 @ 标记支持两种写法：
 * - `@username`：按 `users.username` 精确匹配（系统用户名仅允许 `[A-Za-z0-9_]`）；
 * - `@姓名`：按 `users.name` 精确匹配（中文姓名 1~32 字，用于「@显示名」场景）。
 * 两者都以 users 表为准，`@` 前面必须是非“单词字符”（避免把邮箱 `a@b.com` 误判成提醒）。
 * 单条评论最多提醒 {@link COMMUNITY_MENTION_LIMIT} 人，按出现顺序取前 5 个。
 *
 * 通知统一写入 Notification 表，`source` 固定为 `COMMUNITY`：
 * - `COMMUNITY_COMMENT_REPLY`：回复了父评论作者；
 * - `COMMUNITY_MENTION`：在评论中 @ 了某人。
 *
 * 本文件被 `comments.post.ts`（评论即时通过审核时）调用；审核通过分支
 * （`server/api/community/review/comments/[id].post.ts`）也调用一次
 * {@link dispatchCommunityCommentMentionNotifications} 补齐「先审后发」场景，
 * 内部会自行校验评论与帖子状态；同一评论只需在真正可见（APPROVED）时调用一次。
 */
import { eq, inArray, or } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import {
  communityComments,
  communityPosts,
  communityProfiles,
  communityTitles,
  notifications,
  users
} from '~/drizzle/schema'
import { buildCommunityIdentity, getCommunityUserIdentity } from '~~/server/utils/community'

/** 单条评论最多提醒的人数 */
export const COMMUNITY_MENTION_LIMIT = 5

/** 兼容 `@username`（ASCII）与 `@姓名`（中文/间隔号）两类 token */
const MENTION_TOKEN_PATTERN = /(?<![A-Za-z0-9_@.\-])@([A-Za-z0-9_\u4e00-\u9fa5·]{1,32})/g

/** 一次解析的 token 上限，避免超长正文构造过大的 IN 查询 */
const MENTION_TOKEN_BATCH_LIMIT = 300

export interface CommunityMentionUser {
  id: number
  /** 社区展示名（班级 + 脱敏姓名，与评论作者展示规则一致） */
  displayName: string
}

export interface CommunityCommentInteractionResult {
  /** 是否已给父评论作者写入「回复」通知 */
  replied: boolean
  /** 写入的「@ 提醒」通知条数 */
  mentioned: number
  /** 本次实际收到互动通知的用户 id（调用方可据此避免重复发送通用通知） */
  notifiedUserIds: number[]
}

/**
 * 提取正文里的 @ token（保序去重）。
 * 中文姓名没有天然分隔符，约定提醒必须写成 `@姓名 ` 或 `@username`（后接空格/标点）。
 */
export function extractCommunityMentionTokens(content: string): string[] {
  const tokens: string[] = []
  const seen = new Set<string>()
  const text = String(content || '')
  for (const match of text.matchAll(MENTION_TOKEN_PATTERN)) {
    const token = match[1]
    if (!token || seen.has(token)) continue
    seen.add(token)
    tokens.push(token)
    if (tokens.length >= MENTION_TOKEN_BATCH_LIMIT) break
  }
  return tokens
}

/**
 * 批量把 token 解析为社区用户。
 * username 精确匹配优先，其次按 users.name 精确匹配；未匹配到的 token 直接忽略。
 */
export async function resolveCommunityMentionUsers(
  tokens: string[]
): Promise<Map<string, CommunityMentionUser>> {
  const resolved = new Map<string, CommunityMentionUser>()
  const uniqueTokens = [...new Set(tokens.filter((token) => Boolean(token)))].slice(
    0,
    MENTION_TOKEN_BATCH_LIMIT
  )
  if (uniqueTokens.length === 0) return resolved

  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      grade: users.grade,
      class: users.class,
      titleName: communityTitles.name
    })
    .from(users)
    .leftJoin(communityProfiles, eq(communityProfiles.userId, users.id))
    .leftJoin(communityTitles, eq(communityTitles.id, communityProfiles.equippedTitleId))
    .where(or(inArray(users.username, uniqueTokens), inArray(users.name, uniqueTokens)))

  const byUsername = new Map<string, (typeof rows)[number]>()
  const byName = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    if (row.username && !byUsername.has(row.username)) byUsername.set(row.username, row)
    const name = String(row.name || '').trim()
    if (name && !byName.has(name)) byName.set(name, row)
  }

  for (const token of uniqueTokens) {
    const row = byUsername.get(token) || byName.get(token)
    if (!row) continue
    resolved.set(token, {
      id: row.id,
      displayName: buildCommunityIdentity(row, row.titleName).displayName
    })
  }
  return resolved
}

/**
 * 解析一条评论正文中的 @ 用户：按出现顺序去重，最多 {@link COMMUNITY_MENTION_LIMIT} 人。
 */
export async function resolveCommunityCommentMentions(
  content: string
): Promise<CommunityMentionUser[]> {
  const tokens = extractCommunityMentionTokens(content)
  if (tokens.length === 0) return []
  const resolved = await resolveCommunityMentionUsers(tokens)

  const mentioned: CommunityMentionUser[] = []
  const seenUserIds = new Set<number>()
  for (const token of tokens) {
    const user = resolved.get(token)
    if (!user || seenUserIds.has(user.id)) continue
    seenUserIds.add(user.id)
    mentioned.push(user)
    if (mentioned.length >= COMMUNITY_MENTION_LIMIT) break
  }
  return mentioned
}

/**
 * 给「回复父评论」与「被 @」的用户写互动通知。
 *
 * 只对 APPROVED 且未删除的评论、且所属帖子公开时投递；作者本人不会收到自己的提醒。
 * 同一个人同时是被回复者与被 @ 者时，只发优先级更高的一条「回复」通知。
 * 通知写入失败不影响评论主流程（调用方需自行 try/catch 或由本函数吞掉异常）。
 */
export async function dispatchCommunityCommentMentionNotifications(
  commentId: number
): Promise<CommunityCommentInteractionResult> {
  const result: CommunityCommentInteractionResult = {
    replied: false,
    mentioned: 0,
    notifiedUserIds: []
  }
  if (!Number.isInteger(commentId) || commentId <= 0) return result

  const [comment] = await db
    .select({
      id: communityComments.id,
      postId: communityComments.postId,
      parentId: communityComments.parentId,
      authorId: communityComments.authorId,
      content: communityComments.content,
      status: communityComments.status,
      deletedAt: communityComments.deletedAt
    })
    .from(communityComments)
    .where(eq(communityComments.id, commentId))
    .limit(1)
  // 未通过审核 / 已删除的评论不投递互动通知，避免提醒指向不可见内容
  if (!comment || comment.deletedAt || comment.status !== 'APPROVED') return result

  const [post] = await db
    .select({
      id: communityPosts.id,
      status: communityPosts.status,
      deletedAt: communityPosts.deletedAt
    })
    .from(communityPosts)
    .where(eq(communityPosts.id, comment.postId))
    .limit(1)
  if (!post || post.deletedAt || post.status !== 'APPROVED') return result

  const actor = await getCommunityUserIdentity(comment.authorId)
  if (!actor) return result

  // 父评论作者：只认未被删除的父评论，父评论不可见时不发「回复」提醒
  let parentAuthorId: number | null = null
  if (comment.parentId) {
    const [parent] = await db
      .select({ id: communityComments.id, authorId: communityComments.authorId })
      .from(communityComments)
      .where(eq(communityComments.id, comment.parentId))
      .limit(1)
    if (parent && parent.authorId !== comment.authorId) {
      parentAuthorId = parent.authorId
    }
  }

  const mentionedUsers = await resolveCommunityCommentMentions(comment.content)

  // 收件人去重：父评论作者优先（回复通知信息量更大），其后才是 @ 提醒
  const recipients = new Map<number, 'reply' | 'mention'>()
  if (parentAuthorId) recipients.set(parentAuthorId, 'reply')
  for (const mentioned of mentionedUsers) {
    if (mentioned.id === comment.authorId) continue
    if (recipients.has(mentioned.id)) continue
    recipients.set(mentioned.id, 'mention')
  }
  if (recipients.size === 0) return result

  const preview = comment.content.slice(0, 50)
  const values = [...recipients.entries()].map(([userId, kind]) =>
    kind === 'reply'
      ? {
          userId,
          type: 'COMMUNITY_COMMENT_REPLY',
          source: 'COMMUNITY',
          title: '回声社区：有人回复了你的评论',
          message: `${actor.displayName} 回复了你的评论：${preview}`,
          songId: null
        }
      : {
          userId,
          type: 'COMMUNITY_MENTION',
          source: 'COMMUNITY',
          title: '回声社区：有人在评论中提到了你',
          message: `${actor.displayName} 在评论中提到了你：${preview}`,
          songId: null
        }
  )

  await db.insert(notifications).values(values)

  result.replied = parentAuthorId !== null
  result.mentioned = values.filter((item) => item.type === 'COMMUNITY_MENTION').length
  result.notifiedUserIds = [...recipients.keys()]
  return result
}
