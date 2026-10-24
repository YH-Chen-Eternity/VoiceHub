<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-lg font-black text-text-primary">{{ t.settingsTitle }}</h2>
        <p class="mt-1 text-xs text-text-tertiary">{{ t.settingsDesc }}</p>
      </div>
      <span
        class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold"
        :class="form.enabled ? 'bg-success-10 text-success' : 'bg-bg-tertiary text-text-tertiary'"
      >
        <span class="h-1.5 w-1.5 rounded-full" :class="form.enabled ? 'bg-success' : 'bg-text-disabled'" />
        {{ form.enabled ? t.settingsEnabled : t.settingsDisabled }}
      </span>
    </div>

    <div v-if="loading" class="flex items-center justify-center gap-2 py-16 text-xs text-text-tertiary">
      <RefreshCw :size="16" class="animate-spin" /> {{ t.loading }}
    </div>
    <div
      v-else-if="error"
      class="flex flex-col items-center gap-3 rounded-2xl border border-error-20 bg-error-10 py-12 text-xs text-error"
    >
      <span>{{ t.loadFailed }}</span>
      <button class="rounded-lg border border-error-30 px-3 py-1.5 font-bold hover:bg-error-15" type="button" @click="load">
        {{ t.retry }}
      </button>
    </div>

    <template v-else>
      <!-- 主开关 -->
      <section class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-4 md:p-5">
        <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div class="flex items-start gap-3">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-10 text-primary">
              <Power :size="18" />
            </span>
            <div>
              <h3 class="text-sm font-black text-text-primary">
                {{ form.enabled ? t.enableCommunity : t.disableCommunity }}
              </h3>
              <p class="mt-1 text-xs text-text-tertiary">{{ t.enableHint }}</p>
            </div>
          </div>
          <button
            type="button"
            class="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold text-white transition-all disabled:opacity-50"
            :class="form.enabled ? 'bg-error hover:opacity-90' : 'bg-primary hover:bg-primary-hover'"
            :disabled="toggling"
            @click="toggleEnabled"
          >
            <Power :size="14" /> {{ form.enabled ? t.disableCommunity : t.enableCommunity }}
          </button>
        </div>
      </section>

      <!-- 发帖策略 -->
      <section class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-4 md:p-5">
        <h3 class="text-sm font-black text-text-primary">{{ t.allowImagesLabel }}</h3>
        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          <label class="flex items-center justify-between gap-3 rounded-xl border border-border-secondary bg-bg-primary-40 p-3">
            <span class="min-w-0">
              <span class="block text-xs font-bold text-text-primary">{{ t.allowImagesLabel }}</span>
              <span class="mt-0.5 block text-[10px] text-text-tertiary">{{ t.allowImagesHint }}</span>
            </span>
            <button
              type="button"
              role="switch"
              :aria-checked="form.allowImages"
              class="relative h-5 w-10 shrink-0 rounded-full transition-colors"
              :class="form.allowImages ? 'bg-primary-hover' : 'bg-bg-tertiary'"
              @click="form.allowImages = !form.allowImages"
            >
              <span
                class="absolute top-1 h-3 w-3 rounded-full bg-bg-secondary transition-all"
                :class="form.allowImages ? 'left-6' : 'left-1'"
              />
            </button>
          </label>
          <div class="space-y-1.5">
            <label class="px-1 text-[10px] font-black uppercase tracking-widest text-text-disabled">{{ t.maxImagesLabel }}</label>
            <input
              v-model.number="form.maxImages"
              type="number"
              min="1"
              max="9"
              class="w-full rounded-xl border border-border-secondary bg-bg-primary px-3 py-2.5 text-sm text-text-primary focus:border-primary-30 focus:outline-none"
            >
          </div>
          <div class="space-y-1.5">
            <label class="px-1 text-[10px] font-black uppercase tracking-widest text-text-disabled">{{ t.maxContentLabel }}</label>
            <input
              v-model.number="form.maxContentLength"
              type="number"
              min="50"
              max="5000"
              class="w-full rounded-xl border border-border-secondary bg-bg-primary px-3 py-2.5 text-sm text-text-primary focus:border-primary-30 focus:outline-none"
            >
          </div>
          <div class="space-y-1.5">
            <label class="px-1 text-[10px] font-black uppercase tracking-widest text-text-disabled">{{ t.maxCommentLabel }}</label>
            <input
              v-model.number="form.maxCommentLength"
              type="number"
              min="20"
              max="1000"
              class="w-full rounded-xl border border-border-secondary bg-bg-primary px-3 py-2.5 text-sm text-text-primary focus:border-primary-30 focus:outline-none"
            >
          </div>
        </div>
      </section>

      <!-- 内容审核 -->
      <section class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-4 md:p-5">
        <div class="flex items-center gap-2">
          <ShieldCheck :size="16" class="text-primary" />
          <h3 class="text-sm font-black text-text-primary">{{ t.moderationSection }}</h3>
        </div>
        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          <label class="flex items-start justify-between gap-3 rounded-xl border border-border-secondary bg-bg-primary-40 p-3 sm:col-span-2">
            <span class="min-w-0">
              <span class="block text-xs font-bold text-text-primary">{{ t.moderationEnabledLabel }}</span>
              <span class="mt-0.5 block text-[10px] leading-relaxed text-text-tertiary">{{ t.moderationEnabledHint }}</span>
            </span>
            <button
              type="button"
              role="switch"
              :aria-checked="form.moderationEnabled"
              class="relative mt-0.5 h-5 w-10 shrink-0 rounded-full transition-colors"
              :class="form.moderationEnabled ? 'bg-primary-hover' : 'bg-bg-tertiary'"
              @click="form.moderationEnabled = !form.moderationEnabled"
            >
              <span
                class="absolute top-1 h-3 w-3 rounded-full bg-bg-secondary transition-all"
                :class="form.moderationEnabled ? 'left-6' : 'left-1'"
              />
            </button>
          </label>
          <div class="space-y-1.5">
            <label class="px-1 text-[10px] font-black uppercase tracking-widest text-text-disabled">{{ t.hitAction }}</label>
            <CustomSelect
              v-model="form.moderationHitAction"
              :options="hitActionOptions"
            />
          </div>
        </div>
        <p class="mt-3 text-[11px] leading-relaxed text-text-tertiary">
          <span :class="meta.moderationServiceConfigured ? 'text-success' : 'text-text-tertiary'">
            {{ meta.moderationServiceConfigured ? t.moderationServiceActive : t.moderationServiceInactive }}
          </span>
        </p>
      </section>

      <!-- 阿里云 -->
      <section class="rounded-2xl border border-border-secondary-50 bg-bg-secondary-30 p-4 md:p-5">
        <div class="flex items-center gap-2">
          <KeyRound :size="16" class="text-primary" />
          <h3 class="text-sm font-black text-text-primary">{{ t.aliyunSection }}</h3>
        </div>

        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          <div class="space-y-1.5 sm:col-span-2">
            <label class="flex items-center justify-between px-1">
              <span class="text-[10px] font-black uppercase tracking-widest text-text-disabled">{{ t.accessKeyId }}</span>
              <span class="text-[10px] text-text-disabled">
                {{ meta.hasAccessKeyId ? meta.accessKeyIdMasked : t.noSettings }}
              </span>
            </label>
            <input
              v-model="secrets.accessKeyId"
              type="text"
              autocomplete="off"
              :placeholder="meta.hasAccessKeyId ? t.secretSaved : t.accessKeyId"
              class="w-full rounded-xl border border-border-secondary bg-bg-primary px-3 py-2.5 text-sm text-text-primary placeholder:text-text-disabled focus:border-primary-30 focus:outline-none"
            >
          </div>

          <div class="space-y-1.5 sm:col-span-2">
            <label class="flex items-center justify-between px-1">
              <span class="text-[10px] font-black uppercase tracking-widest text-text-disabled">{{ t.accessKeySecret }}</span>
              <span class="text-[10px] text-text-disabled">{{ meta.hasAccessKeySecret ? '********' : t.noSettings }}</span>
            </label>
            <div class="relative">
              <input
                v-model="secrets.accessKeySecret"
                :type="showSecret ? 'text' : 'password'"
                autocomplete="new-password"
                :placeholder="meta.hasAccessKeySecret ? t.secretSaved : t.accessKeySecret"
                class="w-full rounded-xl border border-border-secondary bg-bg-primary px-3 py-2.5 pr-10 text-sm text-text-primary placeholder:text-text-disabled focus:border-primary-30 focus:outline-none"
              >
              <button
                type="button"
                class="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-text-tertiary hover:bg-bg-tertiary"
                @click="showSecret = !showSecret"
              >
                <EyeOff v-if="showSecret" :size="14" />
                <Eye v-else :size="14" />
              </button>
            </div>
          </div>

          <div class="space-y-1.5">
            <label class="px-1 text-[10px] font-black uppercase tracking-widest text-text-disabled">{{ t.endpoint }}</label>
            <input
              v-model="form.aliyunEndpoint"
              type="text"
              class="w-full rounded-xl border border-border-secondary bg-bg-primary px-3 py-2.5 text-sm text-text-primary focus:border-primary-30 focus:outline-none"
            >
          </div>
          <div class="space-y-1.5">
            <label class="px-1 text-[10px] font-black uppercase tracking-widest text-text-disabled">{{ t.regionId }}</label>
            <input
              v-model="form.aliyunRegionId"
              type="text"
              class="w-full rounded-xl border border-border-secondary bg-bg-primary px-3 py-2.5 text-sm text-text-primary focus:border-primary-30 focus:outline-none"
            >
          </div>
          <div class="space-y-1.5">
            <label class="px-1 text-[10px] font-black uppercase tracking-widest text-text-disabled">{{ t.textService }}</label>
            <input
              v-model="form.aliyunTextService"
              type="text"
              class="w-full rounded-xl border border-border-secondary bg-bg-primary px-3 py-2.5 text-sm text-text-primary focus:border-primary-30 focus:outline-none"
            >
          </div>
          <div class="space-y-1.5">
            <label class="px-1 text-[10px] font-black uppercase tracking-widest text-text-disabled">{{ t.imageService }}</label>
            <input
              v-model="form.aliyunImageService"
              type="text"
              class="w-full rounded-xl border border-border-secondary bg-bg-primary px-3 py-2.5 text-sm text-text-primary focus:border-primary-30 focus:outline-none"
            >
          </div>
          <div class="space-y-1.5">
            <label class="px-1 text-[10px] font-black uppercase tracking-widest text-text-disabled">{{ t.connectTimeout }}</label>
            <input
              v-model.number="form.aliyunConnectTimeoutMs"
              type="number"
              min="500"
              max="15000"
              class="w-full rounded-xl border border-border-secondary bg-bg-primary px-3 py-2.5 text-sm text-text-primary focus:border-primary-30 focus:outline-none"
            >
          </div>
          <div class="space-y-1.5">
            <label class="px-1 text-[10px] font-black uppercase tracking-widest text-text-disabled">{{ t.readTimeout }}</label>
            <input
              v-model.number="form.aliyunReadTimeoutMs"
              type="number"
              min="1000"
              max="30000"
              class="w-full rounded-xl border border-border-secondary bg-bg-primary px-3 py-2.5 text-sm text-text-primary focus:border-primary-30 focus:outline-none"
            >
          </div>
        </div>

        <div class="mt-3 flex flex-wrap gap-2">
          <button
            v-if="meta.hasAccessKeyId"
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg border border-error-20 px-3 py-1.5 text-xs font-bold text-error hover:bg-error-10"
            @click="askClear('id')"
          >
            <Trash2 :size="13" /> {{ t.accessKeyId }}
          </button>
          <button
            v-if="meta.hasAccessKeySecret"
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg border border-error-20 px-3 py-1.5 text-xs font-bold text-error hover:bg-error-10"
            @click="askClear('secret')"
          >
            <Trash2 :size="13" /> {{ t.accessKeySecret }}
          </button>
        </div>

        <p class="mt-4 flex items-start gap-2 rounded-xl bg-bg-tertiary-40 p-3 text-[11px] leading-relaxed text-text-tertiary">
          <Lock :size="13" class="mt-0.5 shrink-0" />
          {{ t.securityHint }}
        </p>
      </section>

      <div class="sticky bottom-3 z-10 flex justify-end">
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-[var(--primary-glow-20)] transition-all hover:bg-primary-hover disabled:opacity-50"
          :disabled="saving"
          @click="save"
        >
          <Save :size="14" :class="{ 'animate-pulse': saving }" />
          {{ saving ? t.saving : t.saveSettings }}
        </button>
      </div>
    </template>

    <ConfirmDialog
      v-model:show="clearConfirm.show"
      :title="t.clearKeyConfirmTitle"
      :message="t.clearKeyConfirmMsg"
      type="danger"
      :loading="clearConfirm.loading"
      @confirm="clearKey"
      @cancel="clearConfirm.show = false"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { Eye, EyeOff, KeyRound, Lock, Power, RefreshCw, Save, ShieldCheck, Trash2 } from '@lucide/vue'
