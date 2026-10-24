# 校园音乐社区内容审核服务

> 审核策略提示词见 [`POLICY_PROMPT.md`](POLICY_PROMPT.md)：用于在阿里云内容安全控制台配置 MultiModalAgent，或接入自建多模态 LLM。
> 说明：手机号/微信号/QQ/邮箱/任何网址链接/身份证/银行卡/学号/住址等确定性规则已在应用侧做本地拦截；语义类标签由智能体或人工判断。帖内分享歌曲只能使用「选歌」功能，音乐平台链接同样按引流拦截。

基于 **阿里云内容安全 MultiModalAgent（审核智能体）** 的帖子图文审核服务。面向校园音乐社区九宫格发帖场景：一次请求最多 9 张图片，逐图调用审核接口，再由服务端聚合为唯一处置结论。

- 服务形态：FastAPI + 进程内异步队列 + 全局 QPS 整形
- 部署目标：腾讯云首尔轻量应用服务器（2C4G），Docker / docker-compose
- 三种最终状态：`PASS`、`MANUAL_REVIEW`、`API_UNAVAILABLE`
- 设计原则：**宁可多审，不可漏审；任何不确定因素一律转人工，绝不自动放行**

---

## 1. 处置策略（硬约束）

### 1.1 风险等级映射

| 风险等级 | 处置结果 | 说明 |
| --- | --- | --- |
| `none` | `PASS` | 直接放行 |
| `low` | `PASS` | 直接放行 |
| `medium` | `MANUAL_REVIEW` | 转人工 |
| `high` | `MANUAL_REVIEW` | 转人工 |
| 未知等级 | `MANUAL_REVIEW` | 保守处理 |

以下标签即使风险等级为 `low`，也强制 `MANUAL_REVIEW`：

- `恶意丑化`
- `学生欺凌`

### 1.2 前置规则拦截

本地正则命中以下任一规则，直接按 `high` 处理并返回 `MANUAL_REVIEW`，**不调用任何外部 API**：

- 中国大陆手机号
- `http://` / `https://` / `www.` 链接
- 邮箱
- 18 位身份证号

### 1.3 九宫格聚合

| 图片情况 | 聚合结果 |
| --- | --- |
| 任意一张 `medium` / `high` | `MANUAL_REVIEW` |
| 任意一张调用失败（超时、限流、非 200、网络错误） | `MANUAL_REVIEW` |
| 全部 `none` / `low` 且无失败 | `PASS` |
| 图片列表为空 | `MANUAL_REVIEW` |
| 全部图片 URL 非法 | `MANUAL_REVIEW` |
| 命中 `恶意丑化` / `学生欺凌` | `MANUAL_REVIEW` |

### 1.4 API 不可用降级

1. 启动时 AK/SK 任一缺失：服务以 `DEGRADED` 模式启动，`/audit` 不发起任何外部调用，直接返回 `API_UNAVAILABLE`。
2. 所有已配置 Endpoint 探测均失败：进入 `DEGRADED`，后续请求返回 `API_UNAVAILABLE`。默认只配置上海节点；如显式追加新加坡等节点，则按配置顺序选第一个可用节点。
3. 降级期间由后台周期探测恢复；请求路径上不反复探测。
4. 运行中连续 2 次网络超时：触发一次重新探测，必要时临时切换 Endpoint。
5. 单张图片调用失败：该图片记为失败，**整组转人工**，不会因为其他图片通过而放行。

### 1.5 调用约束

- 每次 API 请求只送 **1 张图片**
- 配文最长 **2000 字符**
- 全局所有 API 调用（含重试）共享 **≤ 10 QPS** 限流
- 单任务超时 **15 秒**，单次审核总等待上限 **18 秒**
- 队列最长等待 **120 秒**，队列容量 **1000**
- 图片下载超时 **3 秒**，单图最大 **20 MB**
- 必须单进程运行（`--workers 1`），多进程会绕过全局限流

---

## 2. 架构

