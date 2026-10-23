/**
 * VoiceHub-Plus — 非官方社区版（基于 laoshuikaixue/VoiceHub，GPL-3.0）
 * Copyright (C) 2026 YH-Chen-Eternity
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * 本文件为社区版新增代码；完整许可证见仓库根目录 LICENSE。
 */

<template>
  <div class="max-w-[1400px] mx-auto space-y-6 pb-20 px-2 animate-in fade-in slide-in-from-bottom-4 duration-500">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="space-y-1">
        <h2 class="text-2xl font-black text-text-primary tracking-tight">{{ t.title }}</h2>
        <p class="text-xs text-text-tertiary font-medium">{{ t.desc }}</p>
      </div>
      <div class="flex items-center gap-3">
        <span class="text-[11px] text-text-disabled font-medium">{{ t.lastUpdated(formatTime(lastRefresh)) }}</span>
        <button
          class="flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-bold uppercase tracking-wider bg-bg-primary-40 border border-border-secondary text-text-tertiary hover:text-text-primary hover:border-border-tertiary transition-all disabled:opacity-50"
          :disabled="loading"
          @click="refreshAll"
        >
          <RefreshCw :size="14" :class="loading ? 'animate-spin' : ''" />
          {{ t.refresh }}
        </button>
      </div>
    </div>

    <div class="flex items-center gap-2 border-b border-border-secondary">
      <button
        class="flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 -mb-px transition-colors"
        :class="activeTab === 'attacks' ? 'border-primary text-primary' : 'border-transparent text-text-tertiary hover:text-text-primary'"
        @click="setTab('attacks')"
      >
        <ShieldAlert :size="15" />
        {{ t.tabAttacks }}
      </button>
      <button
        class="flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 -mb-px transition-colors"
        :class="activeTab === 'audit' ? 'border-primary text-primary' : 'border-transparent text-text-tertiary hover:text-text-primary'"
        @click="setTab('audit')"
      >
        <History :size="15" />
        {{ t.tabAudit }}
      </button>
    </div>

    <div
      v-if="loadError"
      class="flex items-start gap-3 p-4 rounded-2xl bg-error-10 border border-error-20 text-error text-xs font-medium"
    >
      <AlertCircle :size="16" class="shrink-0 mt-0.5" />
      <span>{{ loadError }}</span>
    </div>

    <template v-if="activeTab === 'attacks'">
      <!-- 封禁名单 -->
      <section class="bg-bg-secondary-40 border border-border-secondary rounded-2xl p-5 space-y-4">
        <header class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-bold text-text-primary flex items-center gap-2">
              <ShieldAlert :size="16" class="text-error" /> {{ t.bansTitle }}
            </h3>
            <p class="mt-1 text-[11px] text-text-tertiary">{{ t.bansDesc }}</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <input
              v-model="manualBanIp"
              :placeholder="String(t.banIpPlaceholder)"
              class="w-44 rounded-xl border border-border-secondary bg-bg-primary-30 px-3 py-2 text-[11px] text-text-primary outline-none focus:border-primary"
              @keyup.enter="banManual"
            />
            <button
              v-if="isAdminOrAbove"
              class="px-3 py-2 rounded-xl text-[11px] font-bold bg-error text-white hover:opacity-90 disabled:opacity-50"
              :disabled="manualBanning"
              @click="banManual"
            >
              {{ t.banIpButton }}
            </button>
            <span class="text-[11px] font-semibold text-text-disabled">
              {{ isSuperAdmin ? t.superAdminHint : t.readOnlyHint }}
            </span>
          </div>
        </header>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div class="rounded-xl border border-border-secondary bg-bg-primary-30 p-4 space-y-3">
            <h4 class="text-[11px] font-black uppercase tracking-wider text-text-tertiary flex items-center gap-2">
              <Ban :size="14" class="text-error" /> {{ t.permanent }}
              <span class="ml-auto text-text-disabled">{{ bans.permanent.length }}</span>
            </h4>
            <p v-if="!bans.permanent.length" class="text-[11px] text-text-disabled py-4 text-center">{{ t.emptyPermanent }}</p>
            <ul v-else class="space-y-2 max-h-72 overflow-y-auto custom-scrollbar pr-1">
              <li
                v-for="item in bans.permanent"
                :key="`ip-${item.ip}`"
                class="flex items-start gap-2 rounded-lg border border-border-secondary bg-bg-secondary-30 px-3 py-2"
              >
                <div class="min-w-0 flex-1">
                  <p class="text-xs font-bold text-text-primary break-all">{{ item.ip }}</p>
                  <p class="mt-0.5 text-[10px] text-text-tertiary">
                    {{ t.banCount(item.count) }} · {{ formatTime(item.at) }}
                  </p>
                  <p v-if="item.detail" class="mt-0.5 text-[10px] text-text-disabled break-all">{{ item.detail }}</p>
                </div>
                <button
                  v-if="isSuperAdmin"
                  class="shrink-0 text-[10px] font-bold text-primary hover:text-primary-hover disabled:opacity-50"
                  :disabled="unbanning === `ip:${item.ip}`"
                  @click="unban('ip', item.ip)"
                >
                  {{ t.unban }}
                </button>
              </li>
            </ul>
          </div>

          <div class="rounded-xl border border-border-secondary bg-bg-primary-30 p-4 space-y-3">
            <h4 class="text-[11px] font-black uppercase tracking-wider text-text-tertiary flex items-center gap-2">
              <Lock :size="14" class="text-warning" /> {{ t.ipLocks }}
              <span class="ml-auto text-text-disabled">{{ bans.locks.length }}</span>
            </h4>
            <p v-if="!bans.locks.length" class="text-[11px] text-text-disabled py-4 text-center">{{ t.emptyLocks }}</p>
            <ul v-else class="space-y-2 max-h-72 overflow-y-auto custom-scrollbar pr-1">
              <li
                v-for="item in bans.locks"
                :key="`lock-${item.ip}`"
                class="flex items-start gap-2 rounded-lg border border-border-secondary bg-bg-secondary-30 px-3 py-2"
              >
                <div class="min-w-0 flex-1">
                  <p class="text-xs font-bold text-text-primary break-all">{{ item.ip }}</p>
                  <p class="mt-0.5 text-[10px] text-text-tertiary">{{ t.until(formatTime(item.until)) }}</p>
                </div>
                <button
                  v-if="isSuperAdmin"
                  class="shrink-0 text-[10px] font-bold text-primary hover:text-primary-hover disabled:opacity-50"
                  :disabled="unbanning === `ip:${item.ip}`"
                  @click="unban('ip', item.ip)"
                >
                  {{ t.unban }}
                </button>
              </li>
            </ul>
          </div>

          <div class="rounded-xl border border-border-secondary bg-bg-primary-30 p-4 space-y-3">
            <h4 class="text-[11px] font-black uppercase tracking-wider text-text-tertiary flex items-center gap-2">
              <Fingerprint :size="14" class="text-primary" /> {{ t.fpLocks }}
              <span class="ml-auto text-text-disabled">{{ bans.fps.length }}</span>
            </h4>
            <p v-if="!bans.fps.length" class="text-[11px] text-text-disabled py-4 text-center">{{ t.emptyLocks }}</p>
            <ul v-else class="space-y-2 max-h-72 overflow-y-auto custom-scrollbar pr-1">
              <li
                v-for="item in bans.fps"
                :key="`fp-${item.fp}`"
                class="flex items-start gap-2 rounded-lg border border-border-secondary bg-bg-secondary-30 px-3 py-2"
              >
                <div class="min-w-0 flex-1">
                  <p class="text-xs font-bold text-text-primary break-all">{{ truncate(item.fp, 28) }}</p>
                  <p class="mt-0.5 text-[10px] text-text-tertiary">
                    <span v-if="item.ip" class="break-all">{{ item.ip }} · </span>{{ t.until(formatTime(item.until)) }}
                  </p>
                </div>
                <button
                  v-if="isSuperAdmin"
                  class="shrink-0 text-[10px] font-bold text-primary hover:text-primary-hover disabled:opacity-50"
                  :disabled="unbanning === `fp:${item.fp}`"
                  @click="unban('fp', item.fp)"
                >
                  {{ t.unban }}
                </button>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <!-- 地域访问限制 -->
      <section class="bg-bg-secondary-40 border border-border-secondary rounded-2xl p-5 space-y-4">
        <header class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-bold text-text-primary flex items-center gap-2">
              <Globe :size="16" class="text-primary" /> {{ t.geoLockTitle }}
            </h3>
            <p class="mt-1 text-[11px] text-text-tertiary">{{ t.geoLockDesc }}</p>
          </div>
          <span class="text-[11px] font-semibold text-text-disabled">
            {{ isAdminOrAbove ? t.geoLockReadonly : t.readOnlyHint }}
          </span>
        </header>

        <div class="flex flex-wrap items-center gap-4">
          <div class="flex items-center gap-3 rounded-xl border border-border-secondary bg-bg-primary-30 px-4 py-3">
            <span class="text-[11px] text-text-tertiary">{{ t.geoLockCurrent }}</span>
            <button
              type="button"
              class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50"
              :class="geoEnabled ? 'bg-primary' : 'bg-border-tertiary'"
              :disabled="!isAdminOrAbove || geoSaving"
              :aria-pressed="geoEnabled"
              @click="toggleGeoLock"
            >
              <span
                class="inline-block h-5 w-5 transform rounded-full bg-white transition-transform"
                :class="geoEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'"
              />
            </button>
            <span class="text-[11px] font-bold" :class="geoEnabled ? 'text-success' : 'text-text-tertiary'">
              {{ geoEnabled ? t.geoLockOn : t.geoLockOff }}
            </span>
          </div>
          <span v-if="geoSaving" class="text-[11px] text-text-tertiary">{{ t.geoLockApplying }}</span>
          <span v-else-if="geoSaved" class="text-[11px] font-semibold text-success">{{ t.geoLockOk }}</span>
        </div>

        <p v-if="geoError" class="flex items-center gap-2 text-[11px] text-error">
          <AlertCircle :size="14" /> {{ geoError }}
        </p>
      </section>

      <!-- Bot 评分 -->
      <section class="bg-bg-secondary-40 border border-border-secondary rounded-2xl p-5 space-y-4">
        <header class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-bold text-text-primary flex items-center gap-2">
              <Bot :size="16" class="text-primary" /> {{ t.botTitle }}
              <span class="text-[11px] font-semibold text-text-disabled">{{ t.total(filteredBotScores.length) }}</span>
            </h3>
            <p class="mt-1 text-[11px] text-text-tertiary">{{ t.botDesc }}</p>
          </div>
          <div class="relative">
            <Search :size="13" class="absolute left-3 top-1/2 -translate-y-1/2 text-text-disabled" />
            <input
              v-model="botFilter"
              :placeholder="String(t.botAccountPlaceholder)"
              class="w-52 rounded-xl border border-border-secondary bg-bg-primary-30 py-2 pl-8 pr-3 text-[11px] text-text-primary outline-none focus:border-primary"
            />
          </div>
        </header>

        <div v-if="botScoresError" class="flex items-center gap-2 text-[11px] text-error">
          <AlertCircle :size="14" /> {{ botScoresError }}
        </div>
        <div v-if="!filteredBotScores.length && !botScoresLoading" class="py-8 text-center text-xs text-text-disabled">
          {{ t.botEmpty }}
        </div>
        <div v-else class="overflow-auto custom-scrollbar max-h-[460px]">
          <table class="w-full min-w-[860px] text-left text-xs">
            <thead class="sticky top-0 z-10 bg-bg-secondary-40">
              <tr class="text-[10px] uppercase tracking-wider text-text-disabled border-b border-border-secondary">
                <th class="py-2 pr-3 font-semibold">{{ t.botAccount }}</th>
                <th class="py-2 pr-3 font-semibold">{{ t.colIp }}</th>
                <th class="py-2 pr-3 font-semibold">{{ t.colBot }}</th>
                <th class="py-2 pr-3 font-semibold">{{ t.botReasonsCol }}</th>
                <th class="py-2 pr-3 font-semibold">{{ t.botSignalsCol }}</th>
                <th class="py-2 font-semibold">{{ t.botLastSeen }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in filteredBotScores"
                :key="row.key"
                class="border-b border-border-secondary/60 align-top hover:bg-bg-secondary-20"
              >
                <td class="py-2 pr-3 font-semibold text-text-primary break-all">
                  {{ row.account || t.botNoAccount }}
                </td>
                <td class="py-2 pr-3 text-text-tertiary break-all">
                  {{ row.ip || '-' }}
                  <button
                    v-if="isAdminOrAbove && row.ip"
                    class="ml-1 align-middle text-[10px] font-bold text-error hover:opacity-80"
                    :title="String(t.banIpButton)"
                    @click="banFromRow(row.ip)"
                  >
                    <Ban :size="12" />
                  </button>
                </td>
                <td class="py-2 pr-3">
                  <span :class="['inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border', botTone(row.score)]">
                    {{ row.score.toFixed(1) }}
                  </span>
                </td>
                <td class="py-2 pr-3 text-text-tertiary break-all max-w-[220px]">{{ row.reasons.join(', ') || '-' }}</td>
                <td class="py-2 pr-3 text-text-tertiary whitespace-nowrap">{{ row.reports }} / {{ row.human }} / {{ row.signed }} / {{ row.unsigned }}</td>
                <td class="py-2 whitespace-nowrap text-text-tertiary">{{ formatTime(new Date(row.last).toISOString()) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 出口白名单 -->
      <section class="bg-bg-secondary-40 border border-border-secondary rounded-2xl p-5 space-y-4">
        <header class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-bold text-text-primary flex items-center gap-2">
              <ShieldCheck :size="16" class="text-success" /> {{ t.trustedTitle }}
              <span class="text-[11px] font-semibold text-text-disabled">{{ trustedIps.length }}</span>
            </h3>
            <p class="mt-1 text-[11px] text-text-tertiary">{{ t.trustedDesc }}</p>
          </div>
          <div v-if="isAdminOrAbove" class="flex flex-wrap items-center gap-2">
            <input
              v-model="trustedInput"
              :placeholder="String(t.trustedAddPlaceholder)"
              class="w-44 rounded-xl border border-border-secondary bg-bg-primary-30 px-3 py-2 text-[11px] text-text-primary outline-none focus:border-primary"
              @keyup.enter="addTrustedIp"
            />
            <button
              class="px-3 py-2 rounded-xl text-[11px] font-bold bg-primary text-white hover:bg-primary-hover disabled:opacity-50"
              :disabled="trustedBusy"
              @click="addTrustedIp"
            >
              {{ t.trustedAdd }}
            </button>
          </div>
        </header>

        <p v-if="trustedError" class="flex items-center gap-2 text-[11px] text-error">
          <AlertCircle :size="14" /> {{ trustedError }}
        </p>
        <p v-else-if="trustedOk" class="text-[11px] font-semibold text-success">{{ t.trustedOk }}</p>

        <p v-if="!trustedIps.length && !trustedLoading" class="py-4 text-center text-xs text-text-disabled">{{ t.trustedEmpty }}</p>
        <ul v-else class="flex flex-wrap gap-2">
          <li
            v-for="ip in trustedIps"
            :key="ip"
            class="flex items-center gap-2 rounded-lg border border-border-secondary bg-bg-primary-30 px-3 py-1.5"
          >
            <span class="text-xs font-bold text-text-primary break-all">{{ ip }}</span>
            <button
              v-if="isAdminOrAbove"
              class="text-[10px] font-bold text-error hover:opacity-80 disabled:opacity-50"
              :disabled="trustedBusy === `rm:${ip}`"
              @click="removeTrustedIp(ip)"
            >
              {{ t.trustedRemove }}
            </button>
          </li>
        </ul>
      </section>

      <!-- 攻击日志 -->
      <section class="bg-bg-secondary-40 border border-border-secondary rounded-2xl p-5 space-y-4">
        <header class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-bold text-text-primary flex items-center gap-2">
              <ScrollText :size="16" class="text-primary" /> {{ t.logsTitle }}
              <span class="text-[11px] font-semibold text-text-disabled">{{ t.total(logs.length) }}</span>
            </h3>
            <p class="mt-1 text-[11px] text-text-tertiary">{{ t.logsDesc }}</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <CustomSelect v-model="kind" :options="kindOptions" class="w-36" />
            <CustomSelect v-model="hours" :options="hourOptions" class="w-36" />
          </div>
        </header>

        <div v-if="logsError" class="flex items-center gap-2 text-[11px] text-error">
          <AlertCircle :size="14" /> {{ logsError }}
        </div>

        <div v-if="!logs.length && !logsLoading" class="py-10 text-center text-xs text-text-disabled">
          {{ t.emptyLogs }}
        </div>
        <div v-else class="overflow-auto custom-scrollbar max-h-[560px]">
          <table class="w-full min-w-[980px] text-left text-xs">
            <thead class="sticky top-0 z-10 bg-bg-secondary-40">
              <tr class="text-[10px] uppercase tracking-wider text-text-disabled border-b border-border-secondary">
                <th class="py-2 pr-3 font-semibold">{{ t.colTime }}</th>
                <th class="py-2 pr-3 font-semibold">{{ t.colKind }}</th>
                <th class="py-2 pr-3 font-semibold">{{ t.colIp }}</th>
                <th class="py-2 pr-3 font-semibold">{{ t.colBot }}</th>
                <th class="py-2 pr-3 font-semibold">{{ t.colGeo }}</th>
                <th class="py-2 pr-3 font-semibold">{{ t.colPath }}</th>
                <th class="py-2 pr-3 font-semibold">{{ t.colCount }}</th>
                <th class="py-2 pr-3 font-semibold">{{ t.colAction }}</th>
                <th class="py-2 pr-3 font-semibold">{{ t.colUserAgent }}</th>
                <th class="py-2 pr-3 font-semibold">{{ t.colFingerprint }}</th>
                <th class="py-2 font-semibold">{{ t.colDetail }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in logs"
                :key="row.id"
                class="border-b border-border-secondary/60 align-top hover:bg-bg-secondary-20"
              >
                <td class="py-2 pr-3 whitespace-nowrap text-text-tertiary">{{ formatTime(row.createdAt) }}</td>
                <td class="py-2 pr-3">
                  <span :class="['inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border', kindTone(row.kind)]">
                    {{ kindLabel(row.kind) }}
                  </span>
                </td>
                <td class="py-2 pr-3 font-semibold text-text-primary break-all">
                  {{ row.ip }}
                  <button
                    v-if="isAdminOrAbove"
                    class="ml-1 align-middle text-text-error hover:opacity-80"
                    :title="String(t.banIpButton)"
                    @click="banFromRow(row.ip)"
                  >
                    <Ban :size="12" />
                  </button>
                </td>
                <td class="py-2 pr-3">
                  <span
                    v-if="rowBotScore(row.ip) !== null"
                    :class="['inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border', botTone(rowBotScore(row.ip))]"
                    :title="rowBotReasons(row.ip)"
                  >
                    {{ rowBotScore(row.ip).toFixed(1) }}
                  </span>
                  <span v-else class="text-text-disabled">-</span>
                </td>
                <td class="py-2 pr-3 text-text-tertiary whitespace-nowrap">{{ geoLabel(row.location) }}</td>
                <td class="py-2 pr-3 text-text-tertiary break-all max-w-[200px]">{{ row.path || '-' }}</td>
                <td class="py-2 pr-3 text-text-primary font-bold">{{ row.count ?? 0 }}</td>
                <td class="py-2 pr-3 text-text-tertiary break-all">{{ row.action || '-' }}</td>
                <td class="py-2 pr-3 text-text-tertiary max-w-[220px] truncate" :title="row.userAgent || ''">
                  {{ row.userAgent || '-' }}
                </td>
                <td class="py-2 pr-3 text-text-tertiary max-w-[140px] truncate" :title="row.fingerprint || ''">
                  {{ row.fingerprint || '-' }}
                </td>
                <td class="py-2 text-text-tertiary max-w-[240px] break-all">{{ row.detail || '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <template v-else>
      <!-- 日志审计 -->
      <section class="bg-bg-secondary-40 border border-border-secondary rounded-2xl p-5 space-y-4">
        <header class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 class="text-sm font-bold text-text-primary flex items-center gap-2">
              <History :size="16" class="text-primary" /> {{ t.auditTitle }}
              <span class="text-[11px] font-semibold text-text-disabled">{{ t.auditTotal(auditTotal) }}</span>
            </h3>
            <p class="mt-1 text-[11px] text-text-tertiary">{{ t.auditDesc }}</p>
            <p class="mt-1 text-[10px] text-text-disabled">{{ t.auditNotice }}</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <div class="relative">
              <Search :size="13" class="absolute left-3 top-1/2 -translate-y-1/2 text-text-disabled" />
              <input
                v-model="auditQuery"
                :placeholder="String(t.searchPlaceholder)"
                class="w-56 rounded-xl border border-border-secondary bg-bg-primary-30 py-2 pl-8 pr-3 text-[11px] text-text-primary outline-none focus:border-primary"
                @keyup.enter="applyAuditSearch"
              />
            </div>
            <button
              class="px-3 py-2 rounded-xl text-[11px] font-bold bg-primary text-white hover:bg-primary-hover disabled:opacity-50"
              :disabled="auditLoading"
              @click="applyAuditSearch"
            >
              {{ t.search }}
            </button>
            <CustomSelect v-model="auditType" :options="auditTypeOptions" class="w-36" />
            <CustomSelect v-model="auditHours" :options="hourOptions" class="w-36" />
          </div>
        </header>

        <div v-if="auditError" class="flex items-center gap-2 text-[11px] text-error">
          <AlertCircle :size="14" /> {{ auditError }}
        </div>

        <div v-if="auditLoading && !auditLogs.length" class="py-10 text-center text-xs text-text-disabled">
          {{ t.auditLoading }}
        </div>
        <div v-else-if="!auditLogs.length" class="py-10 text-center text-xs text-text-disabled">
          {{ t.auditEmpty }}
        </div>
        <div v-else class="overflow-auto custom-scrollbar max-h-[560px]">
          <table class="w-full min-w-[1120px] text-left text-xs">
            <thead class="sticky top-0 z-10 bg-bg-secondary-40">
              <tr class="text-[10px] uppercase tracking-wider text-text-disabled border-b border-border-secondary">
                <th class="py-2 pr-3 font-semibold">{{ t.colTime }}</th>
                <th class="py-2 pr-3 font-semibold">{{ t.colActor }}</th>
                <th class="py-2 pr-3 font-semibold">{{ t.colType }}</th>
                <th class="py-2 pr-3 font-semibold">{{ t.colAction }}</th>
                <th class="py-2 pr-3 font-semibold">{{ t.colLocation }}</th>
                <th class="py-2 pr-3 font-semibold">{{ t.colIp }}</th>
                <th class="py-2 pr-3 font-semibold">{{ t.colDevice }}</th>
                <th class="py-2 font-semibold">{{ t.colDetail }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in auditLogs"
                :key="row.id"
                class="border-b border-border-secondary/60 align-top hover:bg-bg-secondary-20"
              >
                <td class="py-2.5 pr-3 whitespace-nowrap text-text-tertiary">{{ formatTime(row.createdAt) }}</td>
                <td class="py-2.5 pr-3">
                  <p class="font-bold text-text-primary break-all">{{ row.actorName || t.actorSystem }}</p>
                  <p v-if="row.actorId" class="text-[10px] text-text-disabled">#{{ row.actorId }}</p>
                </td>
                <td class="py-2.5 pr-3">
                  <span :class="['inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border', auditTypeTone(row)]">
                    {{ auditTypeLabel(row) }}
                  </span>
                </td>
                <td class="py-2.5 pr-3 max-w-[280px]">
                  <p class="font-semibold text-text-primary break-all">{{ row.actionLabel }}</p>
                  <p v-if="row.target" class="mt-0.5 text-[10px] text-text-tertiary break-all">{{ row.target }}</p>
                </td>
                <td class="py-2.5 pr-3 text-text-tertiary max-w-[170px] break-all">
                  {{ row.location?.label || '-' }}
                </td>
                <td class="py-2.5 pr-3 font-semibold text-text-primary break-all max-w-[150px]">{{ row.ip || '-' }}</td>
                <td class="py-2.5 pr-3 text-text-tertiary max-w-[220px] truncate" :title="row.userAgent || ''">
                  {{ row.userAgent || '-' }}
                </td>
                <td class="py-2.5 text-text-tertiary max-w-[300px] break-all">{{ row.detail || '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3 pt-1">
          <span class="text-[11px] text-text-disabled">
            {{ t.auditTotal(auditTotal) }} · {{ t.pageInfo(auditPage, auditTotalPages) }}
          </span>
          <div class="flex items-center gap-2">
            <button
              class="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold border border-border-secondary text-text-tertiary hover:text-text-primary disabled:opacity-40"
              :disabled="auditPage <= 1 || auditLoading"
              @click="changeAuditPage(-1)"
            >
              <ChevronLeft :size="13" /> {{ t.prevPage }}
            </button>
            <button
              class="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold border border-border-secondary text-text-tertiary hover:text-text-primary disabled:opacity-40"
              :disabled="auditPage >= auditTotalPages || auditLoading"
              @click="changeAuditPage(1)"
            >
              {{ t.nextPage }} <ChevronRight :size="13" />
            </button>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import {
  AlertCircle,
  Ban,
  Bot,
  ChevronLeft,
  ChevronRight,
  Fingerprint,
  Globe,
  History,
  Lock,
  RefreshCw,
  ScrollText,
  Search,
  ShieldAlert,
  ShieldCheck
} from '@lucide/vue'
import CustomSelect from '~/components/UI/Common/CustomSelect.vue'
import { useToast } from '~/composables/useToast'
import { usePermissions } from '~/composables/usePermissions'
import { useLocale } from '~/utils/locale'
import { formatDateTime } from '~/utils/timeUtils'
import { getSyncedTimestamp } from '~/composables/useSyncedTime'

defineOptions({ name: 'AdminAttackLogs' })

const { showToast } = useToast()
const { isSuperAdmin, isAdminOrAbove } = usePermissions()
const { admin } = useLocale()
const t = computed(() => useSafeLocale(admin.value?.attackLogs || {}))

const activeTab = ref('attacks')
const logs = ref([])
const bans = ref({ permanent: [], locks: [], fps: [] })
const kind = ref('')
const hours = ref(0)
const logsLoading = ref(false)
const bansLoading = ref(false)
const logsError = ref('')
const bansError = ref('')
const unbanning = ref('')
const lastRefresh = ref(null)

// 地域访问限制（地域锁）：开启=仅中国大陆+CDN 放行；关闭=所有 IP 放行。管理员或超级管理员可切换。
const geoEnabled = ref(false)
const geoLoading = ref(false)
const geoSaving = ref(false)
const geoSaved = ref(false)
const geoError = ref('')

// Bot 评分（边缘安全层会话快照，按账号/IP 查看）
const botScores = ref([])
const botScoresLoading = ref(false)
const botScoresError = ref('')
const botFilter = ref('')

// 手动封禁（攻击日志面板填写 IP）
const manualBanIp = ref('')
const manualBanning = ref(false)

// 出口白名单（TRUSTED_IPS）
const trustedIps = ref([])
const trustedInput = ref('')
const trustedLoading = ref(false)
const trustedBusy = ref(false)
const trustedError = ref('')
const trustedOk = ref(false)

const auditLogs = ref([])
const auditTotal = ref(0)
const auditPage = ref(1)
const auditPageSize = 50
const auditType = ref('')
const auditHours = ref(0)
const auditQuery = ref('')
const auditLoading = ref(false)
const auditError = ref('')
const auditLoaded = ref(false)

const loading = computed(() => logsLoading.value || bansLoading.value || auditLoading.value)
const loadError = computed(() =>
  activeTab.value === 'audit'
    ? auditError.value
    : [bansError.value, logsError.value].filter(Boolean).join('；')
)
const auditTotalPages = computed(() => Math.max(1, Math.ceil(auditTotal.value / auditPageSize)))

const kinds = computed(() => [
  { value: 'brute_force', label: t.value.kindBruteForce },
  { value: 'enumeration', label: t.value.kindEnumeration },
  { value: 'banned', label: t.value.kindBanned },
  { value: 'region', label: t.value.kindRegion },
  { value: 'script', label: t.value.kindScript }
])

const kindOptions = computed(() => [{ value: '', label: t.value.allKinds }, ...kinds.value])
const auditTypeOptions = computed(() => [
  { value: '', label: t.value.typeAll },
  { value: 'login', label: t.value.typeLogin },
  { value: 'action', label: t.value.typeAction }
])

const hourOptions = computed(() => [
  { value: 0, label: t.value.allTime },
  { value: 1, label: t.value.hour1 },
  { value: 24, label: t.value.hour24 },
  { value: 168, label: t.value.hour168 },
  { value: 720, label: t.value.hour720 }
])

const kindLabel = (value) => kinds.value.find((item) => item.value === value)?.label || value || '-'

const geoLabel = (location) => {
  if (!location) return '-'
  if (location.label) return location.label
  return '-'
}

const kindTone = (value) => {
  if (value === 'brute_force' || value === 'script') return 'bg-error-10 text-error border-error-20'
  if (value === 'enumeration' || value === 'region') return 'bg-warning-10 text-warning border-warning-20'
  return 'bg-primary-10 text-primary border-primary-20'
}

const auditTypeLabel = (row) => (row.type === 'login' ? t.value.typeLogin : t.value.typeAction)
const auditTypeTone = (row) => {
  if (row.type === 'action') return 'bg-primary-10 text-primary border-primary-20'
  return row.action === 'success'
    ? 'bg-success-10 text-success border-success-20'
    : 'bg-error-10 text-error border-error-20'
}

const formatTime = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : formatDateTime(date)
}

const truncate = (value, max) => {
  const text = String(value || '')
  return text.length > max ? `${text.slice(0, max)}…` : text
}

const loadLogs = async () => {
  logsLoading.value = true
  logsError.value = ''
  try {
    const result = await $fetch('/api/admin/attack-logs', {
      query: {
        limit: 200,
        ...(kind.value ? { kind: kind.value } : {}),
        ...(hours.value ? { hours: hours.value } : {})
      }
    })
    logs.value = result?.logs || []
  } catch (error) {
    logsError.value = error?.data?.message || String(t.value.loadFailed)
  } finally {
    logsLoading.value = false
    lastRefresh.value = getSyncedTimestamp()
  }
}

const loadBans = async () => {
  bansLoading.value = true
  bansError.value = ''
  try {
    const result = await $fetch('/api/admin/permanent-bans')
    bans.value = {
      permanent: result?.permanent || [],
      locks: result?.locks || [],
      fps: result?.fps || []
    }
  } catch (error) {
    bansError.value = error?.data?.message || String(t.value.bansLoadFailed)
  } finally {
    bansLoading.value = false
    lastRefresh.value = getSyncedTimestamp()
  }
}

const loadAudit = async () => {
  auditLoading.value = true
  auditError.value = ''
  try {
    const result = await $fetch('/api/admin/audit-logs', {
      query: {
        page: auditPage.value,
        pageSize: auditPageSize,
        ...(auditType.value ? { type: auditType.value } : {}),
        ...(auditHours.value ? { hours: auditHours.value } : {}),
        ...(auditQuery.value.trim() ? { q: auditQuery.value.trim() } : {})
      }
    })
    auditLogs.value = result?.logs || []
    auditTotal.value = Number(result?.total || 0)
    if (result?.page) auditPage.value = result.page
    auditLoaded.value = true
  } catch (error) {
    auditError.value = error?.data?.message || String(t.value.auditLoadFailed)
  } finally {
    auditLoading.value = false
    lastRefresh.value = getSyncedTimestamp()
  }
}

const refreshAll = async () => {
  if (activeTab.value === 'audit') {
    await loadAudit()
    return
  }
  await Promise.all([loadLogs(), loadBans()])
}

const setTab = (tab) => {
  activeTab.value = tab
  if (tab === 'audit' && !auditLoaded.value) {
    loadAudit()
  }
}

const applyAuditSearch = () => {
  auditPage.value = 1
  loadAudit()
}

const changeAuditPage = (delta) => {
  const next = auditPage.value + delta
  if (next < 1 || next > auditTotalPages.value) return
  auditPage.value = next
  loadAudit()
}

const unban = async (type, value) => {
  if (!isSuperAdmin.value) return
  if (!window.confirm(t.value.unbanConfirm(value))) return
  unbanning.value = `${type}:${value}`
  try {
    const result = await $fetch('/api/admin/permanent-bans', {
      method: 'POST',
      body: { type, value }
    })
    showToast(String(result?.removed ? t.value.unbanOk : t.value.unbanNothing), result?.removed ? 'success' : 'info')
    await Promise.all([loadBans(), loadLogs()])
  } catch (error) {
    showToast(error?.data?.message || String(t.value.unbanFailed), 'error')
  } finally {
    unbanning.value = ''
  }
}

watch([kind, hours], loadLogs)
watch([auditType, auditHours], () => {
  auditPage.value = 1
  auditLoaded.value = false
  loadAudit()
})

const loadGeoLock = async () => {
  geoLoading.value = true
  geoError.value = ''
  try {
    const result = await $fetch('/api/admin/geo-lock')
    geoEnabled.value = !!result?.enabled
  } catch (error) {
    geoError.value = error?.data?.message || String(t.value.geoLockFailed)
  } finally {
    geoLoading.value = false
  }
}

const toggleGeoLock = async () => {
  if (!isAdminOrAbove.value || geoSaving.value) return
  geoSaving.value = true
  geoSaved.value = false
  geoError.value = ''
  try {
    const next = !geoEnabled.value
    const result = await $fetch('/api/admin/geo-lock', {
      method: 'POST',
      body: { enabled: next }
    })
    geoEnabled.value = !!result?.enabled
    geoSaved.value = true
    setTimeout(() => { geoSaved.value = false }, 2500)
  } catch (error) {
    geoError.value = error?.data?.message || String(t.value.geoLockFailed)
  } finally {
    geoSaving.value = false
  }
}

// ---- Bot 评分 ----
const filteredBotScores = computed(() => {
  const kw = botFilter.value.trim().toLowerCase()
  if (!kw) return botScores.value
  return botScores.value.filter((row) => String(row.account || '').toLowerCase().includes(kw))
})

const botTone = (score) => {
  if (score >= 9) return 'bg-error-10 text-error border-error-20'
  if (score >= 5) return 'bg-warning-10 text-warning border-warning-20'
  return 'bg-primary-10 text-primary border-primary-20'
}

const rowBotScore = (ip) => {
  if (!ip) return null
  const hit = botScores.value.filter((row) => row.ip === ip && row.score > 0)
  if (!hit.length) return null
  return Math.max(...hit.map((row) => row.score))
}

const rowBotReasons = (ip) => {
  const hit = botScores.value.filter((row) => row.ip === ip && row.score > 0)
  return hit.map((row) => row.reasons.join(', ')).filter(Boolean).join(' | ')
}

const loadBotScores = async () => {
  botScoresLoading.value = true
  botScoresError.value = ''
  try {
    const result = await $fetch('/api/admin/bot-scores')
    botScores.value = result?.scores || []
  } catch (error) {
    botScoresError.value = error?.data?.message || String(t.value.botLoadFailed)
  } finally {
    botScoresLoading.value = false
  }
}

// ---- 手动封禁 ----
const banIp = async (ip) => {
  if (!isAdminOrAbove.value || manualBanning.value) return
  if (!window.confirm(String(t.value.rowBanConfirm).replace('{0}', ip))) return
  manualBanning.value = true
  try {
    await $fetch('/api/admin/ban-ip', {
      method: 'POST',
      body: { ip, detail: 'banned from attack logs panel' }
    })
    showToast(`${String(t.value.banIpOk)} ${ip}`, 'success')
    manualBanIp.value = ''
    await Promise.all([loadBans(), loadLogs(), loadBotScores()])
  } catch (error) {
    showToast(error?.data?.message || String(t.value.banIpFailed), 'error')
  } finally {
    manualBanning.value = false
  }
}

const banManual = () => {
  const ip = manualBanIp.value.trim()
  if (ip) banIp(ip)
}

const banFromRow = (ip) => {
  if (ip) banIp(ip)
}

// ---- 出口白名单 ----
const loadTrustedIps = async () => {
  trustedLoading.value = true
  trustedError.value = ''
  try {
    const result = await $fetch('/api/admin/trusted-ips')
    trustedIps.value = result?.ips || []
  } catch (error) {
    trustedError.value = error?.data?.message || String(t.value.trustedFailed)
  } finally {
    trustedLoading.value = false
  }
}

const updateTrustedIp = async (action, ip) => {
  if (!isAdminOrAbove.value) return
  trustedBusy.value = action === 'add' ? true : `rm:${ip}`
  trustedError.value = ''
  trustedOk.value = false
  try {
    const result = await $fetch('/api/admin/trusted-ips', {
      method: 'POST',
      body: { action, ip }
    })
    trustedIps.value = result?.ips || []
    trustedOk.value = true
    if (action === 'add') trustedInput.value = ''
    setTimeout(() => { trustedOk.value = false }, 2500)
  } catch (error) {
    trustedError.value = error?.data?.message || String(t.value.trustedFailed)
  } finally {
    trustedBusy.value = false
  }
}

const addTrustedIp = () => {
  const ip = trustedInput.value.trim()
  if (ip) updateTrustedIp('add', ip)
}

const removeTrustedIp = (ip) => updateTrustedIp('remove', ip)

onMounted(() => {
  refreshAll()
  loadGeoLock()
  loadBotScores()
  loadTrustedIps()
})
</script>
