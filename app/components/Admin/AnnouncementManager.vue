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
        <h2 class="text-lg font-black text-text-primary">{{ t.announcement.title }}</h2>
        <p class="mt-1 text-xs text-text-tertiary">
          {{ t.announcement.desc }}
        </p>
      </div>
      <button class="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-white transition-all hover:bg-primary-hover" type="button" @click="startCreate">
        <Plus :size="14" /> {{ t.announcement.create }}
      </button>
    </div>

    <!-- 编辑器 -->
    <div v-if="editing" class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-4 md:p-5">
      <div class="mb-4 flex items-center justify-between">
        <span class="text-sm font-black text-text-primary">{{ editing.id ? '编辑公告' : '新建公告' }}</span>
        <button class="rounded-lg p-1.5 text-text-tertiary hover:bg-bg-tertiary" type="button" @click="editing = null">
          <X :size="16" />
        </button>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        <div class="space-y-3">
          <div>
            <label class="mb-1 block text-xs font-bold text-text-secondary">类型</label>
            <div class="inline-flex rounded-xl border border-border-secondary bg-bg-primary-40 p-1">
              <button
                v-for="opt in [{ v: 'TEXT', l: t.announcement.typeText }, { v: 'IMAGE', l: t.announcement.typeImage }]"
                :key="opt.v"
                class="rounded-lg px-3 py-1.5 text-xs font-bold transition-all"
                :class="editing.type === opt.v ? 'bg-primary text-white' : 'text-text-tertiary hover:text-text-secondary'"
                type="button"
                @click="editing.type = opt.v"
              >
                {{ opt.l }}
              </button>
            </div>
          </div>

          <div v-if="editing.type === 'TEXT'">
            <label class="mb-1 block text-xs font-bold text-text-secondary">显示方式</label>
            <div class="mb-3 inline-flex rounded-xl border border-border-secondary bg-bg-primary-40 p-1">
              <button
                class="rounded-lg px-3 py-1.5 text-xs font-bold transition-all"
                :class="editing.displayMode !== 'WRAP' ? 'bg-primary text-white' : 'text-text-tertiary hover:text-text-secondary'"
                type="button"
                @click="editing.displayMode = 'SCROLL'"
              >
                {{ t.announcement.modeScroll }}
              </button>
              <button
                class="rounded-lg px-3 py-1.5 text-xs font-bold transition-all"
                :class="editing.displayMode === 'WRAP' ? 'bg-primary text-white' : 'text-text-tertiary hover:text-text-secondary'"
                type="button"
                @click="editing.displayMode = 'WRAP'"
              >
  {{ t.announcement.modeWrap }}
              </button>
            </div>
            <p class="mb-2 text-[11px] text-text-tertiary">
              {{ t.announcement.modeHint }}
            </p>
            <label class="mb-1 block text-xs font-bold text-text-secondary">字号</label>
            <div class="mb-3 inline-flex rounded-xl border border-border-secondary bg-bg-primary-40 p-1">
              <button
                v-for="opt in [{ v: 'SMALL', l: '小' }, { v: 'MEDIUM', l: '标准' }, { v: 'LARGE', l: '大' }]"
                :key="opt.v"
                class="rounded-lg px-3 py-1.5 text-xs font-bold transition-all"
                :class="(editing.fontSize || 'MEDIUM') === opt.v ? 'bg-primary text-white' : 'text-text-tertiary hover:text-text-secondary'"
                type="button"
                @click="editing.fontSize = opt.v"
              >
                {{ opt.l }}
              </button>
            </div>
            <label class="mb-1 block text-xs font-bold text-text-secondary">公告文字</label>
            <textarea
              v-model="editing.text"
              class="h-24 w-full rounded-xl border border-border-secondary bg-bg-primary-40 px-3 py-2 text-sm text-text-primary focus:border-primary-50 focus:outline-none"
              maxlength="200"
              :placeholder="t.announcement.textPlaceholder"
            />
          </div>

          <div v-else class="space-y-2">
            <label class="mb-1 block text-xs font-bold text-text-secondary">{{ t.announcement.imageLabel }}</label>
            <input
              ref="fileInput"
              accept="image/png,image/jpeg,image/webp,image/gif"
              class="block w-full cursor-pointer rounded-xl border border-border-secondary bg-bg-primary-40 px-3 py-2 text-xs text-text-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-bg-tertiary file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-text-secondary"
              type="file"
              @change="onFileChange"
            />
            <input
              v-model="editing.imageUrl"
              class="w-full rounded-xl border border-border-secondary bg-bg-primary-40 px-3 py-2 text-xs text-text-primary focus:border-primary-50 focus:outline-none"
              :placeholder="t.announcement.imageUrlPlaceholder"
            />
            <p v-if="uploading" class="text-[11px] text-text-tertiary">{{ t.announcement.uploading }}</p>
          </div>

          <div>
            <label class="mb-1 block text-xs font-bold text-text-secondary">{{ t.announcement.linkLabel }}</label>
            <input
              v-model="editing.linkUrl"
              class="w-full rounded-xl border border-border-secondary bg-bg-primary-40 px-3 py-2 text-xs text-text-primary focus:border-primary-50 focus:outline-none"
              :placeholder="t.announcement.linkPlaceholder"
            />
          </div>

          <label class="flex items-center gap-2 text-xs font-bold text-text-secondary">
            <input v-model="editing.enabled" class="h-4 w-4 rounded border-border-secondary" type="checkbox" />
            {{ t.announcement.enabledLabel }}
          </label>

          <div class="flex gap-2 pt-1">
            <button
              class="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-white transition-all hover:bg-primary-hover disabled:opacity-50"
              :disabled="saving"
              type="button"
              @click="save"
            >
              <RefreshCw v-if="saving" :size="14" class="animate-spin" /> {{ t.common.save }}
            </button>
            <button
              class="rounded-xl border border-border-secondary bg-bg-primary-40 px-4 py-2.5 text-xs font-bold text-text-secondary hover:bg-bg-tertiary"
              type="button"
              @click="editing = null"
            >
              {{ t.common.cancel }}
            </button>
          </div>
        </div>

        <!-- 预览：与首页同样克制的尺寸 -->
        <div class="space-y-2">
          <span class="text-xs font-bold text-text-secondary">{{ t.announcement.preview }}</span>
          <div class="rounded-xl border border-border-secondary-50 bg-bg-secondary-60 px-3 py-2">
            <div
              class="flex items-center justify-center gap-2 text-text-secondary"
              :style="{ fontSize: (editing.fontSize || 'MEDIUM') === 'SMALL' ? '11px' : (editing.fontSize === 'LARGE' ? '15px' : '12.5px') }"
            >
              <template v-if="editing.type === 'IMAGE' && previewImage">
                <img :src="previewImage" alt="" style="max-height: 52px; max-width: 100%; object-fit: contain" />
              </template>
              <template v-else>
                <Icon name="volume" :size="14" class="shrink-0 opacity-75" />
                <span
                  v-if="editing.displayMode === 'WRAP'"
                  class="text-center"
                  style="white-space: normal; word-break: break-word"
                >{{ editing.text || t.announcement.previewText }}</span>
                <span v-else class="truncate">{{ editing.text || t.announcement.previewText }}</span>
              </template>
            </div>
          </div>
          <p class="text-[11px] text-text-tertiary">{{ t.announcement.previewHint }}</p>
        </div>
      </div>
    </div>

    <!-- 列表 -->
    <div v-if="loading" class="flex items-center justify-center gap-2 py-10 text-xs text-text-tertiary">
      <RefreshCw :size="16" class="animate-spin" /> 加载中…
    </div>
    <div v-else-if="!items.length" class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 py-12 text-center text-xs text-text-tertiary">
      {{ t.announcement.empty }}
    </div>
    <div v-else class="space-y-3">
      <div
        v-for="(item, index) in items"
        :key="item.id"
        class="flex flex-col gap-3 rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-4 md:flex-row md:items-center md:justify-between"
      >
        <div class="flex min-w-0 flex-1 items-center gap-3">
          <span class="shrink-0 rounded-lg bg-bg-tertiary px-2 py-1 text-[10px] font-bold text-text-tertiary">
            {{ item.type === 'IMAGE' ? '图片' : '文字' }}
          </span>
          <img
            v-if="item.type === 'IMAGE' && imageSrc(item)"
            :src="imageSrc(item)"
            alt=""
            class="h-8 w-auto max-w-[120px] shrink-0 rounded border border-border-secondary-50 object-contain"
          />
          <span class="truncate text-sm text-text-primary">
            {{ item.type === 'IMAGE' ? (item.imageUrl || '（上传的图片）') : item.text }}
          </span>
          <span v-if="item.type !== 'IMAGE'" class="shrink-0 rounded-lg bg-bg-tertiary px-2 py-1 text-[10px] font-bold text-text-tertiary">
            {{ item.displayMode === 'WRAP' ? '分行完整' : '滚动' }}·{{ item.fontSize === 'SMALL' ? '小' : item.fontSize === 'LARGE' ? '大' : '标准' }}
          </span>
          <span v-if="!item.enabled" class="shrink-0 rounded-lg bg-bg-tertiary px-2 py-1 text-[10px] font-bold text-text-tertiary">{{ t.common.disabled }}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <button class="rounded-lg border border-border-secondary p-1.5 text-text-tertiary hover:bg-bg-tertiary disabled:opacity-40" :disabled="index === 0" :title="t.announcement.moveUp" type="button" @click="move(index, -1)">
            <ChevronUp :size="14" />
          </button>
          <button class="rounded-lg border border-border-secondary p-1.5 text-text-tertiary hover:bg-bg-tertiary disabled:opacity-40" :disabled="index === items.length - 1" :title="t.announcement.moveDown" type="button" @click="move(index, 1)">
            <ChevronDown :size="14" />
          </button>
          <button class="rounded-lg border border-border-secondary px-2.5 py-1.5 text-xs font-bold text-text-secondary hover:bg-bg-tertiary" type="button" @click="startEdit(item)">{{ t.common.edit }}</button>
          <button class="rounded-lg border border-error-30 px-2.5 py-1.5 text-xs font-bold text-error hover:bg-error-10" type="button" @click="remove(item)">{{ t.common.delete }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ChevronDown, ChevronUp, Plus, RefreshCw, X } from '@lucide/vue'
