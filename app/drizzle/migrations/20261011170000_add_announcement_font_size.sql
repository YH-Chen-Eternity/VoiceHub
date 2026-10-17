-- Modified by YH-Chen on 2026-10-17
-- GPL-3.0: Copyright (C) 2026 YH-Chen - VoiceHub-Plus community edition
-- 公告字号可调：SMALL / MEDIUM（默认）/ LARGE
ALTER TABLE "Announcement" ADD COLUMN IF NOT EXISTS "fontSize" text DEFAULT 'MEDIUM' NOT NULL;--> statement-breakpoint
