<template>
  <div class="achievement-card">
    <div v-if="loading" class="achievement-state">
      <Loader2 class="animate-spin" :size="18" />
      <span>加载成就…</span>
    </div>

    <div v-else-if="error || !data" class="achievement-state">
      <AlertTriangle :size="18" />
      <span>成就信息加载失败</span>
      <button class="achievement-retry" type="button" @click="load">重试</button>
    </div>

    <template v-else>
      <!-- 等级 -->
      <div class="level-row">
        <div class="level-badge">
          <span class="level-number">Lv.{{ data.level?.level ?? 1 }}</span>
        </div>
        <div class="level-main">
          <div class="level-title-row">
            <span class="level-name">{{ data.level?.levelName || '校园新声' }}</span>
            <span class="level-score">{{ data.level?.score ?? 0 }} 活跃分</span>
          </div>
          <div class="level-progress">
            <div
              class="level-progress-fill"
              :style="{ width: `${Math.round((data.level?.progress ?? 0) * 100)}%` }"
            />
          </div>
          <p class="level-hint">
            <template v-if="data.level?.nextThreshold == null">已达最高等级</template>
            <template v-else>
              距「{{ data.level.nextLevelName }}」还需 {{ data.level.remaining }} 分
            </template>
          </p>
        </div>
      </div>

      <!-- 称号徽章 -->
      <div class="badge-section">
        <p class="section-title">称号徽章</p>
        <div v-if="data.badges?.length" class="badge-list">
          <span
            v-for="badge in data.badges"
            :key="badge.id"
            class="badge-chip"
            :class="{ equipped: badge.equipped }"
            :title="badge.description || badge.name"
          >
            <Award :size="12" />
            {{ badge.name }}
            <span v-if="badge.equipped" class="badge-equipped">佩戴中</span>
          </span>
        </div>
        <p v-else class="empty-text">还没有获得称号</p>
      </div>

      <!-- 统计 -->
      <div class="stat-grid">
        <div class="stat-item">
          <span class="stat-value">{{ data.stats?.posts ?? 0 }}</span>
          <span class="stat-label">帖子</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{{ data.stats?.comments ?? 0 }}</span>
          <span class="stat-label">评论</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{{ data.stats?.postLikesReceived ?? 0 }}</span>
          <span class="stat-label">帖子获赞</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{{ data.stats?.songLikesReceived ?? 0 }}</span>
          <span class="stat-label">歌曲获赞</span>
        </div>
      </div>

      <div class="meta-row">
        <span class="meta-item">
          <Sparkles :size="12" /> 共鸣 {{ data.resonanceCount ?? 0 }} 次
        </span>
        <span v-if="data.joinedAt" class="meta-item"
          >加入于 {{ formatJoinDate(data.joinedAt) }}</span
        >
      </div>

      <p v-if="data.blockedByMe || data.blockedMe" class="blocked-hint">
        {{ data.blockedByMe ? '你已拉黑该用户' : '该用户已拉黑你' }}
      </p>
    </template>
  </div>
</template>

<script setup>
import { onMounted, ref, watch } from 'vue'
import { AlertTriangle, Award, Loader2, Sparkles } from '@lucide/vue'

/**
 * 用户社区成就卡片。
 * 组件内部按 userId 自行请求 /api/community/users/:id，父组件只需传 userId。
 */
const props = defineProps({
  userId: {
    type: Number,
    required: true
  },
  /** 可选：外部已有资料时直接传入，避免重复请求 */
  initialData: {
    type: Object,
    default: null
  }
})

const data = ref(props.initialData)
const loading = ref(!props.initialData)
const error = ref(false)

const load = async () => {
  if (!props.userId) {
    loading.value = false
    return
  }
  if (!props.initialData) loading.value = true
  error.value = false
  try {
    const result = await $fetch(`/api/community/users/${props.userId}`)
    data.value = result
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
}

const formatJoinDate = (value) => {
  if (!value) return ''
  try {
    return new Date(value).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
  } catch {
    return ''
  }
}

watch(
  () => props.userId,
  () => {
    data.value = null
    load()
  }
)

onMounted(load)
</script>

<style scoped>
.achievement-card {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding: 1rem;
  border-radius: 1rem;
  background: var(--panel-bg-elevated);
  border: 1px solid var(--overlay-6);
}

.achievement-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 1.5rem 0;
  font-size: 0.72rem;
  color: var(--text-tertiary);
}

.achievement-retry {
  border: 1px solid var(--overlay-10);
  border-radius: 0.5rem;
  padding: 0.15rem 0.5rem;
  font-size: 0.66rem;
  color: var(--text-secondary);
}

.level-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.level-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 2.8rem;
  height: 2.8rem;
  border-radius: 999px;
  background: var(--color-accent-alpha-15);
  border: 1px solid var(--overlay-8);
}

.level-number {
  font-size: 0.72rem;
  font-weight: 900;
  color: var(--color-accent);
}

.level-main {
  flex: 1 1 auto;
  min-width: 0;
}

.level-title-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}

.level-name {
  font-size: 0.84rem;
  font-weight: 900;
  color: var(--text-primary);
}

.level-score {
  font-size: 0.62rem;
  font-weight: 700;
  color: var(--text-tertiary);
}

.level-progress {
  height: 0.35rem;
  margin-top: 0.4rem;
  border-radius: 999px;
  overflow: hidden;
  background: var(--overlay-6);
}

.level-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--color-accent);
  transition: width 0.3s ease;
}

.level-hint {
  margin-top: 0.3rem;
  font-size: 0.62rem;
  color: var(--text-tertiary);
}

.badge-section {
  padding-top: 0.75rem;
  border-top: 1px solid var(--overlay-4);
}

.section-title {
  font-size: 0.62rem;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-disabled);
}

.badge-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.45rem;
}

.badge-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  border: 1px solid var(--overlay-8);
  background: var(--overlay-4);
  font-size: 0.66rem;
  font-weight: 800;
  color: var(--text-secondary);
}

.badge-chip.equipped {
  border-color: var(--color-accent-alpha-25);
  background: var(--color-accent-alpha-10);
  color: var(--color-accent);
}

.badge-equipped {
  font-size: 0.56rem;
  font-weight: 700;
  opacity: 0.8;
}

.empty-text {
  margin-top: 0.45rem;
  font-size: 0.66rem;
  color: var(--text-tertiary);
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.5rem;
  padding: 0.7rem 0;
  border-top: 1px solid var(--overlay-4);
  border-bottom: 1px solid var(--overlay-4);
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  text-align: center;
}

.stat-value {
  font-size: 0.94rem;
  font-weight: 900;
  color: var(--text-primary);
}

.stat-label {
  font-size: 0.58rem;
  color: var(--text-tertiary);
}

.meta-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}

.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.64rem;
  color: var(--text-tertiary);
}

.blocked-hint {
  font-size: 0.64rem;
  color: var(--color-warning, #f0a020);
}
</style>
