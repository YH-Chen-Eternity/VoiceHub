CREATE TABLE "CommunityPostView" (
	"postId" integer NOT NULL,
	"userId" integer NOT NULL,
	"viewedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "CommunityPostView_postId_userId_pk" PRIMARY KEY("postId","userId")
);
--> statement-breakpoint
ALTER TABLE "CommunityPostView" ADD CONSTRAINT "CommunityPostView_postId_CommunityPost_id_fk" FOREIGN KEY ("postId") REFERENCES "public"."CommunityPost"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CommunityPostView" ADD CONSTRAINT "CommunityPostView_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "CommunityPostView_user_idx" ON "CommunityPostView" USING btree ("userId","viewedAt");