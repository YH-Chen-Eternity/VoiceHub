<!--
Copyright (C) 2026 YH-Chen

This file is part of VoiceHub-Plus (an unofficial community edition),
based on VoiceHub <https://github.com/laoshuikaixue/VoiceHub>.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
-->
<template>
  <!--
    首页顶部公告栏：文字或图片，多条自动轮播。
    设计取向：**克制**——单行高度；文字过长时横向滚动（跑马灯）而不是被省略号截断；
    窄屏自动降字号/降图片高度，不抢首屏内容。
  -->
  <div v-if="items.length" class="announcement-bar" :class="['size-' + (current.fontSize || 'MEDIUM').toLowerCase(), { 'is-paused': paused }]">
    <div class="announcement-inner">
      <button
        v-if="items.length > 1"
        class="announcement-nav"
        type="button"
        aria-label="上一条"
        @click="prev"
      >
        <Icon name="chevron-left" :size="14" />
      </button>

      <component
        :is="current.linkUrl ? 'a' : 'div'"
        class="announcement-item"
        :href="current.linkUrl || undefined"
        :target="current.linkUrl ? '_blank' : undefined"
        :rel="current.linkUrl ? 'noopener noreferrer' : undefined"
        @mouseenter="pause" @mouseleave="resume"
      >
        <template v-if="current.type === 'IMAGE'">
          <img :src="current.imageUrl" :alt="current.text || '公告'" class="announcement-image" />
        </template>
        <template v-else>
          <Icon name="volume" :size="14" class="announcement-icon" />
          <!-- 分行完整显示模式：不滚动，按需分行全部显示 -->
          <div v-if="isWrap" class="announcement-wrap">
            <span class="announcement-text-wrap">{{ current.text }}</span>
          </div>
          <!-- 滚动模式：文字超宽时跑马灯；未超宽时静态居中 -->
          <div v-else ref="viewportRef" class="announcement-viewport" :class="{ 'is-scrolling': scrolling }">
            <div
              class="announcement-track"
              :class="{ 'is-scrolling': scrolling }"
              :style="scrolling ? { animationDuration: `${scrollSeconds}s` } : undefined"
            >
              <span ref="textRef" class="announcement-text">{{ current.text }}</span>
              <span v-if="scrolling" class="announcement-text" aria-hidden="true">{{ current.text }}</span>
            </div>
          </div>
        </template>
      </component>

      <button
        v-if="items.length > 1"
        class="announcement-nav"
        type="button"
        aria-label="下一条"
        @click="next"
      >
        <Icon name="chevron-right" :size="14" />
      </button>

      <div v-if="items.length > 1" class="announcement-dots">
        <button
          v-for="(item, index) in items"
          :key="item.id"
          class="announcement-dot"
          :class="{ 'is-active': index === activeIndex }"
          type="button"
          :aria-label="`第 ${index + 1} 条公告`"
          @click="goTo(index)"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const emit = defineEmits(['loaded'])

const items = ref([])
const activeIndex = ref(0)
const paused = ref(false)
const scrolling = ref(false)
const scrollSeconds = ref(18)
const viewportRef = ref(null)
const textRef = ref(null)

let rotateTimer = null

const current = computed(
  () => items.value[activeIndex.value] || { type: 'TEXT', text: '', imageUrl: '', linkUrl: '', displayMode: 'SCROLL', fontSize: 'MEDIUM' }
)

/** 该条公告是否为「分行完整显示」模式（后台每条可单独设置） */
const isWrap = computed(() => current.value?.type !== 'IMAGE' && current.value?.displayMode === 'WRAP')

/** 判断当前文字是否超出可视宽度；超出才滚动（短文本不动，避免晃眼） */
const measure = () => {
  scrolling.value = false
  // 图片、以及「分行完整显示」模式都不滚动
  if (current.value?.type === 'IMAGE' || isWrap.value) return
  nextTick(() => {
    const viewport = viewportRef.value
    const text = textRef.value
    if (!viewport || !text) return
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) return
    // 多留 8px 容差，避免边界抖动
    if (text.scrollWidth > viewport.clientWidth + 8) {
      // 速度约 55px/秒，长文本自动延长，短文本不会太快
      scrollSeconds.value = Math.min(60, Math.max(10, Math.round((text.scrollWidth + 120) / 55)))
      scrolling.value = true
    }
  })
}

/** 轮播计时：滚动中的文字等它滚完再切下一条，避免读一半被切走 */
const scheduleRotation = () => {
  if (rotateTimer) clearTimeout(rotateTimer)
  if (items.value.length < 2) return
  const holdMs =
    current.value?.type === 'IMAGE' || isWrap.value
      ? 7000
      : (scrolling.value ? scrollSeconds.value * 1000 + 1200 : 7000)
  rotateTimer = setTimeout(() => {
    if (!paused.value) next()
    scheduleRotation()
  }, holdMs)
}

const goTo = (index) => {
  if (!items.value.length) return
  activeIndex.value = (index + items.value.length) % items.value.length
}
const next = () => goTo(activeIndex.value + 1)
const prev = () => goTo(activeIndex.value - 1)

const pause = () => { paused.value = true }
const resume = () => { paused.value = false }

watch(current, () => {
  measure()
  scheduleRotation()
})

const onResize = () => measure()

