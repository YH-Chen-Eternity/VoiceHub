/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

// 邮箱域名策略（2026-10-23 站长要求调整）：
// 1. 只允许「主流邮箱」——国内外常用个人邮箱 + 学校/科研邮箱；
// 2. 一次性 / 临时 / 别名转寄邮箱一律拒绝（即便其根域恰好在白名单里，也先按黑名单拦）。
// 白名单采用「根域 + 子域」后缀匹配，一次覆盖 vip.163.com / mail2.sysu.edu.cn 等官方子域，
// 同时避免 qq.com.evil.com 这类伪造成白名单域名的写法绕过。

const MAINSTREAM_EMAIL_DOMAINS = [
  // 国内主流
  'qq.com',
  'foxmail.com',
  '163.com',
  '126.com',
  'yeah.net',
  '188.com',
  'sina.com',
  'sina.cn',
  'sohu.com',
  'aliyun.com',
  '139.com',
  '189.cn',
  'wo.cn',
  '21cn.com',
  '263.net',
  'china.com',
  // 国际主流
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'live.cn',
  'msn.com',
  'yahoo.com',
  'yahoo.co.jp',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'zoho.com',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'yandex.com',
  'tutanota.com'
]

// 学校 / 教育科研邮箱（mail2.sysu.edu.cn、tsinghua.edu.cn 等），按后缀放行
const EDUCATION_EMAIL_SUFFIXES = ['edu.cn', 'ac.cn', 'edu.hk', 'edu.mo']

// 一次性 / 临时 / 弃用邮箱：按「根域」匹配，自动覆盖其所有子域
const DISPOSABLE_EMAIL_DOMAINS = [
  '10minutemail.com',
  '10minutemail.net',
  '20minutemail.com',
  '33mail.com',
  'anonbox.net',
  'burnermail.io',
  'discard.email',
  'dispostable.com',
  'dropmail.me',
  'emailondeck.com',
  'fakeinbox.com',
  'fakemail.net',
  'getairmail.com',
  'getnada.com',
  'guerrillamail.biz',
  'guerrillamail.com',
  'guerrillamail.de',
  'guerrillamail.info',
  'guerrillamail.net',
  'guerrillamail.org',
  'inboxbear.com',
  'incognitomail.com',
  'jetable.org',
  'linshiyouxiang.net',
  'mailcatch.com',
  'maildrop.cc',
  'mailinator.com',
  'mailnesia.com',
  'mailnull.com',
  'mailsac.com',
  'mintemail.com',
  'moakt.com',
  'mohmal.com',
  'mytrashmail.com',
  'sharklasers.com',
  'spam4.me',
  'spambog.com',
  'spambox.us',
  'spamgourmet.com',
  'tempail.com',
  'temp-mail.io',
  'temp-mail.org',
  'tempmail.com',
  'tempmail.net',
  'tempmailo.com',
  'throwawaymail.com',
  'trashmail.com',
  'trashmail.de',
  'trashmail.net',
  'tmpmail.net',
  'tmpmail.org',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
  // 国内常见临时邮箱
  '24mail.chacuo.net',
  'chacuo.net',
  'linshi.email',
  'mailto.plus',
  'snapmail.cc',
  'tempemail.cn'
]

// 关键词兜底：域名任意标签命中这些词时按一次性邮箱拦，覆盖新冒出来的临时邮箱站
const DISPOSABLE_KEYWORDS = [
  '10minutemail',
  'tempmail',
  'temp-mail',
  'tmpmail',
  'throwaway',
  'trashmail',
  'guerrillamail',
  'mailinator',
  'yopmail',
  'fakeinbox',
  'mailsac',
  'dropmail',
  'linshiyouxiang'
]

export function getEmailDomain(email: string): string {
  const normalized = String(email || '').trim().toLowerCase()
  const at = normalized.lastIndexOf('@')
  if (at <= 0 || at === normalized.length - 1) return ''
  return normalized.slice(at + 1).replace(/\.$/, '')
}

function matchesDomainSuffix(domain: string, root: string): boolean {
  return domain === root || domain.endsWith(`.${root}`)
}

export function isDisposableEmail(email: string): boolean {
  const domain = getEmailDomain(email)
  if (!domain) return false
  if (DISPOSABLE_EMAIL_DOMAINS.some((root) => matchesDomainSuffix(domain, root))) return true
  return domain.split('.').some((label) => DISPOSABLE_KEYWORDS.some((keyword) => label.includes(keyword)))
}

export function isMainstreamEmail(email: string): boolean {
  const domain = getEmailDomain(email)
  if (!domain) return false
  if (MAINSTREAM_EMAIL_DOMAINS.some((root) => matchesDomainSuffix(domain, root))) return true
  return EDUCATION_EMAIL_SUFFIXES.some(
    (suffix) => domain === suffix || domain.endsWith(`.${suffix}`)
  )
}

/**
 * 邮箱域名是否可用（主流邮箱且非一次性邮箱）
 */
export function isAllowedPersonalEmail(email: string): boolean {
  if (!getEmailDomain(email)) return false
  return !isDisposableEmail(email) && isMainstreamEmail(email)
}

/**
 * 返回可直接展示给用户的拦截原因；通过校验时返回 null。
 */
export function getEmailDomainViolation(email: string): { code: string; message: string } | null {
  const domain = getEmailDomain(email)
  if (!domain) {
    return { code: 'AUTH_EMAIL_UNREACHABLE', message: '邮箱格式不正确，请检查后再试' }
  }
  if (isDisposableEmail(email)) {
    return {
      code: 'AUTH_EMAIL_DOMAIN_DISPOSABLE',
      message: '不支持一次性/临时邮箱，请使用常用邮箱（如 QQ、163、Gmail、Outlook 等）'
    }
  }
  if (!isMainstreamEmail(email)) {
    return {
      code: 'AUTH_EMAIL_DOMAIN_NOT_ALLOWED',
      message:
        '仅支持主流邮箱（QQ、163/126、139、Gmail、Outlook、iCloud、Yahoo 等）及学校邮箱（edu.cn），请更换邮箱'
    }
  }
  return null
}
