# 阶段二：圈层 API 与迁移

> 2026-10-21最新本地工作包：独立用户搜索与作者主页完成，API195项、小程序195项共390项及构建、页面编译通过。本轮无新迁移，仍未发布；此前路线参数和评论迁移仍须先执行。详见[本轮交付说明](../Weculture用户搜索与作者主页交付说明20261021.md)。

## 用户搜索与作者主页（2026-10-21本地）

- `GET /api/v1/users?q=昵称&page=1&pageSize=20`：按显示昵称字面、不区分大小写匹配，关键词去首尾空白后1–100字符；`!/%/_`转义。只返回有效用户且有当前读者可见approved作品的作者；结果和总数均去重，按昵称、ID升序。空关键词不枚举用户。
- `GET /api/v1/users/:id`：仅返回`{id,nickname,avatarUrl,visiblePostCount}`，不接受查询字段，不含openid、学校、认证、状态或私有数量。有效作者可返回0条可见作品，不存在／禁用／删除目标404。
- `GET /api/v1/users/:id/posts?page=1&pageSize=20`：标准`{items,page,pageSize,total,hasMore}`作品分页，按`createdAt DESC,id DESC`；完全复用发现列表公开／本校的保守权限条件，作者本人也不例外展示未公开作品。认证使用当前数据库记录。
- 三接口均需有效登录。用户ID为1–80个字母、数字、下划线或连字符；搜索仅接受`q/page/pageSize`，作品仅接受`page/pageSize`，不允许学校或状态参数扩大范围。页码1–100000、页大小1–100，默认1／20。
- 帖子／评论作者增加`profileAvailable`布尔字段，仅真实有效User为true；系统署名／禁用／删除作者为false。客户端只在明确true时打开主页。没有新迁移；旧API021不支持本工作包。

> 2026-10-20 状态补充：最后已确认线上版本为2026-10-11发布的API021与体验版`0.7.20261011.1`，已包含首页分页搜索、活动取消与再次报名，并关闭自动定位、保留手动选城。10月9日真实圈层迁移、API020三城解析与0.6定位候选上传失败均保留历史含义。自动定位权限及真机验收继续待办。本文件的本地隔离测试和回退不表示执行过真实云端回退。当前边界见[开发手册](../Weculture开发手册.md)，历史发布见[开发日志](../Weculture开发日志.md)。

> 本轮（2026-10-20）新增源码为路线计划参数服务端保存与原生内容／活动分享。API125项、小程序110项共235项通过，API构建和页面编译通过；新增路线计划迁移未执行到云端，本轮未部署或上传。发布须先备份数据库、执行迁移并部署API，再更新小程序。10月11日API114项、小程序83项共197项为历史发布检查，不能替代本轮验证。

> 随后同日新增话题精确过滤及活动时间筛选，最新API154项、小程序136项共290项通过，构建及页面编译通过；此批次没有新迁移，但同日此前路线计划迁移仍需配套执行。两个工作包均未发布。详见[最新交付说明](../Weculture话题与活动筛选交付说明20261020.md)。

> 随后同日评论／回复／本人软删除工作包完成，最新API174项、小程序156项共330项通过，构建及页面编译通过。新增`PostComments1792458000000`迁移，须与此前路线参数迁移先执行后部署API、更新小程序；未访问线上或发布。详见[评论交付说明](../Weculture评论与回复交付说明20261020.md)。

内容字段为 `circle: city | international | campus | null`、`city`、`contentLanguage`、`schoolId`。`visibility` 为兼容旧客户端保留，由圈层确定：公开圈层为 `platform`，校园为 `school`。

## 读取与发布

