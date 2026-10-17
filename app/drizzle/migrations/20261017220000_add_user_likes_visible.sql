-- Modified by YH-Chen on 2026-10-17
-- GPL-3.0: Copyright (C) 2026 YH-Chen - VoiceHub-Plus community edition
-- 我的点赞列表可见性（默认对其他同学可见）
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "likesVisible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
