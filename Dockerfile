# Modified by YH-Chen-Eternity on 2026-10-23

# ==========================================
# 第一阶段：构建阶段
# ==========================================
# Nuxt/Vite 使用原生构建器。始终在 CI runner 的原生平台编译，避免 QEMU
# 执行 Rolldown 时崩溃；生成的 Nitro 输出不包含目标架构原生二进制。
FROM --platform=$BUILDPLATFORM node:24-alpine AS builder

WORKDIR /app

# 依赖安装阶段只复制 postinstall 所需脚本，避免其他脚本变更使依赖缓存失效
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/postinstall.js ./scripts/postinstall.js

# 安装所有依赖
RUN set -eux; \
    export CI=true; \
    npm install -g pnpm@10.29.3; \
    pnpm config set fetch-retries 5; \
    pnpm config set fetch-retry-mintimeout 20000; \
    pnpm config set fetch-retry-maxtimeout 120000; \
    pnpm install --frozen-lockfile || ( \
      rm -rf node_modules; \
      pnpm install --no-frozen-lockfile || ( \
        pnpm config set registry https://registry.npmmirror.com; \
        pnpm install --no-frozen-lockfile \
      ) \
    )

# 复制所有源代码
COPY . .

# 构建应用
RUN pnpm run build

# ==========================================
# 第二阶段：运行阶段
# ==========================================
# 预定义各架构的运行时镜像
FROM node:24-alpine AS runtime-amd64
FROM node:24-alpine AS runtime-arm64
# Node 24 镜像已移除 arm/v7，32 位 ARM 使用 Node 22
FROM node:22-alpine AS runtime-arm
FROM node:24-trixie-slim AS runtime-s390x
FROM node:24-trixie-slim AS runtime-ppc64le

# 根据 TARGETARCH 选择对应的运行时镜像
FROM runtime-${TARGETARCH} AS runtime

WORKDIR /app

# 创建非 root 运行用户（2026-10-23 安全加固：原镜像 USER root，
# 一旦应用被 RCE，攻击者直接持有容器内 root 权限）
RUN set -eux; \
    if getent group voicehub >/dev/null 2>&1; then \
      adduser -S voicehub -G voicehub 2>/dev/null || true; \
    else \
      addgroup -S voicehub && adduser -S voicehub -G voicehub; \
    fi

# 运行依赖必须在目标平台安装，不能从构建平台复制 node_modules。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/postinstall.js ./scripts/postinstall.js
RUN set -eux; \
    export CI=true; \
    npm install -g pnpm@10.29.3; \
    pnpm config set fetch-retries 5; \
    pnpm config set fetch-retry-mintimeout 20000; \
    pnpm config set fetch-retry-maxtimeout 120000; \
    pnpm install --prod --frozen-lockfile

# 从构建阶段复制必要文件
COPY --from=builder /app/drizzle.config.ts ./
COPY --from=builder /app/.output ./.output
COPY --from=builder /app/app/drizzle ./app/drizzle
# db.ts 运行时依赖该模块（tsx 直跑源码），缺失会导致 migrate/create-admin 报 ERR_MODULE_NOT_FOUND
COPY --from=builder /app/server/utils/serverless-runtime.ts ./server/utils/
COPY --from=builder /app/scripts ./scripts

# 环境变量配置
ENV NODE_ENV=production \
    PORT=3000 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    PREBUILT=true

# 应用运行期需要写入 backups/（备份）、logs/（日志）、.data/（插件产物），
# 均在 /app 下；整体授权给运行用户后切换为非 root 运行
RUN chown -R voicehub:voicehub /app
USER voicehub

# 暴露端口
EXPOSE $PORT

# 完成数据库迁移后启动应用，插件配置由服务端读取。
CMD ["sh", "-c", "node scripts/deploy.js && node .output/server/index.mjs"]