- `GET /api/v1/posts?circle=city&city=北京&type=dynamic&page=1&pageSize=20` 返回 `{ items, page, pageSize, total, hasMore }`。`circle`、`city`、`schoolId`、`type`、`q` 可以组合；页大小为 1–100。传入 `circle` 或分页参数时使用分页结果，否则保留旧数组结果。
- 当前首页源码显式请求 `page/pageSize`：最新入口省略范围，返回有权查看的公开与本校内容；公开入口使用 `scope=platform`，校园入口使用 `circle=campus`。类型缺省为全部，也可指定 `dynamic/event/market`。搜索 `q` 覆盖标题、正文、标签和数据库中的实际作者昵称；先去除首尾空白再不区分大小写检索，结果按 `createdAt DESC, id DESC` 排序。`q` 长度超过 100 或传入数组／对象返回 400。本轮对 `!/%/_` 使用 `!` 转义和 `LIKE ... ESCAPE '!'`，特殊符号按字面匹配；后台复用相同检索过滤。权限与审核状态过滤同样应用于搜索结果及总数，旧客户端不传分页参数时仍返回数组。
- API021／0.7首页已使用服务端分页、搜索和空结果动作，移除首页示例排序。更早客户端只对已加载列表本地过滤。2026-10-20话题跳转与活动时间筛选、2026-10-21独立用户搜索及作者主页已本地实现；运营精选配置和搜索／曝光等业务事件统计仍未实现。
- `circle=campus` 和旧 `scope=school` 要求有效学校认证，仅返回本校校园内容。显式 `schoolId` 与服务端当前认证不一致时返回 403，包括用公开圈层或默认列表夹带其他学校参数的请求。
- 公开圈层只返回审核通过、`schoolId=null` 的公开内容。未分类旧平台内容保留在默认发现和旧 `scope=platform` 中，排除在同城、国际与校园圈层列表之外。
- `POST /api/v1/posts` 接受 `circle` 和圈层对应元数据。同城 `city` 去除首尾空白后须为 1–50 个字符；国际 `contentLanguage` 必须为 `zh/en/ru/fr/es/ar/other`。公开与后台城市筛选精确匹配短名及末尾带“市”的名称，例如 `北京` 与 `北京市`、`广州` 与 `广州市`；自治州、地区和盟按完整名称精确匹配，不使用包含式匹配。该兼容仅影响查询，投稿保存与请求指纹仍保留原城市名；尚无城市地理编码。
- 已登录、未学校认证的用户可提交公开圈层，公开投稿始终 `pending`，不受 `AUTO_APPROVE` 影响。校园仍需认证，学校从服务端认证记录确定。旧客户端省略 `circle` 时按校园投稿处理。
- 作者可预览自己的待审、驳回或下架内容；普通读者只看审核通过的有权内容。点赞、收藏、活动报名、个人收藏和个人计划应用同一读取边界。公开活动允许未认证的已登录用户报名，计划项携带圈层元数据。
- 请求标识包含圈层、城市与语言，复用请求标识改变这些信息会返回 409。迁移后的阶段一校园请求旧摘要仍可重试。

## 话题与活动时间：2026-10-20本地实现，待配套发布

- `GET /api/v1/posts`与`GET /api/v1/admin/posts`新增`tag`、`eventTime`，可组合原圈层、城市、学校、类型、关键词及分页。`tag`trim后须为1–80字符，使用数据库二进制完整比较，大小写、重音、百分号及下划线均为字面值；不匹配只在标题／正文出现该词的内容。
- `eventTime=all`或省略保留原时间语义；`upcoming`仅`active`活动且`startsAt>=now`。`today`再限定`startsAt<北京时间明日零点`；`week`再限定`startsAt<北京时间今天零点+7天`，含今天共7个自然日，不是按周一分周。活动日期按UTC原样比较，区间上界不包含在内。
- 进行中、`changed`、`cancelled`或缺活动实体的内容不进入非all时间结果。满员／截止不影响时间匹配，不能据列表存在推断可报名；原报名接口继续校验名额、截止及状态。
- 非all时间与`type=dynamic/market`冲突返回400；缺type时查询仍限定event。非法tag／eventTime、数组、对象、嵌套伪参数及不支持的查询键返回400；旧客户端不传分页时仍返回数组。总数和列表均执行相同权限与审核过滤，管理员继续受其学校范围约束。
- 客户端新增`pages/topic`，标签路径完整编码，登录／认证仅允许白名单话题回跳。该页面不会匿名开放校内内容；待审作者预览标签不跳转，话题列表不显示待审／驳回／下架内容。
- 专项见`test/discovery-topics-time.e2e-spec.ts`：29项HTTP／SQLite实际查询与MySQL驱动离线SQL／日期参数检查；未连接真实MySQL，未访问线上。

