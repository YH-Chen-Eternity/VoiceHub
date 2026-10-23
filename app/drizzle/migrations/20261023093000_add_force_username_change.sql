-- Copyright (C) 2026 YH-Chen-Eternity | VoiceHub-Plus 社区版新增 | SPDX-License-Identifier: GPL-3.0-only

-- 用户管理「强制更新」：新增「强制修改用户名」标记（密码沿用 forcePasswordChange）
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "forceUsernameChange" boolean DEFAULT false NOT NULL;