```text
调用方（VoiceHub / 管理后台 / 其他服务）
        │  POST /audit  { post_id, text, image_urls[] }
        ▼
┌──────────────────────────────────────────────────────────┐
│ FastAPI main.py                                          │
│  ├─ 参数校验（≤9 张、text ≤2000）                        │
│  ├─ DEGRADED 快速失败 → API_UNAVAILABLE                  │
│  ├─ prefilter.py  手机号/链接/邮箱/身份证 → MANUAL_REVIEW │
│  ├─ security.py   URL 协议/私网/SSRF 校验 + 图片预检     │
│  └─ pipeline.py   组装九宫格任务并等待聚合               │
│         │                                                │
│         ▼                                                │
│  queue_worker.py  asyncio.Queue（容量 1000 / 并发 16）   │
│         │  每个任务只处理 1 张图片                       │
│         ▼                                                │
│  moderation_client.py                                    │
│  ├─ 全局 10 QPS 限流（重试同样受限）                     │
│  ├─ Endpoint 探测：默认上海；显式配置多节点时按顺序切换
│  ├─ 连续 2 次超时 → 重新探测 / 临时切换                  │
│  ├─ 超时 15s、指数退避重试                               │
│  └─ 阿里云 Green 2022-03-02 SDK（线程池中执行）          │
│         │                                                │
│         ▼                                                │
│  aggregator.py  none/low→PASS；medium/high/失败→人工     │
└──────────────────────────────────────────────────────────┘
        │
        ▼
GET /health  模式 / Endpoint / 成功率 / 队列积压 / 探测结果
```

### 审核调用方式

| 配文情况 | 调用方式 | 原因 |
| --- | --- | --- |
| 空 / 中性配文 | 纯图片审核（`img_check_agent_01`） | 避免 9 倍文本重复计费 |
| 可疑配文（联系方式、欺凌、赌博等） | 图文混合审核（`img_txt_check_agent_01`） | 让智能体结合上下文判断 |

---

## 3. 目录结构

```text
community-moderation-service/
├── config.py              # 环境变量、硬约束常量、Endpoint 解析
├── security.py            # URL/SSRF 校验、重定向、图片预检、日志脱敏
├── prefilter.py           # 手机号/URL/邮箱/身份证正则、可疑文本判断
├── moderation_client.py   # 阿里云 SDK 封装、限流、探测、重试、降级
├── queue_worker.py        # 异步队列、任务超时、优雅停机
├── aggregator.py          # 九宫格聚合与风险映射
├── pipeline.py            # 完整审核流水线
├── main.py                # FastAPI 入口、/audit、/health
├── requirements.txt
├── requirements-dev.txt
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── tests/                 # 31 个单元/流水线测试
└── scripts/
    ├── mock_services.py   # 本地阿里云 + 图片源站 mock
    └── e2e_check.py       # 本地端到端验收脚本
```

---

## 4. 快速开始（本地）

### 4.1 环境要求

- Python **3.9+**（Docker 镜像使用 `python:3.9-slim`）
- 阿里云 RAM 用户，具备内容安全调用权限
- 在阿里云内容安全控制台创建审核智能体，获取 AppID

### 4.2 安装与启动

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# 编辑 .env，填入 ALIBABA_CLOUD_ACCESS_KEY_ID / SECRET
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1
```

> **必须使用 `--workers 1`。** 队列与 QPS 限流都在进程内，多 worker 会突破 10 QPS 约束。

启动后访问：

- Swagger：`http://127.0.0.1:8000/docs`
- 健康检查：`http://127.0.0.1:8000/health`

### 4.3 本地 mock 联调（不消耗真实额度）

```bash
# 终端 1：启动 mock（阿里云审核 9101 + 图片源站 9102）
python scripts/mock_services.py --aliyun-port 9101 --image-port 9102

# 终端 2：以测试配置启动服务
APP_ENV=test \
TEST_ALLOW_PRIVATE_IMAGE_URLS=true \
ALIBABA_CLOUD_ACCESS_KEY_ID=test-ak \
ALIBABA_CLOUD_ACCESS_KEY_SECRET=test-sk \
MODERATION_ENDPOINTS='http://127.0.0.1:9101=test' \
python -m uvicorn main:app --host 127.0.0.1 --port 8010 --workers 1

# 终端 3：运行端到端验收
python scripts/e2e_check.py --base-url http://127.0.0.1:8010
```

`APP_ENV=test` 与 `TEST_ALLOW_PRIVATE_IMAGE_URLS=true` 只用于本地 mock；生产环境严禁开启。

---

## 5. 配置项

