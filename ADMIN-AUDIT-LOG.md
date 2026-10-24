# 管理员日志审计（AdminAuditLog）

> 关联上游议题：laoshuikaixue/VoiceHub#305 「[Feature]: 日志审计系统」
> 方便管理员审计操作是否合规 —— 本文档描述 VoiceHub-Plus 社区版已实现的管理员操作审计子系统。

## 功能范围

仅记录**超级管理员、管理员、歌曲管理员**的登录与后台操作；操作记录在接口执行成功后写入，失败/中断的请求不产生审计记录（避免误报）。

## 数据模型

`AdminAuditLog` 表（迁移 `app/drizzle/migrations/20261018010000_add_admin_audit_log.sql`）：

| 字段 | 说明 |
|---|---|
| `actorId` / `actorName` | 操作者 |
| `action` | 动作类型（登录 / 操作，附具体动作名）|
| `target` | 操作对象 |
| `detail` | 详情 |
| `ip` | 来源 IP |
| `userAgent` | 设备信息 |
| `createdAt` | 时间（建索引）|

`action` 亦建索引，支持按动作类型快速过滤。

## 查询接口

`server/api/admin/audit-logs.get.ts`（管理员权限校验）：

- `type=login|action`：只看登录 / 只看操作 / 全部（UNION 合并两个分支）
- `q`：关键词搜索（管理员 / 动作 / 对象，截断 80 字符）
- `hours`：时间范围（最长 30 天）
- `page` / `pageSize`：分页（默认 50，上限 200）

## 管理界面

`app/components/Admin/AttackLogs.vue` 内「日志审计」标签页：时间、管理员、类型（登录/操作徽标）、处置对象一目了然，支持关键词查询与时间范围过滤。

## 审计写入点

登录成功（`login` 类）与各敏感管理接口成功执行后写入（`action` 类），包括但不限于：
用户管理（`server/api/admin/users/[id].put.ts` 等）、封禁管理（`ban-ip.post.ts`）、
备份导出（`backup/export.post.ts`）、密码安全（`server/services/passwordSecurityService.ts`）等。

## 设计要点

1. **成功后落库**：只在接口执行成功后写入，审计记录即可信操作记录。
2. **双索引**：时间 + 动作两个索引覆盖最常用的审计查询路径。
3. **与攻击日志互补**：攻击日志（`AttackLog`）记录外部威胁，本审计记录内部管理行为，两者同属日志审计体系但数据模型独立。
