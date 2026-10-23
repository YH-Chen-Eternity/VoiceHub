/* Modified by YH-Chen-Eternity on 2026-10-23 */

#!/usr/bin/env node

import { config } from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { client, db, notificationSettings, systemSettings, users } from '../app/drizzle/db.ts'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.resolve(process.cwd(), '.env') })

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL 环境变量未设置')
  process.exit(1)
}

async function main() {
  try {
    // 检查是否已有超级管理员
    const existingSuperAdmin = await db
      .select()
      .from(users)
      .where(eq(users.role, 'SUPER_ADMIN'))
      .limit(1)

    if (existingSuperAdmin.length > 0) {
      console.log('✅ 管理员已存在')
      return existingSuperAdmin[0]
    }

    // 没有超级管理员但 username=admin 已被其他角色占用时跳过创建，避免产生重复 username
    const existingAdminName = await db
      .select()
      .from(users)
      .where(eq(users.username, 'admin'))
      .limit(1)

    if (existingAdminName.length > 0) {
      console.warn(
        `⚠️ username=admin 已被用户#${existingAdminName[0].id}（role=${existingAdminName[0].role}）占用，跳过创建管理员`
      )
      return existingAdminName[0]
    }

    // 创建管理员
    // 2026-10-23 安全加固：不再使用公开已知的默认密码 admin123。
    // 必须通过环境变量 ADMIN_INITIAL_PASSWORD 显式提供初始密码，且强制首次登录改密。
    const initialPassword = String(process.env.ADMIN_INITIAL_PASSWORD || '').trim()
    if (initialPassword.length < 8) {
      throw new Error(
        '安全要求：请设置环境变量 ADMIN_INITIAL_PASSWORD（至少 8 位）作为初始管理员密码；' +
        '脚本不再使用默认密码 admin123（该凭据已公开，等同于无鉴权）'
      )
    }
    const hashedPassword = await bcrypt.hash(initialPassword, 10)
    const [admin] = await db
      .insert(users)
      .values({
        username: 'admin',
        name: '超级管理员',
        password: hashedPassword,
        role: 'SUPER_ADMIN',
        forcePasswordChange: true
      })
      .returning()

    // 创建通知设置
    await db
      .insert(notificationSettings)
      .values({
        userId: admin.id,
        enabled: true,
        songRequestEnabled: true,
        songVotedEnabled: true,
        songPlayedEnabled: true,
        refreshInterval: 60,
        songVotedThreshold: 1
      })
      .onConflictDoNothing()

    // 创建系统设置
    await db
      .insert(systemSettings)
      .values({
        id: 1,
        enablePlayTimeSelection: false
      })
      .onConflictDoNothing()

    console.log('✅ 管理员创建成功 (admin / 你设置的 ADMIN_INITIAL_PASSWORD，首次登录需改密)')
    return admin
  } catch (error) {
    console.error('❌ 创建管理员失败:', error)
    throw error
  }
}

main()
  .then(async () => {
    await client.end()
    process.exit(0)
  })
  .catch(async (error) => {
    console.error('❌ 初始化失败:', error)
    await client.end()
    process.exit(1)
  })