import ConfirmDialog from '~/components/UI/ConfirmDialog.vue'
import CustomSelect from '~/components/UI/Common/CustomSelect.vue'
import { useLocale } from '~/utils/locale'
import { useToast } from '~/composables/useToast'

const { community: communityLocale } = useLocale()
const t = computed(() => communityLocale.value?.admin || {})
const { showToast } = useToast()

const form = reactive({
  enabled: false,
  allowImages: false,
  maxImages: 3,
  maxContentLength: 1000,
  maxCommentLength: 300,
  moderationEnabled: false,
  moderationHitAction: 'MANUAL',
  aliyunEndpoint: 'green-cip.cn-shanghai.aliyuncs.com',
  aliyunRegionId: 'cn-shanghai',
  aliyunTextService: 'comment_detection_pro',
  aliyunImageService: 'baselineCheck',
  aliyunConnectTimeoutMs: 3000,
  aliyunReadTimeoutMs: 6000
})

const secrets = reactive({ accessKeyId: '', accessKeySecret: '' })
const meta = reactive({
  hasAccessKeyId: false,
  hasAccessKeySecret: false,
  accessKeyIdMasked: null,
  moderationServiceConfigured: false
})

const loading = ref(true)
const error = ref(false)
const saving = ref(false)
const toggling = ref(false)
const showSecret = ref(false)

