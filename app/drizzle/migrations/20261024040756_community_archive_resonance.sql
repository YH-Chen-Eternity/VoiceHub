CREATE TABLE "CommunityResonance" (
	"id" serial PRIMARY KEY NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"userId" integer NOT NULL,
	"partnerId" integer NOT NULL,
	"titleId" integer,
	"threshold" integer NOT NULL,
	"mutualCount" integer NOT NULL,
	"songsSnapshot" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "CommunitySettings" ALTER COLUMN "maxImages" SET DEFAULT 9;--> statement-breakpoint
ALTER TABLE "CommunityComment" ADD COLUMN "status" text DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
-- 存量评论视为已通过，避免升级后历史评论全部消失
UPDATE "CommunityComment" SET "status" = 'APPROVED' WHERE "status" = 'PENDING';--> statement-breakpoint
ALTER TABLE "CommunityComment" ADD COLUMN "moderationLabel" text;--> statement-breakpoint
ALTER TABLE "CommunityComment" ADD COLUMN "moderationDetail" text;--> statement-breakpoint
ALTER TABLE "CommunityComment" ADD COLUMN "reviewNote" text;--> statement-breakpoint
ALTER TABLE "CommunityComment" ADD COLUMN "reviewedBy" integer;--> statement-breakpoint
ALTER TABLE "CommunityComment" ADD COLUMN "reviewedAt" timestamp;--> statement-breakpoint
ALTER TABLE "CommunityComment" ADD COLUMN "deletedAt" timestamp;--> statement-breakpoint
ALTER TABLE "CommunityComment" ADD COLUMN "deletedBy" integer;--> statement-breakpoint
ALTER TABLE "CommunityComment" ADD COLUMN "deleteType" text;--> statement-breakpoint
ALTER TABLE "CommunityComment" ADD COLUMN "deleteReason" text;--> statement-breakpoint
ALTER TABLE "CommunityComment" ADD COLUMN "purgeAt" timestamp;--> statement-breakpoint
ALTER TABLE "CommunityPost" ADD COLUMN "deletedAt" timestamp;--> statement-breakpoint
ALTER TABLE "CommunityPost" ADD COLUMN "deletedBy" integer;--> statement-breakpoint
ALTER TABLE "CommunityPost" ADD COLUMN "deleteType" text;--> statement-breakpoint
ALTER TABLE "CommunityPost" ADD COLUMN "deleteReason" text;--> statement-breakpoint
ALTER TABLE "CommunityPost" ADD COLUMN "purgeAt" timestamp;--> statement-breakpoint
ALTER TABLE "CommunityResonance" ADD CONSTRAINT "CommunityResonance_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CommunityResonance" ADD CONSTRAINT "CommunityResonance_partnerId_User_id_fk" FOREIGN KEY ("partnerId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CommunityResonance" ADD CONSTRAINT "CommunityResonance_titleId_CommunityTitle_id_fk" FOREIGN KEY ("titleId") REFERENCES "public"."CommunityTitle"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "CommunityResonance_user_threshold_unique" ON "CommunityResonance" USING btree ("userId","threshold");--> statement-breakpoint
CREATE INDEX "CommunityResonance_partner_idx" ON "CommunityResonance" USING btree ("partnerId");--> statement-breakpoint
CREATE INDEX "CommunityResonance_user_idx" ON "CommunityResonance" USING btree ("userId","createdAt");--> statement-breakpoint
ALTER TABLE "CommunityComment" ADD CONSTRAINT "CommunityComment_reviewedBy_User_id_fk" FOREIGN KEY ("reviewedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CommunityComment" ADD CONSTRAINT "CommunityComment_deletedBy_User_id_fk" FOREIGN KEY ("deletedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CommunityPost" ADD CONSTRAINT "CommunityPost_deletedBy_User_id_fk" FOREIGN KEY ("deletedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "CommunityComment_status_idx" ON "CommunityComment" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "CommunityComment_author_idx" ON "CommunityComment" USING btree ("authorId","createdAt");--> statement-breakpoint
CREATE INDEX "CommunityComment_purge_idx" ON "CommunityComment" USING btree ("purgeAt");--> statement-breakpoint
CREATE INDEX "CommunityPost_deleted_idx" ON "CommunityPost" USING btree ("deletedAt");--> statement-breakpoint
CREATE INDEX "CommunityPost_purge_idx" ON "CommunityPost" USING btree ("purgeAt");