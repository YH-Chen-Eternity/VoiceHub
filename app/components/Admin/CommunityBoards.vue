<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-lg font-black text-text-primary">{{ t.boardsTitle }}</h2>
        <p class="mt-1 text-xs text-text-tertiary">{{ t.boardsDesc }}</p>
      </div>
      <div class="flex gap-2">
        <button
          class="inline-flex items-center gap-2 rounded-xl border border-border-secondary bg-bg-primary-40 px-3 py-2 text-xs font-bold text-text-secondary hover:bg-bg-tertiary disabled:opacity-50"
          type="button"
          :disabled="loading"
          @click="load"
        >
          <RefreshCw :size="14" :class="{ 'animate-spin': loading }" /> {{ t.refresh }}
        </button>
        <button
          class="inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-white hover:bg-primary-hover"
          type="button"
          @click="openEditor(null)"
        >
          <Plus :size="14" /> {{ t.addBoard }}
        </button>
      </div>
    </div>

    <div class="grid grid-cols-3 gap-3">
      <div class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-4">
        <p class="text-[10px] font-black uppercase tracking-widest text-text-disabled">{{ t.boardCount }}</p>
        <p class="mt-2 text-2xl font-black text-text-primary">{{ summary.boards }}</p>
      </div>
      <div class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-4">
        <p class="text-[10px] font-black uppercase tracking-widest text-text-disabled">{{ t.reviewerCount }}</p>
        <p class="mt-2 text-2xl font-black text-text-primary">{{ summary.reviewers }}</p>
      </div>
      <div class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-4">
        <p class="text-[10px] font-black uppercase tracking-widest text-text-disabled">{{ t.pendingCount }}</p>
        <p class="mt-2 text-2xl font-black text-warning">{{ summary.pending }}</p>
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
    <div v-else-if="!boards.length" class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 py-16 text-center text-xs text-text-tertiary">
      {{ t.emptyPosts }}
    </div>

    <section v-else class="grid gap-3 lg:grid-cols-2">
      <article
        v-for="board in boards"
        :key="board.id"
        class="flex flex-col rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-4 md:p-5"
        :class="{ 'opacity-70': !board.isActive }"
      >
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="truncate text-sm font-black text-text-primary">{{ board.name }}</h3>
              <span
                class="rounded-full px-2 py-0.5 text-[10px] font-bold"
                :class="board.isActive ? 'bg-success-10 text-success' : 'bg-bg-tertiary text-text-tertiary'"
              >
                {{ board.isActive ? t.active : t.hidden }}
              </span>
            </div>
            <p v-if="board.description" class="mt-1 break-words text-xs text-text-tertiary">{{ board.description }}</p>
          </div>
          <button
            type="button"
            role="switch"
            :aria-checked="board.isActive"
            class="relative h-5 w-10 shrink-0 rounded-full transition-colors"
            :class="board.isActive ? 'bg-primary-hover' : 'bg-bg-tertiary'"
            :disabled="busyId === board.id"
            @click="toggleBoard(board)"
          >
            <span
              class="absolute top-1 h-3 w-3 rounded-full bg-bg-secondary transition-all"
              :class="board.isActive ? 'left-6' : 'left-1'"
            />
          </button>
        </div>

        <div class="mt-3 flex flex-wrap gap-2 text-[10px] font-bold text-text-tertiary">
          <span class="rounded bg-bg-tertiary px-2 py-0.5">{{ t.postCount }} {{ board.postCount }}</span>
          <span class="rounded bg-bg-tertiary px-2 py-0.5">{{ t.pendingCount }} {{ board.pendingCount }}</span>
          <span class="rounded bg-bg-tertiary px-2 py-0.5">{{ t.reviewersLabel }} {{ board.reviewerCount }}</span>
          <span class="rounded bg-bg-tertiary px-2 py-0.5">{{ t.sortOrder }} {{ board.sortOrder }}</span>
        </div>

        <div class="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg border border-border-secondary px-3 py-1.5 text-xs font-bold text-text-secondary hover:bg-bg-tertiary"
            @click="openEditor(board)"
          >
            <Pencil :size="13" /> {{ t.edit }}
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg border border-border-secondary px-3 py-1.5 text-xs font-bold text-text-secondary hover:bg-bg-tertiary"
            @click="openReviewers(board)"
          >
            <Users :size="13" /> {{ t.assignReviewers }}
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg border border-border-secondary px-3 py-1.5 text-xs font-bold text-text-tertiary hover:border-error-30 hover:text-error"
            @click="askDelete(board)"
          >
            <Trash2 :size="13" /> {{ t.delete }}
          </button>
        </div>
      </article>
    </section>

    <!-- 板块编辑 -->
    <Teleport to="body">
      <div
        v-if="editor.show"
        class="fixed inset-0 z-[2000] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm md:items-center md:p-4"
        @click.self="editor.show = false"
      >
        <div class="w-full max-w-lg rounded-t-3xl border border-border-secondary bg-bg-secondary p-5 shadow-2xl md:rounded-3xl md:p-6">
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-base font-black text-text-primary">
              {{ editor.id ? t.edit : t.addBoard }}
            </h3>
            <button type="button" class="rounded-lg p-1.5 text-text-tertiary hover:bg-bg-tertiary" @click="editor.show = false">
              <X :size="16" />
            </button>
          </div>
          <div class="mt-4 space-y-4">
            <div class="space-y-1.5">
              <label class="px-1 text-[10px] font-black uppercase tracking-widest text-text-disabled">{{ t.boardName }}</label>
              <input
                v-model="editor.name"
                type="text"
                maxlength="30"
                :placeholder="t.boardNamePlaceholder"
                class="w-full rounded-xl border border-border-secondary bg-bg-primary px-3 py-2.5 text-sm text-text-primary placeholder:text-text-disabled focus:border-primary-30 focus:outline-none"
              >
            </div>
            <div class="space-y-1.5">
              <label class="px-1 text-[10px] font-black uppercase tracking-widest text-text-disabled">{{ t.boardDesc }}</label>
              <textarea
                v-model="editor.description"
                rows="3"
                maxlength="200"
                :placeholder="t.boardDescPlaceholder"
                class="w-full resize-none rounded-xl border border-border-secondary bg-bg-primary px-3 py-2.5 text-sm text-text-primary placeholder:text-text-disabled focus:border-primary-30 focus:outline-none"
              />
            </div>
            <div class="flex flex-wrap items-end gap-4">
              <div class="w-32 space-y-1.5">
                <label class="px-1 text-[10px] font-black uppercase tracking-widest text-text-disabled">{{ t.sortOrder }}</label>
                <input
                  v-model.number="editor.sortOrder"
                  type="number"
                  class="w-full rounded-xl border border-border-secondary bg-bg-primary px-3 py-2.5 text-sm text-text-primary focus:border-primary-30 focus:outline-none"
                >
              </div>
              <button
                type="button"
                role="switch"
                :aria-checked="editor.isActive"
                class="flex items-center gap-2 rounded-xl border border-border-secondary px-3 py-2.5 text-xs font-bold text-text-secondary"
                @click="editor.isActive = !editor.isActive"
              >
                <span class="relative h-4 w-8 rounded-full transition-colors" :class="editor.isActive ? 'bg-primary-hover' : 'bg-bg-tertiary'">
                  <span class="absolute top-0.5 h-3 w-3 rounded-full bg-bg-secondary transition-all" :class="editor.isActive ? 'left-4' : 'left-0.5'" />
                </span>
                {{ t.active }}
              </button>
            </div>
          </div>
          <div class="mt-6 flex gap-2">
            <button
              type="button"
              class="flex-1 rounded-xl border border-border-secondary px-4 py-2.5 text-xs font-bold text-text-secondary hover:bg-bg-tertiary"
              @click="editor.show = false"
            >
              {{ t.cancel }}
            </button>
            <button
              type="button"
              class="flex-[2] rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-white hover:bg-primary-hover disabled:opacity-50"
              :disabled="editor.saving"
              @click="saveBoard"
            >
              {{ editor.saving ? t.saving : t.save }}
            </button>
          </div>
        </div>
      </div>

      <!-- 分配审帖员 -->
      <div
        v-if="reviewerModal.show"
        class="fixed inset-0 z-[2000] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm md:items-center md:p-4"
        @click.self="reviewerModal.show = false"
      >
        <div class="w-full max-w-lg rounded-t-3xl border border-border-secondary bg-bg-secondary p-5 shadow-2xl md:rounded-3xl md:p-6">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h3 class="text-base font-black text-text-primary">{{ t.assignReviewers }}</h3>
              <p class="mt-1 text-[11px] text-text-tertiary">{{ reviewerModal.board?.name }}</p>
            </div>
            <button type="button" class="rounded-lg p-1.5 text-text-tertiary hover:bg-bg-tertiary" @click="reviewerModal.show = false">
              <X :size="16" />
            </button>
          </div>
          <p class="mt-3 rounded-xl bg-bg-tertiary-40 p-3 text-[11px] leading-relaxed text-text-tertiary">
            {{ t.assignHint }}
          </p>
          <div v-if="reviewerModal.loading" class="flex items-center justify-center gap-2 py-10 text-xs text-text-tertiary">
            <RefreshCw :size="16" class="animate-spin" /> {{ t.loading }}
          </div>
          <div v-else-if="!reviewerModal.candidates.length" class="py-10 text-center text-xs text-text-tertiary">
            {{ t.noReviewers }}
          </div>
          <div v-else class="mt-3 max-h-64 space-y-2 overflow-y-auto custom-scrollbar">
            <button
              v-for="user in reviewerModal.candidates"
              :key="user.id"
              type="button"
              role="checkbox"
              :aria-checked="reviewerModal.selected.includes(user.id)"
              class="flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition-all"
              :class="
                reviewerModal.selected.includes(user.id)
                  ? 'border-primary-30 bg-primary-hover-5'
                  : 'border-border-secondary bg-bg-primary-40 hover:border-border-tertiary'
              "
              @click="toggleReviewer(user.id)"
            >
              <div class="min-w-0">
                <p class="truncate text-xs font-bold text-text-primary">{{ user.name || user.username }}</p>
                <p class="truncate text-[10px] text-text-tertiary">@{{ user.username }} · {{ user.grade || '-' }} {{ user.class || '' }}</p>
              </div>
              <span
                class="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border"
                :class="reviewerModal.selected.includes(user.id) ? 'border-primary bg-primary text-white' : 'border-border-secondary'"
              >
                <Check v-if="reviewerModal.selected.includes(user.id)" :size="12" />
              </span>
            </button>
          </div>
          <div class="mt-6 flex gap-2">
            <button
              type="button"
              class="flex-1 rounded-xl border border-border-secondary px-4 py-2.5 text-xs font-bold text-text-secondary hover:bg-bg-tertiary"
              @click="reviewerModal.show = false"
            >
              {{ t.cancel }}
            </button>
            <button
              type="button"
              class="flex-[2] rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-white hover:bg-primary-hover disabled:opacity-50"
              :disabled="reviewerModal.saving || reviewerModal.loading"
              @click="saveReviewers"
            >
              {{ reviewerModal.saving ? t.saving : t.save }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <ConfirmDialog
      v-model:show="confirm.show"
      :title="t.deleteBoardTitle"
      :message="t.deleteBoardMsg"
      type="danger"
      :loading="confirm.loading"
      @confirm="deleteBoard"
      @cancel="confirm.show = false"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { Check, Pencil, Plus, RefreshCw, Trash2, Users, X } from '@lucide/vue'
import ConfirmDialog from '~/components/UI/ConfirmDialog.vue'
import { useLocale } from '~/utils/locale'
import { useToast } from '~/composables/useToast'

const { community: communityLocale } = useLocale()
const t = computed(() => communityLocale.value?.admin || {})
const { showToast } = useToast()

const boards = ref([])
const summary = reactive({ boards: 0, reviewers: 0, pending: 0 })
const loading = ref(true)
const error = ref(false)
const busyId = ref(0)

const editor = reactive({
  show: false,
  id: 0,
  name: '',
  description: '',
  sortOrder: 0,
  isActive: true,
  saving: false
})

const reviewerModal = reactive({
  show: false,
  board: null,
  candidates: [],
  selected: [],
  loading: false,
  saving: false
})

const confirm = reactive({ show: false, loading: false, target: null })

const load = async () => {
  loading.value = true
  error.value = false
  try {
    const data = await $fetch('/api/admin/community/boards')
    boards.value = data?.boards || []
    summary.boards = Number(data?.summary?.boards || 0)
    summary.reviewers = Number(data?.summary?.reviewers || 0)
    summary.pending = Number(data?.summary?.pending || 0)
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
}

const openEditor = (board) => {
  Object.assign(editor, {
    show: true,
    id: board?.id || 0,
    name: board?.name || '',
    description: board?.description || '',
    sortOrder: board?.sortOrder ?? 0,
    isActive: board ? !!board.isActive : true,
    saving: false
  })
}

const saveBoard = async () => {
  if (!editor.name.trim()) {
    showToast(t.value.boardNameRequired, 'warning')
    return
  }
  editor.saving = true
  try {
    const body = {
      name: editor.name.trim(),
      description: editor.description.trim(),
      sortOrder: Number(editor.sortOrder) || 0,
      isActive: editor.isActive
    }
    if (editor.id) {
      await $fetch(`/api/admin/community/boards/${editor.id}`, { method: 'PUT', body })
    } else {
      await $fetch('/api/admin/community/boards', { method: 'POST', body })
    }
    showToast(t.value.boardSaved, 'success')
    editor.show = false
    await load()
  } catch (e) {
    showToast(e?.data?.message || t.value.settingsFailed, 'error')
  } finally {
    editor.saving = false
  }
}

const toggleBoard = async (board) => {
  busyId.value = board.id
  try {
    await $fetch(`/api/admin/community/boards/${board.id}`, {
      method: 'PUT',
      body: { isActive: !board.isActive }
    })
    board.isActive = !board.isActive
  } catch (e) {
    showToast(e?.data?.message || t.value.settingsFailed, 'error')
  } finally {
    busyId.value = 0
  }
}

const askDelete = (board) => {
  confirm.target = board
  confirm.show = true
}

const deleteBoard = async () => {
  if (!confirm.target) return
  confirm.loading = true
  try {
    await $fetch(`/api/admin/community/boards/${confirm.target.id}`, { method: 'DELETE' })
    showToast(t.value.boardDeleted, 'success')
    confirm.show = false
    await load()
  } catch (e) {
    showToast(e?.data?.message || t.value.settingsFailed, 'error')
  } finally {
    confirm.loading = false
  }
}

const openReviewers = async (board) => {
  Object.assign(reviewerModal, {
    show: true,
    board,
    candidates: [],
    selected: [],
    loading: true,
    saving: false
  })
  try {
    const data = await $fetch(`/api/admin/community/boards/${board.id}/reviewers`)
    reviewerModal.candidates = data?.candidates || []
    reviewerModal.selected = (data?.assigned || []).map((row) => row.id)
  } catch (e) {
    showToast(e?.data?.message || t.value.loadFailed, 'error')
  } finally {
    reviewerModal.loading = false
  }
}

const toggleReviewer = (id) => {
  const index = reviewerModal.selected.indexOf(id)
  if (index >= 0) reviewerModal.selected.splice(index, 1)
  else reviewerModal.selected.push(id)
}

const saveReviewers = async () => {
  if (!reviewerModal.board) return
  reviewerModal.saving = true
  try {
    await $fetch(`/api/admin/community/boards/${reviewerModal.board.id}/reviewers`, {
      method: 'PUT',
      body: { userIds: reviewerModal.selected }
    })
    showToast(t.value.reviewerSaved, 'success')
    reviewerModal.show = false
    await load()
  } catch (e) {
    showToast(e?.data?.message || t.value.settingsFailed, 'error')
  } finally {
    reviewerModal.saving = false
  }
}

onMounted(load)
</script>