所有配置通过环境变量注入，敏感值只从环境变量读取，**不写入代码、镜像或日志**。

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `ALIBABA_CLOUD_ACCESS_KEY_ID` | 空 | 阿里云 AK；缺失则启动即 `DEGRADED` |
| `ALIBABA_CLOUD_ACCESS_KEY_SECRET` | 空 | 阿里云 SK；缺失则启动即 `DEGRADED` |
| `APP_ENV` | `production` | `production` / `test` |
| `LOG_LEVEL` | `INFO` | 日志级别 |
| `MODERATION_ENDPOINTS` | 上海 | `host[:region],host[:region]`；默认仅上海；如需容灾可显式追加新加坡（跨境调用成本更高）；测试可用 `http://127.0.0.1:9101=test` |
| `MODERATION_SERVICE_TOKEN` | 空 | 可选共享令牌；配置后 `/audit` 必须携带 `x-moderation-token`，VoiceHub 侧用 `COMMUNITY_MODERATION_SERVICE_TOKEN` 同步配置 |
| `MODERATION_MULTIMODAL_APP_ID` | `img_txt_check_agent_01` | 图文混合审核智能体 |
| `MODERATION_IMAGE_APP_ID` | `img_check_agent_01` | 纯图片审核智能体 |
| `MODERATION_TEXT_APP_ID` | `txt_check_agent_01` | 标准文本审核（兜底用） |
| `MODERATION_QPS_LIMIT` | `10` | 全局 QPS，最大被钳制为 10 |
| `MODERATION_PROBE_TIMEOUT` | `3` | Endpoint 探测超时（秒） |
| `MODERATION_PROBE_CACHE_SECONDS` | `300` | 探测结果缓存（秒） |
| `MODERATION_DEGRADED_RECOVERY_SECONDS` | `60` | DEGRADED 恢复探测周期（秒） |
| `MODERATION_API_CONNECT_TIMEOUT_MS` | `3000` | API 连接超时 |
| `MODERATION_API_READ_TIMEOUT_MS` | `10000` | API 读取超时 |
| `MODERATION_API_MAX_RETRIES` | `2` | 可重试错误的最大重试次数 |
| `MODERATION_RETRY_BASE_DELAY_SECONDS` | `0.5` | 指数退避基数 |
| `MODERATION_QUEUE_CAPACITY` | `1000` | 队列容量 |
| `MODERATION_QUEUE_MAX_WAIT_SECONDS` | `120` | 队列最长等待 |
| `MODERATION_QUEUE_WARN_DEPTH` | `50` | 积压告警阈值 |
| `MODERATION_TASK_TIMEOUT_SECONDS` | `15` | 单任务超时 |
| `MODERATION_AUDIT_TIMEOUT_SECONDS` | `18` | 单次审核总超时 |
| `MODERATION_WORKER_CONCURRENCY` | `16` | 队列并发任务数 |
| `MODERATION_MAX_IMAGES` | `9` | 单次最多图片数（上限 9） |
| `MODERATION_MAX_TEXT_CHARS` | `2000` | 配文上限 |
| `MODERATION_MAX_IMAGE_BYTES` | `20971520` | 单图最大字节数（20 MB） |
| `MODERATION_IMAGE_FETCH_TIMEOUT_SECONDS` | `3` | 图片预检下载超时 |
| `MODERATION_IMAGE_PREFLIGHT_ENABLED` | `true` | 是否在审核前预检图片 |
| `MODERATION_STANDARD_CHECK_ENABLED` | `false` | 是否启用标准审核兜底 |
| `MODERATION_STANDARD_TEXT_SERVICE` | `comment_detection_pro` | 标准文本审核服务 |
| `MODERATION_STANDARD_IMAGE_SERVICE` | `baselineCheck` | 标准图片审核服务 |
| `MODERATION_WEBHOOK_URL` | 空 | DEGRADED 告警 webhook（可选） |
| `MODERATION_WEBHOOK_TIMEOUT` | `3` | webhook 超时 |

---

## 6. API

### 6.1 `POST /audit`

请求体：

```json
{
  "post_id": "123456",
  "text": "今天在操场听到一首很好听的歌",
  "image_urls": [
    "https://cdn.example.com/community/a.jpg",
    "https://cdn.example.com/community/b.jpg"
  ]
}
```

| 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `post_id` | string / int | 是 | 1~128 字符，响应统一为字符串 |
| `text` | string | 否 | ≤ 2000 字符（超长直接 422/400） |
| `image_urls` | string[] | 否 | ≤ 9 个；空列表返回 `MANUAL_REVIEW` |

响应：

