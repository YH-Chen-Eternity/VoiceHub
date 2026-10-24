<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-lg font-black text-text-primary">{{ t.archiveTitle }}</h2>
        <p class="mt-1 text-xs text-text-tertiary">{{ t.archiveDesc }}</p>
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

    <div class="grid grid-cols-2 gap-3 sm:max-w-md">
      <div
        v-for="item in typeCards"
        :key="item.type"
        class="cursor-pointer rounded-2xl border p-4 transition-colors"
        :class="
          type === item.type
            ? 'border-primary-30 bg-primary-hover-5'
            : 'border-border-secondary-50 bg-bg-secondary-30'
        "
        @click="switchType(item.type)"
      >
        <p class="text-[10px] font-black uppercase tracking-widest text-text-disabled">{{ item.label }}</p>
        <p class="mt-2 text-2xl font-black text-text-primary">{{ stats[item.type] || 0 }}</p>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <div class="flex gap-1 rounded-xl border border-border-secondary bg-bg-primary-40 p-1">
        <button
          v-for="item in typeCards"
          :key="`tab-${item.type}`"
          type="button"
          class="rounded-lg px-3 py-1.5 text-[11px] font-bold transition-all"
          :class="type === item.type ? 'bg-bg-tertiary text-primary' : 'text-text-tertiary hover:text-text-primary'"
          @click="switchType(item.type)"
        >
          {{ item.label }}
        </button>
      </div>
      <div class="w-48">
        <CustomSelect v-model="boardId" :options="boardOptions" :label="t.boardFilter" />
      </div>
      <span class="rounded-full border border-warning-20 bg-warning-10 px-2.5 py-1 text-[10px] font-bold text-warning">
        {{ t.archiveRetention }}
      </span>
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
    <div
      v-else-if="type === 'posts' && !posts.length"
      class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 py-16 text-center text-xs text-text-tertiary"
    >
      {{ t.archiveEmptyPosts }}
    </div>
    <div
      v-else-if="type === 'comments' && !comments.length"
      class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 py-16 text-center text-xs text-text-tertiary"
    >
      {{ t.archiveEmptyComments }}
    </div>

    <section v-else-if="type === 'posts'" class="space-y-3">
      <article
        v-for="post in posts"
        :key="post.id"
        class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-4 md:p-5"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex min-w-0 flex-wrap items-center gap-2 text-xs">
            <span class="font-black text-text-primary">{{ post.author.name }}</span>
            <span v-if="post.author.username" class="text-text-disabled">@{{ post.author.username }}</span>
            <span class="rounded bg-bg-tertiary px-1.5 py-0.5 text-text-tertiary">{{ post.board.name }}</span>
            <span class="text-text-disabled">#{{ post.id }}</span>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <span class="rounded-full bg-error-10 px-2 py-0.5 text-[10px] font-bold text-error">
              {{ deleteTypeLabel(post.deleteType) }}
            </span>
            <button
              v-if="canReviewCommunity"
              type="button"
              class="inline-flex items-center gap-1 rounded-lg border border-success-30 bg-success-10 px-2.5 py-1 text-[10px] font-bold text-success hover:bg-success-15 disabled:opacity-50"
              :disabled="restoringId === `post-${post.id}`"
              @click="askRestore('post', post)"
            >
              <RotateCcw :size="12" :class="{ 'animate-spin': restoringId === `post-${post.id}` }" />
              {{ t.restore }}
            </button>
          </div>
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

        <div class="mt-3 grid gap-2 rounded-xl border border-border-secondary-50 bg-bg-primary-40 p-3 text-[11px] sm:grid-cols-2">
          <span class="text-text-tertiary">
            {{ t.removedBy }}：<span class="font-bold text-text-secondary">{{ actorName(post.deletedBy) }}</span>
          </span>
          <span class="text-text-tertiary">
            {{ t.removedAt }}：<span class="font-bold text-text-secondary">{{ formatDate(post.deletedAt) }}</span>
          </span>
          <span class="text-text-tertiary">
            {{ t.purgeAt }}：<span class="font-bold text-warning">{{ formatDate(post.purgeAt) }}</span>
          </span>
          <span class="text-text-tertiary">
            {{ t.createdAt }}：<span class="font-bold text-text-secondary">{{ formatDate(post.createdAt) }}</span>
          </span>
          <span v-if="post.deleteReason" class="text-text-tertiary sm:col-span-2">
            {{ t.deleteReason }}：<span class="font-bold text-text-secondary">{{ post.deleteReason }}</span>
          </span>
        </div>

        <div class="mt-3 rounded-xl border border-border-secondary-50 bg-bg-primary-40 p-3">
          <p class="text-[10px] font-black uppercase tracking-widest text-text-disabled">
            {{ t.archivedComments }} · {{ post.comments?.length || 0 }}
          </p>
          <div v-if="post.comments?.length" class="mt-2 space-y-2">
            <div
              v-for="comment in post.comments"
              :key="comment.id"
              class="rounded-lg bg-bg-secondary-60 p-2.5"
              :class="{ 'border border-error-20': comment.deletedAt }"
            >
              <div class="flex flex-wrap items-center gap-2 text-[10px] text-text-tertiary">
                <span class="font-bold text-text-secondary">{{ comment.author.name }}</span>
                <span>{{ formatDate(comment.createdAt) }}</span>
                <span v-if="comment.status !== 'APPROVED'" class="rounded bg-bg-tertiary px-1.5 py-0.5">
                  {{ statusLabel(comment.status) }}
                </span>
                <span v-if="comment.deletedAt" class="rounded bg-error-10 px-1.5 py-0.5 font-bold text-error">
                  {{ deleteTypeLabel(comment.deleteType) }} · {{ actorName(comment.deletedBy) }} ·
                  {{ formatDate(comment.deletedAt) }} · {{ t.purgeAt }} {{ formatDate(comment.purgeAt) }}
                </span>
              </div>
              <p class="mt-1 whitespace-pre-wrap break-words text-xs text-text-secondary">{{ comment.content }}</p>
              <p v-if="comment.deleteReason" class="mt-1 text-[10px] text-text-tertiary">
                {{ t.deleteReason }}：{{ comment.deleteReason }}
              </p>
            </div>
          </div>
          <p v-else class="mt-2 text-[11px] text-text-disabled">{{ t.noComments }}</p>
        </div>
      </article>
    </section>

    <section v-else class="space-y-3">
      <article
        v-for="comment in comments"
        :key="comment.id"
        class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-4 md:p-5"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex min-w-0 flex-wrap items-center gap-2 text-xs">
            <span class="font-black text-text-primary">{{ comment.author.name }}</span>
            <span v-if="comment.author.username" class="text-text-disabled">@{{ comment.author.username }}</span>
            <span class="rounded bg-bg-tertiary px-1.5 py-0.5 text-text-tertiary">{{ comment.board.name }}</span>
            <span class="text-text-disabled">#{{ comment.id }}</span>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <span class="rounded-full bg-error-10 px-2 py-0.5 text-[10px] font-bold text-error">
              {{ deleteTypeLabel(comment.deleteType) }}
            </span>
            <button
              v-if="canReviewCommunity"
              type="button"
              class="inline-flex items-center gap-1 rounded-lg border border-success-30 bg-success-10 px-2.5 py-1 text-[10px] font-bold text-success hover:bg-success-15 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="restoringId === `comment-${comment.id}` || !!comment.post?.deletedAt"
              :title="comment.post?.deletedAt ? t.restoreCommentBlocked : ''"
              @click="askRestore('comment', comment)"
            >
              <RotateCcw
                :size="12"
                :class="{ 'animate-spin': restoringId === `comment-${comment.id}` }"
              />
              {{ t.restore }}
            </button>
          </div>
        </div>

        <div class="mt-3 rounded-xl border border-border-secondary-50 bg-bg-primary-40 p-3">
          <p class="text-[10px] font-bold uppercase tracking-widest text-text-disabled">
            {{ t.parentPost }} #{{ comment.post.id }}
            <span v-if="comment.post.deletedAt" class="ml-1 text-error">· {{ t.postAlsoArchived }}</span>
          </p>
          <p class="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-[11px] text-text-tertiary">
            {{ comment.post.content }}
          </p>
        </div>

        <p class="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-text-secondary">
          {{ comment.content }}
        </p>

        <div class="mt-3 grid gap-2 rounded-xl border border-border-secondary-50 bg-bg-primary-40 p-3 text-[11px] sm:grid-cols-2">
          <span class="text-text-tertiary">
            {{ t.removedBy }}：<span class="font-bold text-text-secondary">{{ actorName(comment.deletedBy) }}</span>
          </span>
          <span class="text-text-tertiary">
            {{ t.removedAt }}：<span class="font-bold text-text-secondary">{{ formatDate(comment.deletedAt) }}</span>
          </span>
          <span class="text-text-tertiary">
            {{ t.purgeAt }}：<span class="font-bold text-warning">{{ formatDate(comment.purgeAt) }}</span>
          </span>
          <span class="text-text-tertiary">
            {{ t.createdAt }}：<span class="font-bold text-text-secondary">{{ formatDate(comment.createdAt) }}</span>
          </span>
          <span v-if="comment.deleteReason" class="text-text-tertiary sm:col-span-2">
            {{ t.deleteReason }}：<span class="font-bold text-text-secondary">{{ comment.deleteReason }}</span>
          </span>
        </div>
      </article>
    </section>

    <ConfirmDialog
      :show="restoreConfirm.show"
      :title="restoreConfirm.title"
      :message="restoreConfirm.message"
      type="info"
      :loading="restoreConfirm.loading"
      :confirm-text="t.restore"
      :cancel-text="t.cancel"
      @confirm="runRestore"
      @cancel="restoreConfirm.show = false"
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
import { RefreshCw, RotateCcw } from '@lucide/vue'
import CustomSelect from '~/components/UI/Common/CustomSelect.vue'
import ConfirmDialog from '~/components/UI/ConfirmDialog.vue'
import { useLocale } from '~/utils/locale'
import { useServerErrors } from '~/composables/useLocaleText'
import { useToast } from '~/composables/useToast'
import { usePermissions } from '~/composables/usePermissions'

