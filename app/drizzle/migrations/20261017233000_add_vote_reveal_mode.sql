-- Modified by YH-Chen on 2026-10-17
-- GPL-3.0: Copyright (C) 2026 YH-Chen - VoiceHub-Plus community edition
-- 点赞署名偏好：ASK=每次询问（默认）/ ANONYMOUS=总是匿名 / REVEAL=总是署名
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "voteRevealMode" text DEFAULT 'ASK' NOT NULL;--> statement-breakpoint
