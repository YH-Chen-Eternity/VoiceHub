/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

<!--
修改登录用户名（2026-10-23 起账号管理仅保留用户名修改；真实姓名自助修改已下线）
规则：仅英文、数字、下划线，2-20 个字符，不能是纯数字，不能与他人重名；修改后即时生效，无需审核。
-->
<template>
  <section class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-5 md:p-6">
    <div class="flex items-center gap-3 border-b border-border-secondary-50 pb-5 mb-6">
      <div class="p-2.5 bg-primary-10 rounded-xl flex items-center justify-center">
        <AtSign :size="20" class="text-primary" />
      </div>
      <div>
        <h2 class="text-base font-black text-text-primary">{{ t.usernameChange.title }}</h2>
        <p class="text-xs text-text-tertiary mt-0.5">
          {{ t.usernameChange.current(auth.user.value?.username) }}
        </p>
      </div>
    </div>

    <div class="max-w-md space-y-3">
      <input
        v-model="newUsername"
        class="w-full rounded-xl border border-border-secondary bg-bg-primary-40 px-4 py-2.5 text-sm text-text-primary focus:border-primary-50 focus:outline-none"
        maxlength="20"
        :placeholder="t.usernameChange.placeholder"
        type="text"
        autocomplete="off"
        @keyup.enter="submit"
      />
      <p class="text-[11px] text-text-tertiary">{{ t.usernameChange.hint }}</p>
      <button
        class="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-white transition-all hover:bg-primary-hover disabled:opacity-50"
        :disabled="submitting || !canSubmit"
        type="button"
        @click="submit"
      >
        <RefreshCw v-if="submitting" :size="14" class="animate-spin" />
        {{ submitting ? t.usernameChange.submitting : t.usernameChange.submit }}
      </button>
    </div>
  </section>
</template>

<script setup>
import { AtSign, RefreshCw } from '@lucide/vue'
import { computed, ref } from 'vue'
import { useAuth } from '~/composables/useAuth'
import { useNewUi } from '~/composables/useNewUi'

const t = useNewUi()
const { showToast } = useToast()
const auth = useAuth()
const newUsername = ref('')
const submitting = ref(false)

// 与服务端 username-policy.ts 同口径：禁中文、2-20 位、禁纯数字
const canSubmit = computed(() => {
  const value = newUsername.value.trim()
  if (value.length < 2 || value.length > 20) return false
  if (!/^[A-Za-z0-9_]+$/.test(value)) return false
  if (/^\d+$/.test(value)) return false
  return value !== auth.user.value?.username
})

const submit = async () => {
  const value = newUsername.value.trim()
  if (!value || submitting.value) return
  if (!canSubmit.value) {
    showToast?.(t.value.usernameChange.hint, 'error')
    return
  }

  submitting.value = true
  try {
    await $fetch('/api/user/name-change', { method: 'POST', body: { field: 'USERNAME', value } })
    showToast?.(t.value.usernameChange.success, 'success')
    newUsername.value = ''
    // 刷新全局登录态，让导航栏/头像区的用户名同步更新
    await auth.refreshUser()
  } catch (error) {
    showToast?.(error?.data?.message || t.value.usernameChange.failed, 'error')
  } finally {
    submitting.value = false
  }
}
</script>
