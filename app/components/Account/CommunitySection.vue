<template>
  <section class="bg-bg-secondary-40 border border-border-secondary rounded-3xl p-6 md:p-8 shadow-2xl">
    <div class="flex items-center gap-3 border-b border-border-secondary-50 pb-5 mb-6">
      <div class="p-2.5 bg-primary-10 rounded-xl flex items-center justify-center">
        <MessagesSquare :size="20" class="text-primary" />
      </div>
      <div>
        <h2 class="text-base font-black text-text-primary">{{ t.accountSection }}</h2>
        <p class="text-xs text-text-tertiary mt-0.5">{{ t.accountSectionDesc }}</p>
      </div>
    </div>

    <div v-if="loading" class="flex items-center justify-center gap-2 py-10 text-xs text-text-tertiary">
      <Loader2 class="animate-spin" :size="16" />
      {{ t.loading }}
    </div>

    <div v-else-if="error" class="flex flex-col items-center gap-3 py-8 text-center">
      <p class="text-xs text-error">{{ error }}</p>
      <button
        class="inline-flex items-center gap-2 px-4 py-2 border border-border-secondary bg-bg-primary-40 hover:bg-bg-tertiary text-text-secondary text-xs font-bold rounded-xl transition-all"
        type="button"
        @click="load"
      >
        {{ t.retry }}
      </button>
    </div>

    <div v-else-if="data" class="space-y-6">
      <div
        v-if="!data.settings.enabled"
        class="flex items-center gap-2 rounded-2xl border border-info-20 bg-info-10 px-4 py-3 text-xs font-semibold text-info"
      >
        <Info :size="15" />
        <span>{{ t.closedForUsers }}</span>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border-secondary-70 bg-bg-primary-45 px-4 py-3">
        <div class="min-w-0">
          <p class="text-sm font-black text-text-primary break-all">{{ data.user?.displayName || '—' }}</p>
          <p class="text-xs text-text-tertiary mt-0.5">
            {{ t.postCount }} {{ data.stats.posts }} · {{ t.commentCount }} {{ data.stats.comments }}
          </p>
        </div>
        <span
          v-if="data.ban.muted"
          class="px-3 py-1 rounded-full bg-warning-10 border border-warning-20 text-warning text-[10px] font-black"
        >
          {{ data.ban.permanent ? t.permanent : t.muted }}
        </span>
      </div>

      <!-- 喜欢的歌 -->
      <div class="space-y-3">
        <div class="flex items-center justify-between gap-3">
          <h3 class="text-[10px] font-black text-text-disabled uppercase tracking-[0.18em]">
            {{ t.favoriteSongLabel }}
          </h3>
          <button
            v-if="favoriteSong"
            class="text-[10px] font-bold text-text-tertiary hover:text-error transition-colors"
            type="button"
            @click="clearFavorite"
          >
            {{ t.remove }}
          </button>
        </div>

        <div
          v-if="favoriteSong"
          class="flex items-center gap-3 rounded-2xl border border-primary-20 bg-primary-hover-5 px-4 py-3"
        >
          <div class="w-10 h-10 rounded-xl overflow-hidden bg-bg-tertiary flex items-center justify-center shrink-0">
            <img v-if="favoriteSong.cover" :alt="favoriteSong.title" :src="favoriteSong.cover" class="w-full h-full object-cover">
            <Music v-else :size="18" class="text-text-tertiary" />
          </div>
          <div class="min-w-0">
            <p class="text-sm font-bold text-text-primary truncate">{{ favoriteSong.title }}</p>
            <p class="text-xs text-text-tertiary truncate">{{ favoriteSong.artist }}</p>
          </div>
        </div>

        <template v-else>
          <div class="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border-secondary bg-bg-primary text-text-tertiary">
            <Search :size="15" />
            <input
              v-model="songQuery"
              class="flex-1 min-w-0 bg-transparent border-none outline-none text-xs text-text-primary placeholder:text-text-disabled"
              :placeholder="t.selectSong"
              type="text"
              @input="handleSongInput"
            >
          </div>
          <div v-if="songResults.length" class="rounded-xl border border-border-secondary bg-bg-primary overflow-hidden">
            <button
              v-for="song in songResults"
              :key="song.id"
              class="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-bg-tertiary-40 transition-colors"
              type="button"
              @click="chooseSong(song)"
            >
              <span class="text-xs font-bold text-text-primary truncate">{{ song.title }}</span>
              <span class="text-[10px] text-text-tertiary truncate">{{ song.artist }}</span>
              <span class="ml-auto text-[10px] font-bold text-primary shrink-0">{{ t.choose }}</span>
            </button>
          </div>
          <p v-else-if="songQuery && songSearched" class="text-[10px] text-text-disabled">{{ t.noSongFound }}</p>
          <p v-else class="text-[10px] text-text-disabled">{{ t.favoriteSongEmpty }}</p>
        </template>
      </div>

      <!-- 隐私 -->
      <div class="space-y-3">
        <h3 class="text-[10px] font-black text-text-disabled uppercase tracking-[0.18em]">
          {{ t.privacyHint }}
        </h3>
        <div class="space-y-2">
          <div class="flex items-center justify-between gap-4 rounded-2xl border border-border-secondary-70 bg-bg-primary-45 px-4 py-3">
            <span class="text-xs font-bold text-text-secondary">{{ t.privacyFavorite }}</span>
            <button
              :aria-checked="privacy.showFavorite"
              aria-label="privacy favorite"
              class="relative w-10 h-5 rounded-full transition-colors shrink-0"
              :class="privacy.showFavorite ? 'bg-primary-hover' : 'bg-bg-tertiary'"
              role="switch"
              type="button"
              @click="privacy.showFavorite = !privacy.showFavorite"
            >
              <span
                class="absolute top-1 w-3 h-3 bg-bg-secondary rounded-full transition-all"
                :class="privacy.showFavorite ? 'left-6' : 'left-1'"
              />
            </button>
          </div>
          <div class="flex items-center justify-between gap-4 rounded-2xl border border-border-secondary-70 bg-bg-primary-45 px-4 py-3">
            <span class="text-xs font-bold text-text-secondary">{{ t.privacyLiked }}</span>
            <button
              :aria-checked="privacy.showLikedSongs"
              aria-label="privacy liked songs"
              class="relative w-10 h-5 rounded-full transition-colors shrink-0"
              :class="privacy.showLikedSongs ? 'bg-primary-hover' : 'bg-bg-tertiary'"
              role="switch"
              type="button"
              @click="privacy.showLikedSongs = !privacy.showLikedSongs"
            >
              <span
                class="absolute top-1 w-3 h-3 bg-bg-secondary rounded-full transition-all"
                :class="privacy.showLikedSongs ? 'left-6' : 'left-1'"
              />
            </button>
          </div>
        </div>
      </div>

      <!-- 称号 -->
      <div class="space-y-2">
        <h3 class="text-[10px] font-black text-text-disabled uppercase tracking-[0.18em]">
          {{ t.titleLabel }}
        </h3>
        <CustomSelect v-model="equippedTitleId" :options="titleOptions" />
        <p class="text-[10px] text-text-disabled">{{ t.titleHint }}</p>
      </div>

      <!-- 共鸣记录（仅本人可见） -->
      <div v-if="resonanceList.length" class="space-y-3">
        <h3 class="text-[10px] font-black text-text-disabled uppercase tracking-[0.18em]">
          {{ t.resonanceSection }}
        </h3>
        <p class="text-[10px] text-text-disabled">{{ t.resonancePrivateHint }}</p>
        <div
          v-for="record in resonanceList"
          :key="record.id"
          class="rounded-2xl border border-primary-20 bg-primary-hover-5 px-4 py-3 space-y-2"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="text-sm font-black text-primary">{{ record.titleName }}</span>
            <span class="text-[10px] text-text-disabled">{{ formatDate(record.createdAt) }}</span>
          </div>
          <p class="text-xs text-text-secondary">
            {{ t.resonancePartner }} {{ record.partner?.displayName || '—' }} ·
            {{ t.resonanceMutual(record.mutualCount) }}
          </p>
          <div v-if="record.songs?.length" class="max-h-40 overflow-y-auto custom-scrollbar space-y-1">
            <p v-for="song in record.songs" :key="song.id" class="text-[10px] text-text-tertiary truncate">
              《{{ song.title }}》- {{ song.artist }}
            </p>
          </div>
        </div>
      </div>

      <!-- 违规与禁言 -->
      <div class="space-y-2">
        <h3 class="text-[10px] font-black text-text-disabled uppercase tracking-[0.18em]">
          {{ t.violationLabel }}
        </h3>
        <div class="rounded-2xl border border-border-secondary-70 bg-bg-primary-45 px-4 py-3">
          <p v-if="data.ban.muted" class="text-xs font-bold text-warning">
            {{ data.ban.permanent ? t.permanent : t.muted }}
            <span v-if="data.ban.until" class="font-normal text-text-tertiary">
              · {{ t.muteUntil }} {{ formatDate(data.ban.until) }}
            </span>
          </p>
          <p v-else-if="data.profile.violationCount > 0" class="text-xs font-bold text-warning">
            {{ t.violationCount(data.profile.violationCount) }}
          </p>
          <p v-else class="text-xs text-text-tertiary">{{ t.violationNone }}</p>
          <p v-if="data.ban.muted" class="text-[10px] text-text-disabled mt-1">{{ t.mutedHint }}</p>
          <p v-if="data.ban.reason" class="text-[10px] text-text-tertiary mt-1">{{ data.ban.reason }}</p>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2 pt-1">
        <button
          class="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-hover hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed text-text-primary text-xs font-black rounded-xl shadow-lg shadow-[var(--primary-glow)] transition-all active:scale-95"
          :disabled="saving || !dirty"
          type="button"
          @click="save"
        >
          <Loader2 v-if="saving" class="animate-spin" :size="14" />
          <span>{{ saving ? t.saving : t.save }}</span>
        </button>
        <button
          v-if="data.permissions.canReview"
          class="inline-flex items-center gap-2 px-4 py-2.5 border border-border-secondary bg-bg-primary-40 hover:bg-bg-tertiary text-text-secondary text-xs font-bold rounded-xl transition-all"
          type="button"
          @click="navigateTo('/dashboard?tab=community-review')"
        >
          <ShieldCheck :size="14" />
          <span>{{ t.goReview }}</span>
        </button>
        <button
          v-if="data.permissions.isCommunityAdmin"
          class="inline-flex items-center gap-2 px-4 py-2.5 border border-border-secondary bg-bg-primary-40 hover:bg-bg-tertiary text-text-secondary text-xs font-bold rounded-xl transition-all"
          type="button"
          @click="navigateTo('/dashboard?tab=community-settings')"
        >
          <Settings :size="14" />
          <span>{{ t.goManage }}</span>
        </button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { Info, Loader2, MessagesSquare, Music, Search, Settings, ShieldCheck } from '@lucide/vue'
