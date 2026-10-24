/* Modified by YH-Chen-Eternity on 2026-10-23 */

// Modified by YH-Chen on 2026-10-17
import {bigint, boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, serial, text, timestamp, uniqueIndex, uuid, varchar, unique} from 'drizzle-orm/pg-core';
import {relations, sql} from 'drizzle-orm';

// 枚举定义
export const blacklistTypeEnum = pgEnum('BlacklistType', ['SONG', 'KEYWORD', 'LANGUAGE', 'GENRE']);
// 'merged' = 该账号已被合并进同名的原账号（重复注册清理），登录时提示改用原账号
// 'pending_deletion' = 用户自助注销中（30 天宽限期；期间登录即自动撤销，逾期未登录则清理）
export const userStatusEnum = pgEnum('user_status', ['active', 'pending', 'withdrawn', 'graduate', 'rejected', 'merged', 'pending_deletion']);
export const collaboratorStatusEnum = pgEnum('collaborator_status', ['PENDING', 'ACCEPTED', 'REJECTED']);
export const replayRequestStatusEnum = pgEnum('replay_request_status', ['PENDING', 'FULFILLED', 'REJECTED']);
export const cardCodeStatusEnum = pgEnum('card_code_status', [
  'AVAILABLE',
  'LOCKED',
  'REDEEMED',
  'INVALID'
]);

// 用户表
export const users = pgTable('User', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  username: text('username').notNull(),
  name: text('name'),
  grade: text('grade'),
  class: text('class'),
  role: text('role').default('USER').notNull(),
  password: text('password').notNull(),
  email: text('email'),
  emailVerified: boolean('emailVerified').default(false),
  lastLogin: timestamp('lastLogin'),
  lastLoginIp: text('lastLoginIp'),
  passwordChangedAt: timestamp('passwordChangedAt'),
  forcePasswordChange: boolean('forcePasswordChange').default(false).notNull(),
  // 管理员在用户管理中「强制更新」：要求该用户下次进入站点时先改用户名
  forceUsernameChange: boolean('forceUsernameChange').default(false).notNull(),
  tokenVersion: integer('tokenVersion').default(0).notNull(),
  meowNickname: text('meowNickname'),
  meowBoundAt: timestamp('meowBoundAt'),
  avatarProvider: text('avatarProvider'),
  avatarProviderUserId: text('avatarProviderUserId'),
  status: userStatusEnum('status').default('active').notNull(),
  statusChangedAt: timestamp('statusChangedAt').defaultNow(),
  statusChangedBy: integer('statusChangedBy'),
  // 注册时可选填写的备注，管理员审核时可修改
  remark: text('remark'),
  legalConsentVersion: text('legal_consent_version'),
  legalConsentAt: timestamp('legal_consent_at'),
  // 自助注销：申请时间 + 计划删除时间（默认 30 天后；期间登录会自动撤销）
  // 我的点赞列表是否对其他同学可见（账号页可切换）
  likesVisible: boolean('likesVisible').default(true).notNull(),
  // 点赞时是否让投稿人知道是我：ASK=每次询问（默认）/ ANONYMOUS=总是匿名 / REVEAL=总是署名
  voteRevealMode: text('voteRevealMode').default('ASK').notNull(),
  deletionRequestedAt: timestamp('deletionRequestedAt'),
  deletionScheduledAt: timestamp('deletionScheduledAt'),
}, (table) => [
  uniqueIndex('User_username_unique').on(table.username),
  // 邮箱唯一（不区分大小写、忽略空值）：一个邮箱只能绑定一个账号，
  // 否则「忘记密码」的验证码会把两个账号的找回权限绑到同一个信箱上。
  uniqueIndex('User_email_lower_unique')
    .on(sql`lower(${table.email})`)
    .where(sql`${table.email} is not null and btrim(${table.email}) <> ''`)
]);

// 登录会话表，id 与 JWT 的 jti 一致
export const authSessions = pgTable('auth_sessions', {
  id: uuid('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  browser: text('browser'),
  operatingSystem: text('operating_system'),
  device: text('device'),
  loginMethod: text('login_method').default('password').notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedReason: text('revoked_reason')
}, (table) => [
  index('auth_sessions_user_active_idx').on(table.userId, table.revokedAt, table.expiresAt),
  index('auth_sessions_last_active_idx').on(table.lastActiveAt)
]);

export type AuthSession = typeof authSessions.$inferSelect;
export type NewAuthSession = typeof authSessions.$inferInsert;

// 播出时段表
export const playTimes = pgTable('PlayTime', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  name: text('name').notNull(),
  startTime: text('startTime'),
  endTime: text('endTime'),
  enabled: boolean('enabled').default(true).notNull(),
  description: text('description'),
});

// 年级班级配置表（选择器选项来源，优先于从用户提取）
export const gradeClass = pgTable(
  'GradeClass',
  {
    id: serial('id').primaryKey(),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
    grade: text('grade').notNull(),
    class: text('class').notNull(),
  },
  (table) => [unique('GradeClass_grade_class_unique').on(table.grade, table.class)],
);

// 歌曲表
export const songs = pgTable('Song', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  title: text('title').notNull(),
  artist: text('artist').notNull(),
  requesterId: integer('requesterId').notNull(),
  // 逐条投稿的匿名标记：true = 对其他同学显示「匿名投稿」（管理员与投稿人本人仍可见真实姓名）
  submissionAnonymous: boolean('submissionAnonymous').default(false).notNull(),
  played: boolean('played').default(false).notNull(),
  playedAt: timestamp('playedAt').defaultNow(),
  semester: text('semester'),
  preferredPlayTimeId: integer('preferredPlayTimeId'),
  cover: text('cover'),
  playUrl: text('playUrl'),
  musicPlatform: text('musicPlatform'),
  musicId: text('musicId'),
  musicSourceData: jsonb('musicSourceData'),
  durationSeconds: integer('durationSeconds'),
  submissionNote: text('submissionNote'),
  submissionNotePublic: boolean('submissionNotePublic').default(false).notNull(),
  // 公开留言审核状态：'pending' | 'approved' | 'rejected' | null（null 表示未启用审核或不涉及）
  submissionNotePublicStatus: text('submissionNotePublicStatus'),
  // 匿名投稿：投稿时选择不公开姓名。非管理员（且非投稿人本人）视角下显示为「匿名」，
  // 管理员后台始终可见真实投稿人，便于管理与追溯。
  hitRequestId: integer(),
  cardCodeId: integer('cardCodeId').references(() => cardCodes.id, { onDelete: 'set null' }),
}, (table) => [
  index('song_card_code_id_idx').on(table.cardCodeId),
  index('song_semester_created_at_idx').on(table.semester, table.createdAt),
  // 全站投稿总量限额只按 createdAt 窗口计数，缺少以 createdAt 为前导列的索引会退化成全表扫
  index('song_created_at_idx').on(table.createdAt),
  index('song_requester_id_idx').on(table.requesterId)
]);

