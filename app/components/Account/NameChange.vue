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
  <section class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-5 md:p-6">
    <div class="flex items-center gap-3 border-b border-border-secondary-50 pb-5 mb-6">
      <div class="p-2.5 bg-warning-10 rounded-xl flex items-center justify-center">
        <Pencil :size="20" class="text-warning" />
      </div>
      <div>
        <h2 class="text-base font-black text-text-primary">修改真实姓名</h2>
        <p class="text-xs text-text-tertiary mt-0.5">
          当前姓名：{{ currentName || '未填写' }}。提交后需管理员审核，通过后才生效。
        </p>
      </div>
    </div>

    <div v-if="pending" class="mb-4 rounded-xl border border-warning-40 bg-warning-10 px-4 py-3 text-xs text-warning-200">
      已提交改名申请（{{ pending.oldName || '未填写' }} → <b>{{ pending.newName }}</b>），等待管理员审核。
    </div>
    <div
      v-else-if="latest && latest.status === 'REJECTED'"
      class="mb-4 rounded-xl border border-error-30 bg-error-10 px-4 py-3 text-xs text-error-200"
    >
      上次改名申请被驳回{{ latest.reason ? `：${latest.reason}` : '' }}，可修改后重新提交。
    </div>

    <div class="max-w-md space-y-3">
      <input
        v-model="newName"
        class="w-full rounded-xl border border-border-secondary bg-bg-primary-40 px-4 py-2.5 text-sm text-text-primary focus:border-primary-50 focus:outline-none"
        maxlength="20"
        placeholder="请输入新的真实姓名（只能中文）"
        type="text"
      />
      <p class="text-[11px] text-text-tertiary">2~20 个汉字，少数民族姓名可用「·」分隔（如 阿依古丽·买买提）。</p>
      <button
        class="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-white transition-all hover:bg-primary-hover disabled:opacity-50"
        :disabled="submitting || !newName.trim()"
        type="button"
        @click="submit"
      >
        <RefreshCw v-if="submitting" :size="14" class="animate-spin" />
        {{ submitting ? '提交中…' : '提交改名申请' }}
      </button>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { RefreshCw, Pencil } from '@lucide/vue'
import { useAuth } from '~/composables/useAuth'

const { showToast } = useToast()
const auth = useAuth()
const latest = ref(null)
const newName = ref('')
const submitting = ref(false)

const currentName = computed(() => auth.user.value?.name || '')
const pending = computed(() => (latest.value?.status === 'PENDING' ? latest.value : null))

const load = async () => {
  try {
    const res = await $fetch('/api/user/name-change')
    latest.value = res?.data || null
  } catch (error) {
    console.error('获取改名申请失败:', error)
  }
}

const submit = async () => {
  const name = newName.value.trim()
  if (!name) return
  submitting.value = true
  try {
    await $fetch('/api/user/name-change', { method: 'POST', body: { name } })
    showToast?.('改名申请已提交，等待管理员审核', 'success')
    newName.value = ''
    await load()
  } catch (error) {
    showToast?.(error?.data?.message || '提交失败，请稍后重试', 'error')
  } finally {
    submitting.value = false
  }
}

onMounted(load)
</script>
