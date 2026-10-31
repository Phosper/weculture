# Weculture 内容／评论举报治理设计与交付

日期：2026-11-01（北京时间）。状态：本地实现与自动检查完成；**未部署、未执行云端迁移、未上传小程序、未发布**。真机验收按用户要求统一后置。

## 1. 目标与非目标

**目标：**登录用户可举报已发布内容或评论；后台按学校／角色查看并处理；处理复用现有内容下架和评论软删除；全过程留审计记录；重复、越权、跨校、对象失效和失败重试有明确结果。

**非目标（本包不做）：**用户举报、举报消息通知、申诉、批量处理、自动风控、举报统计报表、正式发布。P2 及以后功能不在本包。

## 2. 对象与状态

- 举报对象：`post`（已发布内容）与 `comment`（未删除评论）。
- 用户只能举报自己可见的已发布对象；不能举报自己的内容。
- 同一用户对同一对象只保留一条举报；待处理时重复提交返回原记录，已处理时返回冲突。
- 举报状态：
  - `pending` 待处理；
  - `dismissed` 举报不成立（只关闭当前这条）；
  - `removed` 已下架内容或删除评论（同一对象的所有待处理举报一起关闭）。
- 处理动作：
  - 驳回：只把当前举报置为 `dismissed`，不改内容；
  - 下架：内容置 `offline`，评论置 `deleted=true` 且清空正文；同一对象所有待处理举报置为 `removed`。

## 3. 原因与权限

举报原因编码固定为：`spam` 垃圾广告、`harassment` 辱骂骚扰、`false_info` 虚假信息、`inappropriate` 低俗不当、`privacy` 泄露隐私、`other` 其他。选择 `other` 时必须填写说明；说明最多 500 字。

| 角色 | 提交举报 | 查看举报 | 处理举报 |
| --- | --- | --- | --- |
| 登录用户 | 仅自己可见且非本人内容 | 否 | 否 |
| 学校审核员 reviewer | 同登录用户 | 仅本校 `schoolId` | 仅本校 |
| 学校运营 operator | 同登录用户 | 仅本校 | 仅本校 |
| 平台超级管理员 super_admin | 同登录用户 | 全部，含平台内容 | 全部 |

平台内容（`schoolId=null`）的举报只有 `super_admin` 可见可处理；学校角色不能跨校处理。查看和处理都要求管理员账号当前有效，角色和学校以数据库当前值为准。

## 4. 数据模型

新表 `content_reports`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | varchar(36) PK | UUID |
| `createdAt` / `updatedAt` | datetime | 与现有实体一致 |
| `reporterId` | varchar(36) | 举报用户 |
| `schoolId` | varchar(36) nullable | 取被举报对象所属学校；平台内容为空 |
| `targetType` | varchar(20) | `post` / `comment` |
| `targetId` | varchar(36) | 内容或评论 id |
| `postId` | varchar(36) | 内容 id；评论举报时为父内容 id |
| `reason` | varchar(20) | 原因编码 |
| `detail` | text | 用户补充说明，可为空 |
| `status` | varchar(20) | `pending` / `dismissed` / `removed` |
| `handledBy` | varchar(36) nullable | 处理管理员 id |
| `handledAt` | datetime nullable | 处理时间 |
| `resolution` | text | 处理说明 |

索引：
- 唯一索引 `IDX_content_reports_reporter_target`（`reporterId`,`targetType`,`targetId`）防重复；
- `IDX_content_reports_school_status_created`（`schoolId`,`status`,`createdAt`）供后台筛选；
- `IDX_content_reports_target`（`targetType`,`targetId`）供同一对象批量关闭。

迁移文件：`1793000000000-ContentReports.ts`，可逆；生产仍保持 `synchronize=false`。

## 5. API 契约

### 5.1 提交举报（用户）

`POST /api/v1/reports`

```json
{ "targetType": "post", "targetId": "<id>", "reason": "spam", "detail": "可选说明" }
```

成功（新建或待处理重复）返回 201：

```json
{ "id": "<report-id>", "status": "pending", "duplicate": false, "createdAt": "..." }
```

规则：
- 参数白名单；`targetType`、`targetId`、`reason` 必填；`detail` 最多 500 字；`other` 必须填写说明。
- 对象必须对当前用户可见；评论必须未删除；父内容权限与详情页一致。
- 不能举报自己发布的内容或评论。
- 同一用户同一对象待处理重复提交返回 `duplicate:true` 和原 id；已处理则 409。
- 响应不返回被举报内容，不泄露对象详情。

### 5.2 后台列表（管理员）

`GET /api/v1/admin/reports?status=pending&targetType=post&page=1&pageSize=20`

只允许 `status`、`targetType`、`page`、`pageSize`；`pageSize` 最大 100。返回：

```json
{
  "items": [{
    "id": "...", "targetType": "comment", "targetId": "...", "postId": "...",
    "reason": "harassment", "detail": "...", "status": "pending",
    "createdAt": "...", "handledAt": null, "resolution": "",
    "reporter": { "id": "...", "nickname": "..." },
    "school": { "id": "...", "name": "...", "shortName": "..." },
    "target": {
      "postTitle": "...", "postStatus": "approved", "authorNickname": "...",
      "commentExcerpt": "...", "commentDeleted": false, "available": true
    }
  }],
  "page": 1, "pageSize": 20, "total": 1, "hasMore": false
}
```

