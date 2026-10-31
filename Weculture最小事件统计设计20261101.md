# Weculture 最小事件统计设计

日期：2026-11-01（北京时间）。状态：**仅设计，未实现**；不新增表、接口或埋点，不部署。

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

## 4. 数据模型

建议两张表（实现前评审）：

`analytics_events`：
- `id`、`eventCode`、`occurredAt`、`schoolId` nullable、`actorHash` nullable、`targetType`/`targetId` nullable、`properties`（受限 JSON 文本）、`dedupeKey`（唯一）、`createdAt`。
- 索引：`(eventCode, occurredAt)`、`(schoolId, occurredAt)`、唯一 `dedupeKey`。
- 不存原文、昵称、OpenID、坐标。

`analytics_daily`：
- `date`（北京时间自然日）、`schoolId` nullable、`eventCode`、`count`、`uniqueActors`、`updatedAt`。
- 唯一 `(date, schoolId, eventCode)`；由定时任务或写入时增量聚合，后台只读此表。

原始事件 90 天后清理；聚合数据保留周期另定。所有迁移可逆，生产仍 `synchronize=false`。

## 5. API 与后台

- `GET /api/v1/admin/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD&schoolId=`：只读聚合；`super_admin` 全量，`operator` 仅本校；`reviewer` 默认无权限。
- 返回按日／事件编码的 `count` 和 `uniqueActors`，不返回用户或对象明细。
- 后台最小看板：日期范围、学校、六个指标卡和一张按日表格；不做实时大屏。
- 所有读取记访问审计；导出功能暂不做。

## 6. 完成标准

- 每个指标能回答第 1 节的问题，口径写清“事件发生”与“用户数”的区别。
- 重复提交、弱网补报、服务端重试不重复计数；失败不阻塞业务。
- 不采集敏感原文或身份；权限和学校范围有回归。
- 原始事件清理和聚合保留有可执行方案；真实 MySQL 上验证索引和聚合。
- 后台构建、API 自动检查和页面编译通过；真机后置项明确。

## 7. 依赖与下一步

- P2a 已完成本地实现；统计可在 P2b 设计确认后单独建包。
- 需要先确认：指标口径、学校维度、保留周期、谁有权看、是否需要导出。
- 实现顺序：迁移→服务端事件写入→聚合→后台只读→定向测试；不与 P3 创作功能混在一个发布包。
- 本文件不是实现授权；未新增任何代码、表或埋点。
