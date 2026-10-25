<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-lg font-black text-text-primary">{{ t.titlesTitle }}</h2>
        <p class="mt-1 text-xs text-text-tertiary">{{ t.titlesDesc }}</p>
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
          <Plus :size="14" /> {{ t.add }}
        </button>
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
    <div v-else-if="!titles.length" class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 py-16 text-center text-xs text-text-tertiary">
      {{ t.noTitles }}
    </div>

    <section v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="title in titles"
        :key="title.id"
        class="flex flex-col rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-4"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="flex min-w-0 items-center gap-2">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-10 text-primary">
              <Award :size="17" />
            </span>
            <div class="min-w-0">
              <h3 class="flex items-center gap-2 truncate text-sm font-black text-text-primary">
                {{ title.name }}
                <span
                  v-if="title.system"
                  class="shrink-0 rounded-full bg-primary-hover-10 px-2 py-0.5 text-[10px] font-black text-primary"
                >
                  {{ t.systemBadge }}
                </span>
              </h3>
              <p class="text-[10px] text-text-tertiary">
                {{ t.holderCount }} {{ title.holderCount }}
                <span v-if="title.threshold"> · {{ t.thresholdLabel }} {{ title.threshold }}</span>
              </p>
            </div>
          </div>
        </div>
        <p class="mt-3 flex-1 whitespace-pre-wrap break-words text-xs text-text-tertiary">
          {{ title.description || '-' }}
        </p>
        <div class="mt-4 flex flex-wrap items-center gap-2">
          <template v-if="!title.system">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg border border-border-secondary px-3 py-1.5 text-xs font-bold text-text-secondary hover:bg-bg-tertiary"
              @click="openEditor(title)"
            >
              <Pencil :size="13" /> {{ t.edit }}
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg border border-border-secondary px-3 py-1.5 text-xs font-bold text-text-tertiary hover:border-error-30 hover:text-error"
              @click="askDelete(title)"
            >
              <Trash2 :size="13" /> {{ t.delete }}
            </button>
          </template>
          <p v-else class="text-[10px] text-text-disabled">{{ t.systemTitleHint }}</p>
        </div>
      </article>
    </section>

    <Teleport to="body">
      <div
        v-if="editor.show"
        class="fixed inset-0 z-[2000] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm md:items-center md:p-4"
        @click.self="editor.show = false"
      >
        <div class="w-full max-w-md rounded-t-3xl border border-border-secondary bg-bg-secondary p-5 shadow-2xl md:rounded-3xl md:p-6">
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-base font-black text-text-primary">{{ editor.id ? t.edit : t.add }}</h3>
            <button type="button" class="rounded-lg p-1.5 text-text-tertiary hover:bg-bg-tertiary" @click="editor.show = false">
              <X :size="16" />
            </button>
          </div>
          <div class="mt-4 space-y-4">
            <div class="space-y-1.5">
              <label class="px-1 text-[10px] font-black uppercase tracking-widest text-text-disabled">{{ t.titleName }}</label>
              <input
                v-model="editor.name"
                type="text"
                maxlength="20"
                :placeholder="t.titleNamePlaceholder"
                class="w-full rounded-xl border border-border-secondary bg-bg-primary px-3 py-2.5 text-sm text-text-primary placeholder:text-text-disabled focus:border-primary-30 focus:outline-none"
              >
            </div>
            <div class="space-y-1.5">
              <label class="px-1 text-[10px] font-black uppercase tracking-widest text-text-disabled">{{ t.titleDesc }}</label>
              <textarea
                v-model="editor.description"
                rows="3"
                maxlength="100"
                :placeholder="t.titleDescPlaceholder"
                class="w-full resize-none rounded-xl border border-border-secondary bg-bg-primary px-3 py-2.5 text-sm text-text-primary placeholder:text-text-disabled focus:border-primary-30 focus:outline-none"
              />
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
              @click="saveTitle"
            >
              {{ editor.saving ? t.saving : t.save }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <ConfirmDialog
      v-model:show="confirm.show"
      :title="t.deleteTitleTitle"
      :message="t.deleteTitleMsg"
      type="danger"
      :loading="confirm.loading"
      @confirm="deleteTitle"
      @cancel="confirm.show = false"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { Award, Pencil, Plus, RefreshCw, Trash2, X } from '@lucide/vue'
import ConfirmDialog from '~/components/UI/ConfirmDialog.vue'
import { useLocale } from '~/utils/locale'
import { useToast } from '~/composables/useToast'

const { community: communityLocale } = useLocale()
const t = computed(() => communityLocale.value?.admin || {})
const { showToast } = useToast()

const titles = ref([])
const loading = ref(true)
const error = ref(false)

const editor = reactive({ show: false, id: 0, name: '', description: '', saving: false })
const confirm = reactive({ show: false, loading: false, target: null })

const load = async () => {
  loading.value = true
  error.value = false
  try {
    const data = await $fetch('/api/admin/community/titles')
    titles.value = data?.titles || []
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
}

const openEditor = (title) => {
  Object.assign(editor, {
    show: true,
    id: title?.id || 0,
    name: title?.name || '',
    description: title?.description || '',
    saving: false
  })
}

const saveTitle = async () => {
  if (!editor.name.trim()) {
    showToast(t.value.titleNameRequired, 'warning')
    return
  }
  editor.saving = true
  try {
    const body = { name: editor.name.trim(), description: editor.description.trim() }
    if (editor.id) {
      await $fetch(`/api/admin/community/titles/${editor.id}`, { method: 'PUT', body })
    } else {
      await $fetch('/api/admin/community/titles', { method: 'POST', body })
    }
    showToast(t.value.titleSaved, 'success')
    editor.show = false
    await load()
  } catch (e) {
    showToast(e?.data?.message || t.value.settingsFailed, 'error')
  } finally {
    editor.saving = false
  }
}

const askDelete = (title) => {
  confirm.target = title
  confirm.show = true
}

const deleteTitle = async () => {
  if (!confirm.target) return
  confirm.loading = true
  try {
    await $fetch(`/api/admin/community/titles/${confirm.target.id}`, { method: 'DELETE' })
    showToast(t.value.titleDeleted, 'success')
    confirm.show = false
    await load()
  } catch (e) {
    showToast(e?.data?.message || t.value.settingsFailed, 'error')
  } finally {
    confirm.loading = false
  }
}

onMounted(load)
</script>