## 评论与回复：2026-10-20本地实现，待配套发布

- `GET /api/v1/posts/:id/comments?page=1&pageSize=20`固定返回分页`{items,page,pageSize,total,hasMore,activeCount}`，默认20条、最多50条；按`createdAt DESC,id DESC`排序。`total`包含删除占位，`activeCount`只计未删评论。参数仅允许page/pageSize，非法值／数组／对象返回400。
- `POST /api/v1/posts/:id/comments`接受`{content,clientRequestId,parentId?}`，正文trim后1–500字，允许正常换行，不接受其它控制字符；请求标识trim后1–80字符。`parentId`必须指向同帖未删评论，缺失父评论404、已删父评论409，跨帖不能回复；读者及帖子作者均可回复。
- 请求标识以`authorId+postId+sha256(clientRequestId)`唯一，避免数据库默认字符串排序规则混淆大小写。相同规范正文／父编号重复请求复用评论，不同正文或父编号返回409。已有请求先于父是否删除的新增校验，保证原回复提交后父被删除仍能幂等确认；删除后的原请求返回占位，不恢复正文。
- `DELETE /api/v1/posts/:id/comments/:commentId`仅当前作者可执行，重复删除幂等，返回`{deleted:true,id}`。数据库将`content`清空并标记deleted，保留已有回复；不能删除别人的评论或用其它帖路径访问评论。
- item为`{id,postId,content,createdAt,deleted,author:{id,nickname,avatarUrl},isPostAuthor,canDelete,canReply,parent:{id,nickname,deleted}|null}`。删除项正文始终为空、不可回复或再次显示删除入口；父信息不含正文，响应不含请求标识或内部摘要。
- 所有读取／创建／删除均只允许有效用户访问approved帖子；校园圈校验当前同校认证，未审核作者预览也不能读写评论。事务内复核用户／帖子／认证；MySQL写事务锁定父帖，SQL.js使用现有事务队列，保护多次提交和回复／删除交错。真实MySQL并发尚未验收。
- 评论错误与详情加载独立；评论失权会清空评论／草稿与失效详情。500字计数、防连点、结果丢失后的同请求重试、本人删除确认、分页刷新及离页／账号隔离均已接入详情。评论审核、举报和通知仍待实现。
- `PostComments1792458000000`新增评论表与唯一／分页索引，注册在`RoutePlanDetails1792454400000`之后。回退会删除评论表与评论数据，保留原帖子和路线参数；生产禁止用自动同步代替迁移。本轮只做SQLite实际迁移和MySQL离线SQL验证。
- 检查用例：`post-comments.e2e-spec.ts`12项、`post-comments-migration.e2e-spec.ts`4项、`comments-client.e2e-spec.ts`4项（实际详情代码与本地HTTP API联调）；不代替真机和真实MySQL验收。

## 活动报名与取消：API021／0.7已发布，真机待验收

- `POST /api/v1/events/:id/registrations` 报名；`DELETE /api/v1/events/:id/registrations/me` 取消自己的报名。两者先复核用户和内容访问权限，公开活动只要求有效登录，校园活动要求当前同校认证。
- 报名或恢复已取消报名时，以事务中的条件更新占用名额，仅在活动有效、未截止、未开始且未满员时成功；重复有效报名不重复加人数。已有取消记录更新为 `registered`，复用活动／用户唯一记录，重新激活或创建相应计划。取消时同步报名状态、人数和计划，重复取消不重复减人数。
- 返回 `{ registered, registeredCount, capacity, eventId, postId }`，已报名的重复请求可附带提示。人数占用、报名与计划变更在同一事务中保存，失败完整回滚；不增加数据库迁移，也不将整个写请求自动重试。
- 小程序详情和我的计划已增加先确认的取消入口、提交锁定、错误重试与结果同步；仍可报名时允许取消后再次报名。入口和事务修复已于10月11日随API021／0.7配套发布。活动变更通知仍未完成。
- 先前隔离库复现的“报名201→取消200→重新报名500”保留为修复前历史失败；取消及重新报名、重复请求、人数边界、权限和事务回滚的本地回归已通过，真实多账号、MySQL并发与手机验收仍待完成。

