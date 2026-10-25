<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-lg font-black text-text-primary">举报与申诉</h2>
        <p class="mt-1 text-xs text-text-tertiary">处理社区举报，审核用户申诉</p>
      </div>
      <button
        class="inline-flex items-center gap-2 rounded-xl border border-border-secondary bg-bg-primary-40 px-3 py-2 text-xs font-bold text-text-secondary hover:bg-bg-tertiary disabled:opacity-50"
        type="button"
        :disabled="loading"
        @click="load"
      >
        <RefreshCw :size="14" :class="{ 'animate-spin': loading }" /> 刷新
      </button>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <div class="flex gap-1 rounded-xl border border-border-secondary bg-bg-primary-40 p-1">
        <button
          v-for="item in tabCards"
          :key="item.value"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold transition-all"
          :class="
            tab === item.value
              ? 'bg-bg-tertiary text-primary'
              : 'text-text-tertiary hover:text-text-primary'
          "
          @click="switchTab(item.value)"
        >
          <component :is="item.icon" :size="12" />
          {{ item.label }}
        </button>
      </div>

      <div class="flex gap-1 rounded-xl border border-border-secondary bg-bg-primary-40 p-1">
        <button
          v-for="item in statusCards"
          :key="item.value"
          type="button"
          class="rounded-lg px-3 py-1.5 text-[11px] font-bold transition-all"
          :class="
            status === item.value
              ? 'bg-bg-tertiary text-primary'
              : 'text-text-tertiary hover:text-text-primary'
          "
          @click="switchStatus(item.value)"
        >
          {{ item.label }}
          <span v-if="item.value === 'PENDING' && pendingCount" class="ml-1 text-warning">{{
            pendingCount
          }}</span>
        </button>
      </div>
    </div>

    <div
      v-if="loading"
      class="flex items-center justify-center gap-2 py-16 text-xs text-text-tertiary"
    >
      <RefreshCw :size="16" class="animate-spin" /> 加载中…
    </div>
    <div
      v-else-if="error"
      class="flex flex-col items-center gap-3 rounded-2xl border border-error-20 bg-error-10 py-12 text-xs text-error"
    >
      <span>加载失败，请稍后重试</span>
      <button
        class="rounded-lg border border-error-30 px-3 py-1.5 font-bold hover:bg-error-15"
        type="button"
        @click="load"
      >
        重试
      </button>
    </div>
    <div
      v-else-if="!currentList.length"
      class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 py-16 text-center text-xs text-text-tertiary"
    >
      {{ tab === 'reports' ? '暂无举报记录' : '暂无申诉记录' }}
    </div>

    <!-- 举报列表 -->
    <section v-else-if="tab === 'reports'" class="space-y-3">
      <article
        v-for="report in reports"
        :key="report.id"
        class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-4 md:p-5"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex min-w-0 flex-wrap items-center gap-2 text-xs">
            <span class="rounded bg-bg-tertiary px-1.5 py-0.5 text-text-tertiary">
              {{ targetTypeLabel(report.targetType) }}
            </span>
            <span class="text-text-disabled">#{{ report.targetId }}</span>
            <span class="font-bold text-text-secondary">{{ reasonLabel(report.reasonCode) }}</span>
            <span class="text-text-disabled">{{ report.createdAtText || '—' }}</span>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <span
              v-if="report.target?.pendingCount"
              class="rounded-full border border-warning-20 bg-warning-10 px-2 py-0.5 text-[10px] font-bold text-warning"
            >
              待处理举报 {{ report.target.pendingCount }} 条
            </span>
            <span
              class="rounded-full px-2 py-0.5 text-[10px] font-bold"
              :class="statusClass(report.status)"
            >
              {{ statusLabel(report.status) }}
            </span>
          </div>
        </div>

        <div class="mt-3 rounded-xl border border-border-secondary-50 bg-bg-primary-40 p-3">
          <p class="text-[10px] font-black uppercase tracking-widest text-text-disabled">
            举报内容
          </p>
          <p
            v-if="report.target?.contentSnippet"
            class="mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-text-secondary"
          >
            {{ report.target.contentSnippet }}
          </p>
          <p v-else-if="report.targetType === 'USER'" class="mt-1 text-[11px] text-text-secondary">
            被举报用户：{{ report.target?.author?.name || '已注销用户' }}
            <span v-if="report.target?.author?.shadowBanned" class="ml-1 text-warning"
              >（已影子封禁）</span
            >
          </p>
          <p v-else class="mt-1 text-[11px] text-text-disabled">目标内容已被清理</p>
          <div class="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-text-tertiary">
            <span v-if="report.target?.author">
              作者：<span class="font-bold text-text-secondary">{{
                report.target.author.name
              }}</span>
            </span>
            <span v-if="report.target?.board" class="rounded bg-bg-tertiary px-1.5 py-0.5">
              {{ report.target.board.name }}
            </span>
            <span v-if="report.target?.status" class="rounded bg-bg-tertiary px-1.5 py-0.5">
              目标状态：{{ contentStatusLabel(report.target.status) }}
            </span>
            <span v-if="report.target?.deletedAtText" class="text-error">
              已于 {{ report.target.deletedAtText }} 删除
            </span>
          </div>
        </div>

        <p
          v-if="report.detail"
          class="mt-3 whitespace-pre-wrap break-words text-xs text-text-secondary"
        >
          <span class="text-text-tertiary">补充说明：</span>{{ report.detail }}
        </p>

        <div
          class="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-text-tertiary"
        >
          <span>
            举报人：<span class="font-bold text-text-secondary">{{
              reporterLabel(report.reporter)
            }}</span>
          </span>
          <span v-if="report.handledAtText">
            处理时间：{{ report.handledAtText }}
            <span v-if="report.handledBy"> · 处理人：{{ reporterLabel(report.handledBy) }}</span>
          </span>
        </div>

        <div
          v-if="report.resultNote || report.actionTaken"
          class="mt-2 rounded-xl bg-bg-tertiary-40 p-2.5 text-[11px] text-text-tertiary"
        >
          <span v-if="report.actionTaken" class="font-bold text-text-secondary">
            处理结果：{{ actionLabel(report.actionTaken) }}
          </span>
          <span v-if="report.resultNote"> · 备注：{{ report.resultNote }}</span>
        </div>

        <div v-if="report.status === 'PENDING'" class="mt-3 flex flex-wrap gap-2">
          <template v-if="report.targetType === 'USER'">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white transition-all hover:bg-primary-hover disabled:opacity-50"
              :disabled="busyId === report.id"
              @click="askReportAction(report, 'ACCEPT_HIDE')"
            >
              <ShieldAlert :size="14" /> 影子封禁
            </button>
          </template>
          <template v-else>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white transition-all hover:bg-primary-hover disabled:opacity-50"
              :disabled="busyId === report.id"
              @click="askReportAction(report, 'ACCEPT_HIDE')"
            >
              <EyeOff :size="14" /> 通过并隐藏
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg border border-error-30 bg-error-10 px-3 py-1.5 text-xs font-bold text-error transition-all hover:bg-error-15 disabled:opacity-50"
              :disabled="busyId === report.id"
              @click="askReportAction(report, 'ACCEPT_DELETE')"
            >
              <Trash :size="14" /> 通过并删除
            </button>
          </template>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg border border-border-secondary px-3 py-1.5 text-xs font-bold text-text-tertiary transition-all hover:border-warning-30 hover:text-warning disabled:opacity-50"
            :disabled="busyId === report.id"
            @click="askReportAction(report, 'REJECT')"
          >
            <X :size="14" /> 驳回举报
          </button>
        </div>
      </article>
    </section>

    <!-- 申诉列表 -->
    <section v-else class="space-y-3">
      <article
        v-for="appeal in appeals"
        :key="appeal.id"
        class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-4 md:p-5"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex min-w-0 flex-wrap items-center gap-2 text-xs">
            <span class="rounded bg-bg-tertiary px-1.5 py-0.5 text-text-tertiary">
              {{ appealTargetTypeLabel(appeal.targetType) }}
            </span>
            <span class="text-text-disabled">#{{ appeal.targetId }}</span>
            <span class="text-text-disabled">{{ appeal.createdAtText || '—' }}</span>
          </div>
          <span
            class="rounded-full px-2 py-0.5 text-[10px] font-bold"
            :class="statusClass(appeal.status)"
          >
            {{ statusLabel(appeal.status) }}
          </span>
        </div>

        <p class="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-text-secondary">
          {{ appeal.reason }}
        </p>

        <div class="mt-3 rounded-xl border border-border-secondary-50 bg-bg-primary-40 p-3">
          <p class="text-[10px] font-black uppercase tracking-widest text-text-disabled">
            申诉对象
          </p>
          <p
            v-if="appeal.target?.contentSnippet"
            class="mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-text-secondary"
          >
            {{ appeal.target.contentSnippet }}
          </p>
          <div class="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-text-tertiary">
            <span v-if="appeal.target?.author">
              作者：<span class="font-bold text-text-secondary">{{
                appeal.target.author.name
              }}</span>
            </span>
            <span v-if="appeal.target?.board" class="rounded bg-bg-tertiary px-1.5 py-0.5">
              {{ appeal.target.board.name }}
            </span>
            <span v-if="appeal.target?.deletedAtText" class="text-error">
              已于 {{ appeal.target.deletedAtText }} 删除
            </span>
            <span
              v-if="appeal.targetType === 'MUTE' && appeal.target?.author?.banned"
              class="text-error"
            >
              当前禁言中
              <template v-if="appeal.target.author.bannedUntilText">
                （至 {{ appeal.target.author.bannedUntilText }}）
              </template>
              <template v-else>（永久）</template>
            </span>
            <span
              v-if="appeal.targetType === 'MUTE' && !appeal.target?.author?.banned"
              class="text-warning"
            >
              当前未被禁言
            </span>
            <span v-if="appeal.target?.pendingAppealCount" class="text-warning">
              待处理申诉 {{ appeal.target.pendingAppealCount }} 条
            </span>
          </div>
        </div>

        <div
          class="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-text-tertiary"
        >
          <span>
            申诉人：<span class="font-bold text-text-secondary">{{
              reporterLabel(appeal.applicant)
            }}</span>
          </span>
          <span v-if="appeal.handledAtText">
            处理时间：{{ appeal.handledAtText }}
            <span v-if="appeal.handledBy"> · 处理人：{{ reporterLabel(appeal.handledBy) }}</span>
          </span>
        </div>

        <div
          v-if="appeal.resultNote"
          class="mt-2 rounded-xl bg-bg-tertiary-40 p-2.5 text-[11px] text-text-tertiary"
        >
          备注：{{ appeal.resultNote }}
        </div>

        <div v-if="appeal.status === 'PENDING'" class="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white transition-all hover:bg-primary-hover disabled:opacity-50"
            :disabled="busyId === appeal.id"
            @click="askAppealAction(appeal, 'ACCEPT')"
          >
            <Undo2 :size="14" /> {{ appeal.targetType === 'MUTE' ? '解除禁言' : '恢复内容' }}
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg border border-border-secondary px-3 py-1.5 text-xs font-bold text-text-tertiary transition-all hover:border-warning-30 hover:text-warning disabled:opacity-50"
            :disabled="busyId === appeal.id"
            @click="askAppealAction(appeal, 'REJECT')"
          >
            <X :size="14" /> 驳回申诉
          </button>
        </div>
      </article>
    </section>

    <!-- 分页 -->
    <div
      v-if="!loading && !error && pagination.total > 0"
      class="flex flex-wrap items-center justify-between gap-2"
    >
      <p class="text-[11px] text-text-tertiary">
        共 {{ pagination.total }} 条 · 第 {{ pagination.page }} / {{ pagination.totalPages }} 页
      </p>
      <div class="flex gap-2">
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-lg border border-border-secondary bg-bg-primary-40 px-3 py-1.5 text-[11px] font-bold text-text-secondary hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="pagination.page <= 1"
          @click="goPage(pagination.page - 1)"
        >
          <ChevronLeft :size="12" /> 上一页
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-lg border border-border-secondary bg-bg-primary-40 px-3 py-1.5 text-[11px] font-bold text-text-secondary hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="pagination.page >= pagination.totalPages"
          @click="goPage(pagination.page + 1)"
        >
          下一页 <ChevronRight :size="12" />
        </button>
      </div>
    </div>

    <ConfirmDialog
      :show="actionConfirm.show"
      :title="actionConfirm.title"
      :message="actionConfirm.message"
      :type="actionConfirm.type"
      :loading="actionConfirm.loading"
      confirm-text="确认处理"
      cancel-text="取消"
      show-input
      :input-required="false"
      input-placeholder="处理备注（可选，会通知相关用户）"
      @confirm="runAction"
      @cancel="actionConfirm.show = false"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  ChevronLeft,
  ChevronRight,
  EyeOff,
  Flag,
  Gavel,
  RefreshCw,
  ShieldAlert,
  Trash,
  Undo2,
  X
} from '@lucide/vue'
import ConfirmDialog from '~/components/UI/ConfirmDialog.vue'
import { useToast } from '~/composables/useToast'
import { useServerErrors } from '~/composables/useLocaleText'

