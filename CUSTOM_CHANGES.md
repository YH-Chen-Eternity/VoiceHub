# VoiceHub 定制源码修改说明

> 适用源码：`voicehub-plus-final2-20261023.tar.gz`
> 线上镜像：`voicehub-voicehub:final2-20261023`
> 生成日期：2026-10-23
> 上游基线：`YH-Chen-Eternity/VoiceHub-Plus`，commit `b3917943976e1bcdbc2c6296064efa225e09df31`（v1.6.0.5，2026-10-17）

本文说明「相对上游基线到底改了哪些文件、每处改动的目的、改完后的行为」。
所有结论来自源码逐文件对比和生产运行验证，不是凭记忆整理。

---

## 一、改动规模

| 项目 | 数量 | 说明 |
|---|---:|---|
| 新增文件 | 19 | 不含 `deploy/` 参考部署文件 |
| 修改文件 | 32 | 无删除文件 |
| 新增数据库迁移 | 4 | 迁移总数变为 67 |
| 新增参考部署文件 | 9 | `deploy/` 目录，独立于 Nuxt 构建 |
| 删除文件 | 0 | — |

对比方法（结果为 19 新增 / 32 修改 / 0 删除）：

```bash
diff -rq \
  --exclude=.git --exclude=node_modules --exclude=.output --exclude=.nuxt \
  --exclude=deploy --exclude=package-lock.json \
  /path/to/upstream /path/to/voicehub-plus-final2-20261023
```

> 注意：V1.6.0.5 上游（VoiceHub-Plus）本身已包含匿名投稿、公告栏、注册审核、
> 实名/用户名变更等功能，这些**不是本次新增**，升级上游时不要重复实现。
> 本次新增的是「安全会话、登录审计、攻击日志、管理员守卫、密码流程人机验证」等加固项。

---

## 二、如何使用这份源码

### 2.1 目录结构

```
voicehub-plus-final2-20261023/
├── app/                 Nuxt 前端 + Drizzle schema/migrations
├── server/              Nitro 服务端接口与工具
├── public/              静态资源
├── deploy/              线上参考配置（compose / nginx / rewriter / env 示例）
├── Dockerfile           多阶段构建：node:24-alpine 构建 → Nitro 运行
├── package.json         name=voicehub-plus, version=1.6.0.5
├── package-lock.json    锁定依赖
└── CUSTOM_CHANGES.md    本文件
```

### 2.2 重新构建镜像

```bash
cd /data/voicehub/src-final2-20261023
docker build -t voicehub-voicehub:rebuild-YYYYMMDD .
# 修改 /data/voicehub/.env 的 VOICEHUB_IMAGE 后：
cd /data/voicehub && docker compose up -d voicehub
```

数据库迁移由应用启动流程执行；迁移文件在 `app/drizzle/migrations/`。
构建前不要删除 `package-lock.json`，否则依赖版本会漂移。

### 2.3 回滚

```bash
# 镜像回滚
sed -i 's/^VOICEHUB_IMAGE=.*/VOICEHUB_IMAGE=voicehub-voicehub:node-sec-20261022/' /data/voicehub/.env
cd /data/voicehub && docker compose up -d voicehub
```

回滚镜像 `node-sec-20261022` 仍在服务器上。数据库迁移是向前兼容的（只加表/加列），
回滚旧镜像不需要删表；但旧镜像不会使用新增的审计/攻击日志表。

---

## 三、新增文件（19 个）

### 3.1 攻击日志与封禁管理

