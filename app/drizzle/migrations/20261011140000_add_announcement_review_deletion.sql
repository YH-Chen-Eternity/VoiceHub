-- Copyright (C) 2026 YH-Chen
--
-- This file is part of VoiceHub-Plus (an unofficial community edition),
-- based on VoiceHub <https://github.com/laoshuikaixue/VoiceHub>.
--
-- This program is free software: you can redistribute it and/or modify
-- it under the terms of the GNU General Public License as published by
-- the Free Software Foundation, either version 3 of the License, or
-- (at your option) any later version.
--
-- This program is distributed in the hope that it will be useful,
-- but WITHOUT ANY WARRANTY; without even the implied warranty of
-- MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
-- GNU General Public License for more details.
--
-- You should have received a copy of the GNU General Public License
-- along with this program. If not, see <https://www.gnu.org/licenses/>.
-- 公告栏 + 媒体资源 + 改名审核 + 自助注销（2026-10-11）
--
-- ⚠️ 顺序要求：user_status 的 'pending_deletion' 必须先于任何使用它的 UPDATE 提交。
--    本迁移只 ADD VALUE，不在同一事务里使用它；生产清理脚本若要用该状态，需自行先 ADD VALUE。

ALTER TYPE "public"."user_status" ADD VALUE IF NOT EXISTS 'pending_deletion';--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deletionRequestedAt" timestamp;--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deletionScheduledAt" timestamp;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "MediaAsset" (
  "id" serial PRIMARY KEY,
  "filename" text NOT NULL,
  "mimeType" text NOT NULL,
  "byteSize" integer NOT NULL,
  "data" text NOT NULL,
  "uploadedBy" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "Announcement" (
  "id" serial PRIMARY KEY,
  "type" text DEFAULT 'TEXT' NOT NULL,
  "text" text,
  "imageId" integer,
  "imageUrl" text,
  "linkUrl" text,
  "sortOrder" integer DEFAULT 0 NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  "createdBy" integer
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "NameChangeRequest" (
  "id" serial PRIMARY KEY,
  "userId" integer NOT NULL,
  "oldName" text,
  "newName" text NOT NULL,
  "status" text DEFAULT 'PENDING' NOT NULL,
  "reason" text,
  "reviewedBy" integer,
  "reviewedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
