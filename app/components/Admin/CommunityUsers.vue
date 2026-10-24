<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-lg font-black text-text-primary">{{ t.usersTitle }}</h2>
        <p class="mt-1 text-xs text-text-tertiary">{{ t.usersDesc }}</p>
      </div>
      <button
        class="inline-flex items-center gap-2 rounded-xl border border-border-secondary bg-bg-primary-40 px-3 py-2 text-xs font-bold text-text-secondary hover:bg-bg-tertiary disabled:opacity-50"
        type="button"
        :disabled="loading"
        @click="load"
      >
        <RefreshCw :size="14" :class="{ 'animate-spin': loading }" /> {{ t.refresh }}
      </button>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <div class="relative min-w-[220px] flex-1">
        <Search :size="14" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-disabled" />
        <input
          v-model="query"
          type="text"
          maxlength="50"
          :placeholder="t.searchUsers"
          class="w-full rounded-xl border border-border-secondary bg-bg-primary-40 py-2.5 pl-9 pr-3 text-xs text-text-primary placeholder:text-text-disabled focus:border-primary-30 focus:outline-none"
          @keyup.enter="search"
        >
      </div>
      <button
        type="button"
        class="rounded-xl border border-border-secondary bg-bg-primary-40 px-4 py-2.5 text-xs font-bold text-text-secondary hover:bg-bg-tertiary"
        @click="search"
      >
        {{ t.search }}
      </button>
      <span class="text-[11px] text-text-tertiary">{{ t.totalUsers(total) }}</span>
    </div>

    <div v-if="loading" class="flex items-center justify-center gap-2 py-16 text-xs text-text-tertiary">
      <RefreshCw :size="16" class="animate-spin" /> {{ t.loading }}
    </div>
    <div
      v-else-if="error"
      class="flex flex-col items-center gap-3 rounded-2xl border border-error-20 bg-error-10 py-12 text-xs text-error"
    >
      <span>{{ t.loadFailed }}</span>
      <button class="rounded-lg border border-error-30 px-3 py-1.5 font-bold hover:bg-error-15" type="button" @click="load">
        {{ t.retry }}
      </button>
    </div>
    <div v-else-if="!users.length" class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 py-16 text-center text-xs text-text-tertiary">
      {{ t.emptyPosts }}
    </div>

    <section v-else class="space-y-2">
      <article
        v-for="user in users"
        :key="user.id"
        class="flex flex-col gap-3 rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-4 lg:flex-row lg:items-center lg:justify-between"
      >
        <div class="flex min-w-0 items-start gap-3">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-bg-tertiary text-text-secondary">
            <UserRound :size="18" />
          </span>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <p class="truncate text-sm font-black text-text-primary">{{ user.name || user.username }}</p>
              <span class="rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] font-bold text-text-tertiary">
                {{ t.roleLabels?.[user.role] || user.role }}
              </span>
              <span
                v-if="user.ban?.muted"
                class="rounded-full px-2 py-0.5 text-[10px] font-bold"
                :class="user.ban.permanent ? 'bg-error-10 text-error' : 'bg-warning-10 text-warning'"
              >
                {{ user.ban.permanent ? t.permanentState : t.mutedState }}
              </span>
            </div>
            <p class="mt-1 truncate text-[11px] text-text-tertiary">
              @{{ user.username }} · {{ user.grade || '-' }} {{ user.class || '' }}
            </p>
            <p class="mt-1 text-[11px] text-text-tertiary">
              {{ t.violations }}：<span :class="user.violationCount > 0 ? 'font-bold text-warning' : ''">{{ user.violationCount }}</span>
              <span v-if="user.ban?.muted && user.ban.until" class="ml-2">
                {{ t.mutedState }} {{ formatDate(user.ban.until) }}
              </span>
            </p>
            <p v-if="user.ban?.muted && user.ban.reason" class="mt-1 break-all text-[11px] text-text-disabled">
              {{ user.ban.reason }}
            </p>
          </div>
        </div>

        <div class="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg border border-border-secondary px-3 py-1.5 text-xs font-bold text-text-secondary hover:bg-bg-tertiary"
            @click="openTitles(user)"
          >
            <Award :size="13" /> {{ t.manageTitles }}
          </button>
          <button
            v-if="user.ban?.muted"
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg border border-success-20 px-3 py-1.5 text-xs font-bold text-success hover:bg-success-10"
            :disabled="busyId === user.id"
            @click="unban(user)"
          >
            <Check :size="13" /> {{ t.unban }}
          </button>
          <button
            v-else
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg border border-warning-20 px-3 py-1.5 text-xs font-bold text-warning hover:bg-warning-10"
            @click="openBan(user)"
          >
            <Ban :size="13" /> {{ t.banUser }}
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg border border-border-secondary px-3 py-1.5 text-xs font-bold text-text-tertiary hover:border-error-30 hover:text-error"
            :disabled="busyId === user.id"
            @click="askReset(user)"
          >
            <RefreshCw :size="13" /> {{ t.resetViolations }}
          </button>
        </div>
      </article>

      <div class="flex flex-wrap items-center justify-between gap-3 pt-2">
        <button
          type="button"
          class="rounded-lg border border-border-secondary px-3 py-1.5 text-xs font-bold text-text-secondary hover:bg-bg-tertiary disabled:opacity-40"
          :disabled="page <= 1 || loading"
          @click="changePage(-1)"
        >
          {{ t.pagePrev }}
        </button>
        <span class="text-[11px] text-text-tertiary">{{ t.pageInfo(page, totalPages) }}</span>
        <button
          type="button"
          class="rounded-lg border border-border-secondary px-3 py-1.5 text-xs font-bold text-text-secondary hover:bg-bg-tertiary disabled:opacity-40"
          :disabled="page >= totalPages || loading"
          @click="changePage(1)"
        >
          {{ t.pageNext }}
        </button>
      </div>
    </section>

    <!-- 禁言 -->
    <Teleport to="body">
      <div
        v-if="banModal.show"
        class="fixed inset-0 z-[2000] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm md:items-center md:p-4"
        @click.self="banModal.show = false"
      >
        <div class="w-full max-w-md rounded-t-3xl border border-border-secondary bg-bg-secondary p-5 shadow-2xl md:rounded-3xl md:p-6">
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-base font-black text-text-primary">{{ t.banUser }}</h3>
            <button type="button" class="rounded-lg p-1.5 text-text-tertiary hover:bg-bg-tertiary" @click="banModal.show = false">
              <X :size="16" />
            </button>
          </div>
          <p class="mt-1 text-xs text-text-tertiary">{{ banModal.user?.name || banModal.user?.username }}</p>
          <div class="mt-4 space-y-4">
            <div class="space-y-1.5">
              <label class="px-1 text-[10px] font-black uppercase tracking-widest text-text-disabled">{{ t.banDays }}</label>
              <input
                v-model.number="banModal.days"
                type="number"
                min="0"
                class="w-full rounded-xl border border-border-secondary bg-bg-primary px-3 py-2.5 text-sm text-text-primary focus:border-primary-30 focus:outline-none"
              >
              <p class="px-1 text-[10px] text-text-disabled">{{ t.banDaysHint }}</p>
            </div>
            <div class="space-y-1.5">
              <label class="px-1 text-[10px] font-black uppercase tracking-widest text-text-disabled">{{ t.banReason }}</label>
              <textarea
                v-model="banModal.reason"
                rows="3"
                maxlength="200"
                :placeholder="t.banReasonPlaceholder"
                class="w-full resize-none rounded-xl border border-border-secondary bg-bg-primary px-3 py-2.5 text-sm text-text-primary placeholder:text-text-disabled focus:border-primary-30 focus:outline-none"
              />
            </div>
          </div>
          <div class="mt-6 flex gap-2">
            <button
              type="button"
              class="flex-1 rounded-xl border border-border-secondary px-4 py-2.5 text-xs font-bold text-text-secondary hover:bg-bg-tertiary"
              @click="banModal.show = false"
            >
              {{ t.cancel }}
            </button>
            <button
              type="button"
              class="flex-[2] rounded-xl bg-warning px-4 py-2.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
              :disabled="banModal.saving"
              @click="submitBan"
            >
              {{ banModal.saving ? t.saving : t.banUser }}
            </button>
          </div>
        </div>
      </div>

      <!-- 称号 -->
      <div
        v-if="titleModal.show"
        class="fixed inset-0 z-[2000] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm md:items-center md:p-4"
        @click.self="titleModal.show = false"
      >
        <div class="w-full max-w-lg rounded-t-3xl border border-border-secondary bg-bg-secondary p-5 shadow-2xl md:rounded-3xl md:p-6">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h3 class="text-base font-black text-text-primary">{{ t.manageTitles }}</h3>
              <p class="mt-1 text-[11px] text-text-tertiary">{{ titleModal.user?.name || titleModal.user?.username }}</p>
            </div>
            <button type="button" class="rounded-lg p-1.5 text-text-tertiary hover:bg-bg-tertiary" @click="titleModal.show = false">
              <X :size="16" />
            </button>
          </div>
          <div v-if="titleModal.loading" class="flex items-center justify-center gap-2 py-10 text-xs text-text-tertiary">
            <RefreshCw :size="16" class="animate-spin" /> {{ t.loading }}
          </div>
          <div v-else-if="!titleModal.titles.length" class="py-10 text-center text-xs text-text-tertiary">
            {{ t.noTitles }}
          </div>
          <div v-else class="mt-4 max-h-72 space-y-2 overflow-y-auto custom-scrollbar">
            <div
              v-for="title in titleModal.titles"
              :key="title.id"
              class="flex items-center justify-between gap-3 rounded-xl border border-border-secondary bg-bg-primary-40 p-3"
            >
              <div class="min-w-0">
                <p class="truncate text-xs font-bold text-text-primary">
                  {{ title.name }}
                  <span v-if="titleModal.equippedTitleId === title.id" class="ml-1 text-[10px] font-normal text-primary">
                    {{ communityLocale.titleLabel }}
                  </span>
                </p>
                <p v-if="title.description" class="truncate text-[10px] text-text-tertiary">{{ title.description }}</p>
              </div>
              <button
                type="button"
                class="shrink-0 rounded-lg border px-3 py-1.5 text-xs font-bold transition-all disabled:opacity-50"
                :class="
                  titleModal.granted.includes(title.id)
                    ? 'border-error-20 text-error hover:bg-error-10'
                    : 'border-primary-20 text-primary hover:bg-primary-hover-5'
                "
                :disabled="titleModal.saving === title.id"
                @click="toggleTitle(title.id)"
              >
                {{ titleModal.granted.includes(title.id) ? t.revoke : t.grant }}
              </button>
            </div>
          </div>
          <div class="mt-6">
            <button
              type="button"
              class="w-full rounded-xl border border-border-secondary px-4 py-2.5 text-xs font-bold text-text-secondary hover:bg-bg-tertiary"
              @click="titleModal.show = false"
            >
              {{ t.close }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <ConfirmDialog
      v-model:show="resetConfirm.show"
      :title="t.resetTitle"
      :message="t.resetMsg"
      type="warning"
      :loading="resetConfirm.loading"
      @confirm="resetViolations"
      @cancel="resetConfirm.show = false"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { Award, Ban, Check, RefreshCw, Search, UserRound, X } from '@lucide/vue'
import ConfirmDialog from '~/components/UI/ConfirmDialog.vue'
import { useLocale } from '~/utils/locale'
import { useToast } from '~/composables/useToast'

const { community: communityLocale } = useLocale()
const t = computed(() => communityLocale.value?.admin || {})
const { showToast } = useToast()

const users = ref([])
const query = ref('')
const page = ref(1)
const total = ref(0)
const limit = 20
const loading = ref(true)
const error = ref(false)
const busyId = ref(0)

const totalPages = computed(() => Math.max(Math.ceil(total.value / limit), 1))

const banModal = reactive({ show: false, user: null, days: 30, reason: '', saving: false })
const titleModal = reactive({
  show: false,
  user: null,
  titles: [],
  granted: [],
  equippedTitleId: null,
  loading: false,
  saving: 0
})
const resetConfirm = reactive({ show: false, loading: false, target: null })

const formatDate = (value) => {
  if (!value) return ''
  try {
    return new Date(value).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return ''
  }
}

const load = async () => {
  loading.value = true
  error.value = false
  try {
    const params = new URLSearchParams({ page: String(page.value), limit: String(limit) })
    if (query.value.trim()) params.set('q', query.value.trim())
    const data = await $fetch(`/api/admin/community/users?${params.toString()}`)
    users.value = data?.users || []
    total.value = Number(data?.total || 0)
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
}

const search = () => {
  page.value = 1
  load()
}

const changePage = (delta) => {
  const next = page.value + delta
  if (next < 1 || next > totalPages.value) return
  page.value = next
  load()
}

const openBan = (user) => {
  Object.assign(banModal, { show: true, user, days: 30, reason: '', saving: false })
}

const submitBan = async () => {
  if (!banModal.user) return
  banModal.saving = true
  try {
    const days = Number(banModal.days) || 0
    await $fetch(`/api/admin/community/users/${banModal.user.id}/action`, {
      method: 'POST',
      body: { action: 'ban', days, reason: banModal.reason.trim() }
    })
    showToast(t.value.banSuccess, 'success')
    banModal.show = false
    await load()
  } catch (e) {
    showToast(e?.data?.message || t.value.reviewFailed, 'error')
  } finally {
    banModal.saving = false
  }
}

const unban = async (user) => {
  busyId.value = user.id
  try {
    await $fetch(`/api/admin/community/users/${user.id}/action`, {
      method: 'POST',
      body: { action: 'unban' }
    })
    showToast(t.value.unbanSuccess, 'success')
    await load()
  } catch (e) {
    showToast(e?.data?.message || t.value.reviewFailed, 'error')
  } finally {
    busyId.value = 0
  }
}

const askReset = (user) => {
  resetConfirm.target = user
  resetConfirm.show = true
}

const resetViolations = async () => {
  if (!resetConfirm.target) return
  resetConfirm.loading = true
  try {
    await $fetch(`/api/admin/community/users/${resetConfirm.target.id}/action`, {
      method: 'POST',
      body: { action: 'reset-violations' }
    })
    showToast(t.value.resetSuccess, 'success')
    resetConfirm.show = false
    await load()
  } catch (e) {
    showToast(e?.data?.message || t.value.reviewFailed, 'error')
  } finally {
    resetConfirm.loading = false
  }
}

const openTitles = async (user) => {
  Object.assign(titleModal, {
    show: true,
    user,
    titles: [],
    granted: [],
    equippedTitleId: null,
    loading: true,
    saving: 0
  })
  try {
    const data = await $fetch(`/api/admin/community/users/${user.id}/titles`)
    titleModal.titles = data?.titles || []
    titleModal.granted = data?.grantedTitleIds || []
    titleModal.equippedTitleId = data?.equippedTitleId ?? null
  } catch (e) {
    showToast(e?.data?.message || t.value.loadFailed, 'error')
  } finally {
    titleModal.loading = false
  }
}

const toggleTitle = async (titleId) => {
  if (!titleModal.user) return
  const granted = titleModal.granted.includes(titleId)
  titleModal.saving = titleId
  try {
    const data = await $fetch(`/api/admin/community/users/${titleModal.user.id}/titles`, {
      method: 'POST',
      body: { titleId, action: granted ? 'revoke' : 'grant' }
    })
    titleModal.granted = data?.grantedTitleIds || []
    if (!titleModal.granted.includes(titleId) && titleModal.equippedTitleId === titleId) {
      titleModal.equippedTitleId = null
    }
    showToast(t.value.titlesSaved, 'success')
  } catch (e) {
    showToast(e?.data?.message || t.value.reviewFailed, 'error')
  } finally {
    titleModal.saving = 0
  }
}

onMounted(load)
</script>
