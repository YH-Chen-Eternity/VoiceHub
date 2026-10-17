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
import { eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { users } from '~/drizzle/schema'
import { createApiError } from '~~/server/utils/apiError'
import { getClientIP } from '~~/server/utils/ip-utils'

// 注销前验证邮箱：往当前绑定邮箱发验证码
export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createApiError(401, 'AUTH_UNAUTHORIZED_ACCESS', '未授权访问')

  const [row] = await db
    .select({ email: users.email, emailVerified: users.emailVerified, name: users.name })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1)

  if (!row?.email) {
    throw createApiError(400, 'DELETE_ACCOUNT_NO_EMAIL', '账号未绑定邮箱，无法自助注销，请联系管理员')
  }

  const { sendEmailVerificationCode } = await import('~~/server/api/user/email/send-code.post')
  await sendEmailVerificationCode(user.id, row.email, row.name || undefined, getClientIP(event), 'verification.code.deletion')

  const [local, domain] = row.email.split('@')
  const masked = local && domain && local.length > 2 ? `${local.slice(0, 2)}****@${domain}` : row.email
  return { success: true, email: masked }
})
