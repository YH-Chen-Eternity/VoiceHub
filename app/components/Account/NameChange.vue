<!-- Modified by YH-Chen on 2026-10-17 -->
<template>
  <section class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-5 md:p-6">
    <div class="flex items-center gap-3 border-b border-border-secondary-50 pb-5 mb-6">
      <div class="p-2.5 bg-warning-10 rounded-xl flex items-center justify-center">
        <Pencil :size="20" class="text-warning" />
      </div>
      <div>
        <h2 class="text-base font-black text-text-primary">{{ t.nameChange.title }}</h2>
        <p class="text-xs text-text-tertiary mt-0.5">{{ t.nameChange.current(currentName) }}</p>
      </div>
    </div>

    <div
      v-if="pending"
      class="mb-4 rounded-xl border border-warning-40 bg-warning-10 px-4 py-3 text-xs text-warning-200"
    >
      {{ t.nameChange.pending(pending.oldName, pending.newName) }}
    </div>
    <div
      v-else-if="latest && latest.status === 'REJECTED'"
      class="mb-4 rounded-xl border border-error-30 bg-error-10 px-4 py-3 text-xs text-error-200"
    >
      {{ t.nameChange.rejected(latest.reason) }}
    </div>

    <div class="max-w-md space-y-3">
      <input
        v-model="newName"
        class="w-full rounded-xl border border-border-secondary bg-bg-primary-40 px-4 py-2.5 text-sm text-text-primary focus:border-primary-50 focus:outline-none"
        maxlength="20"
        :placeholder="t.nameChange.placeholder"
        type="text"
      />
      <p class="text-[11px] text-text-tertiary">{{ t.nameChange.hint }}</p>
      <button
        class="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-white transition-all hover:bg-primary-hover disabled:opacity-50"
        :disabled="submitting || !newName.trim()"
        type="button"
        @click="submit"
      >
        <RefreshCw v-if="submitting" :size="14" class="animate-spin" />
        {{ submitting ? t.nameChange.submitting : t.nameChange.submit }}
      </button>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { RefreshCw, Pencil } from '@lucide/vue'
import { useAuth } from '~/composables/useAuth'
import { useNewUi } from '~/composables/useNewUi'

const t = useNewUi()
const { showToast } = useToast()
const auth = useAuth()
const latest = ref(null)
const newName = ref('')
const submitting = ref(false)

const currentName = computed(() => auth.user.value?.name || '')
const pending = computed(() => (latest.value?.status === 'PENDING' ? latest.value : null))

const load = async () => {
  try {
    const res = await $fetch('/api/user/name-change')
    latest.value = res?.data || null
  } catch (error) {
    console.error('load name change failed:', error)
  }
}

const submit = async () => {
  const name = newName.value.trim()
  if (!name) return
  submitting.value = true
  try {
    await $fetch('/api/user/name-change', { method: 'POST', body: { name } })
    showToast?.(t.value.nameChange.success, 'success')
    newName.value = ''
    await load()
  } catch (error) {
    showToast?.(error?.data?.message || t.value.nameChange.failed, 'error')
  } finally {
    submitting.value = false
  }
}

onMounted(load)
</script>