| 文件 | 改了什么 | 作用 |
|---|---|---|
| `app/components/Admin/AttackLogs.vue` | 新增管理端页面：攻击事件表格、类型/时间筛选、刷新；永久封禁 / IP 临时锁定 / 指纹锁定三栏；超级管理员可点「解封」 | 让站长在后台直接看到边缘层拦截了谁、为什么拦，并能对误封自助解封，不必登服务器改文件 |
| `server/api/admin/attack-logs.get.ts` | 新增 `GET /api/admin/attack-logs`；仅 `ADMIN`/`SUPER_ADMIN`；支持 `limit`（1–500，默认 200）、`kind`、`hours`（0–720） | 为后台攻击日志页提供查询接口；限制返回条数和时间范围，避免大表拖垮数据库 |
| `server/api/admin/permanent-bans.get.ts` | 新增 `GET /api/admin/permanent-bans`；仅管理员 | 读取 rewriter 当前的三类封禁快照（永久 / IP 锁定 / 指纹锁定） |
| `server/api/admin/permanent-bans.post.ts` | 新增 `POST /api/admin/permanent-bans`；仅 `SUPER_ADMIN`；校验 IP 用 `net.isIP`、指纹用字符白名单；调用 rewriter 解封 | 把「解封」收敛为超级管理员操作，避免普通管理员误放攻击源；输入校验防注入/畸形值 |
| `server/api/internal/attack-log.post.ts` | 新增 `POST /api/internal/attack-log`；`x-attack-token` 与 `ATTACK_LOG_TOKEN` 做 `timingSafeEqual`；未配置令牌返回 503；类型白名单 `brute_force/enumeration/banned/region/script`；所有字段截断后入库 | 给 rewriter 一个受控的攻击事件写入口；避免日志接口被公网伪造写入、避免超长字段撑爆数据库 |
| `server/utils/rewriterBans.ts` | 新增 rewriter 内部调用封装：`GET /__internal/bans`、`POST /__internal/unban`，携带 `ATTACK_LOG_TOKEN`，5 秒超时 | 应用不直接读 rewriter 状态文件，统一走内部 HTTP；rewriter 不可用时返回 502 而不是 500 |
| `server/utils/requireAdmin.ts` | 新增 `requireAdmin(event, roles)` / `requireSuperAdmin(event)` | 统一管理接口的登录与角色校验，减少各接口各写一套导致漏判 |
| `server/middleware/zz-admin-guard.ts` | 新增全局兜底：所有 `/api/admin/**` 必须登录且角色为 `ADMIN`/`SUPER_ADMIN`/`SONG_ADMIN`；`SONG_ADMIN` 只允许 6 个白名单路径；写操作自动记审计 | 即使某个接口自己忘了鉴权，也会被全局中间件拦住；同时把歌曲管理员的权限压到最小 |
| `server/utils/adminAudit.ts` | 新增审计写入：操作者 id/用户名、action、target、IP、UA；写失败只记日志不阻断业务 | 管理端增删改可追溯；审计故障不影响正常运营 |

### 3.2 密码流程人机验证

| 文件 | 改了什么 | 作用 |
|---|---|---|
| `server/utils/password-turnstile.ts` | 新增 `assertPasswordTurnstile(body, ip)`：仅在后台启用 Turnstile 时校验；无 token 返回 400，校验失败返回 400，Turnstile 服务异常返回 500 | 给「忘记密码 / 重置密码 / 修改密码」补上登录接口已有的人机验证，阻断脚本批量试邮箱、批量改密 |

### 3.3 备份触发保护

| 文件 | 改了什么 | 作用 |
|---|---|---|
| `server/utils/backupTriggerToken.ts` | 新增 `assertBackupTriggerToken(event)`：`BACKUP_TRIGGER_TOKEN` 未配置时放行（兼容旧行为）；配置后从 `?token=` 或 `x-backup-token` 读取并 `timingSafeEqual` | 允许给外部定时器触发备份的 URL 加共享令牌，避免公开接口被随意调用 |

### 3.4 数据库迁移（4 个）