const REASON_LABELS = {
  SPAM: '刷屏/广告',
  ABUSE: '辱骂/攻击',
  FRAUD: '诈骗',
  PRIVACY: '隐私泄露',
  OTHER: '其他'
}

const TARGET_TYPE_LABELS = {
  POST: '帖子',
  COMMENT: '评论',
  USER: '用户'
}

const APPEAL_TARGET_TYPE_LABELS = {
  POST: '帖子',
  COMMENT: '评论',
  MUTE: '禁言'
}

const STATUS_LABELS = {
  PENDING: '待处理',
  ACCEPTED: '已通过',
  REJECTED: '已驳回'
}

const CONTENT_STATUS_LABELS = {
  PENDING: '待审核',
  APPROVED: '已通过',
  REJECTED: '已驳回',
  BLOCKED: '已屏蔽'
}

const ACTION_LABELS = {
  ACCEPT_HIDE: '已隐藏内容',
  ACCEPT_DELETE: '已删除内容',
  REJECT: '已驳回'
}

const { showToast } = useToast()
const { localize: localizeServerError } = useServerErrors()

const tab = ref('reports')
const status = ref('PENDING')
const page = ref(1)
const pageSize = 20
const loading = ref(true)
const error = ref(false)
const busyId = ref(0)
const reports = ref([])
const appeals = ref([])
const pagination = reactive({ page: 1, total: 0, totalPages: 1 })
const stats = reactive({ PENDING: 0, ACCEPTED: 0, REJECTED: 0, total: 0 })

