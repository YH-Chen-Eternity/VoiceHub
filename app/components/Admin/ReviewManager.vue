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
        <h2 class="text-lg font-black text-text-primary">{{ isNotes ? '公开备注审核' : '用户审核' }}</h2>
        <p class="mt-1 text-xs text-text-tertiary">
          {{ isNotes
            ? '学生勾选「公开给已登录用户」的投稿留言，需要在这里通过后才会展示给其他同学。'
            : '注册待审核、真实姓名修改申请、以及处于注销宽限期的账号都在这里处理。' }}
        </p>
      </div>
      <div class="flex gap-2">
        <button
          v-if="!isNotes"
          class="inline-flex items-center gap-2 rounded-xl border border-border-secondary bg-bg-primary-40 px-3 py-2 text-xs font-bold text-text-secondary hover:bg-bg-tertiary"
          type="button"
          @click="runPurge"
        >
          <Trash2 :size="14" /> 立即清理逾期注销账号
        </button>
        <button
          class="inline-flex items-center gap-2 rounded-xl border border-border-secondary bg-bg-primary-40 px-3 py-2 text-xs font-bold text-text-secondary hover:bg-bg-tertiary disabled:opacity-50"
          :disabled="loading"
          type="button"
          @click="load"
        >
          <RefreshCw :size="14" :class="{ 'animate-spin': loading }" /> 刷新
        </button>
      </div>
    </div>

    <div v-if="loading" class="flex items-center justify-center gap-2 py-12 text-xs text-text-tertiary">
      <RefreshCw :size="16" class="animate-spin" /> 加载中…
    </div>

    <!-- 公开备注审核 -->
    <template v-else-if="isNotes">
      <section class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-4 md:p-5">
        <h3 class="mb-3 text-sm font-black text-text-primary">歌曲投稿留言（{{ notes.songs?.length || 0 }}）</h3>
        <div v-if="!notes.songs?.length" class="py-6 text-center text-xs text-text-tertiary">暂无待审留言</div>
        <div v-else class="space-y-3">
          <div v-for="row in notes.songs" :key="`s-${row.id}`" class="rounded-xl border border-border-secondary-50 bg-bg-primary-40 p-3">
            <div class="flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
              <span class="font-bold text-text-primary">{{ row.title }}</span>
              <span>- {{ row.artist }}</span>
              <span class="rounded bg-bg-tertiary px-1.5 py-0.5">投稿人：{{ row.requester }}</span>
            </div>
            <p class="mt-2 whitespace-pre-wrap break-words text-sm text-text-secondary">{{ row.note }}</p>
            <div class="mt-3 flex gap-2">
              <button class="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover" type="button" @click="decideNote('song', row.id, true)">通过</button>
              <button class="rounded-lg border border-error-30 px-3 py-1.5 text-xs font-bold text-error hover:bg-error-10" type="button" @click="decideNote('song', row.id, false)">驳回</button>
            </div>
          </div>
        </div>
      </section>

      <section class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-4 md:p-5">
        <h3 class="mb-3 text-sm font-black text-text-primary">重播申请留言（{{ notes.replays?.length || 0 }}）</h3>
        <div v-if="!notes.replays?.length" class="py-6 text-center text-xs text-text-tertiary">暂无待审留言</div>
        <div v-else class="space-y-3">
          <div v-for="row in notes.replays" :key="`r-${row.id}`" class="rounded-xl border border-border-secondary-50 bg-bg-primary-40 p-3">
            <div class="flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
              <span class="font-bold text-text-primary">{{ row.songTitle }}</span>
              <span class="rounded bg-bg-tertiary px-1.5 py-0.5">申请人：{{ row.requester }}</span>
            </div>
            <p class="mt-2 whitespace-pre-wrap break-words text-sm text-text-secondary">{{ row.note }}</p>
            <div class="mt-3 flex gap-2">
              <button class="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover" type="button" @click="decideNote('replay', row.id, true)">通过</button>
              <button class="rounded-lg border border-error-30 px-3 py-1.5 text-xs font-bold text-error hover:bg-error-10" type="button" @click="decideNote('replay', row.id, false)">驳回</button>
            </div>
          </div>
        </div>
      </section>
    </template>

    <!-- 用户审核 -->
    <template v-else>
      <section class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-4 md:p-5">
        <h3 class="mb-3 text-sm font-black text-text-primary">注册待审核（{{ users.registrations?.length || 0 }}）</h3>
        <div v-if="!users.registrations?.length" class="py-6 text-center text-xs text-text-tertiary">暂无待审核注册</div>
        <div v-else class="space-y-3">
          <div v-for="row in users.registrations" :key="`u-${row.id}`" class="flex flex-col gap-3 rounded-xl border border-border-secondary-50 bg-bg-primary-40 p-3 md:flex-row md:items-center md:justify-between">
            <div class="min-w-0 text-xs text-text-secondary">
              <span class="font-bold text-text-primary">{{ row.name }}</span>
              <span class="ml-2 text-text-tertiary">@{{ row.username }}</span>
              <span v-if="row.grade || row.class" class="ml-2 text-text-tertiary">{{ row.grade || '' }} {{ row.class || '' }}</span>
              <div v-if="row.email" class="mt-1 truncate text-text-tertiary">{{ row.email }}</div>
            </div>
            <div class="flex shrink-0 gap-2">
              <button class="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover" type="button" @click="decideUser('register', row.id, true)">通过</button>
              <button class="rounded-lg border border-error-30 px-3 py-1.5 text-xs font-bold text-error hover:bg-error-10" type="button" @click="decideUser('register', row.id, false)">拒绝</button>
            </div>
          </div>
        </div>
      </section>

      <section class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-4 md:p-5">
        <h3 class="mb-3 text-sm font-black text-text-primary">真实姓名修改申请（{{ users.nameChanges?.length || 0 }}）</h3>
        <div v-if="!users.nameChanges?.length" class="py-6 text-center text-xs text-text-tertiary">暂无待审改名</div>
        <div v-else class="space-y-3">
          <div v-for="row in users.nameChanges" :key="`n-${row.id}`" class="flex flex-col gap-3 rounded-xl border border-border-secondary-50 bg-bg-primary-40 p-3 md:flex-row md:items-center md:justify-between">
            <div class="min-w-0 text-xs text-text-secondary">
              <span class="text-text-tertiary">{{ row.oldName || '未填写' }}</span>
              <span class="mx-1 text-text-tertiary">→</span>
              <span class="font-bold text-text-primary">{{ row.newName }}</span>
              <span v-if="row.user" class="ml-2 text-text-tertiary">@{{ row.user.username }} {{ row.user.grade || '' }} {{ row.user.class || '' }}</span>
            </div>
            <div class="flex shrink-0 gap-2">
              <button class="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover" type="button" @click="decideUser('name', row.id, true)">通过</button>
              <button class="rounded-lg border border-error-30 px-3 py-1.5 text-xs font-bold text-error hover:bg-error-10" type="button" @click="rejectName(row.id)">驳回</button>
            </div>
          </div>
        </div>
      </section>

      <section class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-4 md:p-5">
        <h3 class="mb-3 text-sm font-black text-text-primary">注销宽限期账号（{{ users.deletions?.length || 0 }}）</h3>
        <p class="mb-3 text-[11px] text-text-tertiary">宽限期内登录一次即自动恢复；30 天未登录会由系统清理（也可点上方「立即清理逾期注销账号」）。</p>
        <div v-if="!users.deletions?.length" class="py-6 text-center text-xs text-text-tertiary">暂无待注销账号</div>
        <div v-else class="space-y-3">
          <div v-for="row in users.deletions" :key="`d-${row.id}`" class="flex flex-col gap-3 rounded-xl border border-border-secondary-50 bg-bg-primary-40 p-3 md:flex-row md:items-center md:justify-between">
            <div class="min-w-0 text-xs text-text-secondary">
              <span class="font-bold text-text-primary">{{ row.name }}</span>
              <span class="ml-2 text-text-tertiary">@{{ row.username }}</span>
              <div class="mt-1 text-text-tertiary">计划清理：{{ formatTime(row.deletionScheduledAt) }}</div>
            </div>
            <div class="flex shrink-0 gap-2">
              <button class="rounded-lg border border-border-secondary px-3 py-1.5 text-xs font-bold text-text-secondary hover:bg-bg-tertiary" type="button" @click="decideUser('deletion', row.id, false)">撤销注销</button>
              <button class="rounded-lg border border-error-30 px-3 py-1.5 text-xs font-bold text-error hover:bg-error-10" type="button" @click="decideUser('deletion', row.id, true)">立即清理</button>
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