```json
{
  "post_id": "123456",
  "overall_status": "MANUAL_REVIEW",
  "reason": "存在失败图片，整组转人工",
  "per_image_results": [
    {
      "task_id": "123456_0",
      "index": 0,
      "image_url": "https://cdn.example.com/community/a.jpg",
      "risk_level": "low",
      "decision": "PASS",
      "labels": [],
      "descriptions": ["未检测出风险"],
      "request_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "code": 200,
      "endpoint": "green-cip.cn-shanghai.aliyuncs.com"
    }
  ],
  "failed_images": [
    {
      "task_id": "123456_1",
      "index": 1,
      "reason": "图片下载超时",
      "error_type": "timeout"
    }
  ],
  "rule_intercepted": false,
  "current_mode": "NORMAL",
  "image_count": 2,
  "request_mode": "image_only",
  "text_truncated": false,
  "elapsed_ms": 842,
  "queue": {
    "queue_depth": 0,
    "queue_capacity": 1000,
    "in_flight": 0,
    "processed": 12,
    "failed": 1
  },
  "app_id": "img_check_agent_01"
}
```

`per_image_results[].image_url` 已去除 query/fragment/账号信息，避免日志或前端泄露敏感 token。

### 6.2 `GET /health`

```json
{
  "mode": "NORMAL",
  "endpoint": "green-cip.cn-shanghai.aliyuncs.com",
  "endpoint_region": "cn-shanghai",
  "probe_results": [
    {
      "endpoint": "green-cip.cn-shanghai.aliyuncs.com",
      "region": "cn-shanghai",
      "healthy": true,
      "latency_ms": 48,
      "error": null,
      "checked_at": "2026-10-24T03:00:00.000000+00:00"
    }
  ],
  "ak_ready": true,
  "sk_ready": true,
  "sdk_available": true,
  "sdk_version": "3.5.1",
  "degraded_reason": null,
  "calls_last_minute": 26,
  "success_rate": 1.0,
  "status": "ok",
  "queue_depth": 0,
  "in_flight": 0,
  "queue": { "queue_depth": 0, "queue_capacity": 1000, "in_flight": 0, "processed": 26, "failed": 0 },
  "uptime_seconds": 3600,
  "version": "1.0.0"
}
```

- `success_rate`：最近 60 秒 API 成功率，`1.0` 表示 100%；无调用时为 `null`
- `mode`：`NORMAL` / `DEGRADED`
- `status`：`ok` / `degraded`

---

## 7. 可直接运行的验收 curl

以下示例配合第 4.3 节的本地 mock 使用，复制即可执行。

### 示例 1：健康检查

```bash
curl -s http://127.0.0.1:8010/health
```

### 示例 2：低风险图片 → PASS

```bash
curl -s -X POST http://127.0.0.1:8010/audit \
  -H 'Content-Type: application/json' \
  -d '{"post_id":"demo-low","text":"nice song today","image_urls":["http://127.0.0.1:9102/low1.jpg"]}'
```

### 示例 3：中风险图片 → MANUAL_REVIEW

```bash
curl -s -X POST http://127.0.0.1:8010/audit \
  -H 'Content-Type: application/json' \
  -d '{"post_id":"demo-medium","text":"share this song","image_urls":["http://127.0.0.1:9102/medium1.jpg"]}'
```

### 示例 4：命中手机号 → MANUAL_REVIEW（0 次 API 调用）

```bash
curl -s -X POST http://127.0.0.1:8010/audit \
  -H 'Content-Type: application/json' \
  -d '{"post_id":"demo-phone","text":"联系我 13800138000","image_urls":["http://127.0.0.1:9102/low1.jpg"]}'
```

### 示例 5：九宫格 + 可疑配文 → 9 次图文审核

```bash
curl -s -X POST http://127.0.0.1:8010/audit \
  -H 'Content-Type: application/json' \
  -d '{
    "post_id": "demo-nine",
    "text": "wechat: abcdefg123",
    "image_urls": [
      "http://127.0.0.1:9102/low1.jpg",
      "http://127.0.0.1:9102/low2.jpg",
      "http://127.0.0.1:9102/low3.jpg",
      "http://127.0.0.1:9102/low4.jpg",
      "http://127.0.0.1:9102/low5.jpg",
      "http://127.0.0.1:9102/low6.jpg",
      "http://127.0.0.1:9102/low7.jpg",
      "http://127.0.0.1:9102/low8.jpg",
      "http://127.0.0.1:9102/low9.jpg"
    ]
  }'
```

查看 mock 峰值 QPS：

```bash
curl -s http://127.0.0.1:9101/stats
```

### 示例 6：单图超时 → MANUAL_REVIEW + `failed_images`