const tabCards = [
  { value: 'reports', label: '举报', icon: Flag },
  { value: 'appeals', label: '申诉', icon: Gavel }
]

const statusCards = [
  { value: 'PENDING', label: '待处理' },
  { value: 'ACCEPTED', label: '已通过' },
  { value: 'REJECTED', label: '已驳回' },
  { value: 'ALL', label: '全部' }
]

const pendingCount = computed(() => Number(stats.PENDING || 0))
const currentList = computed(() => (tab.value === 'reports' ? reports.value : appeals.value))

// 处理弹窗：kind = report | appeal
const actionConfirm = reactive({
  show: false,
  loading: false,
  kind: 'report',
  targetType: '',
  id: 0,
  action: '',
  type: 'warning',
  title: '',
  message: ''
})

const statusLabel = (value) => STATUS_LABELS[value] || value || '—'
const actionLabel = (value) => ACTION_LABELS[value] || value || '—'
const contentStatusLabel = (value) => CONTENT_STATUS_LABELS[value] || value || '—'
const targetTypeLabel = (value) => TARGET_TYPE_LABELS[value] || value
const appealTargetTypeLabel = (value) => APPEAL_TARGET_TYPE_LABELS[value] || value
const reasonLabel = (value) => REASON_LABELS[value] || value || '其他'