- 非 `super_admin` 只返回 `report.schoolId` 等于本账号学校的记录；没有学校范围直接拒绝。
- 评论已删除时 `commentExcerpt` 为空、`commentDeleted=true`；对象不存在时 `available=false`，仍可关闭举报。
- 列表只给管理员，不向普通用户开放。

### 5.3 处理举报（管理员）

`POST /api/v1/admin/reports/:id/resolve`，HTTP 200：

```json
{ "action": "dismiss", "reason": "举报不成立，内容符合社区规范" }
```

或：

```json
{ "action": "takedown", "reason": "含辱骂内容，下架处理" }
```

返回当前举报的 `id`、`status`、`handledAt`、`resolution`。

规则：
- 必须 `pending`；已处理返回 409。
- 处理说明必填，1–500 字。
- 越权、跨校、平台举报由学校角色处理均拒绝。
- 下架内容：`posts.status=offline`、`rejectionReason=举报处理：<说明>`、`reviewedBy=管理员`。
- 删除评论：`post_comments.deleted=true`、`content=''`。
- 下架时同一 `targetType+targetId` 的所有 `pending` 举报一起置 `removed`；驳回只关闭当前。
- 每次处理写 `audit_logs`：`report.dismiss` 或 `report.takedown`，记录对象、父内容、说明。

### 5.4 工作台

`GET /api/v1/admin/dashboard` 增加 `pendingReports`，按管理员学校范围计数；平台管理员统计全部。

## 6. 后台界面

- 菜单新增“举报处理”，`super_admin`、`operator`、`reviewer` 均可见；审核专用构建也保留。
- 默认筛选 `pending`，可按对象类型筛选；表格展示时间、类型、原因、对象摘要、举报人、学校、状态。
- 详情弹窗展示举报说明、对象标题／评论摘要、当前状态；待处理时可填写处理说明并选择“驳回举报”或“下架内容／删除评论”。
- 处理成功刷新列表；失败保留弹窗并显示错误；所有动作均有二次确认。
- 工作台增加“待处理举报”指标。

## 7. 小程序界面

- 详情页操作区增加“举报”；评论操作区对非本人、未删除评论增加“举报”。
- 自定义底部弹层：六个原因、0–500 字补充说明、“其他”必填说明；提交中禁用，失败保留内容并可重试。
- 提交只发送对象类型、id、原因和说明，不发送正文；成功或重复提交给出明确提示；不展示举报处理状态。
- 换账号、离页、内容不可见时关闭举报弹层并清空状态。
- 后端返回 `canReport` 标志；前端不自行猜测权限。

## 8. 验收用例

**API：**平台内容举报、重复举报、第二用户举报、举报自己、未认证访问校园内容、外校访问校园内容、已删除评论、无权限评论、学校角色列表隔离、平台举报仅超级管理员、跨校处理拒绝、驳回只关当前、下架关闭同对象全部、下架后用户不可见、评论删除后正文清空、已处理再次处理 409、说明必填、工作台计数、迁移可逆与索引唯一。

**小程序：**原因校验、`other` 必填、500 字上限、正常提交、重复提交提示、失败保留、本人内容无入口、已删除评论无入口、换账号清理。

**后台：**构建通过；列表筛选、详情、驳回、下架、错误提示、权限范围由 API 保证。

## 9. 发布边界

本包只做本地实现和自动检查。正式生效顺序仍为：备份数据库 → 执行 `content_reports` 迁移 → 部署 API → 验证举报提交／列表／处理 → 再上传小程序。没有迁移记录、真实 MySQL 和真机证据前，不把本包写成已上线或已验收。

## 10. 实施记录

**本地实现（2026-11-01）：**
- API：`src/entities.ts` 新增 `ContentReport`；`src/migrations/1793000000000-ContentReports.ts` 新增可逆迁移；`src/database.ts` 注册迁移；`src/app.service.ts` 新增提交、列表、处理、工作台计数和 `canReport`；`src/app.controller.ts` 新增三个路由。
- 后台：新增 `src/reports.tsx`，`src/main.tsx` 增加“举报处理”菜单和工作台指标。
- 小程序：新增 `utils/reports.js`；详情页增加内容／评论举报入口、底部弹层、校验和提交；`utils/comments.js` 保留 `canReport`。
- 测试：新增 `test/reports.e2e-spec.ts`、`test/content-reports-migration.e2e-spec.ts`、`test/reports.test.js`；更新评论精确对象断言和迁移链断言。

**检查结果：**
- API：20 个测试文件、205 项通过，退出码 0；包含举报权限、重复、跨校、驳回、下架、评论清空、工作台计数、迁移可逆和 MySQL SQL 生成。
- 小程序：15 个测试文件、202 项通过，退出码 0；举报 7 项覆盖校验、提交、重复、失败保留、本人／已删除无入口和换账号清理。
- 后台：`npm run build` 通过，退出码 0。
- 小程序编译：14 个 WXML、15 个 WXSS 通过官方 `wcc`／`wcsc`，退出码 0；详情页 WXSS 单独编译包含 `report-mask`。

**未覆盖／限制：**
- 未执行真实 MySQL、云端迁移、备份恢复、并发或部署；迁移只在 SQL.js 和 MySQL SQL 生成层验证。
- 未启动微信开发者工具登录、未上传、未真机验收；未做后台浏览器端到端点击测试。
- 未做举报频率上限、通知、申诉或自动风控；同一用户同一对象只允许一条举报，已处理不能重复提交。
- 发布前仍需：备份→执行 `ContentReports1793000000000`→部署 API→验证三个接口和工作台→再上传小程序。