| 文件 | 改了什么 | 作用 |
|---|---|---|
| `app/drizzle/migrations/20261018010000_add_admin_audit_log.sql` | 新建 `AdminAuditLog` 表 + `createdAt`、`action` 索引 | 管理端敏感操作审计 |
| `app/drizzle/migrations/20261018013000_add_login_attempt_log.sql` | 新建 `LoginAttempt` 表 + `createdAt`、`username` 索引 | 登录成功/失败/锁定追溯 |
| `app/drizzle/migrations/20261018030000_add_name_change_field.sql` | `NameChangeRequest` 增加 `field`（默认 `NAME`，非空） | 区分「改姓名」与「改用户名」两类申请 |
| `app/drizzle/migrations/20261018120000_add_attack_log.sql` | 新建 `AttackLog` 表 + 时间/IP/类型索引 | 存 rewriter 上报的攻击事件 |

### 3.5 品牌资源（4 个）

| 文件 | 作用 |
|---|---|
| `public/images/logo.png` | 站点 Logo 素材（后台站点配置/页面图片 URL 可引用） |
| `public/images/school-logo-light.png` | 浅色背景校徽素材 |
| `public/images/校徽.png` | 校徽原图 |
| `public/images/校徽.webp` | 校徽 WebP 压缩版 |

这些是静态素材，不参与业务逻辑；不引用也不会导致构建或运行失败。

### 3.6 参考部署文件（`deploy/`，9 个，不进入镜像）

| 文件 | 作用 |
|---|---|
| `deploy/docker-compose.yml` | 腾讯云生产编排参考：rewriter → voicehub → postgres/redis，端口只绑 `127.0.0.1`，TZ=UTC |
| `deploy/.env.example` | 环境变量模板（不含真实密钥） |
| `deploy/nginx/voicehub.conf` | 站点主配置：443、mTLS `ssl_verify_client on`、回源 3001、限流、安全头 |
| `deploy/nginx/voicehub-proxy.conf` | 统一回源 proxy 头，放大 header 缓冲避免 Nuxt SSR 502 |
| `deploy/nginx/cloudflare-real-ip.conf` | Cloudflare 真实 IP 还原 |
| `deploy/nginx/99-performance.conf` | 连接数限制与静态缓存 |
| `deploy/rewriter/app-rewriter.js` | 边缘安全层源码副本（地域闸/封禁/脚本识别/攻击声明页/攻击上报/内部解封接口） |
| `deploy/rewriter/guangdong-cidrs.txt` | 广东放行网段 |
| `deploy/rewriter/geo-allow-cidrs.txt` | 地域闸其他放行网段 |

`deploy/` 只是「可重建的参考副本」，线上实际配置在 `/data/voicehub/`。
不要用 `deploy/docker-compose.yml` 直接覆盖生产文件（生产有真实密钥与卷路径）。

---

## 四、修改文件（32 个）

> 下面按功能分组，便于理解「为什么改」。同一个文件涉及多项改动时会在多节重复出现
> （如 `login.post.ts` 同时改会话和登录日志、`schema.ts` 同时加三张表）；
> **按文件去重后共 32 个修改文件**。§4.5 列出的两个是新增工具文件，放在这里是为了说明
> 它们与管理员接口改动的关联，不重复计入 32。

### 4.1 登录态：7 天 → 6 小时

统一把 JWT、Cookie、数据库会话的有效期从 7 天改为 6 小时，并取消自动续期。

