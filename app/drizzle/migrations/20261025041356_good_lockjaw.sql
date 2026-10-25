CREATE TABLE "CommunityAppeal" (
	"id" serial PRIMARY KEY NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"userId" integer NOT NULL,
	"targetType" text NOT NULL,
	"targetId" integer NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"handledBy" integer,
	"handledAt" timestamp,
	"resultNote" text
);
--> statement-breakpoint
CREATE TABLE "CommunityBlock" (
	"blockerId" integer NOT NULL,
	"blockedId" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "CommunityBlock_blockerId_blockedId_pk" PRIMARY KEY("blockerId","blockedId")
);
--> statement-breakpoint
CREATE TABLE "CommunityReport" (
	"id" serial PRIMARY KEY NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"targetType" text NOT NULL,
	"targetId" integer NOT NULL,
	"reporterId" integer NOT NULL,
	"reasonCode" text NOT NULL,
	"detail" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"handledBy" integer,
	"handledAt" timestamp,
	"resultNote" text,
	"actionTaken" text
);
--> statement-breakpoint
ALTER TABLE "CommunityComment" ADD COLUMN "parentId" integer;--> statement-breakpoint
ALTER TABLE "CommunityPost" ADD COLUMN "contentHash" text;--> statement-breakpoint
ALTER TABLE "CommunityProfile" ADD COLUMN "shadowBanned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "CommunitySettings" ADD COLUMN "reportAutoHideThreshold" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "MediaAsset" ADD COLUMN "sha256" text;--> statement-breakpoint
ALTER TABLE "CommunityAppeal" ADD CONSTRAINT "CommunityAppeal_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CommunityAppeal" ADD CONSTRAINT "CommunityAppeal_handledBy_User_id_fk" FOREIGN KEY ("handledBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CommunityBlock" ADD CONSTRAINT "CommunityBlock_blockerId_User_id_fk" FOREIGN KEY ("blockerId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CommunityBlock" ADD CONSTRAINT "CommunityBlock_blockedId_User_id_fk" FOREIGN KEY ("blockedId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CommunityReport" ADD CONSTRAINT "CommunityReport_reporterId_User_id_fk" FOREIGN KEY ("reporterId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CommunityReport" ADD CONSTRAINT "CommunityReport_handledBy_User_id_fk" FOREIGN KEY ("handledBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "CommunityAppeal_status_idx" ON "CommunityAppeal" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "CommunityAppeal_user_idx" ON "CommunityAppeal" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "CommunityBlock_blocked_idx" ON "CommunityBlock" USING btree ("blockedId");--> statement-breakpoint
CREATE UNIQUE INDEX "CommunityReport_reporter_target_unique" ON "CommunityReport" USING btree ("reporterId","targetType","targetId");--> statement-breakpoint
CREATE INDEX "CommunityReport_status_idx" ON "CommunityReport" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "CommunityReport_target_idx" ON "CommunityReport" USING btree ("targetType","targetId");