import CustomSelect from '~/components/UI/Common/CustomSelect.vue'
import { useLocale } from '~/utils/locale'
import { useToast } from '~/composables/useToast'

type AnyRecord = Record<string, any>

const { community: communityLocale, currentLocale } = useLocale()
const t = computed<AnyRecord>(() => communityLocale.value || {})
const { showToast } = useToast()

const loading = ref(true)
const error = ref('')
const data = ref<AnyRecord | null>(null)

const favoriteSong = ref<AnyRecord | null>(null)
const favoriteSongId = ref<number | null>(null)
const songQuery = ref('')
const songResults = ref<AnyRecord[]>([])
const songSearched = ref(false)
let songTimer: ReturnType<typeof setTimeout> | null = null

const privacy = reactive({ showFavorite: true, showLikedSongs: true })
const equippedTitleId = ref<string>('')
const initial = ref({ favoriteSongId: null as number | null, showFavorite: true, showLikedSongs: true, equippedTitleId: '' })
const saving = ref(false)

const resonanceList = computed<AnyRecord[]>(() => {
  const list = data.value?.resonance
  return Array.isArray(list) ? list : []
})

const titleOptions = computed(() => {
  const options = [{ label: t.value.titleNone, value: '' }]
  for (const title of data.value?.titles || []) {
    options.push({ label: title.name, value: String(title.id) })
  }
  return options
})