const statusClass = (value) => {
  if (value === 'PENDING') return 'bg-warning-10 text-warning'
  if (value === 'ACCEPTED') return 'bg-success-10 text-success'
  return 'bg-error-10 text-error'
}

const reporterLabel = (actor) => {
  if (!actor) return '已注销用户'
  return actor.username ? `${actor.name} (@${actor.username})` : actor.name
}

const load = async () => {
  loading.value = true
  error.value = false
  try {
    const path =
      tab.value === 'reports' ? '/api/admin/community/reports' : '/api/admin/community/appeals'
    const params = new URLSearchParams({
      status: status.value,
      page: String(page.value),
      pageSize: String(pageSize)
    })
    const data = await $fetch(`${path}?${params.toString()}`)
    if (tab.value === 'reports') {
      reports.value = data?.reports || []
    } else {
      appeals.value = data?.appeals || []
    }
    Object.assign(stats, {
      PENDING: Number(data?.stats?.PENDING || 0),
      ACCEPTED: Number(data?.stats?.ACCEPTED || 0),
      REJECTED: Number(data?.stats?.REJECTED || 0),
      total: Number(data?.stats?.total || 0)
    })
    Object.assign(pagination, {
      page: Number(data?.pagination?.page || 1),
      total: Number(data?.pagination?.total || 0),
      totalPages: Number(data?.pagination?.totalPages || 1)
    })
  } catch (e) {
    error.value = true
    showToast(localizeServerError(e, '加载失败'), 'error')
  } finally {
    loading.value = false
  }
}

