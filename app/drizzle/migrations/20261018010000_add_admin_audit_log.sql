-- Copyright (C) 2026 YH-Chen-Eternity | VoiceHub-Plus 社区版新增 | SPDX-License-Identifier: GPL-3.0-only

-- 管理端敏感操作审计表
CREATE TABLE IF NOT EXISTS "AdminAuditLog" (
  "id" serial PRIMARY KEY,
  "actorId" integer,
  "actorName" text,
  "action" text NOT NULL,
  "target" text,
  "detail" text,
  "ip" text,
  "userAgent" text,
  "createdAt" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_created_idx" ON "AdminAuditLog" ("createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_action_idx" ON "AdminAuditLog" ("action");