| 文件 | 改了什么 | 作用 |
|---|---|---|
| `server/utils/jwt-enhanced.ts` | `TOKEN_EXPIRES: '7d' → '6h'`；`REFRESH_THRESHOLD: 24h → 0` | 登录态最长 6 小时；阈值为 0 表示不再自动续期，到点必须重新登录 |
| `server/utils/auth-session.ts` | `AUTH_SESSION_MAX_AGE_SECONDS: 7d → 6h` | 数据库 `auth_sessions.expiresAt` 与 JWT 对齐，避免「JWT 过期但会话仍有效」 |
| `server/middleware/auth.ts` | 续期 Cookie `maxAge` 改为 6h | 中间件即使签发新 Cookie，也不会把有效期拉回 7 天 |
| `server/api/auth/login.post.ts` | 登录 Cookie `maxAge` 改为 6h | 账密登录入口对齐 |
| `server/api/auth/2fa/verify.post.ts` | 2FA 完成后的 Cookie 改为 6h | 两步验证入口对齐 |
| `server/api/auth/[provider]/callback.get.ts` | OAuth 回调 Cookie 改为 6h | 第三方登录入口对齐 |
| `server/api/auth/bind.post.ts` | 绑定第三方账号后的 Cookie 改为 6h | 绑定流程对齐 |
| `server/api/auth/change-password.post.ts` | 改密后的 Cookie 改为 6h | 改密后重新签发的会话不再回到 7 天 |
| `server/api/auth/oauth-register.post.ts` | OAuth 注册后的 Cookie 改为 6h | 注册即登录入口对齐 |
| `server/api/auth/register.post.ts` | 普通注册后的 Cookie 改为 6h | 注册即登录入口对齐 |
| `server/api/auth/set-initial-password.post.ts` | 首次设密后的 Cookie 改为 6h | 首次登录入口对齐 |
| `server/api/auth/webauthn/login/verify.post.ts` | WebAuthn 登录后的 Cookie 改为 6h | 生物识别/安全密钥入口对齐 |

**影响**：所有用户（含管理员）每 6 小时需要重新登录一次；切镜像后旧 7 天 token
仍能用到自身过期，但新登录一律 6 小时。该改动用于缩小 Cookie/Token 泄露后的可用窗口。

### 4.2 密码流程接入 Turnstile

| 文件 | 改了什么 | 作用 |
|---|---|---|
| `server/api/auth/forgot-password.post.ts` | 读取 body 后调用 `assertPasswordTurnstile` | 忘记密码第一步/第二步都要求人机验证（启用时） |
| `server/api/auth/reset-password.post.ts` | 校验 token/新密码前调用 `assertPasswordTurnstile` | 重置密码链接被脚本批量尝试时先过 Turnstile |
| `server/api/auth/change-password.post.ts` | 校验旧密码前调用 `assertPasswordTurnstile` | 已登录用户改密也要过人机验证，防会话被盗后脚本改密 |
| `app/pages/forgot-password.vue` | 引入 `TurnstileWidget`；两步都带 token；切换步骤/失败后重置 widget；返回上一步统一走 `goBack()` | 前端能完成验证并正确换新 token（Turnstile token 一次性） |
| `app/pages/reset-password.vue` | 引入 `TurnstileWidget`，提交带 `turnstileToken`，失败重置 | 重置页可视化验证 |
| `app/components/Auth/ChangePasswordForm.vue` | 非首次登录时显示 Turnstile；提交带 token；失败重置 | 改密表单可视化验证 |
| `app/composables/useAuth.ts` | `changePassword` 增加第三个参数 `turnstileToken` 并放入请求体 | 前端把 token 传到服务端 |

**行为**：后台未启用 Turnstile 时完全不拦截；启用后，上述三个流程缺 token 会返回
`AUTH_CAPTCHA_REQUIRED`，前端会显示人机验证组件。首次登录强制设密不要求 Turnstile
（此时用户刚通过登录验证，且必须设置初始密码）。

### 4.3 登录尝试日志

| 文件 | 改了什么 | 作用 |
|---|---|---|
| `server/api/auth/login.post.ts` | 内联 `recordLoginAttempt()`；记录 `account_locked`、`no_user`、`wrong_password`、`status_rejected`、`success` 五类结果；写入用户名、IP、UA、详情，字段截断 | 登录失败/成功可追溯，便于判断撞库、枚举、锁定误伤；不记录密码 |
| `app/drizzle/schema.ts` | 新增 `LoginAttempt` 表定义与类型 | 与迁移文件对应，Drizzle 查询可用 |

**注意**：`no_user` 会记录「被尝试但不存在的用户名」，这是安全审计需要；
该表目前没有自动清理策略，长期运行应加保留期（见第九节）。

### 4.4 攻击日志与封禁

