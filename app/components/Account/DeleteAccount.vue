<!--
Copyright (C) 2026 YH-Chen

This file is part of VoiceHub-Plus (an unofficial community edition),
based on VoiceHub <https://github.com/laoshuikaixue/VoiceHub>.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
-->
<template>
  <section class="rounded-2xl border border-error-30 bg-error-10/40 p-5 md:p-6">
    <div class="flex items-center gap-3 border-b border-error-30/60 pb-5 mb-5">
      <div class="p-2.5 bg-error-10 rounded-xl flex items-center justify-center">
        <UserX :size="20" class="text-error" />
      </div>
      <div>
        <h2 class="text-base font-black text-text-primary">{{ t.deleteAccount.title }}</h2>
        <p class="text-xs text-text-tertiary mt-0.5">{{ t.deleteAccount.desc }}</p>
      </div>
    </div>

    <!-- 已处于宽限期 -->
    <div v-if="state.pending" class="space-y-3">
      <div class="rounded-xl border border-warning-40 bg-warning-10 px-4 py-3 text-xs text-warning-200">
        {{ t.deleteAccount.grace(formattedScheduledAt) }}
      </div>
      <button
        class="inline-flex items-center gap-2 rounded-xl border border-border-secondary bg-bg-primary-40 px-4 py-2.5 text-xs font-bold text-text-secondary transition-all hover:bg-bg-tertiary disabled:opacity-50"
        :disabled="submitting"
        type="button"
        @click="cancelDeletion"
      >
        <Undo2 :size="14" /> {{ t.deleteAccount.cancelButton }}
      </button>
    </div>

    <!-- 正常状态：两步验证 -->
    <div v-else class="max-w-md space-y-3">
      <p class="text-xs text-text-secondary">
        {{ t.deleteAccount.intro }}
      </p>
      <p v-if="!state.hasEmail" class="rounded-xl border border-warning-40 bg-warning-10 px-4 py-3 text-xs text-warning-200">
        {{ t.deleteAccount.noEmail }}
      </p>

      <template v-else>
        <div class="flex flex-wrap items-center gap-2">
          <button
            class="inline-flex items-center gap-2 rounded-xl border border-border-secondary bg-bg-primary-40 px-3 py-2 text-xs font-bold text-text-secondary transition-all hover:bg-bg-tertiary disabled:opacity-50"
            :disabled="sending || countdown > 0"
            type="button"
            @click="sendCode"
          >
            <Mail :size="14" />
            {{ countdown > 0 ? t.deleteAccount.resendIn(countdown) : sending ? t.deleteAccount.sending : t.deleteAccount.sendCode }}
          </button>
          <span v-if="maskedEmail" class="text-[11px] text-text-tertiary">{{ t.deleteAccount.codeSentTo(maskedEmail) }}</span>
        </div>

        <input
          v-model="code"
          class="w-full rounded-xl border border-border-secondary bg-bg-primary-40 px-4 py-2.5 text-sm tracking-[0.3em] text-text-primary focus:border-primary-50 focus:outline-none"
          inputmode="numeric"
          maxlength="6"
          :placeholder="t.deleteAccount.codePlaceholder"
          type="text"
        />

        <button
          class="inline-flex items-center gap-2 rounded-xl bg-error px-4 py-2.5 text-xs font-bold text-white transition-all hover:opacity-90 disabled:opacity-50"
          :disabled="submitting || code.trim().length < 4"
          type="button"
          @click="confirmDeletion"
        >
          <RefreshCw v-if="submitting" :size="14" class="animate-spin" />
          {{ submitting ? t.deleteAccount.processing : t.deleteAccount.confirmButton }}
        </button>
      </template>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { Mail, RefreshCw, Undo2, UserX } from '@lucide/vue'
import { useNewUi } from '~/composables/useNewUi'

const t = useNewUi()
const { showToast } = useToast()
const state = ref({ pending: false, hasEmail: false, scheduledAt: null })
const code = ref('')
const maskedEmail = ref('')
const sending = ref(false)
const submitting = ref(false)
const countdown = ref(0)
let timer = null

const formattedScheduledAt = computed(() => {
  if (!state.value.scheduledAt) return '—'
  try {
    return new Date(state.value.scheduledAt).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return String(state.value.scheduledAt)
  }
})

const startCountdown = () => {
  countdown.value = 60
  if (timer) clearInterval(timer)
  timer = setInterval(() => {
    countdown.value -= 1
    if (countdown.value <= 0) {
      clearInterval(timer)
      timer = null
      countdown.value = 0
    }
  }, 1000)
}

const load = async () => {
  try {
    const res = await $fetch('/api/user/delete-account')
    state.value = { pending: false, hasEmail: false, scheduledAt: null, ...(res?.data || {}) }
  } catch (error) {
    console.error('获取注销状态失败:', error)
  }
}

const sendCode = async () => {
  sending.value = true
  try {
    const res = await $fetch('/api/user/delete-account/code', { method: 'POST' })
    maskedEmail.value = res?.email || ''
    showToast?.(t.value.deleteAccount.codeSent, 'success')
    startCountdown()
  } catch (error) {
    showToast?.(error?.data?.message || t.value.deleteAccount.sendFailed, 'error')
  } finally {
    sending.value = false
  }
}

const confirmDeletion = async () => {
  submitting.value = true
  try {
    await $fetch('/api/user/delete-account/confirm', { method: 'POST', body: { code: code.value.trim() } })
    showToast?.(t.value.deleteAccount.confirmed, 'success')
    code.value = ''
    await load()
  } catch (error) {
    showToast?.(error?.data?.message || t.value.deleteAccount.failed, 'error')
  } finally {
    submitting.value = false
  }
}

const cancelDeletion = async () => {
  submitting.value = true
  try {
    await $fetch('/api/user/delete-account/cancel', { method: 'POST' })
    showToast?.(t.value.deleteAccount.cancelSuccess, 'success')
    await load()
  } catch (error) {
    showToast?.(error?.data?.message || t.value.deleteAccount.cancelFailed, 'error')
  } finally {
    submitting.value = false
  }
}

onMounted(load)
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>