const switchTab = (value) => {
  if (tab.value === value) return
  tab.value = value
  page.value = 1
  load()
}

const switchStatus = (value) => {
  if (status.value === value) return
  status.value = value
  page.value = 1
  load()
}

const goPage = (value) => {
  if (value < 1 || value > pagination.totalPages) return
  page.value = value
  load()
}

const askReportAction = (report, action) => {
  const targetType = report.targetType
  let title = ''
  let message = ''
  let type = 'warning'
  if (action === 'ACCEPT_HIDE' && targetType === 'USER') {
    title = '影子封禁该用户'
    message = '该用户发布的内容将仅本人与管理员可见，确定处理？'
    type = 'info'
  } else if (action === 'ACCEPT_HIDE') {
    title = '隐藏该内容'
    message = '内容将转为待审核并从信息流隐藏，确定处理？'
    type = 'info'
  } else if (action === 'ACCEPT_DELETE') {
    title = '删除该内容'
    message = '内容将被软删除并归档保留 30 天，确定处理？'
    type = 'danger'
  } else {
    title = '驳回举报'
    message = '该举报将被标记为不成立，确定驳回？'
    type = 'warning'
  }
  Object.assign(actionConfirm, {
    show: true,
    loading: false,
    kind: 'report',
    targetType,
    id: report.id,
    action,
    type,
    title,
    message
  })
}

const askAppealAction = (appeal, action) => {
  let title = ''
  let message = ''
  let type = 'warning'
  if (action === 'ACCEPT' && appeal.targetType === 'MUTE') {
    title = '解除禁言'
    message = '该用户的禁言将被解除，确定处理？'
    type = 'info'
  } else if (action === 'ACCEPT') {
    title = '恢复内容'
    message = '该内容将从归档中恢复并重新展示，确定处理？'
    type = 'info'
  } else {
    title = '驳回申诉'
    message = '该申诉将被标记为不通过，确定驳回？'
    type = 'warning'
  }
  Object.assign(actionConfirm, {
    show: true,
    loading: false,
    kind: 'appeal',
    targetType: appeal.targetType,
    id: appeal.id,
    action,
    type,
    title,
    message
  })
}

const runAction = async (resultNote) => {
  if (!actionConfirm.id) return
  const isReport = actionConfirm.kind === 'report'
  const url = isReport
    ? `/api/admin/community/reports/${actionConfirm.id}/handle`
    : `/api/admin/community/appeals/${actionConfirm.id}/handle`
  actionConfirm.loading = true
  busyId.value = actionConfirm.id
  try {
    await $fetch(url, {
      method: 'POST',
      body: {
        action: actionConfirm.action,
        resultNote: String(resultNote || '').trim()
      }
    })
    showToast(isReport ? '举报已处理' : '申诉已处理', 'success')
    actionConfirm.show = false
    await load()
  } catch (e) {
    showToast(localizeServerError(e, '处理失败'), 'error')
  } finally {
    actionConfirm.loading = false
    busyId.value = 0
  }
}

watch(
  () => actionConfirm.show,
  (visible) => {
    if (!visible) busyId.value = 0
  }
)

onMounted(load)
</script>