| 文件 | 改了什么 | 作用 |
|---|---|---|
| `app/drizzle/schema.ts` | 新增 `AttackLog`、`AdminAuditLog`、`LoginAttempt` 三张表；`NameChangeRequest` 增加 `field` | 代码模型与 4 个迁移一致 |
| `app/drizzle/migrations/meta/_journal.json` | 注册 4 个新迁移（idx 63–66） | 保证启动时按顺序执行迁移 |
| `server/utils/auth-route-policy.ts` | 公开 API 白名单增加 `POST /api/internal/attack-log` | 让 rewriter 不带用户 Cookie 也能写日志；接口自身用共享令牌鉴权 |
| `app/composables/usePermissions.ts` | `ADMIN` / `SUPER_ADMIN` 增加 `attack-logs` 页面权限 | 只有管理员能在后台看到攻击日志菜单 |
| `app/components/Admin/Sidebar.vue` | 增加「攻击日志」菜单与 `ShieldAlert` 图标 | 后台入口 |
| `app/pages/dashboard.vue` | 增加 `attack-logs` Tab，懒加载 `AdminAttackLogs` | 页面挂载与权限判断 |
| `app/utils/locale/zh-CN.ts` | 增加攻击日志全部中文文案、菜单名 | 中文界面完整 |
| `app/utils/locale/en-US.ts` | 增加攻击日志全部英文文案、菜单名 | 英文界面完整 |

**数据流**：rewriter 检测到暴力破解/枚举/封禁命中/地域阻断/脚本行为
→ `POST /api/internal/attack-log`（`x-attack-token`）
→ `AttackLog` 表
→ 后台「攻击日志」页。
解封走反向链路：后台 → `/api/admin/permanent-bans` → rewriter `/__internal/unban`。

### 4.5 管理员权限与审计

| 文件 | 改了什么 | 作用 |
|---|---|---|
| `server/middleware/zz-admin-guard.ts` | 见新增文件表；所有 `/api/admin/**` 兜底鉴权，`SONG_ADMIN` 仅 6 个路径，写操作审计 | 防止单个接口漏鉴权导致越权；把歌曲管理员限制在排期/歌曲/重播相关只读或必要操作 |
| `server/utils/adminAudit.ts` | 见新增文件表 | 管理端写操作留痕 |

`SONG_ADMIN` 白名单：

```
GET  /api/admin/schedule/full
GET  /api/admin/schedule/song-pool
POST /api/admin/songs/mark-played
GET  /api/admin/songs/duration
POST /api/admin/songs/duration
GET  /api/admin/replay-requests
```

白名单只是「允许进入接口」，接口内部若还有更严格角色判断，以接口为准
（例如 `schedule/full` 自身仍要求 `ADMIN`，因此歌曲管理员实测为 403）。

### 4.6 备份接口令牌

| 文件 | 改了什么 | 作用 |
|---|---|---|
| `server/api/open/backup/auto.post.ts` | handler 改为接收 `event`，第一行调用 `assertBackupTriggerToken(event)` | 配置令牌后，外部必须带正确 token 才能触发备份；未配置时保持旧行为 |

### 4.7 公开留言审核通知

| 文件 | 改了什么 | 作用 |
|---|---|---|
| `server/api/songs/replay.post.ts` | 当重播申请的公开留言状态为 `PENDING` 时，给所有 `ADMIN`/`SUPER_ADMIN` 插入站内通知；失败只记日志 | 以前公开留言待审没有提醒，容易长期积压；现在管理员在站内能收到 |
| `server/services/songRequestService.ts` | 投稿歌曲的公开留言为 `PENDING` 时同样通知管理员；同时给 `playUrl` 增加 `http(s)://` 校验 | 同上；并阻止 `javascript:`/`data:` 等非 HTTP 播放链接进入数据库/前端 |

### 4.8 通知收敛

| 文件 | 改了什么 | 作用 |
|---|---|---|
| `server/utils/registration-notify.ts` | 移除 `enqueueAstrbotGroupEvent` 群推送；改为直接插入 `notifications` 站内通知；保留邮件通知 | 注册审核含学生姓名/班级，不再推到群聊；站内通知足够管理员处理，减少隐私外泄面 |