// 插件配置与不可变历史分开保存，部署快照引用精确版本。
export const musicSourcePlugins = pgTable('MusicSourcePlugin', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  priority: integer('priority').default(0).notNull(),
  desiredRevision: integer('desiredRevision').default(1).notNull(),
  activeRevision: integer('activeRevision'),
  activeHash: text('activeHash'),
  legacyPlatformKey: text('legacyPlatformKey'),
  lastError: text('lastError'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  deletedAt: timestamp('deletedAt'),
}, (table) => [uniqueIndex('music_source_legacy_key').on(table.legacyPlatformKey)]);

export const musicSourcePluginRevisions = pgTable('MusicSourcePluginRevision', {
  pluginId: uuid('pluginId').notNull().references(() => musicSourcePlugins.id),
  revision: integer('revision').notNull(),
  scriptUrl: text('scriptUrl').notNull(),
  protocol: text('protocol').notNull(),
  variables: text('variables').notNull(),
  catalog: text('catalog'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.pluginId, table.revision] })]);

export const musicSourceConfigState = pgTable('MusicSourceConfigState', {
  id: integer('id').primaryKey(),
  revision: integer('revision').default(0).notNull(),
});

// 投票表
export const votes = pgTable('Vote', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  songId: integer('songId').notNull(),
  userId: integer('userId').notNull(),
  // 点赞时是否让投稿人知道是谁点的（默认公开；关掉则只显示"有一位同学"）
  revealToRequester: boolean('revealToRequester').default(true).notNull(),
}, (table) => [
  unique('vote_song_user_unique').on(table.songId, table.userId),
  index('vote_user_song_idx').on(table.userId, table.songId)
]);

// 排期表
export const schedules = pgTable('Schedule', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  songId: integer('songId').notNull(),
  playDate: timestamp('playDate').notNull(),
  played: boolean('played').default(false).notNull(),
  sequence: integer('sequence').default(1).notNull(),
  playTimeId: integer('playTimeId'),
  // 草稿支持字段
  isDraft: boolean('isDraft').default(false).notNull(),
  publishedAt: timestamp('publishedAt'),
  replayRequestId: integer('replay_request_id'),
}, (table) => [
  index('schedule_published_song_idx').on(table.isDraft, table.songId, table.playDate),
  index('schedule_published_date_idx').on(table.isDraft, table.playDate)
]);

// 排期备选池表
export const scheduleSongPool = pgTable('ScheduleSongPool', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  songId: integer('songId').notNull().references(() => songs.id, { onDelete: 'cascade' }),
  addedBy: integer('addedBy').references(() => users.id, { onDelete: 'set null' })
}, (table) => [
  unique('schedule_song_pool_song_unique').on(table.songId)
]);

export type ScheduleSongPool = typeof scheduleSongPool.$inferSelect;
export type NewScheduleSongPool = typeof scheduleSongPool.$inferInsert;

// 通知表
export const notifications = pgTable('Notification', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  type: text('type').notNull(),
  batchId: text('batchId'),
  source: text('source').default('SYSTEM').notNull(),
  senderId: integer('senderId'),
  senderName: text('senderName'),
  senderUsername: text('senderUsername'),
  title: text('title'),
  message: text('message').notNull(),
  important: boolean('important').default(false).notNull(),
  read: boolean('read').default(false).notNull(),
  userDeleted: boolean('userDeleted').default(false).notNull(),
  userId: integer('userId').notNull(),
  songId: integer('songId'),
}, (table) => [
  index('notification_user_important_read_created_idx').on(
    table.userId,
    table.userDeleted,
    table.important,
    table.read,
    table.createdAt
  ),
  index('notification_batch_id_idx').on(table.batchId)
]);

// 通知设置表
export const notificationSettings = pgTable('NotificationSettings', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  userId: integer('userId').notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  songRequestEnabled: boolean('songRequestEnabled').default(true).notNull(),
  songVotedEnabled: boolean('songVotedEnabled').default(true).notNull(),
  songPlayedEnabled: boolean('songPlayedEnabled').default(true).notNull(),
  refreshInterval: integer('refreshInterval').default(60).notNull(),
  songVotedThreshold: integer('songVotedThreshold').default(1).notNull(),
});

// AstrBot 绑定码持久化，避免 serverless 多实例内存状态不一致。
export const astrbotBindingCodes = pgTable('AstrbotBindingCode', {
  userId: integer('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  codeHash: text('codeHash').notNull(),
  expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumedAt', { withTimezone: true })
}, (table) => [primaryKey({ columns: [table.userId, table.platform] }),
  uniqueIndex('AstrbotBindingCode_hash_unique').on(table.codeHash)]);

// 每个用户每个平台一条绑定；适配器名与 UMO 实例名分离存储。
export const astrbotBindings = pgTable('AstrbotBinding', {
  userId: integer('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  adapter: text('adapter').notNull(),
  umo: text('umo').notNull(),
  boundAt: timestamp('boundAt').defaultNow().notNull()
}, (table) => [primaryKey({ columns: [table.userId, table.platform] }), uniqueIndex('AstrbotBinding_umo_unique').on(table.umo)]);

// AstrBot 待投递队列：插件无法被 VoiceHub 访问（内网/NAT）时，由插件主动轮询取件。
// 目标在入队时即由绑定表解析完毕，插件只按队列内容投递。
export const astrbotOutbox = pgTable('AstrbotOutbox', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  title: text('title'),
  message: text('message').notNull(),
  url: text('url'),
  umos: jsonb('umos').$type<string[]>().default([]).notNull(),
  // NULL 为迁移前队列：无法确认原绑定主体，领取时必须丢弃。
  targetOwners: jsonb('targetOwners').$type<Record<string, { userId: number; boundAt: string }>>(),
  broadcast: boolean('broadcast').default(false).notNull(),
  // 群事件类型（新点歌投稿 / 注册待审核 / 备份失败…）。私聊通知为 NULL。
  // 合并与冷却都以它 + 目标会话为键，避免把不同类型的事件混进同一条。
  eventKey: text('eventKey'),
  // 冷却闸门：早于该时刻不得投递。同群同类型事件在冷却期内合并为一条，
  // 由领取逻辑与冲刷逻辑共同遵守。
  notifyAfter: timestamp('notifyAfter', { withTimezone: true }),
  attempts: integer('attempts').default(0).notNull(),
  leasedUntil: timestamp('leasedUntil', { withTimezone: true }),
  claimToken: text('claimToken'),
  deliveredAt: timestamp('deliveredAt', { withTimezone: true }),
  failedAt: timestamp('failedAt', { withTimezone: true }),
  lastError: text('lastError')
}, (table) => [index('astrbot_outbox_pending_idx').on(table.deliveredAt, table.failedAt, table.id)]);

// 学期表
export const semesters = pgTable('Semester', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  name: text('name').notNull(),
  isActive: boolean('isActive').default(false).notNull(),
});

