<template>
  <div ref="rootRef" class="notification-center">
    <button
      ref="triggerRef"
      :aria-expanded="isOpen"
      :aria-label="triggerLabel"
      aria-haspopup="dialog"
      :class="['nc-trigger', { active: isOpen }]"
      type="button"
      @click="togglePanel"
    >
      <Icon :size="20" name="bell" />
      <!-- 红点总数：社区 / 歌曲 / 系统未读之和 -->
      <span v-if="totalUnread > 0" class="nc-badge">{{
        totalUnread > 99 ? '99+' : totalUnread
      }}</span>
    </button>

    <Teleport to="body">
      <Transition name="nc-fade">
        <div
          v-if="isOpen"
          ref="panelRef"
          :style="panelStyle"
          aria-label="通知中心"
          class="nc-panel"
          role="dialog"
          @keydown.esc="closePanel"
        >
          <header class="nc-header">
            <div class="nc-header-title">
              <Icon :size="18" name="bell" />
              <h3>通知中心</h3>
              <span v-if="totalUnread > 0" class="nc-header-count">{{ totalUnread }} 条未读</span>
            </div>
            <div class="nc-header-actions">
              <button
                :disabled="markingRead || currentUnread <= 0"
                class="nc-text-button"
                type="button"
                @click="markAllRead"
              >
                <Icon :size="14" name="check" />
                <span>{{ markingRead ? '处理中...' : '全部已读' }}</span>
              </button>
              <button
                aria-label="关闭通知中心"
                class="nc-icon-button"
                type="button"
                @click="closePanel"
              >
                <Icon :size="15" name="close" />
              </button>
            </div>
          </header>

          <!-- 分类 tab：未读红点按分类展示 -->
          <div aria-label="通知分类" class="nc-tabs" role="tablist">
            <button
              v-for="tab in CATEGORY_TABS"
              :key="tab.key"
              :aria-selected="activeCategory === tab.key"
              :class="['nc-tab', { active: activeCategory === tab.key }]"
              role="tab"
              type="button"
              @click="changeCategory(tab.key)"
            >
              <span>{{ tab.label }}</span>
              <span v-if="counts.unread[tab.key] > 0" class="nc-tab-dot">{{
                counts.unread[tab.key] > 99 ? '99+' : counts.unread[tab.key]
              }}</span>
            </button>
          </div>

          <div class="nc-toolbar">
            <label class="nc-unread-toggle">
              <input v-model="unreadOnly" type="checkbox" @change="reloadList" />
              <span>仅看未读</span>
            </label>
            <button :disabled="loading" class="nc-text-button" type="button" @click="refreshAll">
              <Icon :size="14" name="refresh" />
              <span>刷新</span>
            </button>
          </div>

          <div class="nc-body">
            <div v-if="loading" class="nc-state">
              <AppSpinner :size="26" />
              <span>加载中...</span>
            </div>
            <div v-else-if="error" class="nc-state nc-state-error">
              <Icon :size="22" name="error" />
              <span>{{ error }}</span>
              <button class="nc-retry" type="button" @click="refreshAll">重试</button>
            </div>
            <div v-else-if="items.length === 0" class="nc-state nc-state-empty">
              <Icon :size="30" name="bell" />
              <span>{{ emptyText }}</span>
            </div>
            <ul v-else class="nc-list">
              <li v-for="item in items" :key="item.id">
                <button
                  :class="['nc-item', { unread: !item.read }]"
                  :disabled="processingIds.has(item.id)"
                  type="button"
                  @click="handleItemClick(item)"
                >
                  <span class="nc-item-icon" :style="{ color: iconColorOf(item.type) }">
                    <Icon :size="17" :name="iconNameOf(item.type)" />
                  </span>
                  <span class="nc-item-main">
                    <span class="nc-item-head">
                      <span class="nc-item-title">{{ typeLabelOf(item) }}</span>
                      <span class="nc-item-time">{{ formatTime(item.createdAt) }}</span>
                    </span>
                    <span class="nc-item-message">{{ item.message }}</span>
                    <span v-if="item.target?.path" class="nc-item-jump">查看详情</span>
                  </span>
                  <span v-if="!item.read" class="nc-item-unread-dot" />
                </button>
              </li>
            </ul>
          </div>

          <footer class="nc-footer">
            <button
              v-if="hasMore"
              :disabled="loadingMore"
              class="nc-load-more"
              type="button"
              @click="loadMore"
            >
              {{ loadingMore ? '加载中...' : '加载更多' }}
            </button>
            <button class="nc-view-all" type="button" @click="viewAllNotifications">
              查看全部通知
            </button>
          </footer>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