```bash
curl -s -X POST http://127.0.0.1:8010/audit \
  -H 'Content-Type: application/json' \
  -d '{"post_id":"demo-timeout","text":"share this song","image_urls":["http://127.0.0.1:9102/low1.jpg","http://127.0.0.1:9102/timeout1.jpg"]}'
```

### 示例 7：未配置 AK/SK → `API_UNAVAILABLE`

```bash
# 启动一个不带凭证的实例
APP_ENV=production \
MODERATION_ENDPOINTS='http://127.0.0.1:9101=test' \
python -m uvicorn main:app --host 127.0.0.1 --port 8011 --workers 1

curl -s http://127.0.0.1:8011/health
# mode = DEGRADED

curl -s -X POST http://127.0.0.1:8011/audit \
  -H 'Content-Type: application/json' \
  -d '{"post_id":"demo-nocreds","text":"hello","image_urls":["http://127.0.0.1:9102/low1.jpg"]}'
# overall_status = API_UNAVAILABLE
```

生产环境将 `http://127.0.0.1:9102/...` 替换为公网可访问的 HTTPS 图片地址即可。

---

## 8. 测试

```bash
pip install -r requirements-dev.txt
python -m pytest
```

当前结果：

```text
31 passed
```

覆盖内容：

- 风险等级映射、失败图片、空列表、API 降级、强制标签
- 手机号 / URL / 邮箱 / 身份证前置拦截
- URL 协议、私网地址、凭证、超长 URL、日志脱敏
- 九宫格聚合、队列、超时、配文模式选择、DEGRADED 快速失败

端到端验收（mock）：

```bash
python scripts/e2e_check.py
```

已验证通过：

- [x] 低风险 → `PASS`
- [x] 中风险 → `MANUAL_REVIEW`
- [x] 9 图 + 手机号 → `MANUAL_REVIEW`，0 次 API 调用
- [x] 9 图 + 可疑配文 → 9 次调用，峰值 QPS = 9（≤10）
- [x] 单图超时 → `MANUAL_REVIEW`，`failed_images` 非空
- [x] `学生欺凌` 标签 → 强制 `MANUAL_REVIEW`
- [x] 空图片列表 → `MANUAL_REVIEW`，0 次 API 调用
- [x] 缺失 AK/SK → 启动 `DEGRADED`，`/audit` 返回 `API_UNAVAILABLE`
- [x] 显式配置上海、新加坡两个 Endpoint 时：上海不可达、新加坡可用 → 自动切换并保持 `NORMAL`
- [x] 所有已配置 Endpoint 均不可达 → `DEGRADED`
- [x] 连续 2 次超时 → 触发重新探测
- [x] 日志不包含 AK/SK，响应与日志不包含 URL 敏感 query

---

## 9. Docker 部署

### 9.1 构建与启动

```bash
cp .env.example .env
vi .env    # 填写 AK/SK

docker compose up -d --build
docker compose ps
curl -s http://127.0.0.1:8000/health
```

### 9.2 修改环境变量

```bash
vi .env
docker compose up -d --force-recreate
```

> 修改环境变量后必须重建容器，`docker restart` 不会重新读取 `env_file`。

### 9.3 查看日志

```bash
docker compose logs -f --tail=200
```

日志已配置轮转（单文件 10 MB，保留 3 个）。生产建议再接入宿主机日志采集。

### 9.4 容器安全基线

- 非 root 用户 `app` 运行
- `read_only: true` + `tmpfs /tmp`
- `no-new-privileges:true`
- 仅绑定 `127.0.0.1:8000`，不对公网暴露
- 单 worker，避免绕过全局限流

---

## 10. 腾讯云首尔轻量服务器部署

目标：Ubuntu 22.04 / 2C4G / Docker。以下命令在服务器执行。

### 10.1 安装 Docker

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

### 10.2 部署

```bash
sudo mkdir -p /opt/community-moderation
sudo chown "$USER":"$USER" /opt/community-moderation
cd /opt/community-moderation
# 上传代码（git clone 或 scp）
cp .env.example .env
chmod 600 .env
vi .env
docker compose up -d --build
```

### 10.3 安全组 / 防火墙

- 只开放 SSH（建议限制来源 IP）
- **不要开放 8000 端口**
- 若由 Nginx 反代，只开放 80/443，并把上游指向 `127.0.0.1:8000`

### 10.4 Nginx 反向代理示例

```nginx
server {
    listen 443 ssl http2;
    server_name moderation.example.com;

    ssl_certificate     /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;

    client_max_body_size 1m;

    location / {
        # 建议叠加 IP 白名单或内部鉴权
        allow 10.0.0.0/8;
        deny all;

        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 30s;
    }
}
```

