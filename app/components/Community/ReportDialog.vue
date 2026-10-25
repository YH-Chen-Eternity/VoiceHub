<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 scale-95"
      enter-to-class="opacity-100 scale-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="show"
        class="fixed inset-0 z-[2000] flex items-center justify-center bg-bg-primary-80 p-4 backdrop-blur-sm"
        @click="handleOverlayClick"
      >
        <div
          class="w-full max-w-md overflow-hidden rounded-3xl border border-border-secondary bg-bg-secondary shadow-2xl"
          @click.stop
        >
          <div
            class="flex items-start justify-between gap-3 border-b border-border-secondary-50 px-6 pt-6 pb-4"
          >
            <div class="min-w-0">
              <h3 class="flex items-center gap-2 text-base font-black text-text-primary">
                <Flag :size="16" class="text-error" />
                举报
              </h3>
              <p class="mt-1 truncate text-xs text-text-tertiary">
                {{ targetLabel || TARGET_LABELS[normalizedTargetType] || '该内容' }}
              </p>
            </div>
            <button
              type="button"
              class="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-bg-tertiary-40 hover:text-text-primary"
              :disabled="submitting"
              @click="close"
            >
              <X :size="16" />
            </button>
          </div>

          <div class="space-y-4 px-6 py-5">
            <div>
              <p class="mb-2 text-[10px] font-black uppercase tracking-widest text-text-disabled">
                举报原因
              </p>
              <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  v-for="reason in REASONS"
                  :key="reason.value"
                  type="button"
                  class="rounded-xl border px-3 py-2 text-left transition-all"
                  :class="
                    reasonCode === reason.value
                      ? 'border-primary-30 bg-primary-hover-5'
                      : 'border-border-secondary-50 bg-bg-primary-40 hover:border-border-secondary'
                  "
                  :disabled="submitting"
                  @click="reasonCode = reason.value"
                >
                  <span
                    class="block text-xs font-bold"
                    :class="reasonCode === reason.value ? 'text-primary' : 'text-text-secondary'"
                  >
                    {{ reason.label }}
                  </span>
                  <span class="mt-0.5 block text-[10px] leading-snug text-text-tertiary">
                    {{ reason.description }}
                  </span>
                </button>
              </div>
            </div>

            <div>
              <p class="mb-2 text-[10px] font-black uppercase tracking-widest text-text-disabled">
                补充说明（可选）
              </p>
              <textarea
                v-model="detail"
                rows="3"
                maxlength="500"
                placeholder="请补充说明具体情况，便于管理员核实"
                class="w-full resize-none rounded-xl border border-border-secondary bg-bg-primary px-3 py-2 text-xs text-text-primary placeholder:text-text-disabled focus:border-primary-30 focus:outline-none"
                :disabled="submitting"
              />
              <p class="mt-1 text-right text-[10px] text-text-disabled">{{ detail.length }}/500</p>
            </div>
          </div>

          <div class="flex gap-3 border-t border-border-secondary-50 px-6 py-4">
            <button
              type="button"
              class="flex-1 rounded-2xl bg-bg-tertiary px-4 py-3 text-xs font-black text-text-secondary transition-all hover:bg-bg-quaternary disabled:opacity-50"
              :disabled="submitting"
              @click="close"
            >
              取消
            </button>
            <button
              type="button"
              class="flex flex-[2] items-center justify-center gap-2 rounded-2xl bg-error px-4 py-3 text-xs font-black text-white shadow-lg transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
              :disabled="submitting"
              @click="submit"
            >
              <LoaderCircle v-if="submitting" :size="14" class="animate-spin" />
              {{ submitting ? '提交中…' : '提交举报' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { Flag, LoaderCircle, X } from '@lucide/vue'
import { useToast } from '~/composables/useToast'
import { useServerErrors } from '~/composables/useLocaleText'

const TARGET_LABELS = {
  POST: '举报帖子',
  COMMENT: '举报评论',
  USER: '举报用户'
}

const REASONS = [
  { value: 'SPAM', label: '刷屏 / 广告', description: '重复发布、广告引流' },
  { value: 'ABUSE', label: '辱骂 / 攻击', description: '人身攻击、恶意挑衅' },
  { value: 'FRAUD', label: '诈骗', description: '虚假信息、诱导转账' },
  { value: 'PRIVACY', label: '隐私泄露', description: '泄露他人身份信息' },
  { value: 'OTHER', label: '其他', description: '其他违规内容' }
]

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  targetType: {
    type: String,
    default: 'POST'
  },
  targetId: {
    type: [Number, String],
    default: 0
  },
  targetLabel: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['update:show', 'done'])

const { showToast } = useToast()
const { localize: localizeServerError } = useServerErrors()

const reasonCode = ref('SPAM')
const detail = ref('')
const submitting = ref(false)

const normalizedTargetType = computed(() => String(props.targetType || 'POST').toUpperCase())

watch(
  () => props.show,
  (visible) => {
    if (visible) {
      reasonCode.value = 'SPAM'
      detail.value = ''
      submitting.value = false
    }
  }
)

const close = () => {
  if (submitting.value) return
  emit('update:show', false)
}

const handleOverlayClick = () => {
  close()
}

const submit = async () => {
  const targetId = Number(props.targetId)
  if (!Number.isInteger(targetId) || targetId <= 0) {
    showToast('举报目标无效', 'error')
    return
  }
  submitting.value = true
  try {
    const result = await $fetch('/api/community/reports', {
      method: 'POST',
      body: {
        targetType: normalizedTargetType.value,
        targetId,
        reasonCode: reasonCode.value,
        detail: detail.value.trim()
      }
    })
    const autoHidden = !!result?.autoHidden
    showToast(
      autoHidden ? '举报已提交，内容已自动隐藏待审核' : '举报已提交，请等待管理员处理',
      'success'
    )
    emit('done', { autoHidden })
    emit('update:show', false)
  } catch (error) {
    showToast(localizeServerError(error, '举报提交失败'), 'error')
  } finally {
    submitting.value = false
  }
}
</script>
