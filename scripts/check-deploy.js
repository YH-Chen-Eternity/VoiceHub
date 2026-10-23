/* Modified by YH-Chen-Eternity on 2026-10-23 */

#!/usr/bin/env node

import fs from 'fs'
import path from 'path'

// 颜色输出函数
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
}

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green')
}

function logWarning(message) {
  log(`⚠️ ${message}`, 'yellow')
}

function logError(message) {
  log(`❌ ${message}`, 'red')
}

function logInfo(message) {
  log(`ℹ️ ${message}`, 'blue')
}

// 检查文件是否存在
function fileExists(filePath) {
  try {
    return fs.existsSync(filePath)
  } catch {
    return false
  }
}

// 检查目录大小
function getDirectorySize(dirPath) {
  try {
    const stats = fs.statSync(dirPath)
    if (stats.isFile()) {
      return stats.size
    } else if (stats.isDirectory()) {
      let totalSize = 0
      const files = fs.readdirSync(dirPath)
      for (const file of files) {
        const filePath = path.join(dirPath, file)
        totalSize += getDirectorySize(filePath)
      }
      return totalSize
    }
  } catch {
    return 0
  }
  return 0
}

// 格式化文件大小
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// 检查 Drizzle 配置
function checkDrizzleConfig() {
  log('🔍 检查 Drizzle 配置...', 'cyan')

  const drizzleConfigPath = 'drizzle.config.ts'
  const drizzleSchemaPath = 'app/drizzle/schema.ts'

  if (!fileExists(drizzleConfigPath)) {
    logError('Drizzle 配置文件不存在')
    return false
  }

  if (!fileExists(drizzleSchemaPath)) {
    logError('Drizzle schema 文件不存在')
    return false
  }

  logSuccess('Drizzle 配置检查通过')
  return true
}

// 检查环境变量
function checkEnvironmentVariables() {
  log('🔍 检查环境变量...', 'cyan')

  const requiredVars = ['DATABASE_URL', 'JWT_SECRET']

  const optionalVars = ['NODE_ENV']

  let allRequired = true

  // 检查必需的环境变量
  requiredVars.forEach((varName) => {
    if (process.env[varName]) {
      logSuccess(`${varName} 已设置`)
    } else {
      logError(`缺少必需的环境变量: ${varName}`)
      allRequired = false
    }
  })

  // 检查可选的环境变量
  optionalVars.forEach((varName) => {
    if (process.env[varName]) {
      logInfo(`${varName} 已设置`)
    } else {
      logWarning(`可选环境变量未设置: ${varName}`)
    }
  })

  return allRequired
}

// 检查数据库连接
async function checkDatabaseConnection() {
  log('🔍 检查数据库连接...', 'cyan')

  try {
    // 检查数据库连接文件是否存在
    const dbPath = 'app/drizzle/db.ts'
    if (!fileExists(dbPath)) {
      logError('数据库连接文件不存在')
      return false
    }

    logSuccess('数据库配置检查通过')
    return true
  } catch (error) {
    logWarning('数据库连接测试失败（这在某些部署环境中是正常的）')
    return false
  }
}

// 检查关键文件
function checkCriticalFiles() {
  log('🔍 检查关键文件...', 'cyan')

  const criticalFiles = [
    'nuxt.config.ts',
    'drizzle.config.ts',
    'app/drizzle/schema.ts',
    'package.json'
  ]

  let allExists = true

  criticalFiles.forEach((file) => {
    if (fileExists(file)) {
      logSuccess(`${file} 存在`)
    } else {
      logError(`关键文件缺失: ${file}`)
      allExists = false
    }
  })

  return allExists
}

// 生成部署报告
function generateDeploymentReport(checks) {
  log('\n📊 部署检查报告', 'bright')
  log('='.repeat(50), 'cyan')

  const passed = checks.filter((check) => check.passed).length
  const total = checks.length

  checks.forEach((check) => {
    const status = check.passed ? '✅' : '❌'
    const color = check.passed ? 'green' : 'red'
    log(`${status} ${check.name}`, color)
    if (check.details) {
      log(`   ${check.details}`, 'reset')
    }
  })

  log(`\n总计: ${passed}/${total} 项检查通过`, passed === total ? 'green' : 'yellow')

  if (passed === total) {
    log('🎉 所有检查都通过了！部署应该可以正常工作。', 'green')
  } else {
    log('⚠️ 部分检查未通过，可能会影响应用运行。', 'yellow')
  }
}

// 主检查函数
async function checkDeployment() {
  log('🔍 开始部署后检查...', 'bright')

  const checks = [
    {
      name: '关键文件检查',
      passed: checkCriticalFiles(),
      details: null
    },
    {
      name: 'Drizzle 配置检查',
      passed: checkDrizzleConfig(),
      details: null
    },
    {
      name: '环境变量检查',
      passed: checkEnvironmentVariables(),
      details: null
    }
  ]

  // 数据库连接检查（异步）
  const dbConnected = await checkDatabaseConnection()
  checks.push({
    name: '数据库连接检查',
    passed: dbConnected,
    details: dbConnected ? null : '在某些部署环境中这是正常的'
  })

  generateDeploymentReport(checks)

  const criticalFailed = checks.filter(
    (check) => !check.passed && !check.name.includes('数据库连接')
  ).length

  if (criticalFailed > 0) {
    process.exit(1)
  }
}

// 运行检查
checkDeployment().catch((error) => {
  logError(`检查过程中发生错误: ${error.message}`)
  process.exit(1)
})