修改 Nginx 后先校验再重载：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 10.5 镜像拉取与网络

- 阿里云 Endpoint 需从服务器出网访问；建议在安全组放行 443 出站
- 使用真实 AK/SK 前，先用 `curl -I https://green-cip.cn-shanghai.aliyuncs.com/` 验证连通性
- 服务器时间需同步（`timedatectl`），否则签名会失败
- 容器保持 `TZ=UTC`，日志时间统一为 UTC

---

## 11. 安全说明

1. **AK/SK 只从环境变量读取**，不写入代码、镜像、日志；启动日志只输出 `AK=True/False`。
2. `.env` 已被 `.gitignore` 忽略，禁止提交；生产建议使用密钥管理服务或 Docker secrets 注入。
3. RAM 用户遵循最小权限，只授予内容安全相关权限，并定期轮换 AK。
4. 日志与响应中的图片 URL 会去掉 query、fragment、userinfo，避免泄露签名 token。
5. 图片 URL 做 SSRF 防护：
   - 仅允许 `http` / `https`
   - 禁止带账号密码的 URL
   - 禁止环回、私网、链路本地、保留地址
   - DNS 解析后逐个校验 IP，并缓存 60 秒
   - 预检下载限制 3 秒 / 20 MB
6. 服务本身不提供公网鉴权，**必须**部署在内网或 Nginx 白名单之后；不要直接暴露 `/audit`。
7. 任何内部异常都不自动放行，统一返回 `MANUAL_REVIEW`。
8. 生产图片需对阿里云审核服务可访问；如使用签名 URL，签名有效期需覆盖审核耗时，且不要将签名写入业务日志。

---

## 12. 运维

### 12.1 降级与恢复

```bash
curl -s http://127.0.0.1:8000/health | python -m json.tool
```

- `mode=DEGRADED` 且 `degraded_reason=未配置...`：检查 AK/SK 是否注入
- `mode=DEGRADED` 且 `degraded_reason=已配置的阿里云内容安全 Endpoint 均探测失败`：检查出网、DNS、安全组
- 配置修复后重启容器；Endpoint 故障恢复由后台每 60 秒自动探测

### 12.2 队列积压

```bash
curl -s http://127.0.0.1:8000/health | python -c "import json,sys; d=json.load(sys.stdin); print(d['queue'])"
```

- `queue_depth` 持续超过 `MODERATION_QUEUE_WARN_DEPTH`：检查 API 延迟与 QPS 限流
- 队列满时新任务直接记失败并转人工，不会阻塞调用方

### 12.3 优雅停机

`SIGTERM` 后停止接收新任务、等待在途任务（最多 5 秒）、剩余队列任务按失败处理，避免请求悬挂。

### 12.4 webhook

配置 `MODERATION_WEBHOOK_URL` 后，进入 `DEGRADED` 会发送一次 JSON 告警，内容只包含原因和时间，不包含凭证。

---

## 13. 常见问题

### Q1：启动报 `cannot import name 'websocketUtils_models'`

`alibabacloud_green20220302==3.5.1` 与 `alibabacloud_tea_openapi==0.4.6` 存在模块命名差异。代码在 `moderation_client._load_sdk()` 中做了运行时别名兼容，无需手动改包。

### Q2：为什么锁定 `pydantic==2.12.3`？

较新的 Python（3.14）没有旧版 `pydantic-core` 的预编译 wheel，会触发本地 Rust 构建失败；2.12.3 同时兼容 Python 3.9（Docker）与 3.14（本地）。

### Q3：为什么必须单 worker？

全局限流器、队列和工作线程都在进程内。多 worker 会各自持有限流器，实际 QPS 成倍放大。

### Q4：图片都通过，为什么还是 `MANUAL_REVIEW`？

检查 `failed_images`。任意一张图片下载失败、超时、API 非 200，整组都会转人工。

### Q5：`/audit` 返回 400 是什么原因？

- `post_id` 为空或超过 128 字符
- 图片超过 9 张
- `text` 超过 2000 字符

### Q6：Docker 构建需要联网吗？

需要。构建阶段会从 PyPI 安装依赖；建议在服务器本地构建或使用私有镜像仓库。

---

## 14. 变更记录

- `v1.0.0`：首个生产版本，支持九宫格审核、Endpoint 故障切换（显式配置多节点时）、DEGRADED 降级、SSRF 防护、全局 10 QPS 整形、优雅停机、Docker 部署。
