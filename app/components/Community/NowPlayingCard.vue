<template>
  <section class="now-playing-card">
    <header class="now-head">
      <h3 class="now-title">
        <Radio :size="14" class="now-title-icon" />
        正在播放
      </h3>
      <span v-if="playing" class="now-live-badge">
        <span class="now-live-dot" />
        {{ source === 'live' ? '直播' : '节目单' }}
      </span>
    </header>

    <div v-if="loading && !loaded" class="now-state">
      <Loader2 class="animate-spin" :size="16" />
      <span>读取播放状态…</span>
    </div>

    <template v-else-if="song">
      <NuxtLink v-if="showLink" class="now-main" to="/?tab=schedule">
        <div class="now-cover">
          <img v-if="song.cover" :src="song.cover" :alt="song.title" loading="lazy">
          <Music v-else :size="18" />
        </div>
        <div class="now-info">
          <p class="now-song-title">{{ song.title }}</p>
          <p class="now-song-artist">{{ song.artist }}</p>
          <p v-if="song.requesterName" class="now-requester">点歌：{{ song.requesterName }}</p>
        </div>
      </NuxtLink>
      <div v-else class="now-main">
        <div class="now-cover">
          <img v-if="song.cover" :src="song.cover" :alt="song.title" loading="lazy">
          <Music v-else :size="18" />
        </div>
        <div class="now-info">
          <p class="now-song-title">{{ song.title }}</p>
          <p class="now-song-artist">{{ song.artist }}</p>
          <p v-if="song.requesterName" class="now-requester">点歌：{{ song.requesterName }}</p>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="now-idle">
        <Music :size="18" />
        <div>
          <p class="now-idle-title">暂无节目</p>
          <p class="now-idle-desc">当前没有正在播出的歌曲</p>
        </div>
      </div>
      <div v-if="next" class="now-next">
        <p class="now-next-label">下一首</p>
        <p class="now-next-title">{{ next.song?.title }} - {{ next.song?.artist }}</p>
        <p class="now-next-meta">
          {{ next.date }}<template v-if="next.playTimeName"> · {{ next.playTimeName }}</template>
        </p>
      </div>
    </template>

    <NuxtLink v-if="showLink" class="now-link" to="/?tab=schedule">
      <span>查看节目单</span>
      <ChevronRight :size="12" />
    </NuxtLink>
  </section>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ChevronRight, Loader2, Music, Radio } from '@lucide/vue'

/**
 * 社区侧栏「正在播放」卡片。
 * 自行请求 /api/community/now-playing 并定时刷新；无播放或接口异常时显示「暂无节目」。
 */
const props = defineProps({
  /** 刷新间隔（毫秒），默认 30 秒 */
  refreshMs: {
    type: Number,
    default: 30000
  },
  /** 是否展示跳转节目单的链接 */
  showLink: {
    type: Boolean,
    default: true
  }
})

const playing = ref(false)
const source = ref('none')
const song = ref(null)
const next = ref(null)
const loading = ref(true)
const loaded = ref(false)

let timer = null

const load = async () => {
  try {
    const data = await $fetch('/api/community/now-playing')
    playing.value = !!data?.playing
    source.value = data?.source || 'none'
    song.value = data?.song || null
    next.value = data?.next || null
  } catch {
    playing.value = false
    song.value = null
    next.value = null
  } finally {
    loading.value = false
    loaded.value = true
  }
}

onMounted(() => {
  load()
  const interval = Number(props.refreshMs) > 0 ? Number(props.refreshMs) : 30000
  timer = setInterval(load, interval)
})

onBeforeUnmount(() => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
})
</script>

<style scoped>
.now-playing-card {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  padding: 1rem;
  border-radius: 1rem;
  background: var(--panel-bg-elevated);
  border: 1px solid var(--overlay-6);
}

.now-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.now-title {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.72rem;
  font-weight: 900;
  color: var(--text-primary);
}

.now-title-icon {
  color: var(--color-accent);
}

.now-live-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  background: var(--color-accent-alpha-10);
  border: 1px solid var(--color-accent-alpha-25);
  font-size: 0.58rem;
  font-weight: 800;
  color: var(--color-accent);
}

.now-live-dot {
  width: 0.32rem;
  height: 0.32rem;
  border-radius: 999px;
  background: var(--color-accent);
  animation: now-pulse 1.4s ease-in-out infinite;
}

@keyframes now-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

.now-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  padding: 0.9rem 0;
  font-size: 0.66rem;
  color: var(--text-tertiary);
}

.now-main {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  text-decoration: none;
}

.now-cover {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 2.8rem;
  height: 2.8rem;
  border-radius: 0.7rem;
  overflow: hidden;
  background: var(--color-accent-alpha-15);
  color: var(--color-accent);
}

.now-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.now-info {
  min-width: 0;
  flex: 1 1 auto;
}

.now-song-title {
  font-size: 0.76rem;
  font-weight: 800;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.now-song-artist {
  margin-top: 0.1rem;
  font-size: 0.64rem;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.now-requester {
  margin-top: 0.1rem;
  font-size: 0.58rem;
  color: var(--text-disabled);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.now-idle {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.75rem;
  border-radius: 0.7rem;
  background: var(--overlay-4);
  color: var(--text-tertiary);
}

.now-idle-title {
  font-size: 0.72rem;
  font-weight: 800;
  color: var(--text-secondary);
}

.now-idle-desc {
  margin-top: 0.1rem;
  font-size: 0.6rem;
  color: var(--text-tertiary);
}

.now-next {
  padding: 0.6rem 0.75rem;
  border-radius: 0.7rem;
  border: 1px dashed var(--overlay-8);
}

.now-next-label {
  font-size: 0.56rem;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-disabled);
}

.now-next-title {
  margin-top: 0.2rem;
  font-size: 0.66rem;
  font-weight: 700;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.now-next-meta {
  margin-top: 0.1rem;
  font-size: 0.58rem;
  color: var(--text-disabled);
}

.now-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.2rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--overlay-4);
  font-size: 0.64rem;
  font-weight: 700;
  color: var(--text-tertiary);
  text-decoration: none;
}

.now-link:hover {
  color: var(--color-accent);
}
</style>