const clearConfirm = reactive({ show: false, loading: false, field: '' })

const hitActionOptions = computed(() => [
  { label: t.value.hitManual, value: 'MANUAL' },
  { label: t.value.hitBlock, value: 'BLOCK' }
])

const applySettings = (settings) => {
  if (!settings) return
  for (const key of Object.keys(form)) {
    if (settings[key] !== undefined && settings[key] !== null) form[key] = settings[key]
  }
  meta.hasAccessKeyId = !!settings.hasAccessKeyId
  meta.hasAccessKeySecret = !!settings.hasAccessKeySecret
  meta.accessKeyIdMasked = settings.accessKeyIdMasked || null
  meta.moderationServiceConfigured = !!settings.moderationServiceConfigured
  secrets.accessKeyId = ''
  secrets.accessKeySecret = ''
}

const load = async () => {
  loading.value = true
  error.value = false
  try {
    const data = await $fetch('/api/admin/community/settings')
    applySettings(data?.settings)
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
}

const toggleEnabled = async () => {
  toggling.value = true
  const next = !form.enabled
  try {
    const data = await $fetch('/api/admin/community/settings', {
      method: 'PUT',
      body: { enabled: next }
    })
    form.enabled = !!data?.settings?.enabled
    showToast(form.enabled ? t.value.settingsEnabled : t.value.settingsDisabled, 'success')
  } catch (e) {
    showToast(e?.data?.message || t.value.settingsFailed, 'error')
  } finally {
    toggling.value = false
  }
}

const save = async () => {
  saving.value = true
  try {
    const body = { ...form }
    if (secrets.accessKeyId.trim()) body.aliyunAccessKeyId = secrets.accessKeyId.trim()
    if (secrets.accessKeySecret.trim()) body.aliyunAccessKeySecret = secrets.accessKeySecret.trim()
    const data = await $fetch('/api/admin/community/settings', { method: 'PUT', body })
    applySettings(data?.settings)
    showToast(t.value.settingsSaved, 'success')
  } catch (e) {
    showToast(e?.data?.message || t.value.settingsFailed, 'error')
  } finally {
    saving.value = false
  }
}

const askClear = (field) => {
  clearConfirm.field = field
  clearConfirm.show = true
}

const clearKey = async () => {
  clearConfirm.loading = true
  try {
    const body =
      clearConfirm.field === 'id' ? { clearAliyunAccessKeyId: true } : { clearAliyunAccessKeySecret: true }
    const data = await $fetch('/api/admin/community/settings', { method: 'PUT', body })
    applySettings(data?.settings)
    showToast(t.value.clearSuccess, 'success')
    clearConfirm.show = false
  } catch (e) {
    showToast(e?.data?.message || t.value.settingsFailed, 'error')
  } finally {
    clearConfirm.loading = false
  }
}

onMounted(load)
</script>