const dirty = computed(() => {
  return (
    favoriteSongId.value !== initial.value.favoriteSongId ||
    privacy.showFavorite !== initial.value.showFavorite ||
    privacy.showLikedSongs !== initial.value.showLikedSongs ||
    equippedTitleId.value !== initial.value.equippedTitleId
  )
})

function apiMessage(err: any, fallback: string) {
  return err?.data?.message || err?.data?.statusMessage || err?.message || fallback
}

function formatDate(value: string | Date | null | undefined) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(currentLocale.value || 'zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
}

function applyData(res: AnyRecord) {
  data.value = res
  const profile = res.profile || {}
  favoriteSongId.value = profile.favoriteSongId ?? null
  favoriteSong.value = res.favoriteSong || null
  privacy.showFavorite = profile.showFavorite !== false
  privacy.showLikedSongs = profile.showLikedSongs !== false
  equippedTitleId.value = profile.equippedTitleId ? String(profile.equippedTitleId) : ''
  initial.value = {
    favoriteSongId: favoriteSongId.value,
    showFavorite: privacy.showFavorite,
    showLikedSongs: privacy.showLikedSongs,
    equippedTitleId: equippedTitleId.value
  }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await $fetch<AnyRecord>('/api/community/me')
    applyData(res)
  } catch (err: any) {
    error.value = apiMessage(err, t.value.loadFailed)
  } finally {
    loading.value = false
  }
}

