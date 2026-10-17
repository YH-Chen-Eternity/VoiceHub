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
    <div class="flex items-center gap-3 border-b border-border-secondary-50 pb-5 mb-5">
      <div class="p-2.5 bg-primary-10 rounded-xl flex items-center justify-center">
        <ThumbsUp :size="20" class="text-primary" />
      </div>
      <div class="min-w-0">
        <h2 class="text-base font-black text-text-primary">{{ t.likes.title }}</h2>
        <p class="text-xs text-text-tertiary mt-0.5">{{ t.likes.desc }}</p>
      </div>
    </div>

    <!-- 点赞署名偏好：ASK=每次询问 / ANONYMOUS=总是匿名 / REVEAL=总是署名 -->
    <div class="mb-5 rounded-xl border border-border-secondary-50 bg-bg-primary-40 p-3">
      <p class="text-xs font-bold text-text-secondary">{{ t.voteReveal.prefTitle }}</p>
      <p class="mt-0.5 text-[11px] text-text-tertiary">{{ t.voteReveal.prefHint }}</p>
      <div class="mt-2 flex flex-wrap gap-2">
        <button
          v-for="opt in prefOptions"
          :key="opt.value"
          class="rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-all disabled:opacity-50"
          :class="revealMode === opt.value ? 'border-primary bg-primary-10 text-primary' : 'border-border-secondary text-text-tertiary hover:bg-bg-tertiary'"
          :disabled="savingPref"
          type="button"
          @click="savePref(opt.value)"
        >{{ opt.label }}</button>
      </div>
    </div>

    <!-- 我的点赞列表 -->
    <div class="flex items-center justify-between gap-2">
      <p class="text-xs font-bold text-text-secondary">{{ t.likes.count(total) }}</p>
    </div>

    <div v-if="loading" class="flex items-center justify-center gap-2 py-8 text-xs text-text-tertiary">
      <RefreshCw :size="14" class="animate-spin" /> {{ t.common.loading }}
    </div>
    <div v-else-if="!songs.length" class="py-8 text-center text-xs text-text-tertiary">{{ t.likes.empty }}</div>
    <ul v-else class="mt-2 divide-y divide-border-secondary-50">
      <li v-for="song in songs" :key="song.songId" class="flex items-center justify-between gap-3 py-2.5">
        <div class="min-w-0">
          <p class="truncate text-sm font-bold text-text-primary">{{ song.title }}</p>
          <p class="truncate text-[11px] text-text-tertiary">{{ song.artist }}</p>
        </div>
        <span
          class="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold"
          :class="song.played ? 'bg-bg-tertiary text-text-tertiary' : 'bg-primary-10 text-primary'"
        >
          {{ song.played ? t.likes.played : t.likes.unplayed }}
        </span>
      </li>
    </ul>

  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { RefreshCw, ThumbsUp } from '@lucide/vue'
import { useNewUi } from '~/composables/useNewUi'
import { useAuth } from '~/composables/useAuth'
import { useToast } from '~/composables/useToast'

const t = useNewUi()
const { showToast } = useToast()

const revealMode = ref('ASK')
const savingPref = ref(false)
const prefOptions = computed(() => [
  { value: 'ASK', label: t.value.voteReveal.prefAsk },
  { value: 'ANONYMOUS', label: t.value.voteReveal.prefAnonymous },
  { value: 'REVEAL', label: t.value.voteReveal.prefReveal }
])
const songs = ref([])
const total = ref(0)


const savePref = async (mode) => {
  if (savingPref.value || revealMode.value === mode) return
  savingPref.value = true
  try {
    await $fetch('/api/user/vote-reveal', { method: 'PUT', body: { voteRevealMode: mode } })
    revealMode.value = mode
    showToast?.(t.value.likes.saved, 'success')
  } catch (error) {
    showToast?.(error?.data?.message || t.value.likes.saveFailed, 'error')
  } finally {
    savingPref.value = false
  }
}

const load = async () => {
  loading.value = true
  try {
    const res = await $fetch('/api/user/likes')
    songs.value = res?.data?.songs || []
    revealMode.value = (await $fetch('/api/user/vote-reveal').catch(() => null))?.data?.voteRevealMode || 'ASK'
    total.value = res?.data?.total || songs.value.length
  } catch (error) {
    showToast?.(error?.data?.message || t.value.likes.loadFailed, 'error')
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>
