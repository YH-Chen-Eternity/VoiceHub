/* Modified by YH-Chen-Eternity on 2026-10-23 */

import { db } from '~/drizzle/db'
import { systemSettings } from '~/drizzle/schema'
import type { SystemSettings } from '~/drizzle/schema'

/**
 * 统一读取系统设置，读取失败时返回 null，由调用方按安全默认值降级。
 * 说明：随主分支 minimize-Redis 重构，此处直接查询数据库，不再经过缓存层。
 */
export async function getSystemSettingsCached(): Promise<SystemSettings | null> {
  try {
    const [settings] = await db.select().from(systemSettings).limit(1)
    return settings ?? null
  } catch (error: any) {
    console.warn('[SystemSettings] 读取系统设置失败:', error)
    return null
  }
}

export async function getForcePasswordChangeOnFirstLogin(): Promise<boolean> {
  const settings = await getSystemSettingsCached()
  return settings && typeof settings.forcePasswordChangeOnFirstLogin === 'boolean'
    ? settings.forcePasswordChangeOnFirstLogin
    : false
}

export function computeRequirePasswordChange(
  user: { forcePasswordChange?: boolean | null; passwordChangedAt?: Date | string | null },
  forcePasswordChangeOnFirstLogin: boolean
): boolean {
  return !!user.forcePasswordChange || (forcePasswordChangeOnFirstLogin && !user.passwordChangedAt)
}

export async function resolveRequirePasswordChange(user: {
  forcePasswordChange?: boolean | null
  passwordChangedAt?: Date | string | null
  role?: string | null
}): Promise<boolean> {
  // 管理员显式要求的强制改密优先（管理员可在用户管理里给任意角色下发）
  if (user.forcePasswordChange) return true
  // 管理员 / 超级管理员 / 歌曲管理员不参与「首次登录强制改密」策略
  if (user.role && ['ADMIN', 'SUPER_ADMIN', 'SONG_ADMIN'].includes(user.role)) return false
  if (user.passwordChangedAt) return false
  return computeRequirePasswordChange(user, await getForcePasswordChangeOnFirstLogin())
}