## 路线计划参数：2026-10-20本地实现，待配套发布

- `POST /api/v1/travel-routes/:id/plans` 新客户端提交 `{ planned: boolean, departDate?: string, companions?: number }`。`planned`为目标状态，重复加入／移出均幂等；省略请求体或发送`{}`兼容旧客户端切换语义。非空对象必须包含布尔`planned`，数组、null、未知字段以及仅传参数的请求均返回400。
- `departDate`只接受真实日历日期`YYYY-MM-DD`，不接受0000年；`companions`为0–20整数，表示同行者人数，不含本人。未传字段保留原参数，首次无参数加入保持null。取消保留数据库参数以便恢复，响应`planMeta:null`。
- 响应`{ planned, planMeta: { departDate: string|null, companions: number|null }|null }`；两字段均为空时`planMeta:null`。`GET /api/v1/me/plans`路线项携带同样`planMeta`，活动项保持原合同。客户端保存后重读当前用户计划，个人页不再把本机`routePlanMeta`当作权威数据，也不自动迁移归属不明的本机缓存。
- 用户必须有效登录且账号可用，服务端复核路线有效及同校权限。SQL.js沿用事务队列，MySQL锁定路线行后读取／写入计划，结合已有用户／目标唯一索引，避免并行创建重复计划；本地并发不代表真实MySQL多实例压测。
- 上线前先备份、执行`RoutePlanDetails1792454400000`迁移，再部署API和客户端。旧API会忽略新客户端的目标状态参数，不能只更新客户端。

## 原生内容／活动好友分享：2026-10-20本地实现

- 已发布详情提供`open-type="share"`按钮与`onShareAppMessage`，路径为`/pages/detail/index?id=<内容编号>`。公开内容携带标题及可用封面；校园内容使用通用标题和本地封面，避免在聊天卡中暴露受限内容。
- 登录回跳只允许已知页面和带合法编号的详情；学校认证后回到原详情重新请求。缺登录、跨校、撤销认证、未通过审核或下架时仍由已有详情接口拒绝，不新增匿名读取或绕过审核的接口。
- 待审／驳回／下架的作者预览、加载失败、离页或换账号后不保留可分享资格。本轮未实际向任何人发送消息；微信真机转发回流待验收，朋友圈分享未实现。

## 后台

- `GET /api/v1/admin/posts` 接受 `status/circle/city/schoolId/type/scope/q`。`scope` 为 `platform/school`；无分页参数保留数组，显式分页参数返回分页结果。列表包括 `event` 和 `school` 详情。
- `GET /api/v1/admin/schools` 返回管理员有权处理的有效学校（`id/name/shortName`）。
- `POST /api/v1/admin/posts` 创建，`PATCH /api/v1/admin/posts/:id` 编辑。目标圈层决定学校与公开范围，切换圈层会清理旧圈层元数据；显式提交相互矛盾的元数据会被拒绝。标题 2–40 字、正文 2–2000 字、标签最多 80 字。创建缺省为 `approved`，编辑缺省保留原状态；后台表单明确发送 `pending` 以重新审核。
- 编辑内容类型不能改变，省略活动字段会保留原活动信息、报名数量与活动 ID。新活动必须具有有效的未来时间、地点及人数；原有过期活动可仅编辑正文。
- 活动编辑进入与报名／取消相同的事务调度；MySQL锁定当前活动后重新校验容量，容量不得低于最新报名数。只更新活动设置字段，不写回事务前读取的旧报名数；未提交字段保留事务内最新值，失败不产生部分内容、状态或审核日志写入。此修复已随API021发布，真实MySQL交错验收仍待做。
- `POST /api/v1/admin/posts/:id/review` 审核。未分类或元数据无效的旧帖不能直接审核通过，可先编辑完成分类。驳回或下架不要求分类。
- `super_admin` 可处理公开和所有学校内容；有学校范围的 `operator` 可创建、编辑、审核本校校园内容；`reviewer` 只能查看和审核本校校园内容。服务端重新读取管理员当前状态和学校范围，不依赖客户端或旧令牌中的角色。后台统计与审核日志按学校范围隔离。

## 自动识别同城城市

