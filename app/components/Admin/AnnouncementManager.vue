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
        <h2 class="text-lg font-black text-text-primary">公告栏编辑</h2>
        <p class="mt-1 text-xs text-text-tertiary">
          展示在首页顶端。可添加多条文字或图片，多条自动轮播（6 秒一条）。建议图片高度不超过 60px，避免占屏。
        </p>
      </div>
      <button class="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-white transition-all hover:bg-primary-hover" type="button" @click="startCreate">
        <Plus :size="14" /> 新建公告
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
                v-for="opt in [{ v: 'TEXT', l: '文字公告' }, { v: 'IMAGE', l: '图片公告' }]"
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
                滚动显示
              </button>
              <button
                class="rounded-lg px-3 py-1.5 text-xs font-bold transition-all"
                :class="editing.displayMode === 'WRAP' ? 'bg-primary text-white' : 'text-text-tertiary hover:text-text-secondary'"
                type="button"
                @click="editing.displayMode = 'WRAP'"
              >
                分行完整显示
              </button>
            </div>
            <p class="mb-2 text-[11px] text-text-tertiary">
              滚动：文字超出宽度时横向跑马灯（公告栏始终保持一行高）；分行完整：不滚动，按需要分成多行把文字全部显示出来（公告栏会随文字变高）。
            </p>
            <label class="mb-1 block text-xs font-bold text-text-secondary">公告文字</label>
            <textarea
              v-model="editing.text"
              class="h-24 w-full rounded-xl border border-border-secondary bg-bg-primary-40 px-3 py-2 text-sm text-text-primary focus:border-primary-50 focus:outline-none"
              maxlength="200"
              placeholder="例如：本周点歌截止到周四 18:00，欢迎投稿～"
            />
          </div>

          <div v-else class="space-y-2">
            <label class="mb-1 block text-xs font-bold text-text-secondary">公告图片（≤2MB，建议高度 40~60px）</label>
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
              placeholder="也可直接填相对路径，例如 /images/school-logo-light.png"
            />
            <p v-if="uploading" class="text-[11px] text-text-tertiary">上传中…</p>
          </div>

          <div>
            <label class="mb-1 block text-xs font-bold text-text-secondary">点击跳转链接（可选）</label>
            <input
              v-model="editing.linkUrl"
              class="w-full rounded-xl border border-border-secondary bg-bg-primary-40 px-3 py-2 text-xs text-text-primary focus:border-primary-50 focus:outline-none"
              placeholder="https://… 或 /songs"
            />
          </div>

          <label class="flex items-center gap-2 text-xs font-bold text-text-secondary">
            <input v-model="editing.enabled" class="h-4 w-4 rounded border-border-secondary" type="checkbox" />
            启用（关闭后首页不显示）
          </label>

          <div class="flex gap-2 pt-1">
            <button
              class="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-white transition-all hover:bg-primary-hover disabled:opacity-50"
              :disabled="saving"
              type="button"
              @click="save"
            >
              <RefreshCw v-if="saving" :size="14" class="animate-spin" /> 保存
            </button>
            <button
              class="rounded-xl border border-border-secondary bg-bg-primary-40 px-4 py-2.5 text-xs font-bold text-text-secondary hover:bg-bg-tertiary"
              type="button"
              @click="editing = null"
            >
              取消
            </button>
          </div>
        </div>

        <!-- 预览：与首页同样克制的尺寸 -->
        <div class="space-y-2">
          <span class="text-xs font-bold text-text-secondary">预览（首页实际效果）</span>
          <div class="rounded-xl border border-border-secondary-50 bg-bg-secondary-60 px-3 py-2">
            <div class="flex items-center justify-center gap-2 text-[12.5px] text-text-secondary">
              <template v-if="editing.type === 'IMAGE' && previewImage">
                <img :src="previewImage" alt="预览" style="max-height: 52px; max-width: 100%; object-fit: contain" />
              </template>
              <template v-else>
                <Icon name="volume" :size="14" class="shrink-0 opacity-75" />
                <span
                  v-if="editing.displayMode === 'WRAP'"
                  class="text-center"
                  style="white-space: normal; word-break: break-word"
                >{{ editing.text || '公告文字预览' }}</span>
                <span v-else class="truncate">{{ editing.text || '公告文字预览' }}</span>
              </template>
            </div>
          </div>
          <p class="text-[11px] text-text-tertiary">窄屏（手机）会自动缩到更小：文字 11.5px、图片最高 38px。</p>
        </div>
      </div>
    </div>

    <!-- 列表 -->
    <div v-if="loading" class="flex items-center justify-center gap-2 py-10 text-xs text-text-tertiary">
      <RefreshCw :size="16" class="animate-spin" /> 加载中…
    </div>
    <div v-else-if="!items.length" class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 py-12 text-center text-xs text-text-tertiary">
      还没有公告，点右上角「新建公告」开始。
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
            {{ item.displayMode === 'WRAP' ? '分行完整' : '滚动' }}
          </span>
          <span v-if="!item.enabled" class="shrink-0 rounded-lg bg-bg-tertiary px-2 py-1 text-[10px] font-bold text-text-tertiary">已停用</span>
        </div>
        <div class="flex items-center gap-1.5">
          <button class="rounded-lg border border-border-secondary p-1.5 text-text-tertiary hover:bg-bg-tertiary disabled:opacity-40" :disabled="index === 0" title="上移" type="button" @click="move(index, -1)">
            <ChevronUp :size="14" />
          </button>
          <button class="rounded-lg border border-border-secondary p-1.5 text-text-tertiary hover:bg-bg-tertiary disabled:opacity-40" :disabled="index === items.length - 1" title="下移" type="button" @click="move(index, 1)">
            <ChevronDown :size="14" />
          </button>
          <button class="rounded-lg border border-border-secondary px-2.5 py-1.5 text-xs font-bold text-text-secondary hover:bg-bg-tertiary" type="button" @click="startEdit(item)">编辑</button>
          <button class="rounded-lg border border-error-30 px-2.5 py-1.5 text-xs font-bold text-error hover:bg-error-10" type="button" @click="remove(item)">删除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ChevronDown, ChevronUp, Plus, RefreshCw, X } from '@lucide/vue'

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
    showToast?.(error?.data?.message || '加载公告失败', 'error')
  } finally {
    loading.value = false
  }
}

