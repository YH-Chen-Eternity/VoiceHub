/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

import { resolveCaptchaSettings } from '~~/server/services/securityService'
import { createApiError } from './apiError'

/**
 * 找回 / 修改 / 重置密码统一的人机验证。
 * 未启用 Turnstile 时不拦截；启用后必须携带有效 token。
 */
export async function assertPasswordTurnstile(body: any, clientIP: string) {
  const settings = await resolveCaptchaSettings()
  if (!settings.enabled || settings.provider !== 'turnstile') return

  const token = typeof body?.turnstileToken === 'string' ? body.turnstileToken : ''
  if (!settings.turnstileSecretKey) {
    throw createApiError(500, 'AUTH_CODE_SERVICE_CONFIG_ERROR', '人机验证服务配置错误，请联系管理员')
  }
  if (!token) {
    throw createApiError(400, 'AUTH_CAPTCHA_REQUIRED', '请完成人机验证', {
      captchaRequired: true,
      captchaProvider: 'turnstile'
    })
  }

  const form = new URLSearchParams()
  form.append('secret', settings.turnstileSecretKey)
  form.append('response', token)
  form.append('remoteip', clientIP)

  try {
    const result: any = await $fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
      timeout: 5000
    })
    if (!result.success) {
      throw createApiError(400, 'AUTH_CAPTCHA_FAILED_OR_EXPIRED', '人机验证失败或已过期，请重试', {
        captchaRequired: true,
        captchaProvider: 'turnstile'
      })
    }
  } catch (error: any) {
    if (error.statusCode === 400) throw error
    console.error('Turnstile verification error:', error)
    throw createApiError(500, 'AUTH_CAPTCHA_SERVICE_UNAVAILABLE', '人机验证服务暂不可用')
  }
}
