<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-lg font-black text-text-primary">{{ t.reviewTitle }}</h2>
        <p class="mt-1 text-xs text-text-tertiary">{{ t.reviewDesc }}</p>
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

    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div
        v-for="item in statCards"
        :key="item.status"
        class="rounded-2xl border p-4 transition-colors"
        :class="
          status === item.status
            ? 'border-primary-30 bg-primary-hover-5'
            : 'border-border-secondary-50 bg-bg-secondary-30'
        "
      >
        <p class="text-[10px] font-black uppercase tracking-widest text-text-disabled">{{ item.label }}</p>
        <p class="mt-2 text-2xl font-black text-text-primary">{{ stats[item.status] || 0 }}</p>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <div class="flex flex-wrap gap-1 rounded-xl border border-border-secondary bg-bg-primary-40 p-1">
        <button
          v-for="item in statCards"
          :key="`tab-${item.status}`"
          type="button"
          class="rounded-lg px-3 py-1.5 text-[11px] font-bold transition-all"
          :class="status === item.status ? 'bg-bg-tertiary text-primary' : 'text-text-tertiary hover:text-text-primary'"
          @click="switchStatus(item.status)"
        >
          {{ item.label }}
        </button>
      </div>
      <div class="w-48">
        <CustomSelect v-model="boardId" :options="boardOptions" :label="t.boardFilter" />
      </div>
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
    <div v-else-if="!posts.length" class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 py-16 text-center text-xs text-text-tertiary">
      {{ t.emptyPosts }}
    </div>

    <section v-else class="space-y-3">
      <article
        v-for="post in posts"
        :key="post.id"
        class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-4 md:p-5"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex min-w-0 flex-wrap items-center gap-2 text-xs">
            <span class="font-black text-text-primary">{{ post.author.displayName }}</span>
            <span
              v-if="post.author.title"
              class="rounded-full border border-primary-20 bg-primary-10 px-2 py-0.5 text-[10px] font-bold text-primary"
            >
              {{ post.author.title }}
            </span>
            <span class="rounded bg-bg-tertiary px-1.5 py-0.5 text-text-tertiary">{{ post.board.name }}</span>
            <span class="text-text-disabled">{{ formatDate(post.createdAt) }}</span>
          </div>
          <span class="rounded-full px-2 py-0.5 text-[10px] font-bold" :class="statusClass(post.status)">
            {{ statusLabel(post.status) }}
          </span>
        </div>

        <p class="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-text-secondary">
          {{ post.content }}
        </p>

        <div v-if="post.images?.length" class="mt-3 grid grid-cols-3 gap-2 sm:max-w-md">
          <button
            v-for="image in post.images"
            :key="image.id"
            type="button"
            class="aspect-square overflow-hidden rounded-xl border border-border-secondary-50 bg-bg-primary-40"
            @click="lightbox = image.url"
          >
            <img :src="image.url" alt="" class="h-full w-full object-cover transition-transform hover:scale-105" >
          </button>
        </div>

        <div
          v-if="post.song"
          class="mt-3 flex items-center gap-3 rounded-xl border border-border-secondary-50 bg-bg-primary-40 p-2.5"
        >
          <img v-if="post.song.cover" :src="post.song.cover" alt="" class="h-10 w-10 rounded-lg object-cover" >
          <div class="min-w-0 flex-1">
            <p class="truncate text-xs font-bold text-text-primary">{{ post.song.title }}</p>
            <p class="truncate text-[11px] text-text-tertiary">{{ post.song.artist }}</p>
          </div>
          <span class="text-[11px] font-bold text-text-tertiary">{{ post.song.voteCount }} ♥</span>
        </div>

        <div
          v-if="post.moderationLabel"
          class="mt-3 flex items-start gap-2 rounded-xl border border-warning-20 bg-warning-10 p-3 text-[11px] text-warning"
        >
          <ShieldAlert :size="14" class="mt-0.5 shrink-0" />
          <span class="break-all">{{ t.moderationHit }}：{{ post.moderationLabel }}</span>
        </div>

        <div v-if="post.reviewNote" class="mt-3 rounded-xl bg-bg-tertiary-40 p-3 text-[11px] text-text-tertiary">
          {{ communityLocale.reviewNoteLabel }}：{{ post.reviewNote }}
        </div>

        <div v-if="post.status === 'PENDING'" class="mt-3">
          <textarea
            v-model="notes[post.id]"
            rows="2"
            maxlength="200"
            :placeholder="t.reviewNotePlaceholder"
            class="w-full resize-none rounded-xl border border-border-secondary bg-bg-primary px-3 py-2 text-xs text-text-primary placeholder:text-text-disabled focus:border-primary-30 focus:outline-none"
          />
        </div>

        <div class="mt-3 flex flex-wrap gap-2">
          <template v-if="post.status === 'PENDING'">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white transition-all hover:bg-primary-hover disabled:opacity-50"
              :disabled="busyId === post.id"
              @click="decide(post, 'approve')"
            >
              <Check :size="14" /> {{ t.approve }}
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg border border-error-30 px-3 py-1.5 text-xs font-bold text-error transition-all hover:bg-error-10 disabled:opacity-50"
              :disabled="busyId === post.id"
              @click="askReject(post)"
            >
              <X :size="14" /> {{ t.reject }}
            </button>
          </template>
          <button
            v-if="isCommunityAdmin"
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg border border-border-secondary px-3 py-1.5 text-xs font-bold text-text-tertiary transition-all hover:border-error-30 hover:text-error disabled:opacity-50"
            :disabled="busyId === post.id"
            @click="askDelete(post)"
          >
            <Trash2 :size="14" /> {{ t.delete }}
          </button>
        </div>
      </article>
    </section>

    <ConfirmDialog
      v-model:show="confirm.show"
      :title="confirm.title"
      :message="confirm.message"
      :type="confirm.type"
      :loading="confirm.loading"
      @confirm="runConfirm"
      @cancel="confirm.show = false"
    />

    <Teleport to="body">
      <div
        v-if="lightbox"
        class="fixed inset-0 z-[2100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        @click="lightbox = null"
      >
        <img :src="lightbox" alt="" class="max-h-full max-w-full rounded-xl object-contain" >
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { Check, RefreshCw, ShieldAlert, Trash2, X } from '@lucide/vue'
import ConfirmDialog from '~/components/UI/ConfirmDialog.vue'
import CustomSelect from '~/components/UI/Common/CustomSelect.vue'
import { useLocale } from '~/utils/locale'
import { useToast } from '~/composables/useToast'
import { usePermissions } from '~/composables/usePermissions'

