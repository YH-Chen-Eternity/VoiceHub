-- 回声社区：板块、帖子、评论、称号、社区档案、配图与全局配置
-- 注意：本迁移只新增社区相关对象，不改动既有业务表。

CREATE TABLE "CommunityBoard" (
	"id" serial PRIMARY KEY NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "CommunityBoardReviewer" (
	"boardId" integer NOT NULL,
	"userId" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "CommunityBoardReviewer_boardId_userId_pk" PRIMARY KEY("boardId","userId")
);
--> statement-breakpoint
CREATE TABLE "CommunityTitle" (
	"id" serial PRIMARY KEY NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "CommunityUserTitle" (
	"userId" integer NOT NULL,
	"titleId" integer NOT NULL,
	"grantedBy" integer,
	"grantedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "CommunityUserTitle_userId_titleId_pk" PRIMARY KEY("userId","titleId")
);
--> statement-breakpoint
CREATE TABLE "CommunityProfile" (
	"userId" integer PRIMARY KEY NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"favoriteSongId" integer,
	"showFavorite" boolean DEFAULT true NOT NULL,
	"showLikedSongs" boolean DEFAULT true NOT NULL,
	"equippedTitleId" integer,
	"violationCount" integer DEFAULT 0 NOT NULL,
	"banned" boolean DEFAULT false NOT NULL,
	"bannedUntil" timestamp,
	"banReason" text
);
--> statement-breakpoint
CREATE TABLE "CommunityPost" (
	"id" serial PRIMARY KEY NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"boardId" integer NOT NULL,
	"authorId" integer NOT NULL,
	"content" text NOT NULL,
	"songId" integer,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"moderationLabel" text,
	"moderationDetail" text,
	"reviewNote" text,
	"reviewedBy" integer,
	"reviewedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "CommunityPostImage" (
	"postId" integer NOT NULL,
	"mediaId" integer NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "CommunityPostImage_postId_mediaId_pk" PRIMARY KEY("postId","mediaId")
);
--> statement-breakpoint
CREATE TABLE "CommunityComment" (
	"id" serial PRIMARY KEY NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"postId" integer NOT NULL,
	"authorId" integer NOT NULL,
	"content" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "CommunitySettings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"allowImages" boolean DEFAULT false NOT NULL,
	"maxImages" integer DEFAULT 3 NOT NULL,
	"maxContentLength" integer DEFAULT 1000 NOT NULL,
	"maxCommentLength" integer DEFAULT 300 NOT NULL,
	"moderationEnabled" boolean DEFAULT false NOT NULL,
	"aliyunAccessKeyId" text,
	"aliyunAccessKeySecret" text,
	"aliyunEndpoint" text DEFAULT 'green-cip.cn-shanghai.aliyuncs.com' NOT NULL,
	"aliyunRegionId" text DEFAULT 'cn-shanghai' NOT NULL,
	"aliyunTextService" text DEFAULT 'comment_detection' NOT NULL,
	"aliyunImageService" text DEFAULT 'baselineCheck' NOT NULL,
	"aliyunConnectTimeoutMs" integer DEFAULT 3000 NOT NULL,
	"aliyunReadTimeoutMs" integer DEFAULT 6000 NOT NULL,
	"moderationHitAction" text DEFAULT 'MANUAL' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "CommunityBoardReviewer" ADD CONSTRAINT "CommunityBoardReviewer_boardId_CommunityBoard_id_fk" FOREIGN KEY ("boardId") REFERENCES "public"."CommunityBoard"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CommunityBoardReviewer" ADD CONSTRAINT "CommunityBoardReviewer_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CommunityComment" ADD CONSTRAINT "CommunityComment_postId_CommunityPost_id_fk" FOREIGN KEY ("postId") REFERENCES "public"."CommunityPost"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CommunityComment" ADD CONSTRAINT "CommunityComment_authorId_User_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CommunityPostImage" ADD CONSTRAINT "CommunityPostImage_postId_CommunityPost_id_fk" FOREIGN KEY ("postId") REFERENCES "public"."CommunityPost"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CommunityPostImage" ADD CONSTRAINT "CommunityPostImage_mediaId_MediaAsset_id_fk" FOREIGN KEY ("mediaId") REFERENCES "public"."MediaAsset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CommunityPost" ADD CONSTRAINT "CommunityPost_boardId_CommunityBoard_id_fk" FOREIGN KEY ("boardId") REFERENCES "public"."CommunityBoard"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CommunityPost" ADD CONSTRAINT "CommunityPost_authorId_User_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CommunityPost" ADD CONSTRAINT "CommunityPost_songId_Song_id_fk" FOREIGN KEY ("songId") REFERENCES "public"."Song"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CommunityPost" ADD CONSTRAINT "CommunityPost_reviewedBy_User_id_fk" FOREIGN KEY ("reviewedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CommunityProfile" ADD CONSTRAINT "CommunityProfile_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CommunityProfile" ADD CONSTRAINT "CommunityProfile_favoriteSongId_Song_id_fk" FOREIGN KEY ("favoriteSongId") REFERENCES "public"."Song"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CommunityProfile" ADD CONSTRAINT "CommunityProfile_equippedTitleId_CommunityTitle_id_fk" FOREIGN KEY ("equippedTitleId") REFERENCES "public"."CommunityTitle"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CommunityUserTitle" ADD CONSTRAINT "CommunityUserTitle_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CommunityUserTitle" ADD CONSTRAINT "CommunityUserTitle_titleId_CommunityTitle_id_fk" FOREIGN KEY ("titleId") REFERENCES "public"."CommunityTitle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CommunityUserTitle" ADD CONSTRAINT "CommunityUserTitle_grantedBy_User_id_fk" FOREIGN KEY ("grantedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "CommunityBoardReviewer_user_idx" ON "CommunityBoardReviewer" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "CommunityBoard_name_unique" ON "CommunityBoard" USING btree ("name");--> statement-breakpoint
CREATE INDEX "CommunityBoard_sort_idx" ON "CommunityBoard" USING btree ("sortOrder");--> statement-breakpoint
CREATE INDEX "CommunityComment_post_idx" ON "CommunityComment" USING btree ("postId","createdAt");--> statement-breakpoint
CREATE INDEX "CommunityPostImage_post_idx" ON "CommunityPostImage" USING btree ("postId","sortOrder");--> statement-breakpoint
CREATE INDEX "CommunityPost_feed_idx" ON "CommunityPost" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "CommunityPost_board_feed_idx" ON "CommunityPost" USING btree ("boardId","status","createdAt");--> statement-breakpoint
CREATE INDEX "CommunityPost_author_idx" ON "CommunityPost" USING btree ("authorId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "CommunityTitle_name_unique" ON "CommunityTitle" USING btree ("name");--> statement-breakpoint
CREATE INDEX "CommunityUserTitle_title_idx" ON "CommunityUserTitle" USING btree ("titleId");--> statement-breakpoint

-- 默认板块
INSERT INTO "CommunityBoard" ("name", "description", "sortOrder", "isActive") VALUES
	('日常闲聊', '课间十分钟，随便聊聊', 10, true),
	('点歌许愿', '想听什么歌？在这里许愿', 20, true),
	('音乐分享', '把喜欢的歌安利给全校', 30, true),
	('求助问答', '有问题，找同学', 40, true)
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
-- 默认配置：默认关闭，由管理员在后台一键开启
INSERT INTO "CommunitySettings" ("id") VALUES (1)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- 默认称号
INSERT INTO "CommunityTitle" ("name", "description") VALUES
	('校园麦霸', '开麦即巅峰'),
	('耳机党', '沉浸式听歌选手'),
	('夜猫子', '深夜也在线'),
	('点歌达人', '许愿池常客')
ON CONFLICT ("name") DO NOTHING;
