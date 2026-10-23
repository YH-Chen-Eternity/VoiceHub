/* Modified by YH-Chen-Eternity on 2026-10-23 */

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
  <div class="space-y-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-black text-text-primary">{{ isNotes ? t.review.notesTitle : t.review.usersTitle }}</h2>
        <p class="mt-1 text-xs text-text-tertiary">
          {{ isNotes
            ? t.review.notesDesc
            : t.review.usersDesc }}
        </p>
      </div>
      <div class="flex gap-2">
        <button
          v-if="!isNotes"
          class="inline-flex items-center gap-2 rounded-xl border border-border-secondary bg-bg-primary-40 px-3 py-2 text-xs font-bold text-text-secondary hover:bg-bg-tertiary"
          type="button"
          @click="runPurge"
        >
          <Trash2 :size="14" /> {{ t.review.purgeButton }}
        </button>
        <button
          class="inline-flex items-center gap-2 rounded-xl border border-border-secondary bg-bg-primary-40 px-3 py-2 text-xs font-bold text-text-secondary hover:bg-bg-tertiary disabled:opacity-50"
          :disabled="loading"
          type="button"
          @click="load"
        >
          <RefreshCw :size="14" :class="{ 'animate-spin': loading }" /> {{ t.common.refresh }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="flex items-center justify-center gap-2 py-12 text-xs text-text-tertiary">
      <RefreshCw :size="16" class="animate-spin" /> {{ t.common.loading }}
    </div>

    <!-- 公开备注审核 -->
    <template v-else-if="isNotes">
      <section class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-4 md:p-5">
        <h3 class="mb-3 text-sm font-black text-text-primary">{{ t.review.songNotes(notes.songs?.length || 0) }}</h3>
        <div v-if="!notes.songs?.length" class="py-6 text-center text-xs text-text-tertiary">{{ t.review.noPendingNotes }}</div>
        <div v-else class="space-y-3">
          <div v-for="row in notes.songs" :key="`s-${row.id}`" class="rounded-xl border border-border-secondary-50 bg-bg-primary-40 p-3">
            <div class="flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
              <span class="font-bold text-text-primary">{{ row.title }}</span>
              <span>- {{ row.artist }}</span>
              <span class="rounded bg-bg-tertiary px-1.5 py-0.5">{{ t.review.submitter }}：{{ row.requester }}</span>
            </div>
            <p class="mt-2 whitespace-pre-wrap break-words text-sm text-text-secondary">{{ row.note }}</p>
            <div class="mt-3 flex gap-2">
              <button class="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover" type="button" @click="decideNote('song', row.id, true)">{{ t.review.approve }}</button>
              <button class="rounded-lg border border-error-30 px-3 py-1.5 text-xs font-bold text-error hover:bg-error-10" type="button" @click="decideNote('song', row.id, false)">{{ t.review.reject }}</button>
            </div>
          </div>
        </div>
      </section>

      <section class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-4 md:p-5">
        <h3 class="mb-3 text-sm font-black text-text-primary">{{ t.review.replayNotes(notes.replays?.length || 0) }}</h3>
        <div v-if="!notes.replays?.length" class="py-6 text-center text-xs text-text-tertiary">{{ t.review.noPendingNotes }}</div>
        <div v-else class="space-y-3">
          <div v-for="row in notes.replays" :key="`r-${row.id}`" class="rounded-xl border border-border-secondary-50 bg-bg-primary-40 p-3">
            <div class="flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
              <span class="font-bold text-text-primary">{{ row.songTitle }}</span>
              <span class="rounded bg-bg-tertiary px-1.5 py-0.5">{{ t.review.applicant }}：{{ row.requester }}</span>
            </div>
            <p class="mt-2 whitespace-pre-wrap break-words text-sm text-text-secondary">{{ row.note }}</p>
            <div class="mt-3 flex gap-2">
              <button class="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover" type="button" @click="decideNote('replay', row.id, true)">{{ t.review.approve }}</button>
              <button class="rounded-lg border border-error-30 px-3 py-1.5 text-xs font-bold text-error hover:bg-error-10" type="button" @click="decideNote('replay', row.id, false)">{{ t.review.reject }}</button>
            </div>
          </div>
        </div>
      </section>
    </template>

    <!-- 用户审核 -->
    <template v-else>
      <section class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-4 md:p-5">
        <h3 class="mb-3 text-sm font-black text-text-primary">{{ t.review.registrations(users.registrations?.length || 0) }}</h3>
        <div v-if="!users.registrations?.length" class="py-6 text-center text-xs text-text-tertiary">{{ t.review.noPendingRegistrations }}</div>
        <div v-else class="space-y-3">
          <div v-for="row in users.registrations" :key="`u-${row.id}`" class="flex flex-col gap-3 rounded-xl border border-border-secondary-50 bg-bg-primary-40 p-3 md:flex-row md:items-center md:justify-between">
            <div class="min-w-0 text-xs text-text-secondary">
              <span class="font-bold text-text-primary">{{ row.name }}</span>
              <span class="ml-2 text-text-tertiary">@{{ row.username }}</span>
              <span v-if="row.grade || row.class" class="ml-2 text-text-tertiary">{{ row.grade || '' }} {{ row.class || '' }}</span>
              <div v-if="row.email" class="mt-1 truncate text-text-tertiary">{{ row.email }}</div>
            </div>
            <div class="flex shrink-0 gap-2">
              <button class="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover" type="button" @click="decideUser('register', row.id, true)">{{ t.review.approve }}</button>
              <button class="rounded-lg border border-error-30 px-3 py-1.5 text-xs font-bold text-error hover:bg-error-10" type="button" @click="decideUser('register', row.id, false)">{{ t.review.reject }}</button>
            </div>
          </div>
        </div>
      </section>

      <section class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-4 md:p-5">
        <h3 class="mb-3 text-sm font-black text-text-primary">{{ t.review.deletions(users.deletions?.length || 0) }}</h3>
        <p class="mb-3 text-[11px] text-text-tertiary">{{ t.review.deletionsHint }}</p>
        <div v-if="!users.deletions?.length" class="py-6 text-center text-xs text-text-tertiary">{{ t.review.noPendingDeletions }}</div>
        <div v-else class="space-y-3">
          <div v-for="row in users.deletions" :key="`d-${row.id}`" class="flex flex-col gap-3 rounded-xl border border-border-secondary-50 bg-bg-primary-40 p-3 md:flex-row md:items-center md:justify-between">
            <div class="min-w-0 text-xs text-text-secondary">
              <span class="font-bold text-text-primary">{{ row.name }}</span>
              <span class="ml-2 text-text-tertiary">@{{ row.username }}</span>
              <div class="mt-1 text-text-tertiary">{{ t.review.planToClean }}：{{ formatTime(row.deletionScheduledAt) }}</div>
            </div>
            <div class="flex shrink-0 gap-2">
              <button class="rounded-lg border border-border-secondary px-3 py-1.5 text-xs font-bold text-text-secondary hover:bg-bg-tertiary" type="button" @click="decideUser('deletion', row.id, false)">{{ t.review.revokeDeletion }}</button>
              <button class="rounded-lg border border-error-30 px-3 py-1.5 text-xs font-bold text-error hover:bg-error-10" type="button" @click="decideUser('deletion', row.id, true)">{{ t.review.purgeNow }}</button>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { RefreshCw, Trash2 } from '@lucide/vue'
import { useNewUi } from '~/composables/useNewUi'

const props = defineProps({
  mode: { type: String, default: 'notes' }
})

const t = useNewUi()
const { showToast } = useToast()
const loading = ref(false)
const notes = ref({ songs: [], replays: [] })
const users = ref({ registrations: [], deletions: [] })

const isNotes = computed(() => props.mode !== 'users')

const formatTime = (value) => {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return String(value)
  }
}

