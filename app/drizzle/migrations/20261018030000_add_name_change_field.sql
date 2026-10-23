-- Copyright (C) 2026 YH-Chen-Eternity | VoiceHub-Plus 社区版新增 | SPDX-License-Identifier: GPL-3.0-only

-- 改名申请支持「用户名」变更：新增 field 字段（NAME / USERNAME）
ALTER TABLE "NameChangeRequest" ADD COLUMN IF NOT EXISTS "field" text DEFAULT 'NAME' NOT NULL;
