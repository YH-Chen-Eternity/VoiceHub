-- Modified by YH-Chen on 2026-10-17
-- GPL-3.0: Copyright (C) 2026 YH-Chen - VoiceHub-Plus community edition
-- 点赞是否对投稿人公开身份（默认公开）
ALTER TABLE "Vote" ADD COLUMN IF NOT EXISTS "revealToRequester" boolean DEFAULT true NOT NULL;--> statement-breakpoint