const load = async () => {
  loading.value = true
  try {
    if (isNotes.value) {
      const res = await $fetch('/api/admin/review/notes')
      notes.value = { songs: res?.data?.songs || [], replays: res?.data?.replays || [] }
    } else {
      const res = await $fetch('/api/admin/review/users')
      users.value = {
        registrations: res?.data?.registrations || [],
        deletions: res?.data?.deletions || []
      }
    }
  } catch (error) {
    showToast?.(error?.data?.message || t.value.review.loadFailed, 'error')
  } finally {
    loading.value = false
  }
}

const decideNote = async (kind, id, approve) => {
  try {
    await $fetch('/api/admin/review/notes/decide', { method: 'POST', body: { kind, id, approve } })
    showToast?.(approve ? t.value.review.approved : t.value.review.rejected, 'success')
    await load()
  } catch (error) {
    showToast?.(error?.data?.message || t.value.review.opFailed, 'error')
  }
}

const decideUser = async (kind, id, approve, reason = '') => {
  try {
    await $fetch('/api/admin/review/users/decide', { method: 'POST', body: { kind, id, approve, reason } })
    showToast?.(t.value.review.opSuccess, 'success')
    await load()
  } catch (error) {
    showToast?.(error?.data?.message || t.value.review.opFailed, 'error')
  }
}

const runPurge = async () => {
  try {
    const res = await $fetch('/api/admin/review/users/decide', { method: 'POST', body: { kind: 'purge' } })
    const r = res?.result || {}
    showToast?.(t.value.review.purgeDone(r.purged || 0, r.anonymized || 0), 'success')
    await load()
  } catch (error) {
    showToast?.(error?.data?.message || t.value.review.purgeFailed, 'error')
  }
}

onMounted(load)
watch(() => props.mode, load)
</script>
