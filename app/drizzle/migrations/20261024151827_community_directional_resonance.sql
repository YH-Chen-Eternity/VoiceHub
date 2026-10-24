ALTER TABLE "CommunityResonance" ADD COLUMN "sentCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "CommunityResonance" ADD COLUMN "receivedCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "CommunitySettings" SET "maxImages" = 9 WHERE "maxImages" < 9;--> statement-breakpoint
UPDATE "CommunityTitle" SET description = '互相点赞对方投稿的歌曲各 50 首' WHERE name = '共鸣';--> statement-breakpoint
UPDATE "CommunityTitle" SET name = '70亿个灵魂都在找同个永恒', description = '互相点赞对方投稿的歌曲各 100 首' WHERE name = '70亿人中寻找永恒';