**注意**：重播申请的群推送仍然保留（`replay.post.ts`），只收敛了注册待审通知。

### 4.9 其他修复

| 文件 | 改了什么 | 作用 |
|---|---|---|
| `server/api/songs/public.get.ts` | 删除重复的 `submissionAnonymous` 字段（默认对象、SQL 选择、输出各一处） | 消除重复列/重复键带来的字段覆盖歧义；实际输出仍保留 `submissionAnonymous`，行为不变 |
| `server/utils/qq_music_sdk.ts` | CDN 调度/签名请求失败时不再打印完整错误对象，改为简短 `console.warn` | 降低日志噪声，避免第三方错误对象里带出请求细节/凭据片段 |

---

## 五、数据库变更

| 迁移 | 表/字段 | 是否破坏旧数据 |
|---|---|---|
| `20261018010000_add_admin_audit_log` | 新表 `AdminAuditLog` | 否 |
| `20261018013000_add_login_attempt_log` | 新表 `LoginAttempt` | 否 |
| `20261018030000_add_name_change_field` | `NameChangeRequest.field`，默认 `'NAME'` | 否，旧记录自动为 `NAME` |
| `20261018120000_add_attack_log` | 新表 `AttackLog` | 否 |

线上迁移总数 67；本次切换前已备份数据库，迁移在 final2 启动时执行成功。

---

## 六、行为变化与运维影响

1. **所有人 6 小时重新登录**：这是有意收窄会话窗口，不是故障。
2. **密码流程需要 Turnstile**：生产已启用 Turnstile；忘记密码/重置/改密页面会出现验证组件。
   如果 Cloudflare Turnstile 故障，这三个流程会失败，但登录/浏览不受影响。
3. **注册待审不再有群消息**：管理员需看站内通知或用户管理页。
4. **公开留言待审会有站内通知**：管理员通知数可能增加，这是预期。
5. **攻击日志页需要管理权限**：`SONG_ADMIN` 看不到该菜单，接口也返回 403。
6. **解封仅超级管理员**：普通管理员只能看封禁名单，不能点解封。
7. **备份触发令牌**：当前生产未配置 `BACKUP_TRIGGER_TOKEN`，`/api/open/backup/auto`
   仍保持旧行为；建议配置后再对外使用（见第九节）。
8. **GEO_GATE / TRUST_CF_HEADER 未改动**：生产仍为 `GEO_GATE=0`、`TRUST_CF_HEADER=0`，
   与本次源码修改无关；是否开启地域闸需站长单独确认。

---

## 七、验证记录（2026-10-23）

| 项目 | 结果 |
|---|---|
| 源码构建 final2 镜像 | 成功，生产已运行 |
| 数据库迁移 | 67 个，全部成功 |
| 全量接口回归 | PASS=108 / FAIL=8；8 项均为测试脚本预期/数据问题，复核后无产品缺陷 |
| 修正 suite 回归 | PASS=18 / FAIL=0 |
| Turnstile | 登录无 token → 400；密码流程已接入 |
| 2FA / 找回密码 / 封禁解封 | 通过 |
| 管理员接口未授权 | 无 token 访问 `/api/admin/*` | 401 |
| SONG_ADMIN 越权 | 访问总览/用户/系统设置 | 403 |
| 攻击日志内部写入 | 带令牌 200，无令牌 403 |
| 生产冒烟 | 首页/登录/site-config/sys-time 全部 200 |
| 容器 | 5 个容器运行，3000/3001 仅本机监听 |
| 恢复演练 | `pg_dump -Fc` → `pg_restore` 退出码 0，核心表行数一致 |

详细用例见交接包 `09-测试与验收.md`。

---

## 八、已知残留风险（本次未改）