/**
 * 自包含通知中心（无需 props）：
 * - 铃铛入口 + 未读红点（/api/notifications/unread-count 按分类计数）
 * - 下拉面板：分类 tab（全部/社区/歌曲/系统）、仅看未读、游标分页加载、全部已读
 * - 点击通知：先标记已读（/api/notifications/[id]/read），再按通知自带 target.path 跳转
 * - 打开面板与轮询时刷新计数；接口异常只影响面板，不阻断页面
 *
 * 组件不依赖 index.vue 的通知抽屉，也不改动其实现；文案暂为组件内中文常量，
 * 待 locale 文件解冻后可迁移到 app/utils/locale 的 notificationCenter 词条。
 */
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import Icon from '~/components/UI/Icon.vue'
import AppSpinner from '~/components/UI/Common/AppSpinner.vue'
import { useAuth } from '~/composables/useAuth'
import { useToast } from '~/composables/useToast'

type Category = 'all' | 'community' | 'song' | 'system'
type CategoryCounts = Record<Category, number>

interface NotificationTarget {
  category: Exclude<Category, 'all'>
  path: string | null
}

interface NotificationItem {
  id: number
  createdAt: string
  type: string
  source?: string
  title?: string | null
  message: string
  read: boolean
  songId?: number | null
  category?: Exclude<Category, 'all'>
  target?: NotificationTarget
}

interface NotificationCountsPayload {
  unread?: CategoryCounts
  total?: CategoryCounts
}

interface NotificationListPayload {
  notifications?: NotificationItem[]
  pagination?: {
    hasMore?: boolean
    nextCursor?: number | null
  }
}

const emit = defineEmits<{
  (e: 'open' | 'close'): void
  (e: 'navigate', path: string): void
  (e: 'unread-change', unread: CategoryCounts): void
}>()

const PAGE_SIZE = 20
const POLL_INTERVAL = 60 * 1000
const VIEW_ALL_PATH = '/?tab=notification'

const CATEGORY_TABS: Array<{ key: Category; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'community', label: '社区' },
  { key: 'song', label: '歌曲' },
  { key: 'system', label: '系统' }
]

// 通知类型 → 展示标题（新增 COMMUNITY_COMMENT_REPLY / COMMUNITY_MENTION）
const TYPE_LABELS: Record<string, string> = {
  SONG_SELECTED: '歌曲已选中',
  SONG_PLAYED: '歌曲已播放',
  SONG_VOTED: '收到新投票',
  SONG_REJECTED: '歌曲被驳回',
  REPLAY_REJECTED: '重播申请被驳回',
  COLLABORATION_INVITE: '联合投稿邀请',
  COLLABORATION_RESPONSE: '联合投稿回复',
  COMMUNITY_COMMENT: '回声社区新评论',
  COMMUNITY_COMMENT_REPLY: '有人回复了你的评论',
  COMMUNITY_MENTION: '有人在评论中提到了你',
  COMMUNITY_COMMENT_APPROVED: '评论已通过审核',
  COMMUNITY_COMMENT_REJECTED: '评论未通过审核',
  COMMUNITY_COMMENT_REMOVED: '评论已被移除',
  COMMUNITY_POST_LIKE: '社区帖子收到点赞',
  COMMUNITY_POST_APPROVED: '社区帖子已通过',
  COMMUNITY_POST_REJECTED: '社区帖子未通过',
  COMMUNITY_POST_REMOVED: '社区帖子被移除',
  COMMUNITY_MUTED: '社区禁言',
  COMMUNITY_UNMUTED: '社区解禁',
  COMMUNITY_RESONANCE: '社区共鸣',
  SYSTEM_NOTICE: '系统通知',
  SYSTEM: '系统通知'
}

const { isAuthenticated, getAuthConfig } = useAuth()
const { showToast } = useToast()

const rootRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const panelStyle = ref<Record<string, string>>({})