// 系统设置表
export const systemSettings = pgTable('SystemSettings', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  instanceId: text('instance_id'),
  telemetryEnabled: boolean('telemetryEnabled').default(true).notNull(),
  enablePlayTimeSelection: boolean('enablePlayTimeSelection').default(false).notNull(),
  siteTitle: text('siteTitle'),
  siteLogoUrl: text('siteLogoUrl'),
  schoolLogoHomeUrl: text('schoolLogoHomeUrl'),
  schoolLogoPrintUrl: text('schoolLogoPrintUrl'),
  siteDescription: text('siteDescription'),
  submissionGuidelines: text('submissionGuidelines'),
  icpNumber: text('icpNumber'),
  gonganNumber: text('gonganNumber'),
  showBeianIcon: boolean('showBeianIcon').default(false).notNull(),
  enableSubmissionLimit: boolean('enableSubmissionLimit').default(false).notNull(),
  dailySubmissionLimit: integer('dailySubmissionLimit'),
  weeklySubmissionLimit: integer('weeklySubmissionLimit'),
  monthlySubmissionLimit: integer('monthlySubmissionLimit'),
  // 全站投稿总量上限（按北京时间周期统计所有用户），三个周期可同时生效
  enableGlobalSubmissionLimit: boolean('enableGlobalSubmissionLimit').default(false).notNull(),
  globalDailySubmissionLimit: integer('globalDailySubmissionLimit'),
  globalWeeklySubmissionLimit: integer('globalWeeklySubmissionLimit'),
  globalMonthlySubmissionLimit: integer('globalMonthlySubmissionLimit'),
  // 用户可见播出排期范围
  scheduleDaysBeforeEnabled: boolean('scheduleDaysBeforeEnabled').default(false).notNull(),
  scheduleDaysBefore: integer('scheduleDaysBefore').default(1).notNull(),
  scheduleDaysAfterEnabled: boolean('scheduleDaysAfterEnabled').default(false).notNull(),
  scheduleDaysAfter: integer('scheduleDaysAfter').default(1).notNull(),
  showBlacklistKeywords: boolean('showBlacklistKeywords').default(false).notNull(),
  hideStudentInfo: boolean('hideStudentInfo').default(true).notNull(),
  // 是否允许投稿人逐条选择匿名投稿（默认关闭）
  allowAnonymousSubmission: boolean('allowAnonymousSubmission').default(false).notNull(),
  // SMTP 邮件配置
  smtpEnabled: boolean('smtpEnabled').default(false).notNull(),
  smtpHost: text('smtpHost'),
  smtpPort: integer('smtpPort').default(587),
  smtpSecure: boolean('smtpSecure').default(false),
  smtpUsername: text('smtpUsername'),
  smtpPassword: text('smtpPassword'),
  smtpFromEmail: text('smtpFromEmail'),
  smtpFromName: text('smtpFromName').default('校园广播站'),
  astrbotEnabled: boolean('astrbotEnabled').default(false).notNull(),
  astrbotPlatforms: jsonb('astrbotPlatforms').$type<{ qq: boolean; wecom: boolean; dingtalk: boolean; lark: boolean }>()
    .default({ qq: false, wecom: false, dingtalk: false, lark: false }).notNull(),
  astrbotBaseUrl: text('astrbotBaseUrl'),
  astrbotToken: text('astrbotToken'),
  astrbotBroadcastEnabled: boolean('astrbotBroadcastEnabled').default(false).notNull(),
  // 群广播目标：UMO 前缀是 AstrBot 平台实例 ID（可被改名），无法从会话串推断平台，
  // 因此每条目标显式记录所属平台与备注，投递与校验都以本列白名单为准。
  astrbotGroupTargets: jsonb('astrbotGroupTargets').$type<Array<{ umo: string; platform: string; label: string }>>()
    .default(sql`'[]'::jsonb`).notNull(),
  // 群事件开关与防刷屏参数，均由后台按需配置。
  astrbotGroupEvents: jsonb('astrbotGroupEvents').$type<Record<string, boolean>>(),
  astrbotGroupThrottle: jsonb('astrbotGroupThrottle').$type<{ mergeWindowSeconds: number; minIntervalSeconds: number }>(),
  // 推送方向：push = VoiceHub 主动 POST 到插件（需插件可被访问）；
  // pull = 通知入队，由插件主动轮询领取（插件在内网/NAT 后时使用）。
  astrbotPushMode: text('astrbotPushMode').default('push').notNull(),
  astrbotWeeklyConfig: jsonb('astrbotWeeklyConfig').$type<{
    layoutStyle?: 'classic' | 'table'
    listColumns?: 1 | 2
    showLogo?: boolean
    showSchoolLogo?: boolean
    showCover?: boolean
    showTitle?: boolean
    showArtist?: boolean
    showRequester?: boolean
    showVotes?: boolean
    showSequence?: boolean
    showPlayTime?: boolean
    showDate?: boolean
  }>()
    .default({ showCover: true, showSequence: true, showRequester: true, showVotes: false, showPlayTime: true, showDate: true }).notNull(),
  enableRequestTimeLimitation: boolean('enableRequestTimeLimitation').default(false).notNull(),
  forceBlockAllRequests: boolean().default(false).notNull(),
  forcePasswordChangeOnFirstLogin: boolean('forcePasswordChangeOnFirstLogin').default(false).notNull(),
  enableReplayRequests: boolean('enableReplayRequests').default(false).notNull(),
  enableCollaborativeSubmission: boolean('enableCollaborativeSubmission').default(true).notNull(),
  enableSubmissionRemarks: boolean('enableSubmissionRemarks').default(false).notNull(),
  // 卡密点歌相关开关（用于允许用户使用卡密或强制使用卡密投稿）
  enableCardCodeRequests: boolean('enableCardCodeRequests').default(false).notNull(),
  requireCardCodeForRequests: boolean('requireCardCodeForRequests').default(false).notNull(),
  enableCardCodeLimitBypass: boolean('enableCardCodeLimitBypass').default(false).notNull(),
  // 重复投稿限制：对同一首歌/同一歌手，在其进入排期后的设定时间窗口内禁止再次投稿
  enableSubmissionRestriction: boolean('enableSubmissionRestriction').default(false).notNull(),
  submissionRestrictionScope: text('submissionRestrictionScope').default('all').notNull(),
  sameSongRestrictionHours: integer('sameSongRestrictionHours'),
  sameArtistRestrictionHours: integer('sameArtistRestrictionHours'),
  
  // 验证码配置
  captchaProvider: text('captchaProvider').default('graphic').notNull(),
  turnstileSiteKey: text('turnstileSiteKey'),
  turnstileSecretKey: text('turnstileSecretKey'),
  // 阿里云 ESA AI 验证码：身份标 / 场景 ID 规则列表（JSON：接口 + 域名 → 场景 ID）/ 部署区域（cn=中国内地，sgp=新加坡）
  esaCaptchaPrefix: text('esaCaptchaPrefix'),
  esaCaptchaScenes: text('esaCaptchaScenes').default('[]').notNull(),
  esaCaptchaRegion: text('esaCaptchaRegion').default('cn').notNull(),
  
  // 注册配置
  allowRegister: boolean('allowRegister').default(false).notNull(),
  registerRequiresApproval: boolean('registerRequiresApproval').default(true).notNull(),
  oauthRegisterRequiresApproval: boolean('oauthRegisterRequiresApproval').default(true).notNull(),
  // 注册邮箱（选填→管理员开关控制；需 SMTP 已配置）
  registerEmailRequired: boolean('registerEmailRequired').default(false).notNull(),
  // 注册时必须选择年级班级（本地注册与第三方创建账户均强制）
  registerRequiresGradeClass: boolean('registerRequiresGradeClass').default(false).notNull(),
  // 投稿公开留言审核
  submissionNoteRequiresApproval: boolean('submissionNoteRequiresApproval').default(false).notNull(),

  // OAuth 配置
  allowOAuthRegistration: boolean('allowOAuthRegistration').default(false).notNull(),
  oauthRedirectUri: text('oauthRedirectUri'),
  oauthStateSecret: text('oauthStateSecret'),
  oauthProviders: text('oauthProviders').default('[]'),
  // GitHub OAuth
  githubOAuthEnabled: boolean('githubOAuthEnabled').default(false).notNull(),
  githubClientId: text('githubClientId'),
  githubClientSecret: text('githubClientSecret'),
  // Casdoor OAuth
  casdoorOAuthEnabled: boolean('casdoorOAuthEnabled').default(false).notNull(),
  casdoorServerUrl: text('casdoorServerUrl'),
  casdoorClientId: text('casdoorClientId'),
  casdoorClientSecret: text('casdoorClientSecret'),
  casdoorOrganizationName: text('casdoorOrganizationName'),
  // Google OAuth
  googleOAuthEnabled: boolean('googleOAuthEnabled').default(false).notNull(),
  googleClientId: text('googleClientId'),
  googleClientSecret: text('googleClientSecret'),
  // 聚合登陆
  aggregateOAuthEnabled: boolean('aggregateOAuthEnabled').default(false).notNull(),
  aggregateOAuthAppId: text('aggregateOAuthAppId'),
  aggregateOAuthAppKey: text('aggregateOAuthAppKey'),
  aggregateOAuthLoginType: text('aggregateOAuthLoginType').default('qq'),
  aggregateOAuthEndpoint: text('aggregateOAuthEndpoint'),
  // Custom OAuth2
  customOAuthEnabled: boolean('customOAuthEnabled').default(false).notNull(),
  customOAuthDisplayName: text('customOAuthDisplayName'),
  customOAuthAuthorizeUrl: text('customOAuthAuthorizeUrl'),
  customOAuthTokenUrl: text('customOAuthTokenUrl'),
  customOAuthUserInfoUrl: text('customOAuthUserInfoUrl'),
  customOAuthScope: text('customOAuthScope'),
  customOAuthClientId: text('customOAuthClientId'),
  customOAuthClientSecret: text('customOAuthClientSecret'),
  customOAuthUserIdField: text('customOAuthUserIdField'),
  customOAuthUsernameField: text('customOAuthUsernameField'),
  customOAuthNameField: text('customOAuthNameField'),
  customOAuthEmailField: text('customOAuthEmailField'),
  customOAuthAvatarField: text('customOAuthAvatarField'),
  // 图形验证码
  captchaEnabled: boolean('captchaEnabled').default(false).notNull(),
  captchaMaxFailures: integer('captchaMaxFailures').default(3).notNull(),

  // 自动备份配置
  autoBackupEnabled: boolean('autoBackupEnabled').default(false).notNull(),
  autoBackupConfig: text('autoBackupConfig'),

  // 站点统计代码（任意站点统计平台的 HTML/JS 片段，注入 SSR 页面 <head>）
  statisticsCodeEnabled: boolean('statisticsCodeEnabled').default(false).notNull(),
  statisticsCode: text('statisticsCode'),
  legalConsentEnabled: boolean('legalConsentEnabled').default(false).notNull(),
  legalConsentDisplayMode: text('legalConsentDisplayMode').default('modal').notNull(),
  legalConsentUpdatedDate: text('legalConsentUpdatedDate'),
  legalConsentDocuments: text('legalConsentDocuments').default('[]').notNull(),

  // 主题管理配置
  defaultTheme: text('defaultTheme').default('System').notNull(),
  enabledThemes: text('enabledThemes').default('["System","ClassicDark","ClassicLight","ModernLight"]').notNull(),
  // 平台管理配置（仅内置音源；插件音源由插件管理的启用状态与排序控制，不入库）
  enabledPlatforms: text('enabledPlatforms').default('["netease","tencent","bilibili","migu"]'),
  platformOrder: text('platformOrder').default('["netease","tencent","bilibili","migu"]'),
});

