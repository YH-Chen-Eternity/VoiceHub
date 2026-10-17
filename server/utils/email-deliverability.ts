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
import { promises as dns } from 'node:dns'

/**
 * 邮箱可达性预检（发验证码之前跑）。
 *
 * 背景：学生把邮箱写错（最常见的是域名写错，如 `@qq.con`、`@163com`、少个字母），
 * 邮件根本发不出去，但前端只看到"验证码已发送"，于是反复来问"为什么收不到验证码"。
 * 这里在发信前查一次域名的收信能力，把"这个邮箱根本收不到邮件"提前变成一条明确提示。
 *
 * 判定原则是**宁可放过、不可误伤**：
 *   - 域名有 MX → 放行
 *   - 没有 MX 但有 A/AAAA（RFC 5321 允许退回到 A 记录）→ 放行
 *   - DNS 明确回答"域名不存在"（ENOTFOUND/NXDOMAIN）或既无 MX 又无 A/AAAA → 判为不可达
 *   - DNS 查询本身报错（超时/SERVFAIL/被墙）→ **放行**，绝不因为解析服务抖动拦住正常邮箱
 */
export type EmailDeliverability = { ok: true } | { ok: false; reason: 'syntax' | 'no-mail-host' }

const SYNTAX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const lookupHasRecord = async (domain: string, fn: (d: string) => Promise<unknown[]>): Promise<boolean> => {
  try {
    const records = await fn(domain)
    return Array.isArray(records) && records.length > 0
  } catch {
    return false
  }
}

export async function checkEmailDeliverability(email: string): Promise<EmailDeliverability> {
  const value = String(email || '').trim().toLowerCase()
  if (!SYNTAX.test(value)) return { ok: false, reason: 'syntax' }

  const domain = value.slice(value.lastIndexOf('@') + 1)
  if (!domain || !domain.includes('.')) return { ok: false, reason: 'syntax' }

  let mxEmptyOrMissing = false
  try {
    const mx = await dns.resolveMx(domain)
    if (Array.isArray(mx) && mx.length > 0) return { ok: true }
    mxEmptyOrMissing = true // 域名存在但没有 MX 记录
  } catch (error: any) {
    const code = String(error?.code || '')
    if (code === 'ENOTFOUND' || code === 'NXDOMAIN' || code === 'ENODATA') {
      mxEmptyOrMissing = true // 域名不存在或查不到 MX，继续用 A/AAAA 兜底判断
    } else {
      // 超时 / SERVFAIL / 解析器不可用：不拦，交给真正发信时再暴露问题
      return { ok: true }
    }
  }

  if (!mxEmptyOrMissing) return { ok: true }

  const hasAddress = (await lookupHasRecord(domain, dns.resolve4)) || (await lookupHasRecord(domain, dns.resolve6))
  return hasAddress ? { ok: true } : { ok: false, reason: 'no-mail-host' }
}

/** 最近一次发信失败是否属于「收件人这一侧被永久拒绝」（收件人不存在/地址非法） */
export const isPermanentRecipientFailure = (
  failure?: { responseCode?: number; code?: string; message?: string } | null
): boolean => {
  if (!failure) return false
  const responseCode = Number(failure.responseCode || 0)
  const isPermanent = responseCode >= 500 && responseCode < 600
  if (!isPermanent) return false
  const text = `${failure.code || ''} ${failure.message || ''}`
  return (
    failure.code === 'EENVELOPE' ||
    /recipient|user unknown|no such user|mailbox|invalid address|does not exist|not exist/i.test(text)
  )
}
