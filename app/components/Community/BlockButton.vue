<template>
  <button
    v-if="!isSelf"
    type="button"
    class="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[10px] font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50"
    :class="
      blocked
        ? 'border-error-30 bg-error-10 text-error hover:bg-error-15'
        : 'border-border-secondary bg-bg-primary-40 text-text-tertiary hover:border-error-30 hover:text-error'
    "
    :disabled="loading"
    :title="
      blocked
        ? `取消拉黑${displayName ? ` ${displayName}` : ''}`
        : `拉黑${displayName ? ` ${displayName}` : ''}，互相看不到对方内容`
    "
    @click="toggle"
  >
    <LoaderCircle v-if="loading" :size="12" class="animate-spin" />
    <Ban v-else-if="blocked" :size="12" />
    <UserX v-else :size="12" />
    {{ blocked ? '取消拉黑' : '拉黑' }}
  </button>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { Ban, LoaderCircle, UserX } from '@lucide/vue'
import { useAuth } from '~/composables/useAuth'
import { useToast } from '~/composables/useToast'
import { useServerErrors } from '~/composables/useLocaleText'

const props = defineProps({
  userId: {
    type: [Number, String],
    required: true
  },
  displayName: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['done'])

const auth = useAuth()
const { showToast } = useToast()
const { localize: localizeServerError } = useServerErrors()

const blocked = ref(false)
const loading = ref(false)

const targetId = computed(() => Number(props.userId))
const isSelf = computed(() => {
  const currentId = Number(auth.user.value?.id || 0)
  return currentId > 0 && currentId === targetId.value
})

const loadState = async () => {
  if (isSelf.value || !Number.isInteger(targetId.value) || targetId.value <= 0) return
  try {
    const result = await $fetch('/api/community/blocks')
    const blocks = Array.isArray(result?.blocks) ? result.blocks : []
    blocked.value = blocks.some((item) => Number(item.id) === targetId.value)
  } catch {
    // 拉黑状态读取失败不阻断按钮展示，点击时由服务端再次校验
  }
}

const toggle = async () => {
  if (loading.value) return
  const id = targetId.value
  if (!Number.isInteger(id) || id <= 0) {
    showToast('用户参数无效', 'error')
    return
  }
  loading.value = true
  try {
    const result = await $fetch(`/api/community/blocks/${id}`, { method: 'POST' })
    blocked.value = !!result?.blocked
    showToast(blocked.value ? '已拉黑，双方互相看不到社区内容' : '已取消拉黑', 'success')
    emit('done', { blocked: blocked.value })
  } catch (error) {
    showToast(localizeServerError(error, '操作失败'), 'error')
  } finally {
    loading.value = false
  }
}

onMounted(loadState)
</script>
