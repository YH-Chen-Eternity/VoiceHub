const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const UH = process.env.UPSTREAM_HOST || 'voicehub';
const UP = parseInt(process.env.UPSTREAM_PORT || '3000', 10);
const PORT = parseInt(process.env.PORT || '3001', 10);
const COMBINED = '/_nuxt/vh-combined.css';
let cssCache = { key: '', content: '' };

// ============================================================
//  站点根目录验证文件（微信/公众号等平台域名归属验证）
//  由边缘直接返回，不经过应用与地域闸，保证任何地区的验证爬虫都能取到
// ============================================================
const VERIFY_FILES = {
  '/b4bdf6019bb24fc606d4259d4d3f8eb8.txt': '0f2e6431e8e93932fc8488ef4894051564994d72'
};
function serveVerifyFile(req, res, pathname) {
  const body = VERIFY_FILES[pathname];
  if (typeof body !== 'string') return false;
  res.writeHead(200, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
  return true;
}


// ============================================================
//  真实客户端 IP
//  Caddy 已开启 trusted_proxies_strict（从右往左解析，左侧可被客户端伪造），
//  并把解析结果通过 header_up 写成单值 X-Forwarded-For 传下来。
//  这里再从右往左跳过「基础设施地址」（Caddy 自身 / Docker 网桥），
//  双重保险取到真正的外部客户端 IP。
// ============================================================
// 基础设施地址（Caddy 自己 / Docker 网桥），从右往左跳过
const INFRA = /^(::1$|127\.\d{1,3}\.\d{1,3}\.\d{1,3}$|172\.28\.\d{1,3}\.\d{1,3}$)/;
function pickIp(raw) {
  if (!raw) return '';
  const parts = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (INFRA.test(parts[i])) continue;
    if (typeof isCloudflareIp === "function" && isCloudflareIp(parts[i])) continue; // 跳过 CF 边缘
    return parts[i];
  }
  // 全部是基础设施/CF 边缘时不返回它们，交由 realIp 回退到 X-Real-IP / socket（内网放行）
  return '';
}
// 真实 IP 识别（可按是否接入 Cloudflare 切换）：
// - TRUST_CF_HEADER=0（默认，当前「客户端 → Lolia FRP → NAS」链路）：
//   XFF 由 FRP 覆盖写入，取最后一个非内网地址可信；不信任客户端可伪造的 cf-connecting-ip。
// - TRUST_CF_HEADER=1（接入 Cloudflare 后）：CF 会覆盖写入 cf-connecting-ip（客户端无法伪造），
//   优先使用它；前提是【源站防火墙只允许 Cloudflare 回源】，否则该头可被直连客户端伪造。
const TRUST_CF = String(process.env.TRUST_CF_HEADER || '').trim() === '1';
function realIp(req) {
  if (TRUST_CF) {
    const cf = String(req.headers['cf-connecting-ip'] || '').trim();
    if (cf) return cf;
  }
  const raw = pickIp(req.headers['x-forwarded-for']) || pickIp(req.headers['x-real-ip']) ||
    (req.socket && req.socket.remoteAddress) || 'unknown';
  // 规范化 IPv4 映射地址（::ffff:172.28.0.1 → 172.28.0.1），避免内网/CF 健康检查被误判
  return String(raw).replace(/^::ffff:/i, '');
}

// ============================================================
//  按真实 IP 限流（滑动窗口，单分钟计数）
// ============================================================
function envInt(name, dflt) {
  const v = parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) && v >= 0 ? v : dflt;
}
const LIMIT_MUSIC = envInt('RL_MUSIC_PER_MIN', 60);    // 音乐/搜索等外链代理接口（≈1 req/s）
const LIMIT_AUTH = envInt("RL_AUTH_PER_MIN", 30);      // 登录/注册/验证码
const LIMIT_GLOBAL = envInt('RL_GLOBAL_PER_MIN', 1800);
const LIMIT_SEARCH = envInt("RL_SEARCH_PER_MIN", 60);   // 用户搜索：防批量枚举账号
const LIMIT_ADMIN = envInt("RL_ADMIN_PER_MIN", 120);     // 管理端接口：防扫接口 // 站点整体兜底：校园/运营商共享出口 IP 多，给足余量
const WINDOW_MS = 60000;
const MAX_KEYS = 20000;

// 「同源闸」：音乐/QQ 代理接口只允许本站页面发出的请求
// 依据：实测本站这些接口的**全部**浏览器请求（134/134）都带 Sec-Fetch-Site: same-origin；
//      而 Sec-Fetch-* 是浏览器自动添加的**禁改头**，普通脚本/第三方抓取不会带或带成 cross-site。
// 设 GATE_PROXY_SAME_ORIGIN=0 可一键关闭（应急回滚用）。
const GATE_PROXY = process.env.GATE_PROXY_SAME_ORIGIN !== '0';
const PROXY_PATH_RE = /^\/api\/(native-api|api-enhanced)\//;

const buckets = new Map();

// 安全判定使用解码后的路径：%61 等编码不能绕过登录限流与敏感路径识别
function normalizePathname(raw) {
  let out = raw;
  for (let i = 0; i < 3; i++) {
    let next;
    try { next = decodeURIComponent(out); } catch { return out; }
    if (next === out) return out;
    out = next;
  }
  return out;
}

function safeEqualString(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// 仅接受合法主机名，避免 Host 头注入 HTML/日志
function safeHost(value) {
  const host = String(value || '').split(',')[0].trim().toLowerCase();
  return /^[a-z0-9.-]+(?::\d{1,5})?$/.test(host) ? host : '';
}

function classify(pathname) {
  if (PROXY_PATH_RE.test(pathname)) return ['music', LIMIT_MUSIC];
  if (pathname.startsWith('/api/users/search')) return ['search', LIMIT_SEARCH];
  if (pathname.startsWith('/api/admin/')) return ['admin', LIMIT_ADMIN];
  if (/^\/api\/auth\//.test(pathname)) return ['auth', LIMIT_AUTH];
  return ['global', LIMIT_GLOBAL];
}

// 浏览器自动带的同源标记；缺失即视为非浏览器客户端
function sameOrigin(req) {
  const v = req.headers['sec-fetch-site'];
  return String(v === undefined ? '' : v).trim().toLowerCase() === 'same-origin';
}

function hit(ip, cat, limit, now) {
  if (limit <= 0) return { blocked: false, count: 0, limit: 0 };
  const key = cat + '|' + ip;
  let b = buckets.get(key);
  if (!b || now - b.start >= WINDOW_MS) {
    b = { start: now, count: 0 };
    buckets.set(key, b);
  }
  b.count++;
  if (buckets.size > MAX_KEYS) {
    let n = buckets.size - MAX_KEYS;
    for (const k of buckets.keys()) { buckets.delete(k); if (--n <= 0) break; }
  }
  return { blocked: b.count > limit, count: b.count, limit, retry: Math.ceil((b.start + WINDOW_MS - now) / 1000) };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now - b.start > WINDOW_MS * 2) buckets.delete(k);
}, 30000).unref();

// 首次见到的客户端 IP 记录一次（限量，便于排查真实 IP 是否正确）
const seenIps = new Set();
function noteIp(ip, req) {
  if (seenIps.size >= 300 || seenIps.has(ip)) return;
  seenIps.add(ip);
  console.log('[ip] ' + ip + '  <- xff="' + String(req.headers['x-forwarded-for'] || '') + '" ' + (req.url || ''));
}

function fetchPath(p) {
  return new Promise((resolve) => {
    http.get({ host: UH, port: UP, path: p, headers: { 'accept-encoding': 'identity' } }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => resolve(d));
    }).on('error', () => resolve(''));
  });
}

async function buildCombined(names) {
  const key = names.join('|');
  if (cssCache.key === key) return;
  const arr = await Promise.all(names.map(fetchPath));
  let combined = arr.join('\n');
  const imports = [];
  combined = combined.replace(/@import[^;]+;/g, (m) => { imports.push(m); return ''; });
  // 外部 @import 本地化 + 去重（sf-font 原先走 jsdelivr，国内常 20s 级超时）
  const LOCAL_MAP = [
    ['https://cdn.jsdelivr.net/npm/sf-font@1.0.0/stylesheet.min.css', '/_fonts/sf/stylesheet.css'],
    ['https://cdn.jsdelivr.net/npm/sf-font@1.0.0/stylesheet.css', '/_fonts/sf/stylesheet.css']
  ];
  const seen = new Set();
  const kept = [];
  for (let im of imports) {
    for (const [from, to] of LOCAL_MAP) im = im.split(from).join(to);
    if (seen.has(im)) continue;
    seen.add(im);
    kept.push(im);
  }
  combined = kept.join('\n') + (kept.length ? '\n' : '') + combined;
  // 首屏加载条：动画接管 width（优先级高于内联样式），避免长时间卡在 8%
  combined += '\nhtml.vh-done .app-loading-screen:not([data-vh-keep]){display:none!important;visibility:hidden!important;opacity:0!important}\n'
    + 'html.vh-done .top-progress-bar{width:100%!important;transition:none!important}\n'
    + 'html.vh-done .ring-fill{stroke-dashoffset:0!important;transition:none!important}\n'
    + '.top-progress-bar{transition:width .35s cubic-bezier(.22,.61,.36,1)}\n'
    + '.ring-fill{transition:stroke-dashoffset .35s cubic-bezier(.22,.61,.36,1)}\n'
    + '.ring-percent{transition:opacity .2s ease}\n';
  let hv = 5381;
  for (let i = 0; i < combined.length; i++) hv = ((hv << 5) + hv + combined.charCodeAt(i)) >>> 0;
  cssCache = { key, content: combined, ver: hv.toString(36) };
}

// 安全事件处置：按真实客户端 IP 封禁（BAN_IPS 环境变量，逗号分隔）
const BAN_IPS = new Set(String(process.env.BAN_IPS || '').split(',').map((v) => v.trim()).filter(Boolean))

// ============================================================
//  Cloudflare 边缘 IP 白名单：出现在 XFF 里时跳过，避免把 CF 边缘当成真实客户端
//  （否则地域闸/封禁会误判成"境外访问"）
//  数据来源：https://www.cloudflare.com/ips-v4
// ============================================================
const CF_CIDRS = [
  "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "104.16.0.0/13",
  "104.24.0.0/14", "108.162.192.0/18", "131.0.72.0/22", "141.101.64.0/18",
  "162.158.0.0/15", "172.64.0.0/13", "173.245.48.0/20", "188.114.96.0/20",
  "190.93.240.0/20", "197.234.240.0/22", "198.41.128.0/17"
];
const CF_RANGES = (() => {
  const arr = [];
  for (const c of CF_CIDRS) {
    const parts = c.split("/");
    const p = parts[0].split(".").map(Number);
    const bits = Number(parts[1]);
    const start = ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
    arr.push([start, start + Math.pow(2, 32 - bits) - 1]);
  }
  arr.sort((a, b) => a[0] - b[0]);
  return arr;
})();
function isCloudflareIp(ip) {
  const v = ipToInt(ip);
  if (v < 0) return false;
  let lo = 0, hi = CF_RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = CF_RANGES[mid][0], e = CF_RANGES[mid][1];
    if (v < s) hi = mid - 1;
    else if (v > e) lo = mid + 1;
    else return true;
  }
  return false;
}

// ============================================================
//  脚本 / 自动化工具识别（只作用于敏感 API 路径，避免误伤浏览器）
// ============================================================
const SCRIPT_UA_RE = /(curl|wget|python-requests|python-urllib|aiohttp|httpx|go-http-client|okhttp|java\/|libwww|scrapy|node-fetch|axios|undici|headlesschrome|phantomjs|selenium|puppeteer|playwright|httpie|postmanruntime|insomnia|masscan|nmap|sqlmap|nikto)/i;
const SENSITIVE_PATH_RE = /^\/api\/(auth|users|admin|user)\//;
function looksLikeScript(req) {
  const ua = String(req.headers['user-agent'] || '');
  const secFetch = req.headers['sec-fetch-mode'] || req.headers['sec-fetch-site'] || '';
  const acceptLang = req.headers['accept-language'] || '';
  const accept = String(req.headers['accept'] || '');
  if (SCRIPT_UA_RE.test(ua)) return '脚本UA:' + ua.slice(0, 40);
  if (!ua) return '空UA';
  if (/mozilla/i.test(ua) && !secFetch && !acceptLang && /application\/json|^\*\/\*$/.test(accept)) return '伪造浏览器UA';
  return '';
}