- `POST /api/v1/location/city` 要求有效用户登录及可用账号。请求体为 `{ latitude: number, longitude: number }`，坐标由用户点击定位并授权后调用 `wx.getFuzzyLocation({ type: 'gcj02' })` 获取；纬度范围 `[-90, 90]`、经度范围 `[-180, 180]`，只接受有限数字。不接受 GET 或 URL 查询中的坐标。
- 成功返回统一响应中的 `data: { city, region }`，普通城市的 `region` 为 `[省, 市, '']`，例如 `{ city: '北京', region: ['北京市', '北京市', ''] }`。直辖市以省级名称确定城市，香港与澳门使用短名；省／自治区直辖县级单位优先真实城市名，必要时以对应县级单位识别城市。腾讯返回明确的直辖类别，或六位行政区代码属于 `4190/4290/4690/6590` 时，保留原生三级选择器路径 `[省, 省／自治区直辖县级行政区划, 县级城市]`，例如 `{ city: '济源', region: ['河南省', '省直辖县级行政区划', '济源市'] }`。这一特例的第三列就是已公开的城市本身，不返回更细地区；没有明确依据时不猜测直辖路径。普通地区城市字段缺失时回退手选。服务不返回街道、详细地址或坐标，不保存或记录坐标及腾讯返回的详细地址，响应设置 `Cache-Control: no-store`。
- API 服务端设置 `TENCENT_MAP_KEY`，在[腾讯位置服务控制台](https://lbs.qq.com/dev/console/key/manage)启用 WebServiceAPI；密钥只放服务端环境配置，不能写入小程序。若 Key 启用 SN 签名校验，还须设置 `TENCENT_MAP_SECRET`；未启用时可留空。按照[腾讯官方签名说明](https://lbs.qq.com/faq/serverFaq/webServiceKey)，将参数名升序排列的未编码原值拼在 `/ws/geocoder/v1/?` 后，追加 SK 并计算小写 MD5，最终发送时再对参数值编码。
- 服务端使用[腾讯官方逆地址解析接口](https://github.com/TencentLBS/tencentmap-webservice-skill/blob/main/references/api-geocoder.md)，只请求 `get_poi=0`，上游最长等待 5 秒。未配置 Key 返回 `HTTP_503` 和“自动定位尚未配置，请手动选择城市”；上游超时、拒绝或无法识别城市同样返回中文手选提示，不把上游错误、坐标或密钥传给客户端。当前不通过 IP 推断城市，不自动修改投稿归属，用户仍可手动切换城市。
- `test/city-location.e2e-spec.ts` 使用模拟上游响应测试鉴权、坐标校验、签名、城市规范化、数据最小化及超时，不访问真实地图服务。后续已配置真实 Key、部署 API020，并单独通过三城云端解析；该结果与自动测试分开记录。微信定位权限、客户端上传及真机定位验收仍待完成，详见[自动定位配置说明](../Weculture自动定位配置说明.md)。

## 举报治理：2026-11-01 本地实现，待配套发布

- `POST /api/v1/reports`（用户登录）：`{ targetType: "post"|"comment", targetId, reason, detail? }`。原因编码为 `spam/harassment/false_info/inappropriate/privacy/other`，`other` 必须填写说明；`detail` 最多500字，不允许控制字符。对象必须对当前用户可见，评论未删除，不能举报自己的内容。同一用户同一对象只保留一条举报；待处理重复提交返回原记录和 `duplicate:true`，已处理返回409。响应只含 `{id,status,duplicate,createdAt}`，不返回被举报内容。
- `GET /api/v1/admin/reports?status=&targetType=&page=&pageSize=`（管理员）：`super_admin` 查看全部；`operator`／`reviewer` 只查看本校 `schoolId`，无学校范围拒绝。平台内容举报（`schoolId=null`）只有 `super_admin` 可见。列表返回举报人、学校、对象标题／摘要、对象状态和是否仍可读取；已删除评论的摘要为空。
- `POST /api/v1/admin/reports/:id/resolve`（管理员，HTTP 200）：`{ action: "dismiss"|"takedown", reason }`，说明1–500字。驳回只关闭当前举报；下架内容置 `posts.status=offline`，删除评论置 `post_comments.deleted=true` 且清空正文，并关闭同一对象所有待处理举报。每次处理写 `audit_logs` 的 `report.dismiss`／`report.takedown`。已处理409，跨校或平台举报越权403。
- `GET /api/v1/admin/dashboard` 增加 `pendingReports`，按管理员学校范围计数。
- 新表 `content_reports`，迁移 `1793000000000-ContentReports`；唯一索引防止同一用户重复举报同一对象。生产仍 `synchronize=false`，须先备份再迁移。
- 本地检查：`test/reports.e2e-spec.ts`（权限、重复、跨校、驳回、下架、评论清空、工作台计数）、`test/content-reports-migration.e2e-spec.ts`（可逆、唯一索引、MySQL SQL）；小程序 `test/reports.test.js`（7项）。全部为本地模拟，未部署、未访问真实 MySQL。

## 迁移与旧数据

迁移 `1791417600000-PostCircles` 新增三个可空字段和圈层分页索引；只将旧 `visibility=school` 分类为 `campus`，保留学校、审核状态、原因、作者与投稿请求标识。

2026-10-20新增迁移`1792454400000-RoutePlanDetails`，为`user_plans`增加可空`departDate(varchar(10))`和`companions(int)`，保留旧计划、状态和唯一索引。旧记录返回`planMeta:null`；不从本机自动导入参数。该迁移已经注册在应用和迁移数据源中，尚未执行到云端。当前最后一次`migration:revert`只回退路线参数两列，删除新参数但保留原计划；不要将回退命令当作无数据损失操作。SQLite升级／回滚与MySQL驱动离线SQL已检查，未在真实MySQL执行。

已逐一检查旧平台演示主题（扇艺工作坊、校园茶艺、水墨毕业展、校园剪纸、古建）：源码没有可信的实际城市、内容语言或学校证据，前端展示的演示作者学校也不是服务端学校归属。这些记录及无法确认的其他平台精选均保留 `circle=null`，不自动进入新圈层。管理员可确认主题与归属后逐条补充分类。迁移不根据用户内容标题自动分类。

上线前需保存数据库备份并在目标环境执行现有 `npm run migration:run`；应用迁移后再发布同时包含 API、后台和小程序的版本。MySQL 保持 `synchronize=false`。

本地 SQL.js 的默认配置会自动同步。升级已有 `weculture.sqlite` 时，应先停止本地服务，在该命令进程中设置 `DB_SYNCHRONIZE=false`、`DB_TYPE=sqljs`，再运行 `npm run migration:run`；不要先启动新版服务让自动同步添加空字段。迁移命令加载数据源时就会初始化数据库，因此必须在命令启动前设置环境变量。原有 `DB_LOCATION` 应继续指向原文件。

若本地数据库已经自动同步新字段，或旧数据库没有迁移记录，本轮迁移也可接管：初始迁移保留已有表，阶段一请求标识迁移与阶段二圈层迁移均跳过已存在的字段和索引，再把空圈层的旧学校内容回填为校园圈。已明确分类的数据、真实待审状态和请求标识不会被覆盖。该路径只在内存构造的数据库测试中验证，本轮没有读取或修改实际本地数据库。

`npm run migration:revert` 可撤销新增字段和索引，但新圈层元数据会随字段删除；旧内容与审核数据不被删除。最初本地交付没有操作真实环境，后续 10 月 9 日已备份并完成真实迁移和配套发布；没有执行真实迁移回退，详见[发布记录](../Weculture阶段二发布记录20261009.md)。

验证用例：`test/post-circles.e2e-spec.ts`（双学校、未认证公开投稿、角色范围、分页、重试及活动隐私），`test/post-circles-migration.e2e-spec.ts`（旧数据完整保留与回退），`test/discovery-search.e2e-spec.ts`（16 项 HTTP／内存库检索、排序、分页与权限），`test/event-registration.e2e-spec.ts`（18 项取消及重新报名、重复请求、名额边界、权限、事务回滚与后台编辑交错）；继续执行阶段一回归。2026-10-11 开发前的 169 项综合核查及其 U11 失败、本轮首轮 191 项及最终 194 项 API／小程序回归分开记录，未用新结果覆盖历史检查。
