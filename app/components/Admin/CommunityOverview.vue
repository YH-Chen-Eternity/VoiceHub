<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-lg font-black text-text-primary">审核运营看板</h2>
        <p class="mt-1 text-xs text-text-tertiary">
          待审队列、审核效率、近 7 天趋势与审帖员工作量；审帖员仅统计负责板块
        </p>
      </div>
      <button
        class="inline-flex items-center gap-2 rounded-xl border border-border-secondary bg-bg-primary-40 px-3 py-2 text-xs font-bold text-text-secondary hover:bg-bg-tertiary disabled:opacity-50"
        type="button"
        :disabled="loading"
        @click="loadAll"
      >
        <RefreshCw :size="14" :class="{ 'animate-spin': loading }" /> {{ t.refresh || '刷新' }}
      </button>
    </div>

    <div
      v-if="loading && !overview"
      class="flex items-center justify-center gap-2 py-16 text-xs text-text-tertiary"
    >
      <RefreshCw :size="16" class="animate-spin" /> {{ t.loading || '加载中…' }}
    </div>

    <div
      v-else-if="error"
      class="flex flex-col items-center gap-3 rounded-2xl border border-error-20 bg-error-10 py-12 text-xs text-error"
    >
      <span>{{ t.loadFailed || '加载失败，请稍后重试' }}</span>
      <button
        class="rounded-lg border border-error-30 px-3 py-1.5 font-bold hover:bg-error-15"
        type="button"
        @click="loadAll"
      >
        {{ t.retry || '重试' }}
      </button>
    </div>

    <template v-else>
      <!-- 统计卡片 -->
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <div
          v-for="card in statCards"
          :key="card.key"
          class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-4"
        >
          <p class="text-[10px] font-black uppercase tracking-widest text-text-disabled">
            {{ card.label }}
          </p>
          <p class="mt-2 text-2xl font-black text-text-primary">{{ card.value }}</p>
          <p v-if="card.hint" class="mt-1 text-[10px] text-text-tertiary">{{ card.hint }}</p>
        </div>
      </div>

      <!-- 近 7 天趋势 -->
      <section class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-4 md:p-5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-sm font-black text-text-primary">近 7 天趋势</h3>
          <span class="text-[10px] text-text-disabled">按北京时间日期统计</span>
        </div>
        <div class="mt-4 space-y-2">
          <div
            v-for="item in trendWithBar"
            :key="item.date"
            class="grid grid-cols-[5.5rem_1fr] items-center gap-3"
          >
            <span class="text-[11px] font-bold text-text-tertiary">{{ item.date }}</span>
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <span class="w-10 shrink-0 text-[10px] text-text-disabled"
                  >发帖 {{ item.posts }}</span
                >
                <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-tertiary-50">
                  <div class="h-full rounded-full bg-primary" :style="{ width: item.postsWidth }" />
                </div>
              </div>
              <div class="flex items-center gap-2">
                <span class="w-10 shrink-0 text-[10px] text-text-disabled"
                  >评论 {{ item.comments }}</span
                >
                <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-tertiary-50">
                  <div
                    class="h-full rounded-full bg-success"
                    :style="{ width: item.commentsWidth }"
                  />
                </div>
              </div>
              <div class="flex items-center gap-2">
                <span class="w-10 shrink-0 text-[10px] text-text-disabled"
                  >审核 {{ item.reviewed }}</span
                >
                <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-tertiary-50">
                  <div
                    class="h-full rounded-full bg-warning"
                    :style="{ width: item.reviewedWidth }"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 审帖员工作量 -->
      <section class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-4 md:p-5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-sm font-black text-text-primary">审帖员工作量（近 30 天）</h3>
          <span class="text-[10px] text-text-disabled">共 {{ reviewers.length }} 位审帖员</span>
        </div>
        <div v-if="!reviewers.length" class="py-8 text-center text-xs text-text-tertiary">
          近 30 天暂无审核记录
        </div>
        <div v-else class="mt-3 overflow-x-auto">
          <table class="w-full min-w-[32rem] text-left text-xs">
            <thead class="text-[10px] uppercase tracking-widest text-text-disabled">
              <tr>
                <th class="py-2 pr-3 font-black">审帖员</th>
                <th class="py-2 pr-3 font-black">已审</th>
                <th class="py-2 pr-3 font-black">通过</th>
                <th class="py-2 pr-3 font-black">驳回</th>
                <th class="py-2 font-black">平均耗时</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="reviewer in reviewers"
                :key="reviewer.id"
                class="border-t border-overlay-4"
              >
                <td class="py-2 pr-3 font-bold text-text-primary">
                  {{ reviewer.name || reviewer.username || `用户 #${reviewer.id}` }}
                  <span
                    v-if="reviewer.username"
                    class="ml-1 text-[10px] font-normal text-text-disabled"
                    >@{{ reviewer.username }}</span
                  >
                </td>
                <td class="py-2 pr-3 text-text-secondary">{{ reviewer.reviewed }}</td>
                <td class="py-2 pr-3 text-success">{{ reviewer.approved }}</td>
                <td class="py-2 pr-3 text-error">{{ reviewer.rejected }}</td>
                <td class="py-2 text-text-secondary">{{ formatDuration(reviewer.avgSeconds) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 批量操作入口 -->
      <section class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-4 md:p-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-black text-text-primary">待审队列（批量操作）</h3>
            <p class="mt-1 text-[11px] text-text-tertiary">
              勾选后批量通过或驳回；驳回按条计入作者违规
            </p>
          </div>
          <div class="w-44">
            <CustomSelect
              v-model="boardId"
              :options="boardOptions"
              :label="t.boardFilter || '板块筛选'"
              @update:model-value="loadQueues"
            />
          </div>
        </div>

        <div class="mt-4 flex flex-wrap items-center gap-2">
          <div class="flex gap-1 rounded-xl border border-border-secondary bg-bg-primary-40 p-1">
            <button
              v-for="item in queueTabs"
              :key="item.type"
              type="button"
              class="rounded-lg px-3 py-1.5 text-[11px] font-bold transition-all"
              :class="
                batchType === item.type
                  ? 'bg-bg-tertiary text-primary'
                  : 'text-text-tertiary hover:text-text-primary'
              "
              @click="switchBatchType(item.type)"
            >
              {{ item.label }}
            </button>
          </div>
          <label
            class="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-bold text-text-tertiary"
          >
            <input type="checkbox" :checked="allSelected" @change="toggleSelectAll" />
            全选
          </label>
          <span class="text-[11px] text-text-disabled">已选 {{ selectedIds.length }} 条</span>
        </div>

        <div
          v-if="queueLoading"
          class="flex items-center justify-center gap-2 py-10 text-xs text-text-tertiary"
        >
          <RefreshCw :size="14" class="animate-spin" /> 加载中…
        </div>
        <div v-else-if="!queueItems.length" class="py-10 text-center text-xs text-text-tertiary">
          当前没有待审的{{ batchType === 'post' ? '帖子' : '评论' }}
        </div>
        <div v-else class="mt-3 max-h-[28rem] space-y-2 overflow-y-auto custom-scrollbar pr-1">
          <label
            v-for="item in queueItems"
            :key="item.id"
            class="flex cursor-pointer items-start gap-3 rounded-xl border border-border-secondary-50 bg-bg-primary-40 p-3 transition-colors"
            :class="selectedIdSet.has(item.id) ? 'border-primary-30 bg-primary-hover-5' : ''"
          >
            <input
              type="checkbox"
              class="mt-1 shrink-0"
              :checked="selectedIdSet.has(item.id)"
              @change="toggleSelect(item.id)"
            />
            <span class="min-w-0 flex-1">
              <span class="flex flex-wrap items-center gap-2 text-[11px]">
                <span class="font-black text-text-primary">{{
                  item.authorName || `用户 #${item.authorId}`
                }}</span>
                <span class="rounded bg-bg-tertiary px-1.5 py-0.5 text-text-tertiary">{{
                  item.boardName || '—'
                }}</span>
                <span class="text-text-disabled">{{ formatDate(item.createdAt) }}</span>
                <span v-if="batchType === 'comment'" class="truncate text-text-disabled"
                  >· 帖子：{{ item.postContent }}</span
                >
              </span>
              <span class="mt-1 block truncate text-xs text-text-secondary">{{
                item.content
              }}</span>
            </span>
          </label>
        </div>

        <div class="mt-4 flex flex-wrap items-center gap-2">
          <input
            v-model="batchNote"
            class="min-w-[16rem] flex-1 rounded-xl border border-border-tertiary-50 bg-bg-tertiary-50 px-3 py-2 text-xs text-text-primary placeholder-text-disabled focus:border-primary focus:outline-none"
            :placeholder="t.reviewNotePlaceholder || '审核说明（可选，会通知作者）'"
            type="text"
            maxlength="200"
          />
          <button
            class="inline-flex items-center gap-1.5 rounded-xl bg-success px-4 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
            type="button"
            :disabled="!selectedIds.length || batchBusy"
            @click="runBatch('approve')"
          >
            <Check :size="14" /> 批量通过
          </button>
          <button
            class="inline-flex items-center gap-1.5 rounded-xl bg-error px-4 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
            type="button"
            :disabled="!selectedIds.length || batchBusy"
            @click="askBatchReject"
          >
            <X :size="14" /> 批量驳回
          </button>
        </div>
      </section>
    </template>

    <ConfirmDialog
      :show="rejectConfirm.show"
      :title="rejectConfirm.title"
      :message="rejectConfirm.message"
      :type="'warning'"
      :loading="batchBusy"
      :confirm-text="t.reject || '驳回'"
      @confirm="runBatch('reject')"
      @cancel="rejectConfirm.show = false"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { Check, RefreshCw, X } from '@lucide/vue'
import ConfirmDialog from '~/components/UI/ConfirmDialog.vue'
import CustomSelect from '~/components/UI/Common/CustomSelect.vue'
import { useLocale } from '~/utils/locale'
import { useToast } from '~/composables/useToast'

const { community: communityLocale } = useLocale()
const t = computed(() => communityLocale.value?.admin || {})
const { showToast } = useToast()

const overview = ref(null)
const loading = ref(true)
const error = ref(false)

const batchType = ref('post')
const batchNote = ref('')
const batchBusy = ref(false)
const boardId = ref(0)
const queueItems = ref([])
const queueLoading = ref(false)
const selectedIds = ref([])

const rejectConfirm = reactive({
  show: false,
  title: '批量驳回',
  message: ''
})

const queueTabs = [
  { type: 'post', label: '待审帖子' },
  { type: 'comment', label: '待审评论' }
]

const boardOptions = computed(() => [
  { label: t.value.allBoards || '全部板块', value: 0 },
  ...(overview.value?.boards || []).map((board) => ({ label: board.name, value: board.id }))
])

const selectedIdSet = computed(() => new Set(selectedIds.value))
const allSelected = computed(
  () => queueItems.value.length > 0 && selectedIds.value.length === queueItems.value.length
)

const statCards = computed(() => {
  const data = overview.value
  if (!data) return []
  return [
    { key: 'pendingPosts', label: '待审帖子', value: data.queue.pendingPosts },
    { key: 'pendingComments', label: '待审评论', value: data.queue.pendingComments },
    {
      key: 'todayReviewed',
      label: '今日已审',
      value: data.today.reviewed,
      hint: `通过 ${data.today.approved} · 驳回 ${data.today.rejected}`
    },
    {
      key: 'avgDuration',
      label: '平均审核耗时',
      value: formatDuration(data.reviewDuration.avgSeconds),
      hint: `近 30 天 ${data.reviewDuration.sampleCount} 条样本`
    },
    {
      key: 'pendingReports',
      label: '待处理举报',
      value: data.queue.pendingReports,
      hint:
        data.queue.pendingReportsTotal > data.queue.pendingReports
          ? `全站 ${data.queue.pendingReportsTotal} 条`
          : ''
    },
    { key: 'pendingAppeals', label: '待处理申诉', value: data.queue.pendingAppeals }
  ]
})

const trendWithBar = computed(() => {
  const trend = overview.value?.trend || []
  const maxValue = Math.max(
    1,
    ...trend.flatMap((item) => [item.posts, item.comments, item.reviewed])
  )
  const width = (value) => `${Math.round((Number(value || 0) / maxValue) * 100)}%`
  return trend.map((item) => ({
    ...item,
    postsWidth: width(item.posts),
    commentsWidth: width(item.comments),
    reviewedWidth: width(item.reviewed)
  }))
})

const reviewers = computed(() => overview.value?.reviewers || [])

const formatDuration = (seconds) => {
  const value = Math.round(Number(seconds) || 0)
  if (value < 60) return `${value} 秒`
  const minutes = Math.floor(value / 60)
  const rest = value % 60
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`
}

const formatDate = (value) => {
  if (!value) return ''
  try {
    return new Date(value).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return ''
  }
}

const loadOverview = async () => {
  try {
    const data = await $fetch('/api/admin/community/overview')
    overview.value = data
    error.value = false
  } catch {
    error.value = true
  }
}

const loadQueues = async () => {
  queueLoading.value = true
  try {
    const params = new URLSearchParams({ status: 'PENDING' })
    if (boardId.value) params.set('boardId', String(boardId.value))
    if (batchType.value === 'post') {
      const data = await $fetch(`/api/community/review/posts?${params.toString()}`)
      queueItems.value = (data?.posts || []).map((post) => ({
        id: post.id,
        authorId: post.author?.id,
        authorName: post.author?.displayName,
        boardName: post.board?.name,
        content: post.content,
        createdAt: post.createdAt
      }))
    } else {
      const data = await $fetch(`/api/community/review/comments?${params.toString()}`)
      queueItems.value = (data?.comments || []).map((comment) => ({
        id: comment.id,
        authorId: comment.author?.id,
        authorName: comment.author?.displayName,
        boardName: comment.board?.name,
        content: comment.content,
        postContent: comment.post?.content,
        createdAt: comment.createdAt
      }))
    }
    selectedIds.value = []
  } catch {
    queueItems.value = []
  } finally {
    queueLoading.value = false
  }
}

const loadAll = async () => {
  loading.value = true
  await Promise.all([loadOverview(), loadQueues()])
  loading.value = false
}

const switchBatchType = (type) => {
  if (batchType.value === type) return
  batchType.value = type
  loadQueues()
}

const toggleSelect = (id) => {
  if (selectedIdSet.value.has(id)) {
    selectedIds.value = selectedIds.value.filter((item) => item !== id)
  } else {
    selectedIds.value = [...selectedIds.value, id]
  }
}

const toggleSelectAll = () => {
  selectedIds.value = allSelected.value ? [] : queueItems.value.map((item) => item.id)
}

const askBatchReject = () => {
  rejectConfirm.show = true
  rejectConfirm.title = '批量驳回'
  rejectConfirm.message = `将驳回已选中的 ${selectedIds.value.length} 条${
    batchType.value === 'post' ? '帖子' : '评论'
  }，并按条计入作者违规。确定继续吗？`
}

const runBatch = async (action) => {
  if (!selectedIds.value.length || batchBusy.value) return
  batchBusy.value = true
  try {
    const data = await $fetch('/api/admin/community/review/batch', {
      method: 'POST',
      body: {
        type: batchType.value,
        ids: [...selectedIds.value],
        action,
        note: batchNote.value
      }
    })
    rejectConfirm.show = false
    showToast(
      action === 'approve'
        ? `已批量通过 ${data?.processed || 0} 条`
        : `已批量驳回 ${data?.processed || 0} 条`,
      'success'
    )
    if (data?.skipped?.length) {
      showToast(`${data.skipped.length} 条未处理：${data.skipped[0].message}`, 'warning', 4000)
    }
    batchNote.value = ''
    await loadAll()
  } catch (e) {
    showToast(e?.data?.message || '批量审核失败', 'error')
  } finally {
    batchBusy.value = false
  }
}

onMounted(loadAll)
</script>