// ============================================================
//  永久封禁：1 小时内登录失败 ≥10 次 → 永久封禁（持久化，重启不丢）
//  白名单：学校/管理员固定出口，避免共享 NAT 误伤全校
// ============================================================
const PERMA_FILE = '/app/state/permanent-bans.json';
const PERMA_WHITELIST = new Set(
  String(process.env.PERMA_BAN_WHITELIST || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);
// 受信任出口 IP（学校/广播站固定出口，共享 NAT）：跳过攻击检测与锁定
const TRUSTED_IPS = new Set(
  String(process.env.TRUSTED_IPS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);
function isTrusted(ip) {
  return TRUSTED_IPS.has(ip) || PERMA_WHITELIST.has(ip);
}

// 出口白名单运行时管理：env 初始化 + state 文件持久化（后台攻击日志面板可增删）
const TRUSTED_IPS_FILE = "/app/state/trusted-ips.json";
function saveTrustedIpsState() {
  try { fs.writeFileSync(TRUSTED_IPS_FILE, JSON.stringify({ ips: [...TRUSTED_IPS] }), "utf8"); } catch (e) { console.error("[trusted] state save failed:", e.message); }
}
function loadTrustedIpsState() {
  try {
    const j = JSON.parse(fs.readFileSync(TRUSTED_IPS_FILE, "utf8"));
    if (Array.isArray(j.ips)) {
      for (const ip of j.ips) if (typeof ip === "string" && ip) TRUSTED_IPS.add(ip);
      console.log("[trusted] 已从 state 恢复白名单: " + j.ips.length + " 条");
    }
  } catch (e) { /* 无 state 文件时用 env 初始值 */ }
}
loadTrustedIpsState();

// 可调阈值（默认值按校园共享出口放宽）
const ATK_LOGIN_MAX = envInt('ATK_LOGIN_MAX', 45);     // 10 分钟内登录请求数
const ATK_FAIL_MAX = envInt('ATK_FAIL_MAX', 18);       // 10 分钟内登录失败数
const ATK_SEARCH_MAX = envInt('ATK_SEARCH_MAX', 20);   // 1 分钟内用户搜索数
const ATK_PERMA_FAILS = envInt('ATK_PERMA_FAILS', 30); // 1 小时内失败数 -> 永久封禁

const permanentBans = new Map();

function loadPermanentBans() {
  try {
    const j = JSON.parse(fs.readFileSync(PERMA_FILE, 'utf8'));
    for (const [ip, v] of Object.entries(j)) permanentBans.set(ip, v);
    console.log('[perma] 已加载永久封禁: ' + permanentBans.size + ' 个');
  } catch (e) {}
}
function savePermanentBans() {
  try {
    fs.mkdirSync('/app/state', { recursive: true });
    fs.writeFileSync(PERMA_FILE, JSON.stringify(Object.fromEntries(permanentBans)), 'utf8');
  } catch (e) {}
}
function isPermanentlyBanned(ip) {
  return permanentBans.has(ip);
}
function permanentBan(ip, count, ua, fp) {
  if (!ip) return false;
  if (isTrusted(ip)) {
    console.log('[perma] SKIP whitelisted ip=' + ip);
    return false;
  }
  if (permanentBans.has(ip)) return false;
  permanentBans.set(ip, { at: Date.now(), count, detail: '1 小时内登录失败 ' + count + ' 次' });
  savePermanentBans();
  attackLocks.delete(ip);
  saveAttackState();
  console.log('[perma] 永久封禁 ip=' + ip + ' 失败次数=' + count);
  reportAttack({
    ip,
    kind: 'banned',
    path: '/api/auth/login',
    count,
    userAgent: ua,
    fingerprint: fp,
    action: 'attack_page',
    detail: '永久封禁（1 小时内登录失败 ' + count + ' 次）'
  });
  return true;
}
function countLoginFails(ip, windowMs) {
  const s = attackStats.get(ip);
  if (!s || !s.loginFail) return 0;
  const now = Date.now();
  return s.loginFail.filter((t) => t > now - windowMs).length;
}
loadPermanentBans();
console.log('[trusted] 出口白名单: ' + (TRUSTED_IPS.size ? [...TRUSTED_IPS].join(',') : '无'));

// ============================================================
//  反攻击：行为识别 / 30 分钟锁定 / 设备指纹 / 全屏声明 / 日志上报
// ============================================================
const ATTACK_LOCK_MS = 30 * 60 * 1000;          // 触发后锁定 30 分钟
const ATTACK_STATE_FILE = '/app/state/attack-state.json';
const ATTACK_LOG_TOKEN = String(process.env.ATTACK_LOG_TOKEN || '');
const ATTACK_LOG_URL = String(process.env.ATTACK_LOG_URL || 'http://voicehub:3000/api/internal/attack-log');

const attackLocks = new Map();   // ip  -> 解锁时间戳
const fpLocks = new Map();       // 设备指纹 -> 解锁时间戳
const fpByIp = new Map();        // ip -> 指纹
const attackStats = new Map();   // ip -> { login:[ts], search:[ts] }
const lastReport = new Map();    // ip|kind -> 上次写库时间

function loadAttackState() {
  try {
    const j = JSON.parse(fs.readFileSync(ATTACK_STATE_FILE, 'utf8'));
    const now = Date.now();
    for (const [k, t] of Object.entries(j.ips || {})) if (t > now) attackLocks.set(k, t);
    for (const [k, t] of Object.entries(j.fps || {})) if (t > now) fpLocks.set(k, t);
    console.log('[attack] 已恢复锁定 ' + attackLocks.size + ' IP / ' + fpLocks.size + ' 指纹');
  } catch (e) {}
}
function saveAttackState() {
  try {
    fs.mkdirSync('/app/state', { recursive: true });
    const now = Date.now();
    const ips = {}, fps = {};
    for (const [k, t] of attackLocks) if (t > now) ips[k] = t;
    for (const [k, t] of fpLocks) if (t > now) fps[k] = t;
    fs.writeFileSync(ATTACK_STATE_FILE, JSON.stringify({ ips, fps }), 'utf8');
  } catch (e) {}
}
loadAttackState();
setInterval(saveAttackState, 60000);

// 锁定写盘改为合并延迟执行，避免高频请求把同步全量写盘变成 DoS 放大器
let saveScheduled = false;
function scheduleSave() {
  if (saveScheduled) return;
  saveScheduled = true;
  const timer = setTimeout(() => { saveScheduled = false; saveAttackState(); }, 1000);
  if (timer.unref) timer.unref();
}

const MAX_FP_LOCKS = 20000;

function lockIp(ip, kind, ms) {
  if (!ip) return;
  const duration = Number.isFinite(ms) && ms > 0 ? ms : ATTACK_LOCK_MS;
  attackLocks.set(ip, Date.now() + duration);
  scheduleSave();
  console.log('[attack-lock] ' + ip + ' ' + kind + ' → 锁定 ' + Math.round(duration / 60000) + ' 分钟');
}
function lockFingerprint(fp, ip) {
  if (!fp) return;
  if (!fpLocks.has(fp) && fpLocks.size >= MAX_FP_LOCKS) {
    const now = Date.now();
    for (const [k, t] of fpLocks) if (t <= now) fpLocks.delete(k);
    if (fpLocks.size >= MAX_FP_LOCKS) return;
  }
  fpLocks.set(fp, Date.now() + ATTACK_LOCK_MS);
  if (ip) {
    fpByIp.set(ip, fp);
    if (fpByIp.size > MAX_FP_LOCKS) {
      const oldest = fpByIp.keys().next().value;
      if (oldest) fpByIp.delete(oldest);
    }
  }
  scheduleSave();
  console.log('[attack-lock] fp=' + fp + ' ip=' + ip + ' → 指纹锁定 30 分钟');
}
function isIpLocked(ip) {
  const t = attackLocks.get(ip);
  if (!t) return 0;
  const left = t - Date.now();
  if (left <= 0) { attackLocks.delete(ip); return 0; }
  return left;
}
function isFpLocked(fp) {
  if (!fp) return 0;
  const t = fpLocks.get(fp);
  if (!t) return 0;
  const left = t - Date.now();
  if (left <= 0) { fpLocks.delete(fp); return 0; }
  return left;
}
function getCookie(req, name) {
  const raw = req.headers && req.headers.cookie;
  if (!raw) return '';
  for (const part of String(raw).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

// 写库（失败静默，按 ip+类型 去重）
function reportAttack(payload) {
  if (!ATTACK_LOG_TOKEN) return;
  const key = payload.ip + '|' + payload.kind;
  const now = Date.now();
  const windowMs = payload.kind === 'region' ? 600000 : 60000;
  if ((lastReport.get(key) || 0) > now - windowMs) return;
  lastReport.set(key, now);
  if (lastReport.size > 5000) lastReport.clear();
  try {
    const url = new URL(ATTACK_LOG_URL);
    const data = JSON.stringify(payload);
    const req = http.request({
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-attack-token': ATTACK_LOG_TOKEN,
        'content-length': Buffer.byteLength(data)
      },
      timeout: 3000
    }, (r) => r.resume());
    req.on('error', () => {});
    req.on('timeout', () => req.destroy());
    req.write(data);
    req.end();
  } catch (e) {}
}

function noteAttack(ip, kind) {
  const now = Date.now();
  let s = attackStats.get(ip);
  if (!s) { s = { login: [], search: [], loginFail: [] }; attackStats.set(ip, s); }
  if (kind === 'login') s.login.push(now);
  else if (kind === 'search') s.search.push(now);
  else s.loginFail.push(now);
  const cut = now - 600000;
  s.login = s.login.filter((t) => t > cut);
  s.search = s.search.filter((t) => t > cut);
  s.loginFail = (s.loginFail || []).filter((t) => t > now - 3600000);
  if (attackStats.size > 5000) attackStats.clear();
  return s;
}
function detectAttack(ip) {
  const s = attackStats.get(ip);
  if (!s) return null;
  const now = Date.now();
  const loginCount = s.login.filter((t) => t > now - 600000).length;
  const searchCount = s.search.filter((t) => t > now - 60000).length;
  const failCount = (s.loginFail || []).filter((t) => t > now - 600000).length;
  if (loginCount >= ATK_LOGIN_MAX) return { kind: 'brute_force', label: '撞库登录', count: loginCount, window: '10 分钟' };
  if (failCount >= ATK_FAIL_MAX) return { kind: 'brute_force', label: '撞库登录（连续失败）', count: failCount, window: '10 分钟' };
  if (searchCount >= ATK_SEARCH_MAX) return { kind: 'enumeration', label: '批量用户枚举', count: searchCount, window: '1 分钟' };
  return null;
}

function attackPageHtml(kindLabel, ip, count, windowText, remainMs) {
  const now = new Date(Date.now() + 8 * 3600000).toISOString().replace('T', ' ').slice(0, 19);
  const remainMin = remainMs > 0 ? Math.max(1, Math.ceil(remainMs / 60000)) : 0;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>检测到攻击行为 · VoiceHub 校园广播站</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;background:#c40000;color:#000;font-family:system-ui,-apple-system,"Microsoft YaHei",sans-serif;padding:36px 22px;font-size:15px;line-height:2}
h1{font-size:21px;margin:0 0 18px}
p{margin:0 0 14px}
</style></head><body>
<h1>检测到您正在对本站实施攻击行为</h1>
<p>系统识别到您正在进行：${kindLabel}${count > 0 ? `（在 ${windowText} 内触发 ${count} 次）` : ''}。该行为已被实时拦截，并记录在案。</p>
${remainMin > 0 ? `<p>当前访问已被锁定，约 ${remainMin} 分钟后解除。在此期间更换网络、重启设备或更换浏览器均无效。</p>` : ''}
<p>本次访问记录：来源 IP ${ip}；发生时间（北京时间）${now}；类型 ${kindLabel}${count > 0 ? `；触发次数 ${count} 次` : ''}。相关证据已全部留存、无法删除，将提交学校德育处 / 信息技术中心核查；情节严重的，移交公安机关依法处理。使用本人或他人账号实施入侵的，将追究账号实际使用人责任。更换 IP、重启路由器或更换设备无法解除锁定——系统按设备指纹识别。</p>
<p>法律依据：《中华人民共和国网络安全法》第二十七条——任何个人和组织不得从事非法侵入他人网络、干扰他人网络正常功能、窃取网络数据等危害网络安全的活动；第六十三条——违反上述规定的，没收违法所得，可以并处五日以下拘留；情节较重的，处五日以上十五日以下拘留；构成犯罪的，依法追究刑事责任。</p>
<p>如您认为系统误判（例如正常登录时多次输错密码），请 30 分钟后再试，或联系广播站管理员说明情况。本页面不会自动关闭。</p>
<script>
(function(){
  try {
    var parts = [screen.width, screen.height, screen.colorDepth, window.devicePixelRatio || 1,
      Intl.DateTimeFormat().resolvedOptions().timeZone || '', navigator.language || '',
      navigator.hardwareConcurrency || 0, navigator.platform || ''];
    var c = document.createElement('canvas');
    var ctx = c.getContext('2d');
    if (ctx) {
      ctx.textBaseline = 'top'; ctx.font = '14px Arial';
      ctx.fillStyle = '#f60'; ctx.fillRect(0, 0, 100, 20);
      ctx.fillStyle = '#069'; ctx.fillText('VoiceHub-fp', 2, 2);
      parts.push(String(c.toDataURL()).slice(-64));
    }
    var gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (gl) {
      var dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) {
        parts.push(String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)));
        parts.push(String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)));
      }
    }
    parts.push(navigator.userAgent || '');
    var str = parts.join('|');
    var h = 5381;
    for (var i = 0; i < str.length; i++) { h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; }
    var fp = h.toString(16);
    document.cookie = 'vh_fp=' + fp + ';path=/;max-age=2592000;samesite=lax';
    fetch('/__fp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fp: fp }) }).catch(function(){});
  } catch (e) {}
})();
</script>
</body></html>`;
}

// ============================================================
//  地域闸：仅允许中国大陆 + Cloudflare CDN 回源 IP 访问（GEO_GATE=1 默认开启；数据缺失时自动放行，防止误锁站）
// ============================================================
// 搜索引擎 / 合法爬虫白名单：地域闸与脚本识别都要放行（用户要求不拦截搜索引擎扫描）
const SEARCH_BOT_RE = /(googlebot|google-inspectiontool|googleother|bingbot|bingpreview|msnbot|baiduspider|baidu|sogou|sogou web spider|360spider|haosouspider|yisouspider|bytespider|toutiaospider|applebot|duckduckbot|yandex|petalbot|yahoo! slurp|slurp|exabot|ia_archiver|archive\.org_bot|ccbot|gptbot|chatgpt-user|claudebot|perplexitybot|ahrefsbot|semrushbot|mj12bot|dotbot|facebookexternalhit|twitterbot|linkedinbot|telegrambot|whatsapp|slackbot|discordbot|pinterestbot|redditbot|qwantify|seznambot|yeti|naver|daumoa|samsungbot|petalbot)/i;
function isSearchBot(ua) {
  return SEARCH_BOT_RE.test(String(ua || ""));
}

// ---- 搜索引擎爬虫真实性校验：反向 DNS（PTR）后缀匹配，带缓存 ----
// 仅 UA 声称是爬虫还不够，必须 PTR 记录属于对应厂商域名，防止伪造 UA 绕过地域闸
const dns = require("dns").promises;
const BOT_FAMILIES = [
  { name: "google",  re: /googlebot|google-inspectiontool|googleother/i, hosts: ["googlebot.com", "google.com"] },
  { name: "bing",    re: /bingbot|bingpreview|msnbot/i,                 hosts: ["search.msn.com"] },
  { name: "baidu",   re: /baiduspider/i,                                hosts: ["crawl.baidu.com", "baidu.com", "baidu.jp"] },
  { name: "sogou",   re: /sogou/i,                                     hosts: ["sogou.com"] },
  { name: "360",     re: /360spider|haosouspider/i,                    hosts: ["360.cn", "so.com"] },
  { name: "yisou",   re: /yisouspider/i,                               hosts: ["yisou.com", "sm.cn"] },
  { name: "bytedance", re: /bytespider|toutiaospider/i,                hosts: ["bytedance.com", "toutiao.com"] },
  { name: "apple",   re: /applebot/i,                                  hosts: ["applebot.apple.com", "apple.com"] },
  { name: "duckduckgo", re: /duckduckbot/i,                            hosts: ["duckduckgo.com"] },
  { name: "yandex",  re: /yandex/i,                                    hosts: ["yandex.com", "yandex.net", "yandex.ru"] },
  { name: "yahoo",   re: /slurp/i,                                     hosts: ["crawl.yahoo.net", "yahoo.com"] }
];
const BOT_CACHE = new Map();
function botFamily(ua) {
  const t = String(ua || "");
  for (const f of BOT_FAMILIES) if (f.re.test(t)) return f;
  return null;
}
function dnsReverse(ip) {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve([]); } }, 2000);
    dns.reverse(ip).then((names) => { if (!done) { done = true; clearTimeout(t); resolve(names || []); } })
      .catch(() => { if (!done) { done = true; clearTimeout(t); resolve([]); } });
  });
}
const https = require("https");

// Cloudflare DoH（HTTPS 加密解析，防本地 DNS 投毒/劫持）
function dohQuery(name, type) {
  return new Promise((resolve) => {
    const url = "https://cloudflare-dns.com/dns-query?name=" + encodeURIComponent(name) + "&type=" + type;
    let done = false;
    const req = https.get(url, { headers: { accept: "application/dns-json" }, timeout: 2500 }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => {
        if (done) return; done = true;
        try { resolve((JSON.parse(body).Answer || []).map((a) => String(a.data || "")).filter(Boolean)); }
        catch (e) { resolve([]); }
      });
    });
    req.on("error", () => { if (!done) { done = true; resolve([]); } });
    req.on("timeout", () => { req.destroy(); if (!done) { done = true; resolve([]); } });
  });
}
function ipToReverseName(ip) {
  const s = String(ip || "").trim();
  if (!s) return "";
  if (s.indexOf(":") === -1) {
    return s.split(".").reverse().join(".") + ".in-addr.arpa";
  }
  // IPv6 -> nibble 形式
  const full = s.toLowerCase().split("%")[0];
  const parts = full.split("::");
  let groups = [];
  if (parts.length === 2) {
    const a = parts[0] ? parts[0].split(":") : [];
    const b = parts[1] ? parts[1].split(":") : [];
    const zeros = new Array(Math.max(0, 8 - a.length - b.length)).fill("0");
    groups = a.concat(zeros, b);
  } else {
    groups = parts[0].split(":");
  }
  const hex = groups.map((g) => g.padStart(4, "0")).join("");
  return hex.split("").reverse().join(".") + ".ip6.arpa";
}

// 校验：PTR 必须属于厂商域名，且正向解析必须回到该 IP（FCrDNS）
async function isVerifiedSearchBot(realIp, ua) {
  const fam = botFamily(ua);
  if (!fam) return false;
  const key = fam.name + "|" + realIp;
  const hit = BOT_CACHE.get(key);
  if (hit && hit.exp > Date.now()) return hit.ok;

  let ok = false;
  let ptr = "";
  try {
    const rev = ipToReverseName(realIp);
    let names = await dohQuery(rev, "PTR");
    let via = "doh";
    if (!names.length) { names = await dnsReverse(realIp); via = "system"; }
    const hostOf = (n) => String(n || "").toLowerCase().replace(/\.$/, "");
    const matched = names.map(hostOf).find((h) => h && fam.hosts.some((suf) => h === suf || h.endsWith("." + suf)));
    if (matched) {
      ptr = matched;
      const type = realIp.indexOf(":") === -1 ? "A" : "AAAA";
      const fwd = await dohQuery(matched, type);
      ok = fwd.some((a) => String(a).trim() === String(realIp).trim());
    }
    console.log("[bot] " + (ok ? "VERIFIED" : "SPOOFED ") + " ip=" + realIp + " family=" + fam.name + " ptr=" + (ptr || "-") + " via=" + via);
  } catch (e) { ok = false; }

  if (BOT_CACHE.size > 5000) BOT_CACHE.clear();
  BOT_CACHE.set(key, { ok, exp: Date.now() + (ok ? 10 * 60 * 1000 : 5 * 60 * 1000) });
  return ok;
}

// 地域闸运行时开关：默认由 GEO_GATE 环境变量决定，可由后台管理运行时切换并持久化
const GEO_LOCK_FILE = '/app/state/geo-lock.json'
let geoLockEnabled = String(process.env.GEO_GATE || '').trim() === '1'
function loadGeoLockState() {
  try {
    const j = JSON.parse(fs.readFileSync(GEO_LOCK_FILE, 'utf8'))
    if (typeof j.enabled === 'boolean') {
      geoLockEnabled = j.enabled
      console.log('[geo] 已恢复地域锁状态: ' + (geoLockEnabled ? '开启(仅中国)' : '关闭(所有IP)'))
    }
  } catch (e) {}
}
function saveGeoLockState() {
  try {
    fs.mkdirSync('/app/state', { recursive: true })
    fs.writeFileSync(GEO_LOCK_FILE, JSON.stringify({ enabled: geoLockEnabled }), 'utf8')
  } catch (e) {}
}
// 放行 IP 段（中国大陆 + Cloudflare CDN 回源），IPv4 二分查找
const GEO_RANGES = (() => {
  try {
    const lines = fs.readFileSync("/app/geo-allow-cidrs.txt", "utf8").split("\n").filter(Boolean);
    const arr = [];
    for (const l of lines) {
      const parts = l.split("/");
      const ipStr = parts[0];
      const bits = Number(parts[1]);
      const p = ipStr.split(".").map(Number);
      if (p.length !== 4 || p.some((n) => !Number.isFinite(n)) || !Number.isFinite(bits)) continue;
      const start = ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
      const end = start + Math.pow(2, 32 - bits) - 1;
      arr.push([start, end]);
    }
    arr.sort((a, b) => a[0] - b[0]);
    console.log("[geo] 已加载放行 IP 段（国内 + CDN）: " + arr.length);
    return arr;
  } catch (e) {
    console.error("[geo] 放行 IP 段加载失败，地域闸自动放行:", e.message);
    return null;
  }
})();
function ipToInt(ip) {
  const p = String(ip).split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return -1;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}
function normIp(ip) {
  return String(ip || '').replace(/^::ffff:/i, '');
}
function isLocalIp(ip) {
  return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1$)/.test(normIp(ip));
}
// 国内 IPv6 放行（无 IPv6 地域库，按国家级前缀放行；境外 IPv6 仍拦截）
const V6_CF_PREFIXES = ["2606:4700:","2803:f800:","2405:b500:","2405:8100:","2a06:98c0:","2a06:98c1:","2a06:98c2:","2a06:98c3:","2a06:98c4:","2a06:98c5:","2a06:98c6:","2a06:98c7:","2c0f:f248:"];
const V6_CN_PREFIXES = ["2400:","2401:","2402:","2403:","2404:","2405:","2406:","2407:","2408:","2409:","240a:","240b:","240c:","240d:","240e:","240f:","2001:da8:","2001:250:"];
function isChineseV6(ip) {
  const s6 = String(ip || "").toLowerCase();
  if (s6.indexOf(":") === -1) return false;
  for (let i = 0; i < V6_CN_PREFIXES.length; i++) if (s6.startsWith(V6_CN_PREFIXES[i])) return true;
  return false;
}
// 地域判定：仅允许中国大陆 + Cloudflare CDN 回源 IP（适配 IPv4 / IPv6）
function isChinaAllowed(ip) {
  if (!geoLockEnabled || !GEO_RANGES) return true;
  if (isLocalIp(ip)) return true;
  const nrm = normIp(ip);
  // IPv6：国内运营商前缀 / 教育网放行，Cloudflare 回源前缀放行；境外 IPv6 拦截
  if (nrm.indexOf(":") !== -1) return isChineseV6(nrm) || V6_CF_PREFIXES.some((p) => nrm.startsWith(p));
  const v = ipToInt(nrm);
  if (v < 0) return true;
  let lo = 0, hi = GEO_RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = GEO_RANGES[mid][0], e = GEO_RANGES[mid][1];
    if (v < s) hi = mid - 1;
    else if (v > e) lo = mid + 1;
    else return true;
  }
  return false;
}
loadGeoLockState();

// ============================================================
//  机器人实时检测：会话绑定 + 行为采集 + 请求签名
//  正常浏览器：每请求一次 HMAC 校验（~0.1ms），无网络调用
//  无 JS / 脚本：拿不到签名，累计评分后仅对敏感接口拦截
// ============================================================
const BOT_GUARD = String(process.env.BOT_GUARD || '1') === '1';
const BOT_BLOCK_SCORE = envInt('BOT_BLOCK_SCORE', 9);
// 管理接口需要有效 JWT 会话，误伤站长会直接锁死后台；这里不再用行为评分拦截 /api/admin/，
// 登录/搜索/点歌/音源等未登录或高价值接口仍保留机器人拦截。
const BOT_SENSITIVE_RE = /^\/api\/(user\/export|songs\/request|music\/)/;
const BOT_LOG_FILE = process.env.BOT_LOG_FILE || '/app/data/bot-events.jsonl';
let botLogWrites = 0;
function botEvent(o) {
  try {
    const line = JSON.stringify(Object.assign({ ts: new Date().toISOString() }, o)) + '\n';
    fs.appendFile(BOT_LOG_FILE, line, () => {});
    if ((++botLogWrites % 500) === 0) {
      fs.stat(BOT_LOG_FILE, (e, st) => {
        if (!e && st && st.size > 20 * 1024 * 1024) fs.rename(BOT_LOG_FILE, BOT_LOG_FILE + '.1', () => {});
      });
    }
  } catch (e) {}
}
const bhSecrets = new Map();
const botScores = new Map();

function botKey(req) {
  const cookie = getCookie(req, 'auth-token') || '';
  const fp = getCookie(req, 'vh_fp') || '';
  const ua = String(req.headers['user-agent'] || '');
  return crypto.createHash('sha256').update(cookie + '|' + fp + '|' + ua).digest('hex').slice(0, 20);
}
function botGet(key) {
  const now = Date.now();
  let s = botScores.get(key);
  if (!s) {
    s = { score: 0, reasons: {}, first: now, last: now, reports: 0, human: 0, unsigned: 0, signed: 0 };
    botScores.set(key, s);
    return s;
  }
  const mins = (now - (s.last || now)) / 60000;
  if (mins > 0) s.score = Math.max(0, s.score - mins * 0.25);
  return s;
}
function botAdd(s, reason, v) {
  s.reasons[reason] = (s.reasons[reason] || 0) + 1;
  s.score += v;
}
function botLog(s, key, path, meta) {
  const now = Date.now();
  if (now - (s.logAt || 0) < 30000) return;
  s.logAt = now;
  meta = meta || {};
  botEvent({ event: 'score', ip: meta.ip || '', fp: meta.fp || '', ua: meta.ua || '', key: key, score: Number(s.score.toFixed(1)), reasons: Object.keys(s.reasons), path: path });
  console.log('[botscore] key=' + key.slice(0, 8) + ' score=' + s.score.toFixed(1) +
    ' reasons=' + Object.keys(s.reasons).join(',') + ' path=' + path);
}

const VH_CLIENT_JS = String.raw`(function(){
// 加载屏被移除前先补到 100%：应用在 88% 就直接卸载，用户看不到"完成"
(function(){
  function isLoad(n){ return n && n.nodeType === 1 && n.classList && n.classList.contains('app-loading-screen'); }
  function finish(el){
    try{
      var bar = el.querySelector('.top-progress-bar');
      if(bar){ try{ bar.style.transition='width .08s linear'; }catch(e){} bar.style.width = '100%'; }
      var c = el.querySelector('.ring-fill');
      if(c) c.setAttribute('stroke-dashoffset','0');
      var b = el.querySelector('.phase-badge');
      if(b) b.textContent = 'COMPLETE PHASE';
      var numNow = el.querySelector('.ring-percent');
      if(numNow) numNow.textContent = '100%';
      // 收尾标记：之后新挂载的加载屏由 CSS 直接压制
      el.setAttribute('data-vh-keep','1');
      document.documentElement.classList.add('vh-done');
      window.__vhFinished = true;
      // 锁死 100%：应用复用节点写回 88% 也立即拉回
      if(!window.__vhKeep100){
        window.__vhKeep100 = setInterval(function(){
          var g = document.querySelector('.app-loading-screen');
          if(!g){ clearInterval(window.__vhKeep100); window.__vhKeep100 = null; return; }
          var pb = g.querySelector('.top-progress-bar');
          if(pb && pb.style.width !== '100%') pb.style.width = '100%';
          var pn = g.querySelector('.ring-percent');
          if(pn && pn.textContent !== '100%') pn.textContent = '100%';
          var pc = g.querySelector('.ring-fill');
          if(pc && pc.getAttribute('stroke-dashoffset') !== '0') pc.setAttribute('stroke-dashoffset','0');
        }, 30);
      }
      // 等页面内容真正渲染后再隐藏，避免 100% 之后白屏
      if(!el.__vhHideTimer){
        el.__vhHideTimer = setTimeout(function(){
          try{
            el.removeAttribute('data-vh-keep');
            el.style.setProperty('display','none','important');
            el.style.setProperty('visibility','hidden','important');
            el.style.setProperty('opacity','0','important');
          }catch(e){}
        }, 100);
      }
      try{ if(window.__vhCreep){ clearInterval(window.__vhCreep); window.__vhCreep = null; } }catch(e){}
    }catch(e){}
  }
  window.__vhFinish = finish;
  function hold(el, run){
    if(el.__vhHold){ return run(); }
    el.__vhHold = true;
    finish(el);
    setTimeout(run, 180);
  }
  var R = Element.prototype.remove;
  Element.prototype.remove = function(){
    if(isLoad(this)){ var s = this; hold(this, function(){ R.call(s); }); return; }
    return R.apply(this, arguments);
  };
  var RC = Node.prototype.removeChild;
  Node.prototype.removeChild = function(ch){
    if(isLoad(ch)){ var s = this, c = ch; hold(c, function(){ RC.call(s, c); }); return c; }
    return RC.apply(this, arguments);
  };
})();
if(window.__vh)return;window.__vh=1;
if(!window.loading)window.loading={value:false};
var id=null,secret=null,ready=null;
var ev={m:0,k:0,t:0,s:0,v:1,wd:navigator.webdriver?1:0,pl:(navigator.plugins||[]).length,lg:(navigator.languages||[]).length};
function bump(n){return function(){ev[n]++}}
window.addEventListener('mousemove',bump('m'),{passive:true});
window.addEventListener('keydown',bump('k'),{passive:true});
window.addEventListener('touchstart',bump('t'),{passive:true});
window.addEventListener('scroll',bump('s'),{passive:true});
document.addEventListener('visibilitychange',function(){ev.v=document.visibilityState==='visible'?1:0;report()});
function hash(s){var h=5381;for(var i=0;i<s.length;i++)h=((h<<5)+h+s.charCodeAt(i))>>>0;return h.toString(16)}
function fp(){var s=[screen.width,screen.height,navigator.hardwareConcurrency||0,navigator.deviceMemory||0,navigator.platform||'',(navigator.languages||[]).join(','),(Intl.DateTimeFormat().resolvedOptions().timeZone||'')].join('|');try{var c=document.createElement('canvas'),x=c.getContext('2d');x.textBaseline='top';x.font='14px Arial';x.fillStyle='#f60';x.fillText('VoiceHub',2,2);s+='|'+c.toDataURL().slice(-96)}catch(e){}return hash(s)}
var FP=fp();try{document.cookie='vh_fp='+FP+';path=/;max-age=2592000;samesite=lax'}catch(e){}
function hex(b){var s='';for(var i=0;i<b.length;i++){var h=b[i].toString(16);s+=h.length<2?'0'+h:h}return s}
function hmac(key,msg){var enc=new TextEncoder();return crypto.subtle.importKey('raw',enc.encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']).then(function(k){return crypto.subtle.sign('HMAC',k,enc.encode(msg))}).then(hex)}
ready=fetch('/__bh',{credentials:'same-origin',cache:'no-store'}).then(function(r){return r.json()}).then(function(j){id=j.id;secret=j.secret}).catch(function(){secret=null});
var tsReady=null,tsToken='',tsWaiters=[],tsErr=0;
function loadTs(){if(window.turnstile)return Promise.resolve(true);return new Promise(function(res){var s=document.createElement('script');s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';s.async=true;s.onload=function(){res(true)};s.onerror=function(){res(false)};document.head.appendChild(s)})}
function tsFail(msg){
  var e=document.getElementById('vh-ts-err');
  if(!e){
    e=document.createElement('div');
    e.id='vh-ts-err';
    e.style.cssText='margin:10px 0;padding:8px 10px;border-radius:8px;background:rgba(224,138,138,.12);color:#e08a8a;font-size:12px;line-height:1.6;text-align:center';
    var el=tsField();
    var form=el?el.closest('form'):null;
    var btn=form?form.querySelector('button[type="submit"]'):null;
    var host=document.getElementById('vh-ts-host');
    if(host&&host.parentElement){host.insertAdjacentElement('afterend',e)}
    else if(btn&&btn.parentElement){btn.parentElement.insertBefore(e,btn)}
    else{document.body.appendChild(e)}
  }
  e.textContent=msg;
}
function tsField(){
  var p=location.pathname;
  if(p==='/account'){
    var c=document.querySelector('#confirm-password')||document.querySelector('#new-password');
    if(!c)return null;
    return document.querySelector('#current-password')||c;
  }
  return document.querySelector('#username')||document.querySelector('#confirm-password')||document.querySelector('#confirmPassword')||document.querySelector('input[type="password"]');
}
function mountTs(key){
  if(document.getElementById('vh-ts-host'))return;
  if(document.querySelector('.cf-turnstile,[id^="cf-chl-widget"],iframe[src*="challenges.cloudflare.com"]'))return;
  var host=document.createElement('div');
  host.id='vh-ts-host';
  host.style.cssText='margin:14px 0 4px;display:flex;justify-content:center;min-height:65px';
  var el=tsField();
  var inserted=false;
  if(el){
    var form=el.closest('form');
    var btn=form?form.querySelector('button[type="submit"]'):null;
    if(btn&&btn.parentElement){btn.parentElement.insertBefore(host,btn);inserted=true}
    else if(form){
      var groups=form.querySelectorAll('.form-group');
      var last=groups.length?groups[groups.length-1]:null;
      if(last&&last.parentElement===form){form.insertBefore(host,last.nextSibling);inserted=true}
      else{form.appendChild(host);inserted=true}
    }
    else if(el.parentElement){el.parentElement.insertBefore(host,el.nextSibling);inserted=true}
  }
  if(!inserted)document.body.appendChild(host);
  window.__tsWidget=turnstile.render(host,{sitekey:key,theme:'auto',language:'zh-cn',callback:function(t){tsToken=t;tsErr=0;var e=document.getElementById('vh-ts-err');if(e)e.remove();tsWaiters.splice(0).forEach(function(f){f(t)})},'expired-callback':function(){tsToken=''},'error-callback':function(){tsErr=1;tsFail('人机验证加载失败，请刷新页面后重试');tsWaiters.splice(0).forEach(function(f){f('')})}});
}
function tsInit(){
  if(tsReady)return tsReady;
  var path=location.pathname;
  if(path!=='/forgot-password'&&path!=='/change-password'&&path!=='/reset-password'&&path!=='/account'){tsReady=Promise.resolve(false);return tsReady}
  tsReady=fetch('/api/site-config',{credentials:'same-origin'}).then(function(r){return r.json()}).then(function(cfg){
    var key=cfg&&cfg.turnstileSiteKey;if(!key){tsErr=1;tsFail('人机验证未配置，请联系管理员');return false}
    window.__vhTsSiteKey=key;
    return loadTs().then(function(ok){
      if(!ok){tsErr=1;tsFail('人机验证组件加载失败，请检查网络后刷新页面');return false}
      var tries=0;
      return new Promise(function(res){
        (function wait(){
          var el=tsField();
          if(el){mountTs(key);res(true);return}
          if(tries++>40){res(false);return}
          setTimeout(wait,250);
        })();
      });
    });
  }).catch(function(){return false});
  return tsReady;
}
function tsGet(){if(window.__vhModalToken)return Promise.resolve(window.__vhModalToken);return tsInit().then(function(ok){if(!ok)return '';if(tsErr)return '';return new Promise(function(res){if(tsToken)return res(tsToken);tsWaiters.push(res);setTimeout(function(){res(tsToken||'')},4000)})})}
function withToken(init,tk){var ni=init?Object.assign({},init):{};try{var b=ni.body;if(typeof b==='string'){var j=JSON.parse(b);j.turnstileToken=tk;ni.body=JSON.stringify(j);var h=new Headers(ni.headers||{});if(!h.has('content-type'))h.set('content-type','application/json');ni.headers=h}else if(b&&typeof b==='object'&&!(b instanceof FormData)){ni.body=Object.assign({},b,{turnstileToken:tk})}else if(b instanceof FormData){b.append('turnstileToken',tk)}}catch(e){}return ni}
var of=window.fetch;
var unameShown=false;
function vhEsc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function showUnameModal(){
  if(unameShown||document.getElementById('vh-setup'))return;
  unameShown=true;
  var needPwd=!!window.__vhNeedPwd, needUname=!!window.__vhNeedUname;
  var emailOk=!!window.__vhEmailVerified;
  var curEmail=window.__vhEmail||'';
  var m=document.createElement('div');
  m.id='vh-setup';
  m.style.cssText='position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.66);display:flex;align-items:flex-start;justify-content:center;padding:20px 16px 32px;overflow:auto;-webkit-overflow-scrolling:touch';
  var card=document.createElement('div');
  card.style.cssText='width:100%;max-width:440px;margin:0 auto;background:#16181d;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:22px 20px;color:#eaeaea;font-family:system-ui,-apple-system,"Microsoft YaHei",sans-serif;box-shadow:0 24px 60px rgba(0,0,0,.5)';
  var LBL='display:block;margin:0 0 6px;font-size:12px;font-weight:700;color:#9aa0a6';
  var INP='width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.16);background:#0f1115;color:#fff;font-size:14px;outline:none';
  var html='<h3 style="margin:0 0 4px;font-size:16px;font-weight:800">完善账号信息</h3>'
    +'<p style="margin:0 0 12px;font-size:12.5px;line-height:1.7;color:#9aa0a6">为了你的账号安全，首次登录需要设置'+(needPwd?(needUname?'<b style="color:#eaeaea">新的用户名</b>和<b style="color:#eaeaea">新的密码</b>':'<b style="color:#eaeaea">新的密码</b>'):'<b style="color:#eaeaea">新的用户名</b>')+'，并完成一次邮箱验证。设置后不再提醒。</p>';
  if(!emailOk){
    html+='<div id="vh-email-box" style="margin:0 0 16px;padding:14px;border-radius:12px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08)">'
      +'<div style="font-size:12.5px;font-weight:800;margin-bottom:10px;color:#eaeaea">邮箱验证</div>'
      +'<label style="'+LBL+'">邮箱地址</label>'
      +'<div style="display:flex;gap:8px"><input id="vh-em" value="'+vhEsc(curEmail)+'" placeholder="name@example.com" style="'+INP+';flex:1">'
      +'<button id="vh-em-send" type="button" style="flex:0 0 auto;padding:0 14px;border-radius:10px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#eaeaea;font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap">发送验证码</button></div>'
      +'<label style="'+LBL+';margin-top:12px">邮箱验证码</label>'
      +'<input id="vh-code" inputmode="numeric" maxlength="6" placeholder="6 位验证码" style="'+INP+'">'
      +'<div id="vh-em-st" style="margin-top:8px;font-size:12px;color:#9aa0a6">验证码将发送至该邮箱，10 分钟内有效</div>'
      +'</div>';
  }
  if(needUname){
    html+='<label style="'+LBL+'">设置新用户名（登录账号）</label>'
      +'<input id="vh-un" maxlength="20" placeholder="2-20 位中文/字母/数字/下划线" style="'+INP+'">'
      +'<div id="vh-un-hint" style="margin:6px 0 14px;font-size:11.5px;line-height:1.7;color:#6b7280">当前用户名：'+vhEsc(window.__vhCurUname)+'，新用户名不能与它相同</div>';
  }
  if(needPwd){
    html+='<div style="margin:0 0 8px;font-size:12.5px;font-weight:800;color:#eaeaea">设置新密码</div>'
      +'<label style="'+LBL+'">当前密码</label><input id="vh-pw0" type="password" autocomplete="current-password" placeholder="输入当前登录密码" style="'+INP+';margin-bottom:10px">'
      +'<label style="'+LBL+'">新密码</label><input id="vh-pw1" type="password" autocomplete="new-password" placeholder="至少 6 位" style="'+INP+'">'
      +'<div style="margin:6px 0 14px;font-size:11.5px;line-height:1.7;color:#6b7280">新密码可以与原密码相同</div>'
      +'<label style="'+LBL+'">确认新密码</label><input id="vh-pw2" type="password" autocomplete="new-password" placeholder="再次输入新密码" style="'+INP+'">';
  }
  if(needPwd){
    html+='<div id="vh-setup-ts" style="margin-top:14px;display:flex;justify-content:center;min-height:65px"></div>'
      +'<div style="margin:0 0 4px;font-size:11.5px;line-height:1.7;color:#6b7280;text-align:center">修改密码需要完成一次人机验证</div>';
  }
  html+='<div id="vh-setup-err" style="display:none;margin-top:10px;font-size:12px;line-height:1.6;color:#ff8a8a"></div>'
    +'<button id="vh-setup-btn" style="margin-top:14px;width:100%;padding:10px;border:0;border-radius:10px;background:#2563eb;color:#fff;font-size:14px;font-weight:700;cursor:pointer">保存并继续</button>'
    +'<p style="margin:10px 0 0;font-size:11.5px;color:#6b7280;text-align:center">如遇问题请联系广播站管理员</p>';
  card.innerHTML=html;
  m.appendChild(card);
  document.body.appendChild(m);
  function $(id){return document.getElementById(id)}
  function err(msg){var e=$('vh-setup-err');if(!e)return;e.style.display=msg?'block':'none';e.textContent=msg||''}
  function req(path,body){return window.fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json().catch(function(){return {}}).then(function(j){return {ok:r.ok,j:j}})});}
  function msgOf(x){var j=x.j||{};return (j.data&&j.data.message)||j.message||j.statusMessage||'操作失败，请重试'}

  var sentEmail='', verified=false;
  window.__vhModalToken='';
  if(needPwd){
    (function mountModalTs(){
      var box=document.getElementById('vh-setup-ts');
      if(!box)return;
      function render(){
        try{
          if(!window.turnstile||!window.__vhTsSiteKey)return false;
          window.__vhModalWidget=window.turnstile.render(box,{sitekey:window.__vhTsSiteKey,theme:'dark',language:'zh-cn',callback:function(t){window.__vhModalToken=t;},'expired-callback':function(){window.__vhModalToken='';},'error-callback':function(){window.__vhModalToken='';}});
          return true;
        }catch(e){return false}
      }
      if(render())return;
      var tries=0;
      var t=setInterval(function(){
        if(render()||tries++>40){clearInterval(t);}
      },250);
    })();
  }
  if(!emailOk){
    var sendBtn=$('vh-em-send');
    sendBtn.onclick=function(){
      var em=($('vh-em').value||'').trim().toLowerCase();
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)){err('邮箱格式不正确，请检查后再试');return}
      err('');sendBtn.disabled=true;sendBtn.textContent='发送中…';
      req('/api/user/email/send-code',{email:em}).then(function(x){
        if(x.ok){sentEmail=em;$('vh-em-st').textContent='验证码已发送至 '+em+'，请查收';$('vh-em-st').style.color='#7ee2a8';var n=60;sendBtn.textContent=n+'s';var t=setInterval(function(){n--;sendBtn.textContent=n>0?n+'s':'重新发送';if(n<=0){clearInterval(t);sendBtn.disabled=false;sendBtn.textContent='重新发送'}},1000);}
        else{err(msgOf(x));sendBtn.disabled=false;sendBtn.textContent='发送验证码';}
      }).catch(function(){err('网络异常，请重试');sendBtn.disabled=false;sendBtn.textContent='发送验证码';});
    };
    var codeInp=$('vh-code');
    if(codeInp)codeInp.onblur=function(){
      var code=(codeInp.value||'').trim();
      if(!sentEmail||code.length<4)return;
      $('vh-em-st').textContent='验证中…';$('vh-em-st').style.color='#9aa0a6';
      req('/api/user/email/verify-code',{email:sentEmail,code:code}).then(function(x){
        if(x.ok){verified=true;$('vh-em-st').textContent='邮箱已验证';$('vh-em-st').style.color='#7ee2a8';err('');}
        else{$('vh-em-st').textContent='验证失败，请检查验证码';$('vh-em-st').style.color='#ff8a8a';}
      }).catch(function(){$('vh-em-st').textContent='网络异常，请重试';});
    };
  } else { verified=true; }

  var btn=$('vh-setup-btn');
  btn.onclick=function(){
    if(!emailOk&&!verified){
      // 引导先验证：若已填验证码则尝试验证
      var em=($('vh-em').value||'').trim().toLowerCase();
      var code=(($('vh-code')&&$('vh-code').value)||'').trim();
      if(em&&code.length>=4){
        req('/api/user/email/verify-code',{email:sentEmail||em,code:code}).then(function(x){
          if(x.ok){verified=true;$('vh-em-st').textContent='邮箱已验证';$('vh-em-st').style.color='#7ee2a8';err('');btn.click();}
          else err('邮箱验证失败：'+msgOf(x));
        });
        return;
      }
      err('请先完成邮箱验证');return;
    }
    var uname=needUname?(($('vh-un').value||'').trim()):'';
    if(needUname){
      if(uname.length<2||uname.length>20){err('用户名长度需为 2-20 个字符');return}
      if(!/^[\u4e00-\u9fa5A-Za-z0-9_]+$/.test(uname)){err('用户名只能包含中文、英文、数字和下划线');return}
      if(/^\d+$/.test(uname)){err('用户名不能是纯数字');return}
      if(window.__vhCurUname&&uname===window.__vhCurUname){err('新用户名不能与当前用户名相同');return}
    }
    var pw0=needPwd?(($('vh-pw0').value)||''):'';
    var pw1=needPwd?(($('vh-pw1').value)||''):'';
    var pw2=needPwd?(($('vh-pw2').value)||''):'';
    if(needPwd){
      if(!pw0){err('请输入当前密码');return}
      if(pw1.length<6){err('新密码长度至少为 6 位');return}
      if(pw1!==pw2){err('两次输入的新密码不一致');return}
    }
    err('');btn.disabled=true;btn.textContent='保存中…';
    var chain=Promise.resolve();
    if(needPwd){
      chain=chain.then(function(){return req('/api/auth/change-password',{currentPassword:pw0,newPassword:pw1}).then(function(x){if(!x.ok)throw new Error(msgOf(x));});});
    }
    if(needUname){
      chain=chain.then(function(){return req('/api/user/name-change',{field:'USERNAME',value:uname}).then(function(x){if(!x.ok)throw new Error(msgOf(x));});});
    }
    chain.then(function(){
      btn.textContent='完成';
      location.reload();
    }).catch(function(e){
      var _m=(e&&e.message)||'保存失败，请重试';
      if(/人机验证|验证码/.test(_m)&&window.turnstile&&window.__vhModalWidget!=null){
        try{window.turnstile.reset(window.__vhModalWidget);}catch(x){}
        window.__vhModalToken='';
        _m=_m+'（请在下方完成人机验证后重试）';
      }
      err(_m);
      btn.disabled=false;btn.textContent='保存并继续';
    });
  };
}
var of2=window.fetch;
var of2=window.fetch;
window.fetch=function(input,init){
  return of2.apply(window,arguments);
};
function send(input,init,u,method){return ready.then(function(){if(!secret||!window.crypto||!crypto.subtle)return of.call(window,input,init);var ts=Math.floor(Date.now()/1000),n=Math.random().toString(16).slice(2)+Date.now().toString(16);return hmac(secret,method+'\n'+u.pathname+u.search+'\n'+ts+'\n'+n).then(function(sig){var ni=init?Object.assign({},init):{};var h=new Headers(ni.headers||(input&&input.headers)||{});h.set('x-vh-id',id);h.set('x-vh-ts',''+ts);h.set('x-vh-n',n);h.set('x-vh-sig',sig);ni.headers=h;return of.call(window,input,ni)})}).catch(function(){return of.call(window,input,init)})}
window.fetch=function(input,init){
  var u=null;
  try{var url=typeof input==='string'?input:(input&&input.url)||'';u=new URL(url,location.href)}catch(e){return of.apply(window,arguments)}
  if(!u||u.origin!==location.origin||u.pathname.indexOf('/api/')!==0)return of.apply(window,arguments);
  var method=(init&&init.method)||(input&&input.method)||'GET';
  if((u.pathname==='/api/auth/forgot-password'||u.pathname==='/api/auth/change-password'||u.pathname==='/api/auth/reset-password')&&String(method).toUpperCase()==='POST'){
    return tsGet().then(function(tk){return send(input,withToken(init,tk),u,method)});
  }
  return send(input,init,u,method).then(function(res){
    try{
      if(res&&res.ok&&(u.pathname==='/api/auth/verify'||u.pathname==='/api/auth/login')){
        res.clone().json().then(function(j){
          var usr=j&&(j.user||(j.data&&j.data.user));
          if(usr&&(usr.requireUsernameChange||usr.requirePasswordChange)){
            window.__vhNeedPwd=!!usr.requirePasswordChange;
            window.__vhNeedUname=!!usr.requireUsernameChange;
            window.__vhEmail=usr.email||'';
            window.__vhEmailVerified=!!usr.emailVerified;
            window.__vhCurUname=usr.username||'';
            showUnameModal();
          }
        }).catch(function(){});
      }
    }catch(e){}
    return res;
  });
};
var __vhTextFix=(function(){
  var MAP=[
    ['提交后需管理员审核，通过后才生效。','保存后立即生效。'],
    ['用户名修改申请已提交，等待管理员审核','用户名已修改并生效'],
    ['改名申请已提交，等待管理员审核','修改已保存并生效'],
    ['已提交改名申请','已修改为'],
    ['等待管理员审核','已生效'],
    ['提交改名申请','保存修改'],
    ['修改姓名 / 用户名','修改姓名 / 用户名'],
    ['Changes take effect after an administrator approves them.','Changes take effect immediately.'],
    ['Submit name change','Save changes'],
    ['submitted for admin review','saved and effective immediately'],
    ['for admin review','saved and effective immediately'],
    ['admin review','immediately effective']
  ];
  function apply(){
    if(location.pathname!=='/account')return;
    var w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,null,false),n,changed=0;
    while((n=w.nextNode())){
      var t=n.nodeValue;
      if(!t||t.length<2)continue;
      var nt=t;
      for(var i=0;i<MAP.length;i++){ if(nt.indexOf(MAP[i][0])>=0) nt=nt.split(MAP[i][0]).join(MAP[i][1]); }
      if(nt!==t){ n.nodeValue=nt; changed++; }
    }
    return changed;
  }
  var t=null;
  function loop(){
    if(location.pathname==='/account'){ apply(); }
    t=setTimeout(loop,2500);
  }
  loop();
  return apply;
})();
var __vhSetupChecked=0;
function checkSetup(){
  var p=location.pathname;
  if(p!=='/account'&&p!=='/change-password')return;
  if(document.getElementById('vh-setup'))return;
  if(Date.now()-__vhSetupChecked<5000)return;
  __vhSetupChecked=Date.now();
  try{
    window.fetch('/api/auth/verify',{credentials:'include',cache:'no-store'}).then(function(r){return r.ok?r.json():null}).then(function(j){
      var usr=j&&(j.user||(j.data&&j.data.user));
      if(usr&&(usr.requireUsernameChange||usr.requirePasswordChange)){
        window.__vhNeedPwd=!!usr.requirePasswordChange;
        window.__vhNeedUname=!!usr.requireUsernameChange;
        window.__vhEmail=usr.email||'';
        window.__vhEmailVerified=!!usr.emailVerified;
        window.__vhCurUname=usr.username||'';
        showUnameModal();
      }
    }).catch(function(){});
  }catch(e){}
}
setInterval(checkSetup,3000);checkSetup();
function report(){if(!id)return;try{navigator.sendBeacon('/__bh/report',new Blob([JSON.stringify({id:id,fp:FP,ev:ev})],{type:'application/json'}))}catch(e){}}
setInterval(report,30000);report();
var tsPath='',tsLastTry=0;
function maybeMountTs(){
  var p=location.pathname;
  var target=(p==='/forgot-password'||p==='/change-password'||p==='/reset-password'||p==='/account');
  if(p!==tsPath){tsPath=p;tsReady=null;tsToken='';tsErr=0;tsLastTry=0;}
  if(!target){var _h=document.getElementById('vh-ts-host');if(_h){try{if(window.turnstile&&window.__tsWidget!=null)window.turnstile.remove(window.__tsWidget)}catch(e){}try{_h.remove()}catch(e){}window.__tsWidget=null;tsToken='';}return;}
  if(document.getElementById('vh-ts-host'))return;
  var now=Date.now();
  if(now-tsLastTry<1500)return;
  tsLastTry=now;
  tsReady=null;
  tsInit();
}
setInterval(maybeMountTs,1200);maybeMountTs();
// 账号页「我的点赞」列表限高滚动：避免 30+ 首把页面拉得很长
(function(){
  function apply(){
    if(location.pathname!=='/account')return;
    var secs=document.querySelectorAll('section');
    for(var i=0;i<secs.length;i++){
      var t=(secs[i].innerText||'').toLowerCase();
      if(t.indexOf('\u6211\u7684\u70b9\u8d5e')<0 && t.indexOf('my likes')<0 && t.indexOf('my stars')<0 && t.indexOf('likes')<0) continue;
      var u=secs[i].querySelector('ul');
      if(!u || u.getAttribute('data-vh-scroll')) continue;
      u.setAttribute('data-vh-scroll','1');
      u.style.maxHeight='min(45vh, 360px)';
      u.style.overflowY='auto';
      u.style.overscrollBehavior='contain';
      u.style.paddingRight='6px';
    }
  }
  try{
    var st=document.createElement('style');
    st.textContent='[data-vh-scroll]::-webkit-scrollbar{width:4px}[data-vh-scroll]::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:2px}[data-vh-scroll]::-webkit-scrollbar-track{background:transparent}';
    document.head.appendChild(st);
  }catch(e){}
  setInterval(apply,1200);apply();
})();
// 首屏加载条：按真实加载事件推进（DOM 解析 / CSS / JS / load），不做时间匀速
(function(){
  var tries=0, done=false, cur=8, jsN=0;
  function attach(){
    var el=document.querySelector('.top-progress-bar');
    if(!el){ if(tries++<80) setTimeout(attach,100); return; }
    var CIRC=2*Math.PI*54, PW=0;
    function paint(p){
      var g=document.querySelector('.top-progress-bar')||el;
      var fw=parseFloat(g.style.width);
      if(!(Math.abs(fw-p)<0.5)){ try{ g.style.width=p+'%'; }catch(e){} }
      // 数字与环形跟随「条的实际渲染宽度」，避免条还在过渡时数字先跳
      var shown=Math.round(p);
      try{
        if(!PW && g.parentElement) PW=g.parentElement.getBoundingClientRect().width;
        if(PW>0) shown=Math.round(g.getBoundingClientRect().width/PW*100);
      }catch(e){}
      if(shown<0) shown=0; if(shown>100) shown=100;
      var v=shown;
      var t=document.querySelector('.ring-percent');
      if(t && t.textContent!==v+'%') t.textContent=v+'%';
      var c=document.querySelector('.ring-fill');
      if(c){
        var off=String((CIRC-CIRC*v/100).toFixed(2));
        if(c.getAttribute('stroke-dashoffset')!==off) c.setAttribute('stroke-dashoffset', off);
      }
      var b=document.querySelector('.phase-badge');
      if(b){
        var ph=p>=82?'CONTENT PHASE':p>=58?'SLOW NETWORK PHASE':p>=46?'AUTH PHASE':p>=28?'CONFIG PHASE':'START PHASE';
        if(b.textContent!==ph) b.textContent=ph;
      }
    }
    function advance(p){
      if(done) return;
      if((parseFloat(el.style.width)||0)>=87){ done=true; return; }
      if(p>cur){ cur=p; lastAdv=Date.now(); paint(cur); }
    }
    var lastAdv=Date.now();
    paint(16);              // 脚本一执行即表示 HTML 已到达
    // DOM 解析完成
    if(document.readyState!=='loading') advance(34);
    document.addEventListener('readystatechange', function(){
      if(document.readyState==='interactive') advance(34);
    });
    // 真实资源的 load 事件（link/script 不冒泡，用捕获）
    document.addEventListener('load', function(e){
      var t=e.target;
      if(!t||!t.tagName) return;
      if(t.tagName==='LINK' && /\.css(\?|$)/.test(t.href||'')) advance(50);
      else if(t.tagName==='SCRIPT' && /\/_nuxt\//.test(t.src||'')){ jsN++; advance(Math.min(78, 52+jsN*2)); }
    }, true);
    // 依赖全部就绪
    if(document.readyState==='complete') advance(84);
    window.addEventListener('load', function(){ advance(84); });
    // Vue 写入真实进度（>=80）后交还控制权
    var mo=new MutationObserver(function(){
      var g=document.querySelector('.top-progress-bar')||el;
      var w=parseFloat(g.style.width)||0;
      if(!done){
        if(w>=87){ done=true; startCreep(w); }
        return;
      }
      // 收尾期：应用会把 88% 重新写进 DOM。MutationObserver 在微任务里执行，
      // 早于本轮绘制，因此可以「同帧改回」，浏览器根本不会画出 88%。
      var want=Math.max(cur||0, creepV||0);
      if(w < want - 0.5){
        g.style.width = want + '%';
        var t=document.querySelector('.ring-percent');
        if(t) t.textContent = Math.round(want) + '%';
        var c=document.querySelector('.ring-fill');
        if(c) c.setAttribute('stroke-dashoffset', String((CIRC-CIRC*want/100).toFixed(2)));
      }
      if(g!==el){
        el=g;
        try{ mo.disconnect(); mo.observe(g,{attributes:true,attributeFilter:['style']}); }catch(e){}
      }
    });
    mo.observe(el,{attributes:true,attributeFilter:['style']});
    // 无信号的空档（如 CSS 下载中）给极慢心跳，幅度小、不越过真实节点
    // 收尾爬升：88 -> 99，等应用卸载加载屏时再补满（避免长时间停在某个数字上）
    var creepV = 87;
    function startCreep(from){
      creepV = Math.max(creepV, from || 87);
      if(window.__vhCreep) return;
      window.__vhCreep = setInterval(function(){
        var g=document.querySelector('.top-progress-bar');
        if(!g || !document.querySelector('.app-loading-screen')){ clearInterval(window.__vhCreep); window.__vhCreep=null; return; }
        if(window.__vhFinished || (parseFloat(g.style.width)||0)>=99){ clearInterval(window.__vhCreep); window.__vhCreep=null; return; }
        creepV = Math.min(99, creepV + 1);
        g.style.width = creepV + '%';
        var n=document.querySelector('.ring-percent');
        if(n) n.textContent = creepV + '%';
      }, 480);
    }
    // hydration 会整体替换加载屏节点，新节点回到 SSR 的 16%。
    // 这里只负责守护当前值（不让它回退），收尾交给卸载时的 hold。
    var firstScreen=el.closest('.app-loading-screen')||document.querySelector('.app-loading-screen');
    var swap=setInterval(function(){
      if(window.__vhFinished){ clearInterval(swap); return; }
      var sc=document.querySelector('.app-loading-screen');
      if(sc && firstScreen && sc!==firstScreen){
        firstScreen=sc;
        var g=sc.querySelector('.top-progress-bar');
        var want=Math.max(cur||0, creepV);
        if(g && (parseFloat(g.style.width)||0) < want) g.style.width = want + '%';
        if(g && g!==el){
          el=g;
          try{ mo.disconnect(); mo.observe(g,{attributes:true,attributeFilter:['style']}); }catch(e){}
        }
      }
    },100);
    // 逐帧守护：应用重渲染可能只改数字/环、不改条宽；条的过渡期间数字也要跟随
    (function guard(){
      if(window.__vhFinished) return;
      var want=Math.max(cur||0, creepV||0);
      var g=document.querySelector('.top-progress-bar');
      if(g) el=g;
      paint(want);
      requestAnimationFrame(guard);
    })();
    var idle=setInterval(function(){
      if(done){ clearInterval(idle); return; }
      if((parseFloat(el.style.width)||0)>=87){ done=true; clearInterval(idle); return; }
      if(Date.now()-lastAdv>240 && cur<87){ advance(cur+1); }
    },240);
    setTimeout(function(){ try{ mo.disconnect(); }catch(e){} }, 60000);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',attach,{once:true});
  else attach();
})();
})();`;

const VH_JS_VER = (() => {
  let h = 5381;
  for (let i = 0; i < VH_CLIENT_JS.length; i++) h = ((h << 5) + h + VH_CLIENT_JS.charCodeAt(i)) >>> 0;
  return h.toString(36);
})();

function handleBotGuard(req, res, pathname, ip) {
  if (pathname === '/__vh.js') {
    res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'public, max-age=31536000, immutable' });
    res.end(VH_CLIENT_JS);
    return;
  }
  if (pathname === '/__bh') {
    if (hit(ip, 'bh', 60, Date.now()).blocked) {
      res.writeHead(429, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ error: 'too_many_requests' }));
      return;
    }
    const key = botKey(req);
    const id = crypto.randomBytes(12).toString('hex');
    const secret = crypto.randomBytes(24).toString('hex');
    if (bhSecrets.size >= 20000) {
      const now = Date.now();
      for (const [k, v] of bhSecrets) if (v.exp < now) bhSecrets.delete(k);
      if (bhSecrets.size >= 20000) {
        const oldest = bhSecrets.keys().next().value;
        if (oldest) bhSecrets.delete(oldest);
      }
    }
    bhSecrets.set(id, { secret, key, exp: Date.now() + 30 * 60 * 1000 });
    botEvent({ event: 'session', ip: ip, fp: getCookie(req, 'vh_fp') || '', ua: String(req.headers['user-agent'] || '').slice(0, 160), key: key });
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ id, secret, ttl: 1800 }));
    return;
  }
  if (pathname === '/__bh/report') {
    let body = '';
    req.on('data', (c) => { if (body.length < 4096) body += c; });
    req.on('end', () => {
      try {
        const j = JSON.parse(body || '{}');
        const rec = bhSecrets.get(String(j.id || ''));
        if (rec && rec.exp > Date.now()) {
          const s = botGet(rec.key);
          const ev = j.ev || {};
          if (ev.wd) botAdd(s, 'webdriver', 6);
          if ((ev.pl || 0) === 0 && (ev.lg || 0) === 0) botAdd(s, 'headless_env', 2);
          const act = (ev.m || 0) + (ev.k || 0) + (ev.t || 0) + (ev.s || 0);
          if (act > 5) { s.human++; s.score = Math.max(0, s.score - 2); }
          else if (Date.now() - s.first > 120000 && !s.noInput) {
            // 长时间停留且无输入只扣一次分，避免后台常开页面被持续累加评分误封
            s.noInput = 1;
            botAdd(s, 'no_input', 3);
          }
          s.reports++;
          s.last = Date.now();
          botEvent({ event: 'report', ip: ip, fp: j.fp || '', ua: String(req.headers['user-agent'] || '').slice(0, 160), key: rec.key, score: Number(s.score.toFixed(1)), reasons: Object.keys(s.reasons), ev: ev });
          botLog(s, rec.key, 'report', { ip: ip, fp: j.fp || '', ua: String(req.headers['user-agent'] || '').slice(0, 160) });
        }
      } catch (e) {}
      res.writeHead(204, { 'cache-control': 'no-store' });
      res.end();
    });
    return;
  }
  res.writeHead(404);
  res.end();
}

function botGuardCheck(req, ip, pathname, method) {
  if (!BOT_GUARD) return false;
  if (!pathname.startsWith('/api/') || pathname.startsWith('/api/internal/')) return false;
  const key = botKey(req);
  const s = botGet(key);
  // 记录最近来源，供后台「Bot 评分」区块展示账号/IP 关联
  s.lastIp = ip;
  s.lastUa = String(req.headers['user-agent'] || '').slice(0, 160);
  const sig = String(req.headers['x-vh-sig'] || '');
  const sid = String(req.headers['x-vh-id'] || '');
  const ts = String(req.headers['x-vh-ts'] || '');
  const nonce = String(req.headers['x-vh-n'] || '');
  const q = req.url.indexOf('?');
  const search = q === -1 ? '' : req.url.slice(q);
  if (sig && sid && ts && nonce) {
    const rec = bhSecrets.get(sid);
    const nowSec = Math.floor(Date.now() / 1000);
    if (!rec || rec.key !== key) botAdd(s, 'sig_unknown', 3);
    else if (!Number.isFinite(Number(ts)) || Math.abs(nowSec - Number(ts)) > 180) botAdd(s, 'sig_expired', 3);
    else {
      const want = crypto.createHmac('sha256', rec.secret)
        .update(method + '\n' + pathname + search + '\n' + ts + '\n' + nonce).digest('hex');
      const ok = want.length === sig.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig));
      if (ok) { s.signed++; s.score = Math.max(0, s.score - 0.4); }
      else botAdd(s, 'sig_invalid', 5);
    }
  } else if (getCookie(req, 'auth-token')) {
    s.unsigned++;
    if (!s.reports && s.unsigned <= 3) botAdd(s, 'unsigned_api', 1);
  }
  s.last = Date.now();
  if (s.score >= 5) botLog(s, key, pathname, { ip: ip, fp: getCookie(req, 'vh_fp') || '', ua: String(req.headers['user-agent'] || '').slice(0, 160) });
  if (s.score >= BOT_BLOCK_SCORE && BOT_SENSITIVE_RE.test(pathname) && !isTrusted(ip)) {
    console.log('[botguard] BLOCK key=' + key.slice(0, 8) + ' score=' + s.score.toFixed(1) + ' path=' + pathname);
    botEvent({ event: 'block', ip: ip, fp: getCookie(req, 'vh_fp') || '', ua: String(req.headers['user-agent'] || '').slice(0, 160), key: key, score: Number(s.score.toFixed(1)), reasons: Object.keys(s.reasons), path: pathname });
    return true;
  }
  return false;
}

// ============================================================
//  内部管理接口（仅供应用容器调用，需 x-attack-token）
//    GET  /__internal/bans    查询永封 / IP 锁定 / 指纹锁定
//    POST /__internal/unban   按 ip 或 fp 解封
// ============================================================
function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function handleInternalAdmin(req, res, pathname) {
  const token = String(req.headers['x-attack-token'] || '');
  if (!ATTACK_LOG_TOKEN || !safeEqualString(token, ATTACK_LOG_TOKEN)) {
    sendJson(res, 403, { success: false, message: 'forbidden' });
    return;
  }
  if (pathname === '/__internal/bans' && req.method === 'GET') {
    const now = Date.now();
    sendJson(res, 200, {
      success: true,
      permanent: [...permanentBans.entries()].map(([ip, v]) => ({
        ip, at: v.at || 0, count: v.count || 0, detail: v.detail || ''
      })),
      locks: [...attackLocks.entries()].filter(([, t]) => t > now).map(([ip, until]) => ({ ip, until })),
      fps: [...fpLocks.entries()].filter(([, t]) => t > now).map(([fp, until]) => ({
        fp, until, ip: fpByIp.get(fp) || ''
      }))
    });
    return;
  }
  if (pathname === '/__internal/unban' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { if (body.length < 4096) body += c; });
    req.on('end', () => {
      let j = {};
      try { j = JSON.parse(body || '{}'); } catch (e) {}
      const type = String(j.type || 'ip');
      const value = String(j.value || '').trim();
      if (!value) { sendJson(res, 400, { success: false, message: 'missing value' }); return; }
      let removed = 0;
      if (type === 'fp') {
        if (fpLocks.delete(value)) removed++;
      } else {
        if (permanentBans.delete(value)) removed++;
        if (attackLocks.delete(value)) removed++;
        const fp = fpByIp.get(value);
        if (fp && fpLocks.delete(fp)) removed++;
        fpByIp.delete(value);
      }
      if (removed > 0) {
        savePermanentBans();
        saveAttackState();
      }
      console.log('[unban] type=' + type + ' value=' + value + ' removed=' + removed);
      sendJson(res, 200, { success: true, removed });
    });
    return;
  }
  // ---- Bot 评分快照（供后台攻击日志面板按账号/IP 查看）----
  if (pathname === '/__internal/bot-scores' && req.method === 'GET') {
    const rows = [...botScores.entries()].map(([key, s]) => ({
      key,
      score: Number((s.score || 0).toFixed(1)),
      reasons: Object.keys(s.reasons || {}),
      ip: s.lastIp || '',
      ua: s.lastUa || '',
      first: s.first || 0,
      last: s.last || 0,
      reports: s.reports || 0,
      human: s.human || 0,
      signed: s.signed || 0,
      unsigned: s.unsigned || 0
    })).sort((a, b) => b.score - a.score).slice(0, 500);
    sendJson(res, 200, { success: true, scores: rows });
    return;
  }
  // ---- 手动封禁（后台攻击日志面板填写 IP）----
  if (pathname === '/__internal/ban' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { if (body.length < 4096) body += c; });
    req.on('end', () => {
      let j = {};
      try { j = JSON.parse(body || '{}'); } catch (e) {}
      const ip = String(j.ip || '').trim().replace(/^::ffff:/i, '');
      const detail = String(j.detail || 'manual ban from admin panel').slice(0, 300);
      if (!ip || ip.length > 45) { sendJson(res, 400, { success: false, message: 'invalid ip' }); return; }
      // 防呆：禁止封禁内网/本机/受信 IP，防止自锁
      if (isLocalIp(ip) || isTrusted(ip)) {
        sendJson(res, 400, { success: false, message: 'refused: local or trusted ip' });
        return;
      }
      const prev = permanentBans.get(ip);
      permanentBans.set(ip, { at: (prev && prev.at) || Date.now(), count: ((prev && prev.count) || 0) + 1, detail });
      attackLocks.delete(ip);
      savePermanentBans();
      saveAttackState();
      console.log('[ban] manual ban ip=' + ip + ' detail=' + detail);
      sendJson(res, 200, { success: true, ip, detail });
    });
    return;
  }
  // ---- 出口白名单运行时管理 ----
  if (pathname === '/__internal/trusted-ips' && req.method === 'GET') {
    sendJson(res, 200, { success: true, ips: [...TRUSTED_IPS].sort() });
    return;
  }
  if (pathname === '/__internal/trusted-ips' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { if (body.length < 4096) body += c; });
    req.on('end', () => {
      let j = {};
      try { j = JSON.parse(body || '{}'); } catch (e) {}
      const action = String(j.action || '');
      const ip = String(j.ip || '').trim().replace(/^::ffff:/i, '');
      if (!ip || ip.length > 45) { sendJson(res, 400, { success: false, message: 'invalid ip' }); return; }
      if (action === 'add') {
        if (isLocalIp(ip)) { sendJson(res, 400, { success: false, message: 'refused: local ip' }); return; }
        if (!TRUSTED_IPS.has(ip)) { TRUSTED_IPS.add(ip); saveTrustedIpsState(); }
        console.log('[trusted] add ip=' + ip + ' total=' + TRUSTED_IPS.size);
        sendJson(res, 200, { success: true, ips: [...TRUSTED_IPS].sort() });
      } else if (action === 'remove') {
        const had = TRUSTED_IPS.delete(ip);
        if (had) saveTrustedIpsState();
        console.log('[trusted] remove ip=' + ip + ' removed=' + had);
        sendJson(res, 200, { success: true, removed: had ? 1 : 0, ips: [...TRUSTED_IPS].sort() });
      } else {
        sendJson(res, 400, { success: false, message: 'action must be add|remove' });
      }
    });
    return;
  }
  // ---- 地域闸运行时开关 ----
  if (pathname === '/__internal/geo-lock' && req.method === 'GET') {
    sendJson(res, 200, { success: true, enabled: geoLockEnabled });
    return;
  }
  if (pathname === '/__internal/geo-lock' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { if (body.length < 256) body += c; });
    req.on('end', () => {
      let j = {};
      try { j = JSON.parse(body || '{}'); } catch (e) {}
      const enabled = j.enabled === true || j.enabled === 'true' || j.enabled === 1;
      geoLockEnabled = !!enabled;
      saveGeoLockState();
      console.log('[geo] 地域锁已切换为: ' + (geoLockEnabled ? '开启(仅中国)' : '关闭(所有IP)'));
      sendJson(res, 200, { success: true, enabled: geoLockEnabled });
    });
    return;
  }
  sendJson(res, 404, { success: false, message: 'not found' });
}

async function handleRequest(req, res) {
  const _ip = realIp(req);
  const _ua = String(req.headers["user-agent"] || "");
  let botOK = false;
  if (isSearchBot(_ua)) { try { botOK = await isVerifiedSearchBot(_ip, _ua); } catch (e) { botOK = false; } }
  const ip = realIp(req);
  noteIp(ip, req);

  const qIdx = req.url.indexOf('?');
  const rawPathname = qIdx === -1 ? req.url : req.url.slice(0, qIdx);
  // 安全判定用解码后的路径；转发仍使用原始 req.url
  const pathname = normalizePathname(rawPathname);

  // ---- 机器人检测端点：脚本下发 / 密钥签发 / 行为上报 ----
  if (pathname === '/__vh.js' || pathname === '/__bh' || pathname === '/__bh/report') {
    handleBotGuard(req, res, pathname, ip);
    return;
  }

  // ---- 站点根目录验证文件：最优先返回（不受封禁/地域闸/锁定影响）----
  if (serveVerifyFile(req, res, pathname)) {
    console.log('[verify] served ' + pathname + ' from ' + ip);
    return;
  }

  const ua = String(req.headers['user-agent'] || '').slice(0, 280);
  const cookieFp = getCookie(req, 'vh_fp');

  // ---- 内部管理接口：优先于封禁/地域闸判定 ----
  if (pathname === '/__internal/bans' || pathname === '/__internal/unban' || pathname === '/__internal/geo-lock' || pathname === '/__internal/bot-scores' || pathname === '/__internal/ban' || pathname === '/__internal/trusted-ips') {
    handleInternalAdmin(req, res, pathname);
    return;
  }

  // ---- 设备指纹上报端点（由攻击声明页 JS 调用）----
  if (pathname === '/__fp') {
    if (hit(ip, 'fp', 10, Date.now()).blocked) {
      res.writeHead(429, { 'cache-control': 'no-store' });
      res.end();
      return;
    }
    let body = '';
    req.on('data', (c) => { if (body.length < 2048) body += c; });
    req.on('end', () => {
      try {
        const j = JSON.parse(body || '{}');
        const fp = String(j.fp || '').replace(/[^0-9a-z]/gi, '').slice(0, 32);
        // 只在当前 IP 已被锁定或永久封禁时记录指纹，避免匿名请求任意制造指纹锁定
        if (fp && (isIpLocked(ip) > 0 || isPermanentlyBanned(ip))) {
          lockFingerprint(fp, ip);
          reportAttack({ ip, kind: 'brute_force', path: pathname, count: 0, userAgent: ua, fingerprint: fp, action: 'attack_page', detail: '设备指纹采集' });
        }
      } catch (e) {}
      res.writeHead(204, { 'cache-control': 'no-store' });
      res.end();
    });
    return;
  }

  // ---- 脚本 / 自动化工具识别：命中直接锁定并返回声明页 ----
  if (SENSITIVE_PATH_RE.test(pathname)) {
    const scriptReason = looksLikeScript(req);
    if (scriptReason && !botOK && !isTrusted(ip)) {
      console.log('[script] BLOCK ip=' + ip + ' ' + scriptReason + ' ' + pathname);
      lockIp(ip, 'script');
      reportAttack({ ip, kind: 'script', path: pathname, count: 0, userAgent: ua,
        fingerprint: cookieFp, action: 'attack_page', detail: '脚本工具访问（' + scriptReason + '）' });
      const left = isIpLocked(ip);
      res.writeHead(403, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(attackPageHtml('使用自动化脚本访问接口', ip, 0, '—', left));
      return;
    }
  }

  // ---- 永久封禁：命中直接返回声明页（持久化，重启不丢）----
  if (!isTrusted(ip) && isPermanentlyBanned(ip)) {
    console.log('[perma] BLOCK ip=' + ip + ' ' + pathname);
    const left = isIpLocked(ip);
    res.writeHead(403, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(attackPageHtml('已被永久封禁的攻击来源', ip, permanentBans.get(ip)?.count || 0, '历史记录', left > 0 ? left : ATTACK_LOCK_MS));
    return;
  }

  // ---- 受信任出口：跳过攻击锁定（仍记录便于审计）----
  const trusted = isTrusted(ip);
  if (trusted && (isIpLocked(ip) > 0 || isFpLocked(cookieFp) > 0)) {
    console.log('[trusted] BYPASS ip=' + ip + ' skip-lock');
  }

  // ---- 已锁定：IP 或设备指纹命中 → 直接返回声明页 ----
  const fpLeft = trusted ? 0 : isFpLocked(cookieFp);
  if (fpLeft > 0 && !isIpLocked(ip)) {
    lockIp(ip, 'fp-follow');
    reportAttack({ ip, kind: 'brute_force', path: pathname, count: 0, userAgent: ua, fingerprint: cookieFp, action: 'attack_page', detail: '设备指纹命中（换 IP 仍识别）' });
  }
  let ipLeft = trusted ? 0 : isIpLocked(ip);

  // ---- 反攻击：登录撞库 / 批量用户枚举 行为识别 ----
  if (pathname === '/api/auth/login') noteAttack(ip, 'login');
  else if (pathname === '/api/users/search') noteAttack(ip, 'search');
  const atk = trusted ? null : detectAttack(ip);
  if (atk) {
    if (ipLeft <= 0) {
      lockIp(ip, atk.kind, atk.kind === 'enumeration' ? 5 * 60 * 1000 : ATTACK_LOCK_MS);
      reportAttack({ ip, kind: atk.kind, path: pathname, count: atk.count, userAgent: ua, fingerprint: cookieFp, action: 'attack_page', detail: atk.label + ' ' + atk.count + ' 次/' + atk.window });
    }
    ipLeft = isIpLocked(ip);
  }

  if (ipLeft > 0) {
    console.log('[attack-page] ' + ip + ' remain=' + Math.ceil(ipLeft / 60000) + 'min ' + pathname);
    res.writeHead(403, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(attackPageHtml(atk ? atk.label : '攻击行为', ip, atk ? atk.count : 0, atk ? atk.window : '历史记录', ipLeft));
    return;
  }

  if (!trusted && BAN_IPS.has(ip)) {
    console.log('[ban] BLOCK ip=' + ip + ' ' + req.url);
    lockIp(ip, 'banned');
    reportAttack({ ip, kind: 'banned', path: pathname, count: 0, userAgent: ua, fingerprint: cookieFp, action: 'attack_page', detail: '命中封禁名单' });
    const left = isIpLocked(ip);
    res.writeHead(403, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(attackPageHtml('已被封禁的攻击来源', ip, 0, '历史记录', left));
    return;
  }

  // ---- 地域闸：非中国大陆 / 非 CDN 回源 IP 一律拒绝（不展示声明页，直接无法访问）----
  if (geoLockEnabled && !isChinaAllowed(ip) && !botOK) {
    console.log('[geo] BLOCK ip=' + ip + ' ' + req.url);
    reportAttack({ ip, kind: 'region', path: pathname, count: 0, userAgent: ua, fingerprint: cookieFp, action: 'blocked', detail: '境外/非授权地区' });
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end('Forbidden');
    return;
  }


  // ---- 机器人评分拦截：仅高置信度 + 敏感接口 ----
  if (botGuardCheck(req, ip, pathname, req.method || 'GET')) {
    res.writeHead(403, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ success: false, message: '检测到自动化访问，请刷新页面后重试', code: 'AUTOMATION_SUSPECTED' }));
    return;
  }

  // ---- 同源闸：音乐/QQ 代理接口不接受站外/脚本调用 ----
  if (GATE_PROXY && PROXY_PATH_RE.test(pathname) && !sameOrigin(req)) {
    console.log('[gate] BLOCK ip=' + ip + ' sfs="' + String(req.headers['sec-fetch-site'] || '') +
      '" ua="' + String(req.headers['user-agent'] || '').slice(0, 60) + '" ' + req.url);
    res.writeHead(403, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ success: false, message: '该接口仅限本站页面调用', code: 'SAME_ORIGIN_REQUIRED' }));
    return;
  }

  // ---- 限流（按真实 IP）----
  const [cat, limit] = classify(pathname);
  const r = hit(ip, cat, limit, Date.now());
  if (r.blocked) {
    console.log('[rl] BLOCK ip=' + ip + ' cat=' + cat + ' ' + r.count + '/' + r.limit + ' ' + req.url);
    const body = JSON.stringify({ success: false, message: '请求过于频繁，请稍后再试', code: 'RATE_LIMITED' });
    res.writeHead(429, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'retry-after': String(Math.max(1, r.retry || 60)),
    });
    res.end(body);
    return;
  }

  if (req.url === COMBINED || String(req.url).split('?')[0] === COMBINED) {
    if (!cssCache.content) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('no-css'); return; }
    res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'public, max-age=604800' });
    res.end(cssCache.content);
    return;
  }
  const headers = Object.assign({}, req.headers, { 'accept-encoding': 'identity' });
  // 归一化客户端 IP：只把「真实 IP」单值传给上游，杜绝 XFF 伪造穿透到应用层
  headers['x-forwarded-for'] = ip;
  headers['x-real-ip'] = ip;
  const preq = http.request({ host: UH, port: UP, path: req.url, method: req.method, headers }, (pres) => {
    // ---- 登录失败计数：慢速撞库（每分钟 1 次）也能在 6 次失败后锁定 ----
    if (pathname === '/api/auth/login' && (pres.statusCode === 400 || pres.statusCode === 401 || pres.statusCode === 423)) {
      noteAttack(ip, 'loginFail');
      if (countLoginFails(ip, 3600000) >= ATK_PERMA_FAILS && !isPermanentlyBanned(ip)) {
        permanentBan(ip, countLoginFails(ip, 3600000), ua, cookieFp);
      }
      const failAtk = detectAttack(ip);
      if (failAtk && isIpLocked(ip) <= 0) {
        const hourFails = countLoginFails(ip, 3600000);
        if (hourFails >= ATK_PERMA_FAILS) {
          permanentBan(ip, hourFails, ua, cookieFp);
        } else {
          lockIp(ip, failAtk.kind);
          reportAttack({ ip, kind: failAtk.kind, path: pathname, count: failAtk.count, userAgent: ua, fingerprint: cookieFp, action: 'attack_page', detail: failAtk.label + ' ' + failAtk.count + ' 次/' + failAtk.window });
          console.log('[attack-lock] ' + ip + ' 连续登录失败 ' + failAtk.count + ' 次 → 已锁定 30 分钟');
        }
      }
    }
    const ct = String(pres.headers['content-type'] || '');
    if (!ct.includes('text/html')) {
      res.writeHead(pres.statusCode, pres.headers);
      pres.pipe(res);
      return;
    }
    const chunks = [];
    pres.on('data', (c) => chunks.push(c));
    pres.on('end', async () => {
      let html = Buffer.concat(chunks).toString('utf8');
      html = html.replace(/<link[^>]*rel="prefetch"[^>]*>/g, '');
      // ---- SEO 修正（让爬虫拿到正确的标题与规范链接）----
      const vhost = safeHost(req.headers['x-forwarded-host'] || req.headers['host'] || '');
      const vurl = vhost ? 'https://' + vhost + '/' : '';
      if (/<title>\s*加载中/.test(html)) {
        html = html.replace(/<title>[^<]*<\/title>/i, '<title>校园广播站点歌系统 - 在线点歌<\/title>');
      }
      // ---- Turnstile 速度优化：预连接 + 预加载人机验证脚本 ----
      if (!/challenges\.cloudflare\.com/i.test(html.split('</head>')[0] || '')) {
        html = html.replace('</head>',
          '<link rel="dns-prefetch" href="https://challenges.cloudflare.com">' +
          '<link rel="preconnect" href="https://challenges.cloudflare.com" crossorigin>' +
          '<link rel="preload" as="script" crossorigin href="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit">' +
          '</head>');
      }
      if (!/__vh\.js/.test(html)) {
        html = html.replace('</head>', '<script async src="/__vh.js?v=' + VH_JS_VER + '"></script></head>');
      }
      if (vurl) {
        if (!/rel="canonical"/i.test(html)) {
          html = html.replace('</head>', '<link rel="canonical" href="' + vurl + '"></head>');
        }
        if (!/property="og:url"/i.test(html)) {
          html = html.replace('</head>', '<meta property="og:url" content="' + vurl + '"></head>');
        }
        html = html.replace(/(property="og:image" content=")\//, '$1' + vurl);
      }

      const re = /<link[^>]*rel="stylesheet"[^>]*href="(\/_nuxt\/[^"]+\.css)"[^>]*>/g;
      const names = [];
      let m;
      while ((m = re.exec(html)) !== null) names.push(m[1]);
      if (names.length) {
        await buildCombined(names);
        html = html.replace(/<link[^>]*rel="stylesheet"[^>]*href="\/_nuxt\/[^"]+\.css"[^>]*>/g, '');
        const cssHref = COMBINED + (cssCache.ver ? '?v=' + cssCache.ver : '');
        html = html.replace('</head>', '<link rel="preload" as="style" fetchpriority="high" href="' + cssHref + '"><link rel="stylesheet" href="' + cssHref + '"></head>');
      }
      // 字体本地化：MiSans 原走 cdn.jsdelivr.net，国内单分片可达 20s
      html = html.replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/misans@4\.1\.0\/lib\/Normal\//g, '/_fonts/misans/');
      // 首帧起始值：8% 显得像卡住，提到 16%（脚本接管后会继续推进）
      html = html.replace(/(class="top-progress-bar"[^>]*style="width:)8%/g, function(m, p1){ return p1 + '16%'; });
      html = html.replace(/(class="ring-percent"[^>]*>)8%(<\/span>)/g, function(m, p1, p2){ return p1 + '16%' + p2; });
      html = html.replace('stroke-dashoffset="312.1486460606818"', 'stroke-dashoffset="285.0053"');
      // 字体已本地：去掉多余的 jsdelivr 预连接
      html = html.replace(/<link[^>]*rel="preconnect"[^>]*cdn\.jsdelivr\.net[^>]*>/g, '');
      html = html.replace(/<link[^>]*rel="dns-prefetch"[^>]*cdn\.jsdelivr\.net[^>]*>/g, '');
      // 首页没有登录表单，不需要 Turnstile 脚本
      if (pathname === '/') {
        html = html.replace(/<link[^>]*challenges\.cloudflare\.com[^>]*>/g, '');
      }
      const buf = Buffer.from(html, 'utf8');
      const h = Object.assign({}, pres.headers);
      delete h['content-encoding'];
      delete h['etag'];
      h['content-length'] = String(buf.length);
      res.writeHead(pres.statusCode || 200, h);
      res.end(buf);
    });
  });
  preq.on('error', () => { res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }); res.end('rewriter upstream error'); });
  req.pipe(preq);
}
const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((e) => {
    console.error("[req] error:", e && e.message);
    try { if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" }); res.end("error"); } catch (e2) {}
  });
});
server.listen(PORT, () => console.log('rewriter v6 (real-ip rate-limit + same-origin gate=' + (GATE_PROXY ? 'on' : 'off') + ') listening on ' + PORT));
