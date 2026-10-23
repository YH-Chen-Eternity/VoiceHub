/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

<!-- Modified by YH-Chen on 2026-10-23 -->
<!-- 强制更新用户名：管理员在「用户管理」下发要求后，用户进入站点即被此弹窗拦下，完成后自动解除 -->
<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="visible"
        class="fixed inset-0 z-[1900] flex items-center justify-center p-4 bg-bg-primary-80 backdrop-blur-sm"
      >
        <div
          class="bg-bg-secondary border border-border-secondary w-full max-w-md rounded-3xl overflow-hidden shadow-2xl"
        >
          <div class="p-8">
            <div class="flex items-start gap-3">
              <div
                class="w-12 h-12 rounded-2xl bg-primary-hover-10 text-primary flex items-center justify-center shrink-0"
              >
                <UserCog :size="22" />
              </div>
              <div class="min-w-0">
                <h3 class="text-lg font-black text-text-primary tracking-tight">
                  {{ t.title }}
                </h3>
                <p class="text-xs text-text-tertiary mt-1 leading-relaxed">
                  {{ t.descByAdmin }}
                </p>
              </div>
            </div>

            <div class="mt-6 space-y-2">
              <div class="flex items-center justify-between">
                <label class="text-[10px] font-black text-text-tertiary uppercase tracking-widest ml-1">
                  {{ t.label }}
                </label>
                <span class="text-[10px] text-text-disabled font-bold">
                  {{ t.currentLabel }}: {{ user?.username }}
                </span>
              </div>
              <div class="relative group">
                <AtSign
                  class="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-primary transition-colors"
                  :size="16"
                />
                <input
                  v-model="newUsername"
                  autocomplete="off"
                  class="w-full bg-bg-primary border border-border-secondary rounded-2xl pl-11 pr-4 py-3 text-sm text-text-primary focus:outline-none focus:border-primary-50 transition-all"
                  :placeholder="t.placeholder"
                  type="text"
                  maxlength="20"
                  @keyup.enter="submit"
                />
              </div>
              <p class="text-[11px] text-text-tertiary leading-relaxed">{{ t.hint }}</p>
            </div>

            <div
              v-if="errorMessage"
              class="mt-4 p-3 bg-error-10 border border-error-20 rounded-2xl flex items-center gap-2 text-error text-xs"
            >
              <AlertCircle :size="14" class="shrink-0" />
              <span>{{ errorMessage }}</span>
            </div>

            <button
              :disabled="submitting || !canSubmit"
              class="mt-6 w-full px-6 py-4 bg-primary hover:bg-primary-hover text-white text-xs font-black rounded-2xl transition-all uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.99]"
              @click="submit"
            >
              <RefreshCw v-if="submitting" :size="16" class="animate-spin" />
              <Check v-else :size="16" />
              {{ submitting ? t.submitting : t.submit }}
            </button>

            <button
              class="mt-3 w-full py-2 text-[11px] font-bold text-text-tertiary hover:text-text-primary transition-colors"
              @click="handleLogout"
            >
              {{ t.logout }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { AlertCircle, AtSign, Check, RefreshCw, UserCog } from '@lucide/vue'
import { useAuth } from '~/composables/useAuth'
import { useLocale } from '~/utils/locale'

const auth = useAuth()
const { forceUsernameChange: t } = useLocale()
const { localize: localizeServerError } = useServerErrors()
const { showToast } = useToast()

const newUsername = ref('')
const submitting = ref(false)
const errorMessage = ref('')

const user = computed(() => auth.user.value)

// 改密优先级更高：先完成改密，再处理用户名更新，避免两个强制流程互相抢占。
// 触发条件只有一种：管理员在「用户管理」显式下发的强制要求（forceUsernameChange）。
const visible = computed(
  () =>
    auth.isAuthenticated.value &&
    user.value?.forceUsernameChange === true &&
    user.value?.requirePasswordChange !== true
)

const canSubmit = computed(() => {
  const value = newUsername.value.trim()
  if (value.length < 2 || value.length > 20) return false
  // 2026-10-23 站长要求：用户名禁中文，仅英文、数字、下划线
  if (!/^[A-Za-z0-9_]+$/.test(value)) return false
  if (/^\d+$/.test(value)) return false
  return value !== user.value?.username
})

watch(visible, (value) => {
  if (value) {
    newUsername.value = ''
    errorMessage.value = ''
  }
})

const submit = async () => {
  if (submitting.value) return
  const value = newUsername.value.trim()
  if (!value) {
    errorMessage.value = t.value.required
    return
  }
  if (!canSubmit.value) {
    errorMessage.value = t.value.hint
    return
  }

  submitting.value = true
  errorMessage.value = ''
  try {
    await $fetch('/api/user/name-change', {
      method: 'POST',
      body: { field: 'USERNAME', value }
    })
    showToast?.(t.value.success, 'success')
    await auth.refreshUser()
  } catch (error) {
    errorMessage.value = localizeServerError(error, t.value.failed)
  } finally {
    submitting.value = false
  }
}

const handleLogout = async () => {
  await auth.logout()
}
</script>