| 风险 | 说明 | 建议 |
|---|---|---|
| `GEO_GATE=0` | 地域闸代码可用但生产关闭；境外访问主要靠 Cloudflare WAF | 站长确认放行网段后再开启，先在 staging 验证 |
| `BACKUP_TRIGGER_TOKEN` 未配置 | `/api/open/backup/auto` 公开可触发；虽不泄露数据，但可被反复调用消耗磁盘/CPU | 配置高熵令牌，并在外部定时器 URL 加 `?token=` |
| 登录/攻击日志无自动清理 | 表会持续增长 | 增加按天清理任务（如保留 90 天） |
| `voicehub` 免密 sudo + docker 组 | 等同 root | 改密钥登录、收紧 sudo、移出 docker 组（需改部署方式） |
| 第三方音源 Key 硬编码 | `server/api/music/resolve-url.post.ts` 仍有 `HYW_CARD_KEY` / `YUAFENG_TX_APIKEY` | 移到环境变量并轮换；本次未改，避免影响线上取链 |
| 2FA 未强制 | `Ming`/`广播站` 管理员未开 2FA | 站长按需开启 |
| rewriter 内部令牌比较 | `/__internal/*` 用普通字符串比较而非 `timingSafeEqual` | 仅容器内网可达，风险低；后续可统一为常量时间比较 |

---

## 九、升级上游时的检查清单

1. 先备份本源码包、数据库、`.env`。
2. 合并上游后重点检查：
   - `server/middleware/zz-admin-guard.ts` 是否还在；
   - `AttackLog` / `LoginAttempt` / `AdminAuditLog` 表与 4 个迁移是否还在；
   - `server/utils/password-turnstile.ts` 是否仍被三个密码接口调用；
   - 所有登录入口 Cookie 是否仍为 6h；
   - `server/api/internal/attack-log.post.ts` 是否仍在公开白名单；
   - `server/utils/registration-notify.ts` 是否又被加回群推送；
   - `playUrl` 的 `http(s)` 校验是否被覆盖。
3. 重建镜像 → staging 回归 → 生产切换。
4. 同步 `deploy/rewriter/app-rewriter.js` 到 `/data/voicehub/rewriter/`（rewriter 不在镜像里）。

---

## 十、回声社区（BBS）融合（2026-10-24，未部署生产）

> 分支：`community/voicehub-plus`。本节内容仅存在于本地开发分支，
> **生产仍运行 `voicehub-voicehub:final2-20261023`，未做任何变更**。

### 10.1 入口与权限

| 入口 | 位置 | 可见角色 |
|---|---|---|
| 社区信息流 | 首页第五个 Tab「社区」 | 所有登录用户（社区关闭时仅管理员/审帖员） |
| 进入审帖后台 | 信息流头部按钮 | `ADMIN` / `SUPER_ADMIN` / `REVIEWER`（且有可审板块） |
| 社区帖子审核 | 管理后台「审核」分组 | 同上（`REVIEWER` 仅此一栏） |
| 社区板块 / 称号 / 用户 / 配置 | 管理后台「回声社区」分组 | `ADMIN` / `SUPER_ADMIN` |
| 社区资料 | 账号页「回声社区」卡片 | 本人（含隐私、收藏歌曲、称号、违规与禁言状态） |

- 新增角色值 `REVIEWER`（审帖员）：权限 = 普通用户 + 审帖，`/api/admin/*` 一律 403；
  审帖接口 `/api/community/review/*` 仅 `REVIEWER`/管理员可用，且受板块分配范围限制。
- `BROADCASTER`（放歌员）仅补充角色名称与可分配项，不获得社区管理权限。

### 10.2 数据模型与迁移

新增迁移 `app/drizzle/migrations/20261024015840_community.sql`，创建 9 张表：
`CommunityBoard`、`CommunityBoardReviewer`、`CommunityTitle`、`CommunityUserTitle`、
`CommunityProfile`、`CommunityPost`、`CommunityComment`、`CommunityPostImage`、
`CommunitySettings`（单例 `id=1`，默认关闭）。迁移同时写入 4 个默认板块、
4 个默认称号与默认配置行；不修改任何既有表。