const { community: communityLocale } = useLocale()
const t = computed(() => communityLocale.value?.admin || {})
const { showToast } = useToast()
const { canReviewCommunity } = usePermissions()
const { localize: localizeServerError } = useServerErrors()

const type = ref('posts')
const boardId = ref(0)
const boards = ref([])
const posts = ref([])
const comments = ref([])
const stats = reactive({ posts: 0, comments: 0 })
const loading = ref(true)
const error = ref(false)
const lightbox = ref(null)
const restoringId = ref('')

// 恢复/撤回归档：确认弹窗状态（type = post | comment）
const restoreConfirm = reactive({
  show: false,
  loading: false,
  type: 'post',
  target: null,
  title: '',
  message: ''
})

const typeCards = computed(() => [
  { type: 'posts', label: t.value.archivedPostsTab },
  { type: 'comments', label: t.value.archivedCommentsTab }
])

const boardOptions = computed(() => [
  { label: t.value.allBoards || 'All', value: 0 },
  ...boards.value.map((board) => ({ label: board.name, value: board.id }))
])

const statusLabel = (value) => t.value[`status${value.charAt(0)}${value.slice(1).toLowerCase()}`] || value

const deleteTypeLabel = (value) => (value === 'WITHDRAW' ? t.value.withdrawn : t.value.deleted)