// 歌曲黑名单表
export const songBlacklists = pgTable('SongBlacklist', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  type: blacklistTypeEnum('type').notNull(),
  value: text('value').notNull(),
  reason: text('reason'),
  isActive: boolean('isActive').default(true).notNull(),
  createdBy: integer('createdBy'),
});

// API Keys表
export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  keyHash: varchar('key_hash', { length: 255 }).notNull().unique(),
  keyPrefix: varchar('key_prefix', { length: 10 }).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdByUserId: integer('created_by_user_id').notNull(),
  usageCount: integer('usage_count').default(0).notNull(),

});

// API Key权限表
export const apiKeyPermissions = pgTable('api_key_permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  apiKeyId: uuid('api_key_id').notNull(),
  permission: varchar('permission', { length: 100 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// API访问日志表
export const apiLogs = pgTable('api_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  apiKeyId: uuid('api_key_id'),
  endpoint: varchar('endpoint', { length: 500 }).notNull(),
  method: varchar('method', { length: 10 }).notNull(),
  ipAddress: text('ip_address').notNull(),
  userAgent: text('user_agent'),
  statusCode: integer('status_code').notNull(),
  responseTimeMs: integer('response_time_ms').notNull(),
  requestBody: text('request_body'),
  responseBody: text('response_body'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  errorMessage: text('error_message'),
});

// 用户状态变更日志表
export const userStatusLogs = pgTable('user_status_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  // 审计快照：用户被删除后仍可追溯（如注册审核拒绝）
  username: text('username'),
  name: text('name'),
  oldStatus: userStatusEnum('old_status'),
  newStatus: userStatusEnum('new_status').notNull(),
  reason: text('reason'),
  operatorId: integer('operator_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const requestTimes = pgTable("RequestTime", {
  id: serial().primaryKey().notNull(),
  createdAt: timestamp({ precision: 6, mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp({ precision: 6, mode: 'string' }).defaultNow().notNull(),
  name: text().notNull(),
  startTime: timestamp({ mode: 'string' }).notNull(),
  endTime: timestamp({ mode: 'string' }).notNull(),
  enabled: boolean().default(true).notNull(),
  description: text(),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  expected: bigint({ mode: "number" }).default(0).notNull(),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  accepted: bigint({ mode: "number" }).default(0).notNull(),
  past: boolean().default(false).notNull(),
});

// 联合投稿人表
export const songCollaborators = pgTable('song_collaborators', {
    id: uuid('id').primaryKey().defaultRandom(),
    songId: integer('song_id').notNull(),
    userId: integer('user_id').notNull(),
    status: collaboratorStatusEnum('status').default('PENDING').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).defaultNow().notNull(),
}, (table) => [
    index('song_collaborators_song_status_idx').on(table.songId, table.status),
    index('song_collaborators_user_status_idx').on(table.userId, table.status)
]);

// 联合投稿审计日志表
export const collaborationLogs = pgTable('collaboration_logs', {
    id: uuid('id').primaryKey().defaultRandom(),
    collaboratorId: uuid('collaborator_id').notNull(),
    action: varchar('action', {length: 50}).notNull(), // INVITE, ACCEPT, REJECT, REMOVE
    operatorId: integer('operator_id').notNull(),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at', {withTimezone: true}).defaultNow().notNull(),
});

// 歌曲重播申请表
export const songReplayRequests = pgTable('song_replay_requests', {
  id: serial('id').primaryKey(),
  songId: integer('song_id').notNull(),
  userId: integer('user_id').notNull(),
  createdAt: timestamp('created_at', {withTimezone: true}).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', {withTimezone: true}).defaultNow().notNull(),
  status: replayRequestStatusEnum('status').default('PENDING').notNull(),
  preferredPlayTimeId: integer('preferred_play_time_id'),
  submissionNote: text('submission_note'),
  submissionNotePublic: boolean('submission_note_public').default(false).notNull(),
  submissionNotePublicStatus: text('submission_note_public_status'),
}, (table) => [
  // 同一用户对同一首歌同时最多一条待处理申请；历史申请（FULFILLED/REJECTED）允许多条
  uniqueIndex('song_replay_requests_pending_song_user_unique')
    .on(table.songId, table.userId)
    .where(sql`${table.status} = 'PENDING'`),
  index('song_replay_requests_user_status_song_idx').on(table.userId, table.status, table.songId)
]);

// 第三方身份关联表
export const userIdentities = pgTable('UserIdentity', {
  id: serial('id').primaryKey(),
  userId: integer('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  providerUserId: text('providerUserId').notNull(),
  providerUsername: text('providerUsername'),
  avatar: text('avatar'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
}, (t) => ({
  unq: unique().on(t.provider, t.providerUserId),
}));

export const passwordAuditLogs = pgTable('PasswordAuditLog', {
  id: serial('id').primaryKey(),
  userId: integer('userId').notNull(),
  actorId: integer('actorId'),
  action: text('action').notNull(),
  success: boolean('success').notNull(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  failureReason: text('failureReason'),
  createdAt: timestamp('createdAt', { withTimezone: true }).defaultNow().notNull()
}, (table) => ({
  userCreatedIdx: index('PasswordAuditLog_user_created_idx').on(table.userId, table.createdAt)
}));

export const passwordRateLimits = pgTable('PasswordRateLimit', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  resetAt: timestamp('resetAt', { withTimezone: true }).notNull()
}, (table) => ({
  resetIdx: index('PasswordRateLimit_reset_idx').on(table.resetAt)
}));

// 关系定义
export const usersRelations = relations(users, ({ many, one }) => ({
  songs: many(songs),
  votes: many(votes),
  notifications: many(notifications),
  identities: many(userIdentities),
  notificationSettings: one(notificationSettings, {
    fields: [users.id],
    references: [notificationSettings.userId],
  }),
  apiKeys: many(apiKeys),
  sessions: many(authSessions),
  statusLogs: many(userStatusLogs),
    collaborations: many(songCollaborators),
  replayRequests: many(songReplayRequests),
  statusChangedByUser: one(users, {
    fields: [users.statusChangedBy],
    references: [users.id],
  }),
}));

export const userIdentitiesRelations = relations(userIdentities, ({ one }) => ({
  user: one(users, {
    fields: [userIdentities.userId],
    references: [users.id],
  }),
}));

export const songsRelations = relations(songs, ({ one, many }) => ({
  requester: one(users, {
    fields: [songs.requesterId],
    references: [users.id],
  }),
  preferredPlayTime: one(playTimes, {
    fields: [songs.preferredPlayTimeId],
    references: [playTimes.id],
  }),
  votes: many(votes),
  schedules: many(schedules),
  notifications: many(notifications),
    collaborators: many(songCollaborators),
    replayRequests: many(songReplayRequests),
}));

export const votesRelations = relations(votes, ({ one }) => ({
  song: one(songs, {
    fields: [votes.songId],
    references: [songs.id],
  }),
  user: one(users, {
    fields: [votes.userId],
    references: [users.id],
  }),
}));

export const schedulesRelations = relations(schedules, ({ one }) => ({
  song: one(songs, {
    fields: [schedules.songId],
    references: [songs.id],
  }),
  playTime: one(playTimes, {
    fields: [schedules.playTimeId],
    references: [playTimes.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
  song: one(songs, {
    fields: [notifications.songId],
    references: [songs.id],
  }),
}));

export const notificationSettingsRelations = relations(notificationSettings, ({ one }) => ({
  user: one(users, {
    fields: [notificationSettings.userId],
    references: [users.id],
  }),
}));

export const playTimesRelations = relations(playTimes, ({ many }) => ({
  songs: many(songs),
  schedules: many(schedules),
}));

// API框架关系定义
export const apiKeysRelations = relations(apiKeys, ({ one, many }) => ({
  createdByUser: one(users, {
    fields: [apiKeys.createdByUserId],
    references: [users.id],
  }),
  permissions: many(apiKeyPermissions),
  logs: many(apiLogs),
}));

export const apiKeyPermissionsRelations = relations(apiKeyPermissions, ({ one }) => ({
  apiKey: one(apiKeys, {
    fields: [apiKeyPermissions.apiKeyId],
    references: [apiKeys.id],
  }),
}));

export const apiLogsRelations = relations(apiLogs, ({ one }) => ({
  apiKey: one(apiKeys, {
    fields: [apiLogs.apiKeyId],
    references: [apiKeys.id],
  }),
}));

export const userStatusLogsRelations = relations(userStatusLogs, ({ one }) => ({
  user: one(users, {
    fields: [userStatusLogs.userId],
    references: [users.id],
  }),
  operator: one(users, {
    fields: [userStatusLogs.operatorId],
    references: [users.id],
  }),
}));

export const songCollaboratorsRelations = relations(songCollaborators, ({one, many}) => ({
    song: one(songs, {
        fields: [songCollaborators.songId],
        references: [songs.id],
    }),
    user: one(users, {
        fields: [songCollaborators.userId],
        references: [users.id],
    }),
    logs: many(collaborationLogs),
}));

export const collaborationLogsRelations = relations(collaborationLogs, ({one}) => ({
    collaborator: one(songCollaborators, {
        fields: [collaborationLogs.collaboratorId],
        references: [songCollaborators.id],
    }),
    operator: one(users, {
        fields: [collaborationLogs.operatorId],
        references: [users.id],
    }),
}));

export const songReplayRequestsRelations = relations(songReplayRequests, ({one}) => ({
    song: one(songs, {
        fields: [songReplayRequests.songId],
        references: [songs.id],
    }),
    user: one(users, {
        fields: [songReplayRequests.userId],
        references: [users.id],
    }),
}));

// 邮件模板表（仅存储自定义覆盖，内置模板在代码中定义）
export const emailTemplates = pgTable('EmailTemplate', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  key: varchar('key', { length: 100 }).notNull(),
  name: varchar('name', { length: 200 }).notNull(),
  subject: varchar('subject', { length: 300 }).notNull(),
  html: text('html').notNull(),
  updatedByUserId: integer('updatedByUserId'),
});

// 导出所有表的类型
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Song = typeof songs.$inferSelect;
export type NewSong = typeof songs.$inferInsert;
export type Vote = typeof votes.$inferSelect;
export type NewVote = typeof votes.$inferInsert;
export type Schedule = typeof schedules.$inferSelect;
export type NewSchedule = typeof schedules.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type NotificationSettings = typeof notificationSettings.$inferSelect;
export type NewNotificationSettings = typeof notificationSettings.$inferInsert;
export type PlayTime = typeof playTimes.$inferSelect;
export type NewPlayTime = typeof playTimes.$inferInsert;
export type Semester = typeof semesters.$inferSelect;
export type NewSemester = typeof semesters.$inferInsert;
export type SystemSettings = typeof systemSettings.$inferSelect;
export type NewSystemSettings = typeof systemSettings.$inferInsert;
export type SongBlacklist = typeof songBlacklists.$inferSelect;
export type NewSongBlacklist = typeof songBlacklists.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type ApiKeyPermission = typeof apiKeyPermissions.$inferSelect;
export type NewApiKeyPermission = typeof apiKeyPermissions.$inferInsert;
export type ApiLog = typeof apiLogs.$inferSelect;
export type NewApiLog = typeof apiLogs.$inferInsert;
export type UserStatusLog = typeof userStatusLogs.$inferSelect;
export type NewUserStatusLog = typeof userStatusLogs.$inferInsert;
export type SongCollaborator = typeof songCollaborators.$inferSelect;
export type NewSongCollaborator = typeof songCollaborators.$inferInsert;
export type CollaborationLog = typeof collaborationLogs.$inferSelect;
export type NewCollaborationLog = typeof collaborationLogs.$inferInsert;
export type SongReplayRequest = typeof songReplayRequests.$inferSelect;
export type NewSongReplayRequest = typeof songReplayRequests.$inferInsert;
export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type NewEmailTemplate = typeof emailTemplates.$inferInsert;export type RequestTime = typeof requestTimes.$inferSelect;
export type NewRequestTime = typeof requestTimes.$inferInsert;
export type UserIdentity = typeof userIdentities.$inferSelect;
export type NewUserIdentity = typeof userIdentities.$inferInsert;
// 卡密表
export const cardCodes = pgTable('CardCode', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  code: text('code').notNull().unique(),
  status: cardCodeStatusEnum('status').default('AVAILABLE').notNull(),
  lockedBy: integer('lockedBy').references(() => users.id, { onDelete: 'set null' }),
  lockedAt: timestamp('lockedAt'),
  redeemedBy: integer('redeemedBy').references(() => users.id, { onDelete: 'set null' }),
  redeemedAt: timestamp('redeemedAt'),
  note: text('note'),
});

// 卡密兑换日志表
export const cardCodeRedeemLogs = pgTable('CardCodeRedeemLog', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  cardCodeId: integer('cardCodeId').references(() => cardCodes.id, { onDelete: 'set null' }),
  codeSnapshot: text('codeSnapshot').notNull(),
  redeemedBy: integer('redeemedBy').notNull().references(() => users.id, { onDelete: 'restrict' }),
  redeemedAt: timestamp('redeemedAt').defaultNow().notNull(),
  source: text('source').default('UNKNOWN').notNull(),
  songId: integer('songId').references(() => songs.id, { onDelete: 'set null' })
}, (table) => [
  index('card_code_redeem_log_card_code_id_idx').on(table.cardCodeId)
]);

export type CardCode = typeof cardCodes.$inferSelect;
export type NewCardCode = typeof cardCodes.$inferInsert;

// 自动备份历史记录表
export const backupHistory = pgTable('BackupHistory', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  filename: text('filename').notNull(),
  totalRecords: integer('totalRecords').default(0).notNull(),
  backupSize: integer('backupSize').default(0).notNull(),
  methods: text('methods').notNull(), // JSON: { method: string; success: boolean; error?: string }[]
  success: boolean('success').default(false).notNull(),
  triggeredBy: text('triggeredBy'), // 'api' | 'manual'
}, (table) => [
  index('backup_history_created_at_idx').on(table.createdAt)
]);

export type BackupHistory = typeof backupHistory.$inferSelect;
export type NewBackupHistory = typeof backupHistory.$inferInsert;

// ───────────────────────── 公告栏 / 媒体资源 / 改名申请（2026-10-11） ─────────────────────────

// 媒体资源：运行时上传的图片不能放 public（Nitro 资源清单构建期烘焙，运行时新增文件一律 404），
// 因此统一存库 + 通过 /api/media/[id] 转发，公告栏图片就走这条路。
export const mediaAssets = pgTable('MediaAsset', {
  id: serial('id').primaryKey(),
  filename: text('filename').notNull(),
  mimeType: text('mimeType').notNull(),
  byteSize: integer('byteSize').notNull(),
  // base64 存放（图片限制 2MB 内），随数据库一起备份，不依赖文件系统
  data: text('data').notNull(),
  uploadedBy: integer('uploadedBy'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
});

export type MediaAsset = typeof mediaAssets.$inferSelect;
export type NewMediaAsset = typeof mediaAssets.$inferInsert;

// 公告栏：首页顶部展示，type=TEXT 显示文字、type=IMAGE 显示图片（引用 MediaAsset.id 或外部链接），
// 多条时前端自动轮播；只有 ADMIN / SUPER_ADMIN 能编辑。
export const announcements = pgTable('Announcement', {
  id: serial('id').primaryKey(),
  type: text('type').default('TEXT').notNull(),
  text: text('text'),
  imageId: integer('imageId'),
  imageUrl: text('imageUrl'),
  linkUrl: text('linkUrl'),
  // 文字公告的显示方式：SCROLL=超宽时跑马灯滚动；WRAP=按需分行完整显示
  displayMode: text('displayMode').default('SCROLL').notNull(),
  // 文字公告字号：SMALL / MEDIUM（默认）/ LARGE
  fontSize: text('fontSize').default('MEDIUM').notNull(),
  sortOrder: integer('sortOrder').default(0).notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  createdBy: integer('createdBy'),
});

export type Announcement = typeof announcements.$inferSelect;
export type NewAnnouncement = typeof announcements.$inferInsert;

// 用户名修改记录（即时生效，仅作历史留痕；真实姓名自助修改功能已于 2026-10-23 下线）
export const nameChangeRequests = pgTable('NameChangeRequest', {
  id: serial('id').primaryKey(),
  userId: integer('userId').notNull(),
  field: text('field').default('NAME').notNull(),
  oldName: text('oldName'),
  newName: text('newName').notNull(),
  // PENDING | APPROVED | REJECTED
  status: text('status').default('PENDING').notNull(),
  reason: text('reason'),
  reviewedBy: integer('reviewedBy'),
  reviewedAt: timestamp('reviewedAt'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
});

export type NameChangeRequest = typeof nameChangeRequests.$inferSelect;
export type NewNameChangeRequest = typeof nameChangeRequests.$inferInsert;

// 管理端敏感操作审计
export const adminAuditLogs = pgTable('AdminAuditLog', {
  id: serial('id').primaryKey(),
  actorId: integer('actorId'),
  actorName: text('actorName'),
  action: text('action').notNull(),
  target: text('target'),
  detail: text('detail'),
  ip: text('ip'),
  userAgent: text('userAgent'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
}, (table) => [
  index('admin_audit_created_idx').on(table.createdAt),
  index('admin_audit_action_idx').on(table.action),
]);

// 边缘 rewriter 上报的攻击行为
export const attackLogs = pgTable('AttackLog', {
  id: serial('id').primaryKey(),
  ip: text('ip').notNull(),
  kind: text('kind').notNull(),
  path: text('path'),
  count: integer('count').default(0),
  userAgent: text('userAgent'),
  fingerprint: text('fingerprint'),
  action: text('action'),
  detail: text('detail'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
}, (table) => [
  index('attack_log_created_idx').on(table.createdAt),
  index('attack_log_ip_idx').on(table.ip),
  index('attack_log_kind_idx').on(table.kind),
]);

// 登录尝试日志（安全事件追溯）
export const loginAttempts = pgTable('LoginAttempt', {
  id: serial('id').primaryKey(),
  username: text('username'),
  ip: text('ip'),
  userAgent: text('userAgent'),
  result: text('result').notNull(),
  detail: text('detail'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
}, (table) => [
  index('login_attempt_created_idx').on(table.createdAt),
  index('login_attempt_username_idx').on(table.username),
]);

export type AdminAuditLog = typeof adminAuditLogs.$inferSelect;
export type AttackLog = typeof attackLogs.$inferSelect;
export type LoginAttempt = typeof loginAttempts.$inferSelect;

// ============================================================
// 回声社区：板块、帖子、评论、称号与社区档案
// 歌曲、点赞、排期与通知复用 VoiceHub 现有表，避免两套数据。
// ============================================================

export const communityBoards = pgTable('CommunityBoard', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  name: text('name').notNull(),
  description: text('description').default('').notNull(),
  sortOrder: integer('sortOrder').default(0).notNull(),
  isActive: boolean('isActive').default(true).notNull(),
}, (table) => [
  uniqueIndex('CommunityBoard_name_unique').on(table.name),
  index('CommunityBoard_sort_idx').on(table.sortOrder)
]);

// 板块审核员：一个同学可以负责多个板块，一个板块可以有多名审核员
export const communityBoardReviewers = pgTable('CommunityBoardReviewer', {
  boardId: integer('boardId').notNull().references(() => communityBoards.id, { onDelete: 'cascade' }),
  userId: integer('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.boardId, table.userId] }),
  index('CommunityBoardReviewer_user_idx').on(table.userId)
]);

export const communityTitles = pgTable('CommunityTitle', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  name: text('name').notNull(),
  description: text('description').default('').notNull(),
}, (table) => [uniqueIndex('CommunityTitle_name_unique').on(table.name)]);

export const communityUserTitles = pgTable('CommunityUserTitle', {
  userId: integer('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  titleId: integer('titleId').notNull().references(() => communityTitles.id, { onDelete: 'cascade' }),
  grantedBy: integer('grantedBy').references(() => users.id, { onDelete: 'set null' }),
  grantedAt: timestamp('grantedAt').defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.titleId] }),
  index('CommunityUserTitle_title_idx').on(table.titleId)
]);

export const communityProfiles = pgTable('CommunityProfile', {
  userId: integer('userId').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  favoriteSongId: integer('favoriteSongId').references(() => songs.id, { onDelete: 'set null' }),
  showFavorite: boolean('showFavorite').default(true).notNull(),
  showLikedSongs: boolean('showLikedSongs').default(true).notNull(),
  equippedTitleId: integer('equippedTitleId').references(() => communityTitles.id, { onDelete: 'set null' }),
  violationCount: integer('violationCount').default(0).notNull(),
  banned: boolean('banned').default(false).notNull(),
  // banned=true 且 bannedUntil 为空表示永久禁言
  bannedUntil: timestamp('bannedUntil'),
  banReason: text('banReason'),
});

// 相互点赞成就：每个用户在每个阈值上只记录第一位达成伙伴
// songsSnapshot 保存达成时双方共同点赞歌曲的标题快照（JSON），仅本人可见
export const communityResonance = pgTable('CommunityResonance', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  userId: integer('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  partnerId: integer('partnerId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  titleId: integer('titleId').references(() => communityTitles.id, { onDelete: 'set null' }),
  // 达成阈值：50 / 200
  threshold: integer('threshold').notNull(),
  mutualCount: integer('mutualCount').notNull(),
  songsSnapshot: text('songsSnapshot').notNull(),
}, (table) => [
  uniqueIndex('CommunityResonance_user_threshold_unique').on(table.userId, table.threshold),
  index('CommunityResonance_partner_idx').on(table.partnerId),
  index('CommunityResonance_user_idx').on(table.userId, table.createdAt)
]);

export const communityPosts = pgTable('CommunityPost', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  boardId: integer('boardId').notNull().references(() => communityBoards.id, { onDelete: 'restrict' }),
  authorId: integer('authorId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  songId: integer('songId').references(() => songs.id, { onDelete: 'set null' }),
  // PENDING / APPROVED / REJECTED / BLOCKED
  status: text('status').default('PENDING').notNull(),
  moderationLabel: text('moderationLabel'),
  moderationDetail: text('moderationDetail'),
  reviewNote: text('reviewNote'),
  reviewedBy: integer('reviewedBy').references(() => users.id, { onDelete: 'set null' }),
  reviewedAt: timestamp('reviewedAt'),
  // 软删除/撤回：归档保留 30 天，到期由清理任务物理删除
  deletedAt: timestamp('deletedAt'),
  deletedBy: integer('deletedBy').references(() => users.id, { onDelete: 'set null' }),
  // WITHDRAW=作者撤回 / DELETE=管理员或审帖员删除
  deleteType: text('deleteType'),
  deleteReason: text('deleteReason'),
  purgeAt: timestamp('purgeAt'),
}, (table) => [
  index('CommunityPost_feed_idx').on(table.status, table.createdAt),
  index('CommunityPost_board_feed_idx').on(table.boardId, table.status, table.createdAt),
  index('CommunityPost_author_idx').on(table.authorId, table.createdAt),
  index('CommunityPost_deleted_idx').on(table.deletedAt),
  index('CommunityPost_purge_idx').on(table.purgeAt)
]);

export const communityComments = pgTable('CommunityComment', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  postId: integer('postId').notNull().references(() => communityPosts.id, { onDelete: 'cascade' }),
  authorId: integer('authorId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  // PENDING / APPROVED / REJECTED / BLOCKED，评论与帖子走同一套审核流程
  status: text('status').default('PENDING').notNull(),
  moderationLabel: text('moderationLabel'),
  moderationDetail: text('moderationDetail'),
  reviewNote: text('reviewNote'),
  reviewedBy: integer('reviewedBy').references(() => users.id, { onDelete: 'set null' }),
  reviewedAt: timestamp('reviewedAt'),
  deletedAt: timestamp('deletedAt'),
  deletedBy: integer('deletedBy').references(() => users.id, { onDelete: 'set null' }),
  deleteType: text('deleteType'),
  deleteReason: text('deleteReason'),
  purgeAt: timestamp('purgeAt'),
}, (table) => [
  index('CommunityComment_post_idx').on(table.postId, table.createdAt),
  index('CommunityComment_status_idx').on(table.status, table.createdAt),
  index('CommunityComment_author_idx').on(table.authorId, table.createdAt),
  index('CommunityComment_purge_idx').on(table.purgeAt)
]);

// 帖子配图：图片先落到 MediaAsset，再按顺序关联到帖子，避免帖子表存大字段
export const communityPostImages = pgTable('CommunityPostImage', {
  postId: integer('postId').notNull().references(() => communityPosts.id, { onDelete: 'cascade' }),
  mediaId: integer('mediaId').notNull().references(() => mediaAssets.id, { onDelete: 'cascade' }),
  sortOrder: integer('sortOrder').default(0).notNull(),
}, (table) => [
  primaryKey({ columns: [table.postId, table.mediaId] }),
  index('CommunityPostImage_post_idx').on(table.postId, table.sortOrder)
]);

// 社区全局配置（单例，id 固定为 1）：开关、图片开关与阿里云内容安全参数
export const communitySettings = pgTable('CommunitySettings', {
  id: integer('id').primaryKey().default(1),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  // 一键开启/关闭回声社区
  enabled: boolean('enabled').default(false).notNull(),
  // 发帖是否允许附加图片
  allowImages: boolean('allowImages').default(false).notNull(),
  maxImages: integer('maxImages').default(9).notNull(),
  maxContentLength: integer('maxContentLength').default(1000).notNull(),
  maxCommentLength: integer('maxCommentLength').default(300).notNull(),
  // 阿里云内容安全（Green）：未填写密钥时只走人工审核
  moderationEnabled: boolean('moderationEnabled').default(false).notNull(),
  aliyunAccessKeyId: text('aliyunAccessKeyId'),
  aliyunAccessKeySecret: text('aliyunAccessKeySecret'),
  aliyunEndpoint: text('aliyunEndpoint').default('green-cip.cn-shanghai.aliyuncs.com').notNull(),
  aliyunRegionId: text('aliyunRegionId').default('cn-shanghai').notNull(),
  aliyunTextService: text('aliyunTextService').default('comment_detection').notNull(),
  aliyunImageService: text('aliyunImageService').default('baselineCheck').notNull(),
  aliyunConnectTimeoutMs: integer('aliyunConnectTimeoutMs').default(3000).notNull(),
  aliyunReadTimeoutMs: integer('aliyunReadTimeoutMs').default(6000).notNull(),
  // 命中内容安全时：MANUAL=转人工复核（默认）/ BLOCK=直接拦截
  moderationHitAction: text('moderationHitAction').default('MANUAL').notNull(),
});

export type CommunityBoard = typeof communityBoards.$inferSelect;
export type CommunityPost = typeof communityPosts.$inferSelect;
export type CommunityComment = typeof communityComments.$inferSelect;
export type CommunityTitle = typeof communityTitles.$inferSelect;
export type CommunityProfile = typeof communityProfiles.$inferSelect;
export type CommunitySettings = typeof communitySettings.$inferSelect;
export type CommunityPostImage = typeof communityPostImages.$inferSelect;
export type CommunityResonance = typeof communityResonance.$inferSelect;
