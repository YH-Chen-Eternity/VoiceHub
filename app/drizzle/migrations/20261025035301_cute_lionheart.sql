CREATE TABLE "CommunityPostLike" (
	"postId" integer NOT NULL,
	"userId" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "CommunityPostLike_postId_userId_pk" PRIMARY KEY("postId","userId")
);
--> statement-breakpoint
ALTER TABLE "CommunityPost" ADD COLUMN "viewCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "CommunityPost" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "CommunityPost" ADD COLUMN "likeCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "CommunityPostLike" ADD CONSTRAINT "CommunityPostLike_postId_CommunityPost_id_fk" FOREIGN KEY ("postId") REFERENCES "public"."CommunityPost"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CommunityPostLike" ADD CONSTRAINT "CommunityPostLike_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "CommunityPostLike_user_idx" ON "CommunityPostLike" USING btree ("userId","createdAt");