const isOpen = ref(false)
const activeCategory = ref<Category>('all')
const unreadOnly = ref(false)
const items = ref<NotificationItem[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const markingRead = ref(false)
const error = ref('')
const hasMore = ref(false)
const nextCursor = ref<number | null>(null)
// 正在标记已读的通知 id，避免重复点击
const processingIds = ref<Set<number>>(new Set())

const emptyCounts = (): CategoryCounts => ({ all: 0, community: 0, song: 0, system: 0 })
const counts = reactive({ unread: emptyCounts(), total: emptyCounts() })

const totalUnread = computed(() => counts.unread.all)
const currentUnread = computed(() => counts.unread[activeCategory.value] || 0)
const triggerLabel = computed(() =>
  totalUnread.value > 0 ? `通知中心，${totalUnread.value} 条未读` : '通知中心'
)
const emptyText = computed(() => {
  if (unreadOnly.value) return '当前分类没有未读通知'
  if (activeCategory.value === 'all') return '暂无通知'
  return '当前分类暂无通知'
})

/* ---------------------------------- 数据加载 ---------------------------------- */

const resetCounts = () => {
  Object.assign(counts.unread, emptyCounts())
  Object.assign(counts.total, emptyCounts())
}

const applyCounts = (payload: NotificationCountsPayload) => {
  if (payload?.unread) Object.assign(counts.unread, payload.unread)
  if (payload?.total) Object.assign(counts.total, payload.total)
  emit('unread-change', { ...counts.unread })
}

/** 拉取分类未读/总数（红点），失败静默，避免首页因通知接口异常弹错 */
const fetchCounts = async () => {
  if (!import.meta.client || !isAuthenticated.value) return
  try {
    const data = await $fetch<NotificationCountsPayload>('/api/notifications/unread-count', {
      ...getAuthConfig()
    })
    applyCounts(data || {})
  } catch (err) {
    console.warn('获取通知未读数失败:', err)
  }
}

const fetchList = async (reset = true) => {
  if (!import.meta.client) return
  if (!isAuthenticated.value) {
    items.value = []
    hasMore.value = false
    nextCursor.value = null
    return
  }
  if (reset) {
    loading.value = true
  } else {
    loadingMore.value = true
  }
  error.value = ''
  try {
    const data = await $fetch<NotificationListPayload>('/api/notifications/list', {
      query: {
        category: activeCategory.value,
        unreadOnly: unreadOnly.value ? 'true' : undefined,
        limit: PAGE_SIZE,
        beforeId: reset ? undefined : (nextCursor.value ?? undefined)
      },
      ...getAuthConfig()
    })
    const list = data?.notifications || []
    items.value = reset ? list : [...items.value, ...list]
    hasMore.value = Boolean(data?.pagination?.hasMore)
    nextCursor.value = data?.pagination?.nextCursor ?? null
  } catch (err) {
    console.warn('获取通知列表失败:', err)
    if (reset) items.value = []
    error.value = '通知加载失败，请稍后重试'
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

const refreshAll = async () => {
  await Promise.all([fetchCounts(), fetchList(true)])
}

const reloadList = async () => {
  await fetchList(true)
}

const loadMore = async () => {
  if (!hasMore.value || loadingMore.value) return
  await fetchList(false)
}

/* ---------------------------------- 交互动作 ---------------------------------- */

const changeCategory = async (category: Category) => {
  if (activeCategory.value === category) return
  activeCategory.value = category
  await fetchList(true)
}

const applyReadLocally = (item: NotificationItem) => {
  const category = item.category || 'system'
  counts.unread.all = Math.max(0, counts.unread.all - 1)
  counts.unread[category] = Math.max(0, counts.unread[category] - 1)
  emit('unread-change', { ...counts.unread })
}

const navigateToPath = (path: string) => {
  emit('navigate', path)
  closePanel()
  if (import.meta.client) {
    // 首页 tab 只由 onMounted 的 ?tab= 读取，这里用整页跳转保证任何页面都能落到目标 tab
    window.location.assign(path)
  }
}

const handleItemClick = async (item: NotificationItem) => {
  if (processingIds.value.has(item.id)) return
  const path = item.target?.path || null
  if (!item.read) {
    processingIds.value.add(item.id)
    try {
      await $fetch(`/api/notifications/${item.id}/read`, {
        method: 'POST',
        ...getAuthConfig()
      })
      item.read = true
      applyReadLocally(item)
    } catch (err) {
      console.warn('标记通知已读失败:', err)
      showToast('标记通知已读失败，请稍后重试', 'error')
    } finally {
      processingIds.value.delete(item.id)
    }
  }
  if (path) navigateToPath(path)
}

/** 全部已读：只清空当前 tab 分类（all = 真正全部），与后端 category 参数一致 */
const markAllRead = async () => {
  if (markingRead.value || currentUnread.value <= 0) return
  markingRead.value = true
  const target = activeCategory.value
  try {
    const data = await $fetch<NotificationCountsPayload>('/api/notifications/read-all', {
      method: 'POST',
      query: { category: target },
      ...getAuthConfig()
    })
    if (data?.unread) Object.assign(counts.unread, data.unread)
    if (data?.total) Object.assign(counts.total, data.total)
    emit('unread-change', { ...counts.unread })
    if (unreadOnly.value) {
      // 仅看未读时清空后列表应变为空，直接重新拉取
      await fetchList(true)
    } else {
      items.value = items.value.map((item) =>
        target === 'all' || item.category === target ? { ...item, read: true } : item
      )
    }
    showToast(target === 'all' ? '已将全部通知标记为已读' : '已将当前分类通知标记为已读', 'success')
  } catch (err) {
    console.warn('标记全部已读失败:', err)
    showToast('标记全部已读失败，请稍后重试', 'error')
  } finally {
    markingRead.value = false
  }
}

const viewAllNotifications = () => {
  emit('navigate', VIEW_ALL_PATH)
  closePanel()
  if (import.meta.client) window.location.assign(VIEW_ALL_PATH)
}

/* ---------------------------------- 面板开合/定位 ---------------------------------- */

const updatePanelPosition = () => {
  if (!import.meta.client) return
  const triggerRect = triggerRef.value?.getBoundingClientRect()
  if (!triggerRect) return
  const width = Math.min(380, Math.max(260, window.innerWidth - 24))
  const left = Math.max(12, Math.min(triggerRect.right - width, window.innerWidth - width - 12))
  panelStyle.value = {
    top: `${triggerRect.bottom + 8}px`,
    left: `${left}px`,
    width: `${width}px`
  }
}

const handleDocumentPointerDown = (event: MouseEvent) => {
  const target = event.target as Node | null
  if (!target) return
  if (rootRef.value?.contains(target) || panelRef.value?.contains(target)) return
  closePanel()
}

const addPanelListeners = () => {
  if (!import.meta.client) return
  document.addEventListener('mousedown', handleDocumentPointerDown)
  window.addEventListener('resize', updatePanelPosition)
  window.addEventListener('scroll', updatePanelPosition, true)
}

const removePanelListeners = () => {
  if (!import.meta.client) return
  document.removeEventListener('mousedown', handleDocumentPointerDown)
  window.removeEventListener('resize', updatePanelPosition)
  window.removeEventListener('scroll', updatePanelPosition, true)
}

const openPanel = async () => {
  if (!import.meta.client) return
  if (!isAuthenticated.value) {
    showToast('请先登录后查看通知', 'info')
    return
  }
  isOpen.value = true
  emit('open')
  await nextTick()
  updatePanelPosition()
  addPanelListeners()
  await refreshAll()
}

const closePanel = () => {
  if (!isOpen.value) return
  isOpen.value = false
  emit('close')
  removePanelListeners()
}

const togglePanel = () => {
  if (isOpen.value) closePanel()
  else openPanel()
}

/* ---------------------------------- 展示辅助 ---------------------------------- */

const typeLabelOf = (item: NotificationItem) =>
  TYPE_LABELS[item.type] || TYPE_LABELS[item.category || ''] || '通知'

const iconNameOf = (type: string): string => {
  if (type.startsWith('COMMUNITY_MENTION')) return 'user'
  if (type.startsWith('COMMUNITY_COMMENT') || type === 'COMMUNITY_POST_LIKE')
    return 'message-circle'
  if (type.startsWith('COMMUNITY_')) return 'users'
  if (type === 'SONG_PLAYED') return 'play'
  if (type === 'SONG_SELECTED') return 'check'
  if (type === 'SONG_VOTED') return 'thumbs-up'
  if (type === 'SONG_REJECTED' || type === 'REPLAY_REJECTED') return 'x-circle'
  if (type.startsWith('COLLABORATION_')) return 'users'
  if (type === 'SYSTEM_NOTICE' || type === 'SYSTEM') return 'info'
  return 'bell'
}

const iconColorOf = (type: string): string => {
  if (type === 'COMMUNITY_MENTION' || type === 'COMMUNITY_COMMENT_REPLY') {
    return 'var(--color-accent-light)'
  }
  if (type.startsWith('COMMUNITY_')) return 'var(--color-accent)'
  if (type === 'SONG_REJECTED' || type === 'REPLAY_REJECTED') return 'var(--color-error)'
  if (type === 'SONG_PLAYED' || type === 'SONG_SELECTED') return 'var(--color-success)'
  if (type === 'SONG_VOTED') return 'var(--color-warning)'
  if (type.startsWith('COLLABORATION_')) return 'var(--color-collab)'
  return 'var(--text-tertiary)'
}

const formatTime = (value: string): string => {
  const date = new Date(value)
  const diff = Date.now() - date.getTime()
  if (!Number.isFinite(diff)) return ''
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))} 分钟前`
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))} 小时前`
  if (diff < 30 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / (24 * 60 * 60 * 1000))} 天前`
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/* ---------------------------------- 生命周期 ---------------------------------- */

let pollTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  fetchCounts()
  // 轮询只在面板关闭时刷新红点，避免打断正在浏览的列表
  pollTimer = setInterval(() => {
    if (document.hidden || isOpen.value) return
    fetchCounts()
  }, POLL_INTERVAL)
})

onUnmounted(() => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  removePanelListeners()
})

watch(isAuthenticated, (authenticated) => {
  if (authenticated) {
    fetchCounts()
    if (isOpen.value) fetchList(true)
    return
  }
  isOpen.value = false
  items.value = []
  resetCounts()
  removePanelListeners()
})
</script>

<style scoped>
.notification-center {
  position: relative;
  display: inline-flex;
  align-items: center;
}

/* 触发按钮 */
.nc-trigger {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border: 1px solid var(--overlay-8);
  border-radius: 12px;
  background: var(--overlay-4);
  color: var(--text-secondary);
  cursor: pointer;
  transition:
    background 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease,
    transform 0.2s ease;
}

.nc-trigger:hover,
.nc-trigger.active {
  border-color: var(--color-accent-alpha-22);
  background: var(--color-accent-alpha-10);
  color: var(--color-accent-light);
}

.nc-trigger:active {
  transform: scale(0.96);
}

.nc-badge {
  position: absolute;
  top: -5px;
  right: -5px;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: 9px;
  background: var(--color-error);
  color: #ffffff;
  font-size: 0.625rem;
  font-weight: 800;
  line-height: 17px;
  text-align: center;
  box-shadow: 0 0 0 2px var(--bg-primary);
}

/* 面板 */
.nc-panel {
  position: fixed;
  z-index: 2140;
  display: flex;
  flex-direction: column;
  max-height: min(560px, calc(100vh - 96px));
  border: 1px solid var(--overlay-10);
  border-radius: 18px;
  background: var(--bg-secondary-95);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(20px);
  overflow: hidden;
}

.nc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.9rem 1rem 0.75rem;
  border-bottom: 1px solid var(--overlay-6);
}

.nc-header-title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.45rem;
  color: var(--text-primary);
}

.nc-header-title h3 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
}

.nc-header-count {
  border-radius: 999px;
  background: var(--color-accent-alpha-12);
  padding: 0.1rem 0.45rem;
  color: var(--color-accent-light);
  font-size: 0.68rem;
  font-weight: 700;
  white-space: nowrap;
}

.nc-header-actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
}

.nc-text-button {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  border: 1px solid var(--color-accent-alpha-22);
  border-radius: 9px;
  background: var(--color-accent-alpha-10);
  padding: 0.32rem 0.55rem;
  color: var(--color-accent-light);
  font-size: 0.72rem;
  font-weight: 700;
  cursor: pointer;
  transition:
    background 0.2s ease,
    opacity 0.2s ease;
}

.nc-text-button:hover:not(:disabled) {
  background: var(--color-accent-alpha-20);
}

.nc-text-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.nc-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 9px;
  background: var(--overlay-4);
  color: var(--text-tertiary);
  cursor: pointer;
  transition:
    background 0.2s ease,
    color 0.2s ease;
}

.nc-icon-button:hover {
  background: var(--overlay-8);
  color: var(--text-primary);
}

/* 分类 tab */
.nc-tabs {
  display: flex;
  gap: 0.35rem;
  padding: 0.6rem 1rem 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.nc-tabs::-webkit-scrollbar {
  display: none;
}

.nc-tab {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 0.3rem;
  border: 1px solid transparent;
  border-radius: 999px;
  background: var(--overlay-4);
  padding: 0.32rem 0.7rem;
  color: var(--overlay-55);
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
  transition:
    background 0.2s ease,
    color 0.2s ease;
}

.nc-tab:hover:not(.active) {
  background: var(--overlay-8);
  color: var(--overlay-85);
}

.nc-tab.active {
  border-color: var(--color-accent-alpha-22);
  background: var(--color-accent-alpha-12);
  color: var(--color-accent-light);
}

.nc-tab-dot {
  min-width: 15px;
  border-radius: 999px;
  background: var(--color-error);
  padding: 0 4px;
  color: #ffffff;
  font-size: 0.6rem;
  font-weight: 800;
  line-height: 15px;
  text-align: center;
}

/* 工具栏 */
.nc-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.55rem 1rem 0.6rem;
  border-bottom: 1px solid var(--overlay-6);
}

.nc-unread-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--text-tertiary);
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
}

.nc-unread-toggle input {
  width: 14px;
  height: 14px;
  accent-color: var(--color-accent);
  cursor: pointer;
}

/* 列表 */
.nc-body {
  flex: 1;
  overflow-y: auto;
  padding: 0.55rem;
  min-height: 120px;
}

.nc-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  padding: 2.2rem 0;
  color: var(--overlay-45);
  font-size: 0.78rem;
}

.nc-state-error {
  color: var(--color-error-light);
}

.nc-retry {
  border: 1px solid var(--error-20);
  border-radius: 8px;
  background: var(--error-10);
  padding: 0.25rem 0.6rem;
  color: var(--color-error-light);
  font-size: 0.72rem;
  font-weight: 700;
  cursor: pointer;
}

.nc-list {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.nc-item {
  display: flex;
  width: 100%;
  align-items: flex-start;
  gap: 0.6rem;
  border: 1px solid var(--overlay-4);
  border-radius: 13px;
  background: var(--overlay-2);
  padding: 0.6rem 0.65rem;
  text-align: left;
  cursor: pointer;
  transition:
    background 0.18s ease,
    border-color 0.18s ease;
}

.nc-item:hover:not(:disabled) {
  border-color: var(--overlay-10);
  background: var(--overlay-6);
}

.nc-item.unread {
  border-color: var(--primary-20);
  background: var(--primary-5);
}

.nc-item:disabled {
  opacity: 0.7;
  cursor: progress;
}

.nc-item-icon {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: var(--overlay-5);
}

.nc-item-main {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 0.18rem;
}

.nc-item-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}

.nc-item-title {
  min-width: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 0.78rem;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nc-item-time {
  flex-shrink: 0;
  color: var(--text-tertiary);
  font-size: 0.65rem;
}

.nc-item-message {
  display: -webkit-box;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 0.72rem;
  line-height: 1.45;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.nc-item-jump {
  color: var(--color-accent-light);
  font-size: 0.66rem;
  font-weight: 700;
}

.nc-item-unread-dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  margin-top: 0.35rem;
  border-radius: 50%;
  background: var(--color-error);
}

/* 底部 */
.nc-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.55rem 1rem 0.7rem;
  border-top: 1px solid var(--overlay-6);
}

.nc-load-more,
.nc-view-all {
  border-radius: 9px;
  padding: 0.32rem 0.6rem;
  font-size: 0.72rem;
  font-weight: 700;
  cursor: pointer;
  transition:
    background 0.2s ease,
    opacity 0.2s ease;
}

.nc-load-more {
  border: 1px solid var(--overlay-10);
  background: var(--overlay-4);
  color: var(--text-secondary);
}

.nc-view-all {
  margin-left: auto;
  border: 1px solid var(--color-accent-alpha-22);
  background: var(--color-accent-alpha-10);
  color: var(--color-accent-light);
}

.nc-view-all:hover {
  background: var(--color-accent-alpha-20);
}

.nc-load-more:hover:not(:disabled) {
  background: var(--overlay-8);
}

.nc-load-more:disabled {
  opacity: 0.5;
  cursor: progress;
}

/* 过渡 */
.nc-fade-enter-active,
.nc-fade-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}

.nc-fade-enter-from,
.nc-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* 移动端：贴底弹出成抽屉 */
@media (max-width: 640px) {
  .nc-panel {
    top: auto !important;
    right: 10px !important;
    bottom: 10px !important;
    left: 10px !important;
    width: auto !important;
    max-height: min(72vh, 560px);
  }
}
</style>