import { useNewUi } from '~/composables/useNewUi'

const t = useNewUi()
const { showToast } = useToast()
const items = ref([])
const loading = ref(false)
const saving = ref(false)
const uploading = ref(false)
const editing = ref(null)
const fileInput = ref(null)

const previewImage = computed(() => {
  if (!editing.value) return ''
  return editing.value.imageId ? `/api/media/${editing.value.imageId}` : editing.value.imageUrl || ''
})

const imageSrc = (item) => (item.imageId ? `/api/media/${item.imageId}` : item.imageUrl || '')

const load = async () => {
  loading.value = true
  try {
    const res = await $fetch('/api/admin/announcements')
    items.value = res?.data || []
  } catch (error) {
    showToast?.(error?.data?.message || t.value.announcement.loadFailed, 'error')
  } finally {
    loading.value = false
  }
}

const startCreate = () => {
  editing.value = { id: null, type: 'TEXT', text: '', imageId: null, imageUrl: '', linkUrl: '', displayMode: 'SCROLL', fontSize: 'MEDIUM', enabled: true }
}
const startEdit = (item) => {
  editing.value = { ...item }
}

const onFileChange = async (event) => {
  const file = event.target?.files?.[0]
  if (!file) return
  uploading.value = true
  try {
    const form = new FormData()
    form.append('file', file)
    const res = await $fetch('/api/admin/media', { method: 'POST', body: form })
    editing.value.imageId = res.id
    editing.value.imageUrl = ''
    showToast?.(t.value.announcement.uploadOk, 'success')
  } catch (error) {
    showToast?.(error?.data?.message || t.value.announcement.uploadFailed, 'error')
  } finally {
    uploading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

const save = async () => {
  const data = editing.value
  if (!data) return
  if (data.type === 'TEXT' && !String(data.text || '').trim()) {
    showToast?.(t.value.announcement.textRequired, 'error')
    return
  }
  if (data.type === 'IMAGE' && !data.imageId && !String(data.imageUrl || '').trim()) {
    showToast?.(t.value.announcement.imageRequired, 'error')
    return
  }

  saving.value = true
  try {
    const body = {
      type: data.type,
      text: data.text || '',
      imageId: data.imageId || null,
      imageUrl: data.imageUrl || '',
      linkUrl: data.linkUrl || '',
      displayMode: data.displayMode === 'WRAP' ? 'WRAP' : 'SCROLL',
      fontSize: data.fontSize === 'SMALL' ? 'SMALL' : data.fontSize === 'LARGE' ? 'LARGE' : 'MEDIUM',
      enabled: data.enabled !== false
    }
    if (data.id) {
      await $fetch(`/api/admin/announcements/${data.id}`, { method: 'PUT', body })
    } else {
      await $fetch('/api/admin/announcements', { method: 'POST', body })
    }
    showToast?.(t.value.announcement.saved, 'success')
    editing.value = null
    await load()
  } catch (error) {
    showToast?.(error?.data?.message || t.value.announcement.saveFailed, 'error')
  } finally {
    saving.value = false
  }
}

const move = async (index, delta) => {
  const target = index + delta
  if (target < 0 || target >= items.value.length) return
  const a = items.value[index]
  const b = items.value[target]
  try {
    await Promise.all([
      $fetch(`/api/admin/announcements/${a.id}`, { method: 'PUT', body: { sortOrder: target + 1 } }),
      $fetch(`/api/admin/announcements/${b.id}`, { method: 'PUT', body: { sortOrder: index + 1 } })
    ])
    await load()
  } catch (error) {
    showToast?.(t.value.announcement.sortFailed, 'error')
  }
}

const remove = async (item) => {
  if (!confirm(t.value.announcement.deleteConfirm)) return
  try {
    await $fetch(`/api/admin/announcements/${item.id}`, { method: 'DELETE' })
    showToast?.(t.value.announcement.deleted, 'success')
    await load()
  } catch (error) {
    showToast?.(t.value.announcement.deleteFailed, 'error')
  }
}

onMounted(load)
</script>