const { community: communityLocale } = useLocale()
const t = computed(() => communityLocale.value?.admin || {})
const { showToast } = useToast()
const { isCommunityAdmin } = usePermissions()

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'BLOCKED']

const status = ref('PENDING')
const boardId = ref(0)
const boards = ref([])
const posts = ref([])
const stats = reactive({ PENDING: 0, APPROVED: 0, REJECTED: 0, BLOCKED: 0 })
const loading = ref(true)
const error = ref(false)
const busyId = ref(0)
const notes = reactive({})
const lightbox = ref(null)

const confirm = reactive({
  show: false,
  title: '',
  message: '',
  type: 'warning',
  loading: false,
  action: '',
  target: null
})

const statCards = computed(() => [
  { status: 'PENDING', label: t.value.statusPending },
  { status: 'APPROVED', label: t.value.statusApproved },
  { status: 'REJECTED', label: t.value.statusRejected },
  { status: 'BLOCKED', label: t.value.statusBlocked }
])

const boardOptions = computed(() => [
  { label: t.value.allBoards || 'All', value: 0 },
  ...boards.value.map((board) => ({ label: board.name, value: board.id }))
])

const statusLabel = (value) => t.value[`status${value.charAt(0)}${value.slice(1).toLowerCase()}`] || value

const statusClass = (value) => {
  switch (value) {
    case 'APPROVED':
      return 'bg-success-10 text-success'
    case 'REJECTED':
      return 'bg-error-10 text-error'
    case 'BLOCKED':
      return 'bg-warning-10 text-warning'
    default:
      return 'bg-primary-10 text-primary'
  }
}

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
    const params = new URLSearchParams({ status: status.value })
    if (boardId.value) params.set('boardId', String(boardId.value))
    const data = await $fetch(`/api/community/review/posts?${params.toString()}`)
    posts.value = data?.posts || []
    boards.value = data?.boards || []
    for (const key of STATUSES) stats[key] = Number(data?.stats?.[key] || 0)
    for (const key of Object.keys(notes)) delete notes[key]
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
}

const switchStatus = (value) => {
  if (status.value === value) return
  status.value = value
  load()
}

const decide = async (post, action) => {
  busyId.value = post.id
  try {
    const result = await $fetch(`/api/community/review/posts/${post.id}`, {
      method: 'POST',
      body: { action, note: notes[post.id] || '' }
    })
    showToast(action === 'approve' ? t.value.approveSuccess : t.value.rejectSuccess, 'success')
    if (action === 'reject' && result?.violationCount) {
      showToast(t.value.violationApplied(result.violationCount), 'info', 4000)
      if (result?.ban?.permanent) showToast(t.value.muteAppliedPermanent, 'warning', 4000)
      else if (result?.ban?.muted) showToast(t.value.muteApplied30, 'warning', 4000)
    }
    await load()
  } catch (e) {
    showToast(e?.data?.message || t.value.reviewFailed, 'error')
  } finally {
    busyId.value = 0
  }
}

const askReject = (post) => {
  Object.assign(confirm, {
    show: true,
    title: t.value.rejectTitle,
    message: t.value.rejectMsg,
    type: 'warning',
    loading: false,
    action: 'reject',
    target: post
  })
}

const askDelete = (post) => {
  Object.assign(confirm, {
    show: true,
    title: t.value.deletePostTitle,
    message: t.value.deletePostMsg,
    type: 'danger',
    loading: false,
    action: 'delete',
    target: post
  })
}

const runConfirm = async () => {
  if (!confirm.target) return
  confirm.loading = true
  try {
    if (confirm.action === 'reject') {
      await $fetch(`/api/community/review/posts/${confirm.target.id}`, {
        method: 'POST',
        body: { action: 'reject', note: notes[confirm.target.id] || '' }
      })
      showToast(t.value.rejectSuccess, 'success')
    } else {
      await $fetch(`/api/admin/community/posts/${confirm.target.id}`, { method: 'DELETE' })
      showToast(t.value.deleteSuccess, 'success')
    }
    confirm.show = false
    await load()
  } catch (e) {
    showToast(e?.data?.message || t.value.reviewFailed, 'error')
  } finally {
    confirm.loading = false
  }
}

watch(boardId, () => {
  if (!loading.value) load()
})

onMounted(load)
</script>