function handleSongInput() {
  if (songTimer) clearTimeout(songTimer)
  const keyword = songQuery.value.trim()
  if (!keyword) {
    songResults.value = []
    songSearched.value = false
    return
  }
  songTimer = setTimeout(async () => {
    try {
      const res = await $fetch<AnyRecord>('/api/community/songs', { query: { q: keyword } })
      songResults.value = res.songs || []
    } catch {
      songResults.value = []
    } finally {
      songSearched.value = true
    }
  }, 300)
}

function chooseSong(song: AnyRecord) {
  favoriteSong.value = { id: song.id, title: song.title, artist: song.artist, cover: song.cover }
  favoriteSongId.value = song.id
  songQuery.value = ''
  songResults.value = []
  songSearched.value = false
}

function clearFavorite() {
  favoriteSong.value = null
  favoriteSongId.value = null
}

async function save() {
  if (saving.value || !dirty.value) return
  saving.value = true
  try {
    const body: AnyRecord = {
      favoriteSongId: favoriteSongId.value,
      showFavorite: privacy.showFavorite,
      showLikedSongs: privacy.showLikedSongs,
      equippedTitleId: equippedTitleId.value ? Number(equippedTitleId.value) : null
    }
    await $fetch('/api/community/me', { method: 'PUT', body })
    initial.value = {
      favoriteSongId: favoriteSongId.value,
      showFavorite: privacy.showFavorite,
      showLikedSongs: privacy.showLikedSongs,
      equippedTitleId: equippedTitleId.value
    }
    showToast(t.value.saveSuccess, 'success')
  } catch (err: any) {
    showToast(apiMessage(err, t.value.saveFailed), 'error')
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>