const actorName = (actor) => {
  if (!actor) return t.value.systemActor
  return actor.username ? `${actor.name} (@${actor.username})` : actor.name
}

const formatDate = (value) => {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return '—'
  }
}

const load = async () => {
  loading.value = true
  error.value = false
  try {
    const params = new URLSearchParams({ type: type.value, limit: '50' })
    if (boardId.value) params.set('boardId', String(boardId.value))
    const data = await $fetch(`/api/admin/community/archive?${params.toString()}`)
    posts.value = data?.posts || []
    comments.value = data?.comments || []
    boards.value = data?.boards || []
    stats.posts = Number(data?.stats?.posts || 0)
    stats.comments = Number(data?.stats?.comments || 0)
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
}

const switchType = (value) => {
  if (type.value === value) return
  type.value = value
  load()
}

// 恢复归档：先确认，成功后刷新列表与统计（板块帖子数由后端统计修正）
const askRestore = (targetType, target) => {
  if (targetType === 'comment' && target?.post?.deletedAt) {
    showToast(t.value.restoreCommentBlocked, 'warning')
    return
  }
  Object.assign(restoreConfirm, {
    show: true,
    loading: false,
    type: targetType,
    target,
    title: targetType === 'post' ? t.value.restorePostTitle : t.value.restoreCommentTitle,
    message: targetType === 'post' ? t.value.restorePostMsg : t.value.restoreCommentMsg
  })
}

const runRestore = async () => {
  const target = restoreConfirm.target
  if (!target) return
  const targetType = restoreConfirm.type
  restoreConfirm.loading = true
  restoringId.value = `${targetType}-${target.id}`
  try {
    await $fetch(`/api/admin/community/archive/${targetType}/${target.id}/restore`, {
      method: 'POST'
    })
    showToast(t.value.restoreSuccess, 'success')
    restoreConfirm.show = false
    await load()
  } catch (e) {
    showToast(localizeServerError(e, t.value.restoreFailed), 'error')
  } finally {
    restoreConfirm.loading = false
    restoringId.value = ''
  }
}

watch(boardId, () => {
  if (!loading.value) load()
})

onMounted(load)
</script>
