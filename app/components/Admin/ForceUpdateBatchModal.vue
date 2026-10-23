/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

<!-- Modified by YH-Chen on 2026-10-23 -->
<!-- 批量强制更新：一次给多个账号下发「下次进入站点时必须更新密码 / 用户名」的要求 -->
<template>
  <Transition
    enter-active-class="transition duration-300 ease-out"
    enter-from-class="opacity-0 scale-95"
    enter-to-class="opacity-100 scale-100"
    leave-active-class="transition duration-200 ease-in"
    leave-from-class="opacity-100 scale-100"
    leave-to-class="opacity-0 scale-95"
  >
    <div
      v-if="show"
      class="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-bg-primary-80 backdrop-blur-sm"
      @click="$emit('close')"
    >
      <div
        class="bg-bg-secondary border border-border-secondary w-full max-w-2xl rounded-xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
        @click.stop
      >
        <!-- 头部 -->
        <div class="p-8 pb-4 flex items-center justify-between border-b border-border-secondary-50">
          <div>
            <h3 class="text-xl font-black text-text-primary tracking-tight flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-primary-hover-10 flex items-center justify-center text-primary">
                <UserCog :size="20" />
              </div>
              {{ locale.title }}
            </h3>
            <p class="text-xs text-text-tertiary mt-1 ml-13">{{ locale.desc }}</p>
          </div>
          <button
            class="flex items-center justify-center p-3 bg-bg-tertiary-50 hover:bg-bg-tertiary text-text-tertiary hover:text-text-primary rounded-xl transition-all"
            @click="$emit('close')"
          >
            <X :size="20" />
          </button>
        </div>

        <div class="flex-1 overflow-y-auto p-8 pt-6 custom-scrollbar space-y-6">
          <!-- 筛选 -->
          <div class="space-y-3">
            <div class="flex items-center gap-2 text-xs font-black text-text-tertiary uppercase tracking-widest ml-1">
              <Filter :size="14" class="text-primary" />
              {{ locale.filterTitle }}
            </div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div class="relative group md:col-span-1">
                <Search
                  class="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-primary transition-colors"
                  :size="14"
                />
                <input
                  v-model="searchQuery"
                  class="w-full bg-bg-primary border border-border-secondary rounded-lg pl-10 pr-3 py-2.5 text-xs text-text-primary focus:outline-none focus:border-primary-30 transition-all"
                  :placeholder="locale.filterPlaceholder"
                  type="text"
                >
              </div>
              <CustomSelect
                v-model="gradeFilter"
                :options="gradeOptions"
                label-key="label"
                value-key="value"
                :placeholder="locale.allGrades"
                class-name="w-full"
              />
              <CustomSelect
                v-model="classFilter"
                :options="classOptions"
                label-key="label"
                value-key="value"
                :placeholder="locale.allClasses"
                class-name="w-full"
              />
            </div>
          </div>

          <!-- 用户清单 -->
          <div class="space-y-3">
            <div class="flex items-center justify-between ml-1">
              <label class="text-[10px] font-black text-text-tertiary uppercase tracking-widest">
                {{ formatMessage(locale.selectHint, selectedIds.length, filteredUsers.length) }}
              </label>
              <div class="flex items-center gap-4">
                <button
                  v-if="hasFilter"
                  class="text-[10px] font-black text-text-tertiary hover:text-text-primary uppercase tracking-widest transition-colors"
                  @click="resetFilters"
                >
                  {{ locale.resetFilters }}
                </button>
                <button
                  class="text-[10px] font-black text-primary hover:text-primary-hover uppercase tracking-widest transition-colors"
                  @click="toggleSelectAll"
                >
                  {{ isAllSelected ? locale.clearSelection : locale.selectAll }}
                </button>
              </div>
            </div>
            <div class="max-h-52 overflow-y-auto rounded-lg border border-border-secondary bg-bg-primary p-2 custom-scrollbar">
              <div
                v-if="loadingUsers"
                class="py-10 flex items-center justify-center gap-2 text-xs text-text-disabled font-medium"
              >
                <RefreshCw :size="14" class="animate-spin" />
                {{ locale.loadingUsers }}
              </div>
              <div
                v-else-if="filteredUsers.length === 0"
                class="py-10 text-center text-xs text-text-disabled font-medium"
              >
                {{ locale.empty }}
              </div>
              <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-1">
                <label
                  v-for="user in filteredUsers"
                  :key="user.id"
                  class="flex items-center gap-3 p-3 rounded-lg transition-colors group"
                  :class="
                    isSelectable(user)
                      ? 'hover:bg-bg-secondary-50 cursor-pointer'
                      : 'opacity-50 cursor-not-allowed'
                  "
                >
                  <input
                    v-model="selectedIds"
                    :value="user.id"
                    :disabled="!isSelectable(user)"
                    class="w-4 h-4 rounded-md border-border-tertiary bg-bg-primary text-primary focus:ring-color-collab-10 disabled:cursor-not-allowed"
                    type="checkbox"
                  >
                  <div class="flex flex-col min-w-0">
                    <span class="text-xs font-bold text-text-primary group-hover:text-primary transition-colors truncate">
                      {{ user.name || user.username }}
                    </span>
                    <span class="text-[10px] text-text-disabled font-mono truncate">
                      {{ user.username }}
                      <template v-if="user.grade || user.class">
                        · {{ user.grade || '' }}{{ user.class ? ` ${user.class}` : '' }}
                      </template>
                    </span>
                  </div>
                  <span
                    v-if="!isSelectable(user)"
                    class="ml-auto shrink-0 text-[9px] font-black text-text-disabled uppercase tracking-wider"
                  >
                    {{ locale.notAllowed }}
                  </span>
                  <span
                    v-else-if="user.forcePasswordChange || user.forceUsernameChange"
                    class="ml-auto shrink-0 px-1.5 py-0.5 rounded text-[9px] font-black bg-warning-10 text-warning uppercase tracking-wider"
                  >
                    {{ locale.pendingBadge }}
                  </span>
                </label>
              </div>
            </div>
          </div>

          <!-- 更新内容 -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              class="flex items-start gap-3 p-4 rounded-xl border text-left transition-all"
              :class="
                form.password
                  ? 'border-primary-30 bg-primary-hover-10'
                  : 'border-border-secondary bg-bg-primary-50 hover:border-border-tertiary'
              "
              @click="form.password = !form.password"
            >
              <div
                class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                :class="form.password ? 'bg-primary text-white' : 'bg-bg-tertiary text-text-tertiary'"
              >
                <Key :size="16" />
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-xs font-black text-text-primary">{{ locale.passwordTitle }}</p>
                <p class="text-[10px] text-text-tertiary mt-0.5 leading-relaxed">{{ locale.passwordDesc }}</p>
              </div>
              <span
                class="w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors"
                :class="form.password ? 'bg-primary border-primary text-white' : 'border-border-tertiary text-transparent'"
              >
                <Check :size="12" />
              </span>
            </button>

            <button
              type="button"
              class="flex items-start gap-3 p-4 rounded-xl border text-left transition-all"
              :class="
                form.username
                  ? 'border-primary-30 bg-primary-hover-10'
                  : 'border-border-secondary bg-bg-primary-50 hover:border-border-tertiary'
              "
              @click="form.username = !form.username"
            >
              <div
                class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                :class="form.username ? 'bg-primary text-white' : 'bg-bg-tertiary text-text-tertiary'"
              >
                <AtSign :size="16" />
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-xs font-black text-text-primary">{{ locale.usernameTitle }}</p>
                <p class="text-[10px] text-text-tertiary mt-0.5 leading-relaxed">{{ locale.usernameDesc }}</p>
              </div>
              <span
                class="w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors"
                :class="form.username ? 'bg-primary border-primary text-white' : 'border-border-tertiary text-transparent'"
              >
                <Check :size="12" />
              </span>
            </button>
          </div>

          <p class="text-[11px] text-text-tertiary leading-relaxed">{{ locale.tip }}</p>

          <div
            v-if="errorMessage"
            class="p-4 bg-error-10 border border-error-20 rounded-2xl flex items-center gap-3 text-error text-xs"
          >
            <AlertCircle :size="16" class="shrink-0" />
            {{ errorMessage }}
          </div>
        </div>

        <!-- 底部按钮 -->
        <div class="p-8 pt-4 border-t border-border-secondary-50 bg-bg-secondary-50 flex gap-3">
          <button
            class="flex-1 px-6 py-4 bg-bg-tertiary hover:bg-bg-quaternary text-text-secondary text-xs font-black rounded-2xl transition-all uppercase tracking-widest"
            @click="$emit('close')"
          >
            {{ locale.cancel }}
          </button>
          <button
            :disabled="loading || !canSubmit"
            class="flex-[2] px-6 py-4 bg-primary hover:bg-primary-hover text-white text-xs font-black rounded-2xl transition-all uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg active:scale-95"
            @click="submit"
          >
            <RefreshCw v-if="loading" class="animate-spin" :size="16" />
            <UserCog v-else :size="16" />
            {{ loading ? locale.confirming : formatMessage(locale.confirm, selectedIds.length) }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { AlertCircle, AtSign, Check, Filter, Key, RefreshCw, Search, UserCog, X } from '@lucide/vue'
import { useAuth } from '~/composables/useAuth'
import { useLocale } from '~/utils/locale'
import CustomSelect from '~/components/UI/Common/CustomSelect.vue'

const props = defineProps({
  show: Boolean,
  users: { type: Array, default: () => [] }
})
const emit = defineEmits(['close', 'success'])

const { admin } = useLocale()
const locale = computed(() => admin.value?.userManager?.batchForceUpdate || {})
const auth = useAuth()
const { localize: localizeServerError } = useServerErrors()

const searchQuery = ref('')
const gradeFilter = ref('')
const classFilter = ref('')
const selectedIds = ref([])
const form = ref({ password: false, username: false })
const loading = ref(false)
const errorMessage = ref('')
// 批量弹窗自行拉取全量用户（列表接口上限 1000），避免受表格分页 50 条限制
const allUsers = ref([])
const loadingUsers = ref(false)
const sourceUsers = computed(() => {
  const list = allUsers.value.length > 0 ? allUsers.value : props.users
  // 已合并 / 已毕业 / 退学等归档账号无法登录，强制更新对它们没有意义，直接不展示
  return list.filter((user) => !user.status || user.status === 'active')
})

const formatMessage = (value, ...args) => {
  if (typeof value === 'function') return value(...args)
  if (typeof value === 'string') {
    return value.replace(/{(\d+)}/g, (match, index) =>
      args[index] !== undefined ? String(args[index]) : match
    )
  }
  return ''
}

const hasFilter = computed(() => Boolean(searchQuery.value.trim() || gradeFilter.value || classFilter.value))

const gradeOptions = computed(() => {
  const set = new Set(
    sourceUsers.value.map((user) => String(user.grade || '').trim()).filter((value) => value !== '')
  )
  return [...set].sort().map((value) => ({ label: value, value }))
})

const classOptions = computed(() => {
  const set = new Set(
    sourceUsers.value
      .filter((user) => !gradeFilter.value || String(user.grade || '').trim() === gradeFilter.value)
      .map((user) => String(user.class || '').trim())
      .filter((value) => value !== '')
  )
  return [...set].sort().map((value) => ({ label: value, value }))
})

const filteredUsers = computed(() => {
  const keyword = searchQuery.value.trim().toLowerCase()
  return sourceUsers.value.filter((user) => {
    if (gradeFilter.value && String(user.grade || '').trim() !== gradeFilter.value) return false
    if (classFilter.value && String(user.class || '').trim() !== classFilter.value) return false
    if (!keyword) return true
    return [user.name, user.username]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(keyword))
  })
})

