# Weculture 最小事件统计设计

日期：2026-11-01（北京时间）。状态：**本地实现与自动检查完成**；新增 `analytics_events` 表、服务端事件写入和后台只读聚合；未部署、未执行云端迁移、未真机。原始事件清理和日聚合表暂未实现。

## 1. 目标与问题

先回答运营真正需要的六个问题，再决定采集什么：

1. 搜索后有多少人打开详情（搜索→详情转化）。
2. 发布流程从进入到提交的完成情况。
3. 审核从提交到处理耗时多久。
4. 评论参与程度（发表、回复、删除）。
5. 活动报名与取消的数量和比例。
6. 回访情况（按日／周去重活跃）。

不做用户画像、跨端身份拼接、原文检索或广告归因。

## 2. 隐私与最小化

- 不采集搜索原文、评论正文、OpenID、昵称、头像、位置坐标、设备指纹或敏感正文。
- 需要区分“同一用户重复行为”时，只保存服务端 HMAC 的用户哈希（密钥独立、可轮换），不保存可逆身份。
- 事件属性只保留枚举、数量和必要的对象 id；对象 id 不进入对外报表。
- 默认保留 90 天原始事件、聚合数据长期保留；后台只读聚合结果。
- 统计失败不得阻塞业务；客户端补报失败只记录最小错误码，不记录正文。

## 3. 事件编码

| 编码 | 触发 | 允许属性 | 说明 |
| --- | --- | --- | --- |
| `search_performed` | 服务端完成搜索 | `mode`（content/users）、`resultBucket`（0/1-5/6-20/21+） | 不存关键词 |
| `post_viewed` | 详情成功返回 | `postType`、`circle`、`source`（feed/search/featured/share） | 可按曝光计，不等于阅读完成 |
| `post_published` | 投稿成功 | `postType`、`circle`、`status` | 与审核状态分开 |
| `post_reviewed` | 管理员审核完成 | `status`、`latencyBucket` | 服务端从 `createdAt` 计算耗时 |
| `comment_created` | 评论／回复成功 | `postType`、`isReply` | 不存正文 |
| `event_registered` | 报名成功 | 无用户可见属性 | 可按活动聚合 |
| `event_cancelled` | 取消成功 | 无用户可见属性 | 与报名分开 |
| `session_started` | 每日首次有效请求 | `returning`（布尔） | 不做实时在线人数 |

客户端只上报用户主动行为且已有服务端成功结果的事件；审核、搜索等以服务端为准，避免客户端伪造。每个事件带客户端 `eventId` 或复用请求 id，服务端唯一索引去重。

## 4. 数据模型（本地实现）

已实现单表 `analytics_events`，后台读取时按北京时间日期和事件编码即时聚合；`analytics_daily` 预聚合表暂未实现，等数据量或查询压力需要时再加。

- `id`、`eventCode`、`createdAt`（事件时间，复用 `BaseEntity`）、`schoolId` nullable、`actorHash` nullable、`targetType`/`targetId` nullable、`properties`（受限 JSON 文本）、`dedupeKey`（唯一）。
- 索引：`(eventCode, createdAt)`、`(schoolId, createdAt)`、唯一 `dedupeKey`。
- 不存原文、昵称、OpenID、坐标；`actorHash` 为服务端 HMAC，用于去重行为人数。
- 迁移 `1793000002000-AnalyticsEvents`，可逆；生产仍 `synchronize=false`。
- 原始事件清理任务、90 天保留和日聚合表**未实现**；当前读取上限 20,000 条，超出返回 `truncated:true`。

## 5. API 与后台（本地实现）

- `GET /api/v1/admin/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD&schoolId=`：只读聚合；`super_admin` 全量，`operator` 仅本校；`reviewer` 无权限。范围最多31天，日期按北京时间自然日。
- 返回 `{from,to,schoolId,items,totals,truncated}`；`items` 按日／事件编码返回 `count` 和 `uniqueActors`，`totals` 按事件编码汇总；不返回用户、对象明细或 `actorHash`。
- 后台“数据统计”：日期范围、学校筛选、事件总数／类型／天数、按事件汇总和按日明细；不做实时大屏。
- 读取访问审计和导出**未实现**；当前只有管理员鉴权和学校范围。

## 6. 检查结果

- 已接入事件：`search_performed`（内容／用户搜索，记录结果分桶，不存关键词）、`post_viewed`、`post_published`、`post_reviewed`（记录延迟分桶）、`comment_created`（重试复用请求时不重复）、`event_registered`（重复报名不重复）、`event_cancelled`。
- 未实现 `session_started` 回访事件；第 1 节第 6 个问题暂不能回答。
- API：24 个测试文件、221 项通过；统计 3 项、迁移 4 项；构建退出码 0。
- 后台：`npm run build` 通过；统计界面未做浏览器点击验收。
- 隐私：搜索词、评论正文、投稿正文未进入事件属性；响应不返回 `actorHash` 或原始事件。
- 限制：SQL.js 测试，不是真实 MySQL；未部署、未迁移、未真机；清理和日聚合未实现。

## 7. 依赖与下一步

- 需要真实 MySQL 验证索引、日期边界和 20,000 条上限；需要确认保留周期、读取审计和导出需求。
- 回访指标需要单独定义“每日首次有效会话”，不要用登录次数冒充。
- 统计包与 P3 创作功能分开发布；迁移顺序按 `ContentReports → FeaturedPosts → AnalyticsEvents`。
- 当前只完成本地实现；云端部署、迁移和真实数据核对由用户执行。
