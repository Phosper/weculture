# Weculture 运营精选设计与交付

日期：2026-11-01（北京时间）。状态：本地实现与自动检查完成；**未部署、未执行云端迁移、未上传小程序、未真机验收**。

## 1. 目标与非目标

**目标：**运营可选择已发布内容作为精选，配置顺序和上下架；客户端在首页展示经过选择的内容；内容下架、撤认证或精选停用后自动不展示。

**非目标：**推荐算法、个性化、付费推广、自动抓取、多个精选位、轮播计时、精选点击统计。P2b 统计单独成包。

## 2. 已固定的产品假设

- 只允许精选 `status=approved` 的内容。
- 平台内容（公开圈层）由 `super_admin` 配置；校园内容由本校 `operator` 配置；`reviewer` 只能查看，不能新增／修改／删除。
- 同一条内容只能有一条精选记录；重复加入视为更新排序和状态，不产生重复行。
- 排序号 `0–9999`，升序；同序号按创建时间升序。
- 客户端最多返回 10 条；精选位只出现在首页默认“最新／全部类型／无搜索”状态，避免与筛选结果混淆。
- 精选停用、内容下架／驳回、学校认证撤销后，客户端自动隐藏；不删除原内容。
- 不做有效期；需要下线时由运营停用或移除。

以上是可在评审时调整的默认值；若产品要求不同，先改契约再改代码。

## 3. 数据模型

新表 `featured_posts`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | varchar(36) PK | UUID |
| `createdAt` / `updatedAt` | datetime | 与现有实体一致 |
| `postId` | varchar(36) | 被精选内容，唯一 |
| `scope` | varchar(20) | `platform` / `school` |
| `schoolId` | varchar(36) nullable | 校园精选的学校；平台为空 |
| `sortOrder` | int | 0–9999，越小越靠前 |
| `status` | varchar(20) | `active` / `inactive` |
| `createdBy` | varchar(36) | 首次配置的管理员 |

索引：唯一 `IDX_featured_posts_post(postId)`；`IDX_featured_posts_scope_status_order(scope,schoolId,status,sortOrder)`。迁移 `1793000001000-FeaturedPosts`，可逆；生产仍 `synchronize=false`。

## 4. API 契约

### 4.1 用户读取

`GET /api/v1/featured`（登录）

```json
{ "items": [ { "...post fields...": "...", "canReport": true } ] }
```

- 只返回 `active` 且内容 `approved` 的精选，最多 10 条。
- 平台精选对所有登录用户可见；校园精选只对同校认证成员可见。
- 过滤条件与发现列表一致；内容下架、驳回、学校不匹配或精选停用都不返回。
- 未登录返回 401；响应不额外暴露未发布内容。

### 4.2 后台列表

`GET /api/v1/admin/featured`（管理员）

返回数组，每项：

```json
{
  "id": "...", "postId": "...", "scope": "school", "schoolId": "...",
  "sortOrder": 0, "status": "active", "createdBy": "...",
  "createdAt": "...", "updatedAt": "...",
  "post": { "id": "...", "title": "...", "status": "approved", "visibility": "school", "circle": "campus", "schoolId": "...", "authorId": "...", "imageUrl": "", "tag": "..." },
  "school": { "id": "...", "name": "...", "shortName": "..." }
}
```

- `super_admin` 看全部；`operator`／`reviewer` 只看本校；无学校范围拒绝。
- `post` 为空表示内容已不存在，仍可移除精选。

### 4.3 新增／更新／移除

- `POST /api/v1/admin/featured`：`{ postId, sortOrder? }`。重复加入时更新排序并重新上架；排序省略时保留原值。
- `PATCH /api/v1/admin/featured/:id`：`{ sortOrder?, status? }`，至少一个字段。
- `DELETE /api/v1/admin/featured/:id`：移除精选记录，不删除内容。
- 仅 `super_admin`／`operator`；学校运营只能处理本校 `scope=school` 的记录；平台内容只有 `super_admin`。
- 每次写操作记录 `audit_logs`：`featured.create`／`featured.update`／`featured.delete`。

## 5. 后台界面

- 菜单“运营精选”，仅可管理角色可见。
- 候选内容按标题搜索已发布内容；选择后设置排序号加入。
- 当前精选表格展示排序、内容标题与状态、范围／学校、精选状态、更新时间。
- 操作：编辑排序／状态、上架／下架、移除（二次确认）。
- 内容已下架仍出现在后台列表，提示运营移除或停用；客户端不展示。

## 6. 小程序界面

- 首页默认“最新／全部类型／无搜索”时，在导航助手条下方展示横向“精选”条；其他筛选或搜索状态隐藏。
- 卡片展示封面（可选）、标签、标题、作者和时间；点击进入详情。
- 精选读取失败不阻断主列表；无精选时不占位。
- 换账号、离页或登录失效时清空精选，避免上一账号内容残留。

## 7. 验收用例

**API（本地已覆盖）：**平台精选对所有登录用户可见；校园精选仅同校；外校／未认证不可见；运营跨校配置拒绝；运营配置平台内容拒绝；审核员只读；重复加入幂等；排序；停用／上架；下架内容自动隐藏；最多 10 条；未登录 401；非法排序／状态／字段 400；迁移可逆和唯一索引。

**小程序（本地已覆盖）：**精选在内容列表之后读取；非法／非 approved／重复项过滤；读取失败不影响主列表；点击有效精选进入详情；无效 id 不跳转；换账号或离页清空。

**后台：**构建通过；列表、候选搜索、加入、编辑、上下架、移除需人工点检。

## 8. 检查结果

- API：22 个测试文件、214 项通过，构建退出码 0；含精选 5 项、迁移 4 项。
- 小程序：16 个测试文件、206 项通过；首页精选 4 项。
- 后台：`npm run build` 通过。
- 小程序编译：全量 WXML 退出码 0；首页 WXML 单独编译包含 `featured-section`，首页 WXSS 编译包含 `featured-card`，`node --check` 通过。

## 9. 未覆盖与发布边界

- 未执行真实 MySQL、云端迁移、备份恢复、部署、上传或真机；未做后台浏览器点击验收。
- 未做精选点击／曝光统计、有效期、多个精选位或轮播；不做自动推荐。
- 发布顺序：备份 → 执行 `ContentReports1793000000000` 与 `FeaturedPosts1793000001000` → 部署 API → 验证 `/featured`、后台列表和写操作 → 再上传小程序。两个迁移都未在云端执行。
- 小程序新首页在旧 API 上会因 `/featured` 404 而静默隐藏精选，主列表不受影响；但正式发布仍应先部署 API。