const props = defineProps({
  mode: { type: String, default: 'notes' }
})

const { showToast } = useToast()
const loading = ref(false)
const notes = ref({ songs: [], replays: [] })
const users = ref({ registrations: [], nameChanges: [], deletions: [] })

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
        nameChanges: res?.data?.nameChanges || [],
        deletions: res?.data?.deletions || []
      }
    }
  } catch (error) {
    showToast?.(error?.data?.message || '加载失败', 'error')
  } finally {
    loading.value = false
  }
}

const decideNote = async (kind, id, approve) => {
  try {
    await $fetch('/api/admin/review/notes/decide', { method: 'POST', body: { kind, id, approve } })
    showToast?.(approve ? '已通过' : '已驳回', 'success')
    await load()
  } catch (error) {
    showToast?.(error?.data?.message || '操作失败', 'error')
  }
}

const decideUser = async (kind, id, approve, reason = '') => {
  try {
    await $fetch('/api/admin/review/users/decide', { method: 'POST', body: { kind, id, approve, reason } })
    showToast?.('操作成功', 'success')
    await load()
  } catch (error) {
    showToast?.(error?.data?.message || '操作失败', 'error')
  }
}

const rejectName = async (id) => {
  const reason = prompt('驳回原因（可留空）：') || ''
  await decideUser('name', id, false, reason)
}

const runPurge = async () => {
  try {
    const res = await $fetch('/api/admin/review/users/decide', { method: 'POST', body: { kind: 'purge' } })
    const r = res?.result || {}
    showToast?.(`清理完成：删除 ${r.purged || 0} 个，匿名化 ${r.anonymized || 0} 个`, 'success')
    await load()
  } catch (error) {
    showToast?.(error?.data?.message || '清理失败', 'error')
  }
}

onMounted(load)
watch(() => props.mode, load)
</script>