### 10.3 行为要点

- 发帖默认进入 `PENDING`，审帖通过后才出现在信息流；驳回写入站内通知并累计违规。
- 违规第 3 次自动禁言 30 天，第 6 次永久禁言；禁言期间禁止发帖、评论、上传图片。
- 管理员可重置违规、解除禁言、手动禁言（指定天数或永久）。
- 昵称展示统一脱敏为「年级班级 + 姓*名 + [称号]」，不展示头像；点击姓名可看个人页，
  收藏歌曲 / 点赞歌曲受本人隐私开关控制。
- 「附上一首歌」复用既有 `Song` 与 `Vote`：帖子内点赞直接调用 `/api/songs/vote`，
  点赞数与歌曲列表一致，不新增投票表。
- 图片：PNG/JPEG/WebP/GIF，单张 ≤2MB，每日 30 张；是否允许发图由后台开关控制，
  关闭后上传接口与带图发帖同时拒绝。
- 阿里云内容安全（Green 2022-03-02）文本/图片审核为辅助标记：未配置密钥或接口异常时
  只转人工，绝不自动放行；命中策略可选「转人工审核」或「直接拦截」。
  图片审核需配置 `COMMUNITY_PUBLIC_ORIGIN`，否则只走人工。

### 10.4 主要文件

- 前端：`app/components/Community/*`、`app/components/Admin/Community*.vue`、
  `app/components/Account/CommunitySection.vue`；接入 `app/pages/index.vue`、
  `app/pages/dashboard.vue`、`app/pages/account/index.vue` 与语言包。
- 后端：`server/api/community/**`、`server/api/admin/community/**`、
  `server/utils/community.ts`、`server/utils/communityFeed.ts`、
  `server/utils/communityModeration.ts`。
- 权限：`server/utils/permissions.js`、`server/api/admin/users/**`、`app/composables/usePermissions.ts`。

### 10.5 本地验证记录（2026-10-24）

在便携 PostgreSQL 16 + 构建产物 `.output` 上完成：

| 项目 | 结果 |
|---|---|
| `node scripts/build.js` | 成功 |
| 社区开关 | 关闭后公开接口 403，管理员/审帖员仍可审核；开启后恢复 |
| 发帖 → 审核 | 待审不出现在信息流；通过后出现；驳回通知作者 |
| 违规阈值 | 第 3 次禁言 30 天，第 6 次永久；禁言期间发帖/评论 403；管理员重置后恢复 |
| 板块分配 | 仅分配板块 2 的审帖员只能看到并审核板块 2，越权审核 403 |
| 图片开关 | 关闭后上传 403、带图发帖 400；恢复后上传与展示正常 |
| 歌曲联动 | `/api/songs/vote` 点赞后，社区信息流 `voteCount/likedByMe` 同步 |
| 隐私 | 关闭公开收藏/点赞后，他人视角返回 `null`，本人视角仍可见 |
| 称号 | 后台创建/授予/佩戴后，信息流作者身份展示称号 |
| 阿里云配置 | 密钥保存后仅回显掩码，支持清空；未配置时不影响人工审核 |
| 响应式 | 1440×900 与 390×844 截图核对信息流、发布弹窗、审核/板块/称号/用户/配置面板 |

`nuxt typecheck` 仍有 1116 个上游既有报错（`qq_music_sdk`、`netease` 等），
社区相关文件无新增报错；构建不受影响。

### 10.6 上线前注意

1. 先备份数据库，再执行新迁移；本次迁移只新增表与默认数据。
2. 生产启用前在后台「社区配置」确认：总开关、图片开关、字数上限、阿里云密钥与命中策略。
3. 如需图片机器审核，设置 `COMMUNITY_PUBLIC_ORIGIN=https://实际域名` 并保证外网可访问
   `/api/media/{id}`。
4. 新增角色需在「用户管理」中分配；`REVIEWER` 不会出现在原有审核菜单之外。
