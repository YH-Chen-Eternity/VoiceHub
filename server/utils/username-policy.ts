/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

// Copyright (C) 2026 YH-Chen
//
// This file is part of VoiceHub-Plus (an unofficial community edition),
// based on VoiceHub <https://github.com/laoshuikaixue/VoiceHub>.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

// 用户名规则（2026-10-23 站长要求）：
// 1. 仅允许英文、数字、下划线，禁止中文及其他符号；
// 2. 长度 2-20 个字符；
// 3. 不能是纯数字；
// 4. 必须唯一（唯一性由各调用处查库判定，本工具只负责格式）。
// 适用面：用户自助修改用户名、管理员创建/编辑/批量修改用户名。
// 注意：注册链路（auth/register、auth/oauth-register）沿用 oauth-register.ts 的历史规则，未纳入本策略。
export const USERNAME_PATTERN = /^[A-Za-z0-9_]+$/
export const USERNAME_MIN_LENGTH = 2
export const USERNAME_MAX_LENGTH = 20

export function validateUsernameFormat(value: string): { code: string; message: string } | null {
  if (value.length < USERNAME_MIN_LENGTH || value.length > USERNAME_MAX_LENGTH) {
    return {
      code: 'USERNAME_INVALID',
      message: `用户名长度需为 ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} 个字符`
    }
  }
  if (!USERNAME_PATTERN.test(value)) {
    return { code: 'USERNAME_INVALID', message: '用户名只能包含英文、数字和下划线，不能使用中文' }
  }
  if (/^\d+$/.test(value)) {
    return { code: 'USERNAME_INVALID', message: '用户名不能是纯数字' }
  }
  return null
}