const startCreate = () => {
  editing.value = { id: null, type: 'TEXT', text: '', imageId: null, imageUrl: '', linkUrl: '', displayMode: 'SCROLL', enabled: true }
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
    showToast?.('图片已上传', 'success')
  } catch (error) {
    showToast?.(error?.data?.message || '图片上传失败', 'error')
  } finally {
    uploading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

const save = async () => {
  const data = editing.value
  if (!data) return
  if (data.type === 'TEXT' && !String(data.text || '').trim()) {
    showToast?.('请填写公告文字', 'error')
    return
  }
  if (data.type === 'IMAGE' && !data.imageId && !String(data.imageUrl || '').trim()) {
    showToast?.('请上传图片或填写图片地址', 'error')
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
      enabled: data.enabled !== false
    }
    if (data.id) {
      await $fetch(`/api/admin/announcements/${data.id}`, { method: 'PUT', body })
    } else {
      await $fetch('/api/admin/announcements', { method: 'POST', body })
    }
    showToast?.('已保存', 'success')
    editing.value = null
    await load()
  } catch (error) {
    showToast?.(error?.data?.message || '保存失败', 'error')
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
    showToast?.('排序失败', 'error')
  }
}

const remove = async (item) => {
  if (!confirm('确定删除这条公告吗？')) return
  try {
    await $fetch(`/api/admin/announcements/${item.id}`, { method: 'DELETE' })
    showToast?.('已删除', 'success')
    await load()
  } catch (error) {
    showToast?.('删除失败', 'error')
  }
}

onMounted(load)
</script>