onMounted(async () => {
  try {
    const res = await $fetch('/api/announcements')
    const list = Array.isArray(res?.data) ? res.data : []
    // 图片类型必须有地址、文字类型必须有内容，避免出现空条目
    items.value = list.filter((item) => (item.type === 'IMAGE' ? item.imageUrl : item.text))
    emit('loaded', items.value.length > 0)
    await nextTick()
    measure()
    scheduleRotation()
    window.addEventListener('resize', onResize)
  } catch (error) {
    console.error('加载公告失败:', error)
    emit('loaded', false)
  }
})

onBeforeUnmount(() => {
  if (rotateTimer) clearTimeout(rotateTimer)
  if (typeof window !== 'undefined') window.removeEventListener('resize', onResize)
})
</script>

<style scoped>
.announcement-bar {
  width: 100%;
  display: flex;
  justify-content: center;
  /* 与站点内容区一致的内边距：桌面 1.5rem（同 .tab-content-container） */
  padding: 0 1.5rem;
  /* 位于大标题/副标题之下：标题自带 3rem 下边距，收掉一部分，再与歌单留出间距 */
  margin-top: -2rem;
  margin-bottom: 1.25rem;
}

.announcement-inner {
  width: 100%;
  /* 不额外限宽，和歌单/日期选择器同宽对齐 */
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--border-secondary, rgba(148, 163, 184, 0.25));
  border-radius: 12px;
  background: var(--bg-secondary-60, rgba(148, 163, 184, 0.08));
}

.announcement-item {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  text-decoration: none;
  color: var(--text-secondary, #e2e8f0);
  /* 字号默认"标准"，可由每条公告的 fontSize 覆盖 */
  font-size: 12.5px;
  line-height: 1.35;
}

/* 字号档位（后台每条公告可选：小 / 标准 / 大） */
.announcement-bar.size-small .announcement-item { font-size: 11px; }
.announcement-bar.size-medium .announcement-item { font-size: 12.5px; }
.announcement-bar.size-large .announcement-item { font-size: 15px; }

.announcement-icon { flex-shrink: 0; opacity: 0.75; }

/* 分行完整显示模式：按文字长度自动换成多行，不截断、不滚动 */
.announcement-wrap {
  flex: 1;
  min-width: 0;
  text-align: center;
}

.announcement-text-wrap {
  display: block;
  white-space: normal;
  word-break: break-word;
  line-height: 1.5;
}

/* 文字可视区：超出则滚动 */
.announcement-viewport {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  position: relative;
  display: flex;
  /* 短文本居中显示 */
  justify-content: center;
}

/* 滚动时从左侧起步，保证跑马灯从头开始 */
.announcement-viewport.is-scrolling {
  justify-content: flex-start;
}

.announcement-track {
  display: flex;
  align-items: center;
  width: max-content;
}

.announcement-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

/* 滚动时：两份文本首尾相接，配合 translateX(-50%) 实现无缝循环 */
.announcement-track.is-scrolling .announcement-text {
  max-width: none;
  overflow: visible;
  text-overflow: clip;
  padding-right: 3rem;
}

.announcement-track.is-scrolling {
  animation-name: announcement-scroll;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}

.announcement-bar.is-paused .announcement-track.is-scrolling {
  animation-play-state: paused;
}

@keyframes announcement-scroll {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}

/* 尊重系统"减少动态效果"设置：不滚动，回到省略号显示 */
@media (prefers-reduced-motion: reduce) {
  .announcement-track.is-scrolling { animation: none; }
  .announcement-track.is-scrolling .announcement-text { max-width: 100%; overflow: hidden; text-overflow: ellipsis; padding-right: 0; }
}

/* 图片类公告：严格限高，不做成大横幅 */
.announcement-image {
  max-height: 52px;
  max-width: 100%;
  width: auto;
  object-fit: contain;
  border-radius: 6px;
}

.announcement-nav {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 9999px;
  border: 1px solid var(--border-secondary, rgba(148, 163, 184, 0.25));
  background: transparent;
  color: var(--text-tertiary, #94a3b8);
  cursor: pointer;
  transition: all 0.2s ease;
}
.announcement-nav:hover { color: var(--text-primary, #f8fafc); }

.announcement-dots { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.announcement-dot {
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  border: none;
  padding: 0;
  background: var(--text-disabled, rgba(148, 163, 184, 0.5));
  cursor: pointer;
}
.announcement-dot.is-active { width: 14px; background: var(--primary, #3b82f6); }

@media (max-width: 768px) {
  /* 移动端标题下边距更小，间距相应收紧；内边距对齐站点 768 断点 */
  .announcement-bar { margin-top: -1rem; margin-bottom: 1rem; padding: 0 1rem; }
  .announcement-inner { border-radius: 10px; }
}

@media (max-width: 640px) {
  .announcement-inner { min-height: 30px; padding: 5px 8px; gap: 6px; }
  .announcement-bar.size-small .announcement-item { font-size: 10.5px; }
  .announcement-bar.size-medium .announcement-item { font-size: 11.5px; }
  .announcement-bar.size-large .announcement-item { font-size: 13.5px; }
  .announcement-image { max-height: 38px; }
  .announcement-dots { display: none; }
}

@media (max-width: 480px) {
  /* 对齐站点 480 断点的 10px 侧边距（同 .top-bar） */
  .announcement-bar { padding: 0 10px; }
}
</style>
