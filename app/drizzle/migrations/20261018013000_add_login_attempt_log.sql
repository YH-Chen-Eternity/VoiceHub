-- Copyright (C) 2026 YH-Chen-Eternity | VoiceHub-Plus 社区版新增 | SPDX-License-Identifier: GPL-3.0-only

-- 登录尝试日志（安全事件追溯用，记录被尝试的账号名）
CREATE TABLE IF NOT EXISTS "LoginAttempt" (
  "id" serial PRIMARY KEY,
  "username" text,
  "ip" text,
  "userAgent" text,
  "result" text NOT NULL,
  "detail" text,
  "createdAt" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_attempt_created_idx" ON "LoginAttempt" ("createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_attempt_username_idx" ON "LoginAttempt" ("username");
