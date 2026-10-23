-- Copyright (C) 2026 YH-Chen-Eternity | VoiceHub-Plus 社区版新增 | SPDX-License-Identifier: GPL-3.0-only

-- 攻击行为日志表（边缘 rewriter 检测到后写入）
CREATE TABLE IF NOT EXISTS "AttackLog" (
  "id" serial PRIMARY KEY,
  "ip" text NOT NULL,
  "kind" text NOT NULL,
  "path" text,
  "count" integer DEFAULT 0,
  "userAgent" text,
  "fingerprint" text,
  "action" text,
  "detail" text,
  "createdAt" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attack_log_created_idx" ON "AttackLog" ("createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attack_log_ip_idx" ON "AttackLog" ("ip");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attack_log_kind_idx" ON "AttackLog" ("kind");