// 不可操作的目标提前置灰：自己、系统初始超级管理员、非超管操作超管
const currentUserId = computed(() => auth.user.value?.id)
const currentRole = computed(() => auth.user.value?.role)
const isSelectable = (user) => {
  if (!user) return false
  if (user.id === 1 || user.id === currentUserId.value) return false
  if (user.role === 'SUPER_ADMIN' && currentRole.value !== 'SUPER_ADMIN') return false
  return true
}

const selectableUsers = computed(() => filteredUsers.value.filter(isSelectable))

const isAllSelected = computed(
  () =>
    selectableUsers.value.length > 0 &&
    selectableUsers.value.every((user) => selectedIds.value.includes(user.id))
)

const canSubmit = computed(() => selectedIds.value.length > 0 && (form.value.password || form.value.username))

const toggleSelectAll = () => {
  if (isAllSelected.value) {
    const visible = new Set(selectableUsers.value.map((user) => user.id))
    selectedIds.value = selectedIds.value.filter((id) => !visible.has(id))
  } else {
    const merged = new Set([...selectedIds.value, ...selectableUsers.value.map((user) => user.id)])
    selectedIds.value = [...merged]
  }
}

// 关闭时重置，避免下次打开残留上次勾选
const loadAllUsers = async () => {
  loadingUsers.value = true
  try {
    const data = await $fetch('/api/admin/users', {
      params: { page: 1, limit: 1000, sortBy: 'id', sortOrder: 'asc' },
      ...auth.getAuthConfig()
    })
    allUsers.value = Array.isArray(data?.users) ? data.users : []
  } catch (error) {
    console.warn('批量强制更新：加载用户列表失败，回退到当前页', error)
    allUsers.value = []
  } finally {
    loadingUsers.value = false
  }
}

const resetFilters = () => {
  searchQuery.value = ''
  gradeFilter.value = ''
  classFilter.value = ''
}

watch(
  () => props.show,
  (visible) => {
    if (!visible) return
    resetFilters()
    selectedIds.value = []
    form.value = { password: false, username: false }
    errorMessage.value = ''
    void loadAllUsers()
  },
  { immediate: true }
)

// 年级变化后，班级选项若已不存在则清空
watch(gradeFilter, () => {
  if (classFilter.value && !classOptions.value.some((item) => item.value === classFilter.value)) {
    classFilter.value = ''
  }
})

const submit = async () => {
  if (!canSubmit.value) {
    errorMessage.value = locale.value.noSelection
    return
  }
  loading.value = true
  errorMessage.value = ''
  try {
    const result = await $fetch('/api/admin/users/force-update-batch', {
      method: 'POST',
      body: {
        userIds: selectedIds.value,
        password: form.value.password,
        username: form.value.username
      },
      ...auth.getAuthConfig()
    })
    emit('success', result)
    emit('close')
  } catch (error) {
    errorMessage.value = localizeServerError(error, locale.value.failed)
  } finally {
    loading.value = false
  }
}
</script>
