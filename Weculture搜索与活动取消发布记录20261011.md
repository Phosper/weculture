# Weculture 搜索与活动取消发布记录

发布日期：2026-10-11（北京时间）。按用户“先继续发布，定位权限后面再说”的要求，完成 API 与小程序体验版配套发布，自动定位暂缓，保留手动选城。**当前体验版为 `0.7.20261011.1`，后端为 API021；正式线上版本尚未提交。**

## 实际发布结果

- 云托管环境 `weculture-test-d4g8lhclj2cb27224`，服务 `weculture-api`，线上版本 `weculture-api-021`。控制台显示“服务正常”、1 个实例，发布时间 **23:32:40**。[平台截图](.artifacts/discovery-cancellation-release-20261011/api/api021-published.png)。
- 官方开发者工具上传 `0.7.20261011.1` 成功，日志包含 `√ upload`，退出码 0；公众平台明确显示该版本为“体验版”，提交时间 **23:41:40**。备注：“首页分页搜索与活动取消，保留手动选城，自动定位暂缓”。[上传日志](.artifacts/discovery-cancellation-release-20261011/miniprogram/upload.log)、[版本页面截图](.artifacts/discovery-cancellation-release-20261011/miniprogram/experience-version-published.png)。
- 官方编译包：主包 **1,391,706 字节**、字体分包 **1,925,822 字节**、总包 **3,317,528 字节**，两个包均低于各自 2 MiB 限制。[官方大小清单](.artifacts/discovery-cancellation-release-20261011/miniprogram/upload-info.json)。该文件没有逐文件包清单，不能据此宣称哪些测试文件被上传或排除。
- 平台体验版二维码弹窗显示首页路径 `pages/home/index`，提示“该二维码10月18日前有效”；二维码下载未成功留档，可在公众平台“版本管理 → 体验版”打开。
- 运营后台仍为 `weculture-admin-003`，本轮没有重新部署后台或复测其真实界面。公众平台显示“尚未提交线上版本”，本轮没有提交正式审核。

## 本版功能

首页按最新／公开／校园范围读取服务端分页搜索，支持关键词、动态／活动／闲置筛选、刷新、加载更多和空结果处理。搜索匹配标题、正文、标签及真实作者昵称；示例标题不再覆盖实际作者。

详情与我的计划提供确认取消；后端修复取消后再次报名失败，事务内同步人数、报名及计划，后台修改活动设置不会覆盖期间更新的报名数。完整行为及限制见[交付说明](Weculture发现搜索与活动取消交付说明20261011.md)。

当前 `automaticCityLocation` 固定为 `false`，定位入口隐藏、定位声明移除，关闭态在请求隐私、权限、原生定位或地图调用之前停止。手动地区选择、城市记忆及投稿城市保留。此前自动定位代码及 API 城市解析能力保留，后续取得微信权限、补隐私配置并重新发布后再启用；本版没有读取设备位置。

## 发布源码与包核对

API ZIP 共 25 个文件，仅 `src/app.service.ts` 相比 API020 改动，其余 24 个文件相同；没有新增迁移、依赖、Docker 构建配置或环境变量。ZIP SHA256 为 `9A21497E0ADAE24C4D3BC598BC4300D6B164E09E27DE7954CF44E5FC3B17F5E4`。[包清单](.artifacts/discovery-cancellation-release-20261011/api/manifest.json)、[校验值](.artifacts/discovery-cancellation-release-20261011/api/SHA256SUMS.txt)。准备清单的 `deployed:false` 保留为准备时状态，实际发布由后续平台证据证明。

客户端上传前后 112 个源码文件的大小和 SHA256 清单指纹一致：`6fc72c79a998769731a0d646393e4e73e3c484d27d5f1d6d3475da238ea579eb`。25 个生产 JS 语法、16 个 JSON 解析通过；相对 0.5 源码为 22 修改、6 新增、0 删除。[上传前预检](.artifacts/discovery-cancellation-release-20261011/miniprogram/source-preflight-before-upload-final-20261011-154110242Z-90624c.json)、[上传后预检](.artifacts/discovery-cancellation-release-20261011/miniprogram/source-preflight-after-upload-20261011-154346221Z-4690b0.json)。源码预检自身不执行上传，其 `uploadStarted:false` 不替代实际上传日志；源码清单也不等于微信实际编译包的逐文件清单。

## 验证及验收边界

- 最新本地回归 **API 114 + 小程序 83 = 197 项**，API 构建、12 个 WXML 和 13 个 WXSS 编译通过；其中 3 项新增关闭态检查确认不触发定位及隐私授权。保留前一轮 194／191 项和最初核查 169 项的原日志。[手动选城检查汇总](.artifacts/discovery-cancellation-release-20261011/miniprogram/manual-city-validation.json)、[小程序测试日志](.artifacts/discovery-cancellation-release-20261011/miniprogram/miniprogram-tests.log)、[API 测试日志](.artifacts/development-next-20261011/api-tests.log)。
- API021 发布后，通过微信私有云通道完成 **11 次请求**：健康检查 200、未登录内容请求 401、正常登录与账号读取、两页共 10 项排序／权限／无重复检查、标题片段检索、公开动态组合筛选、我的计划读取。[云端只读结果](.artifacts/discovery-cancellation-release-20261011/cloud-readonly-1791733246940.json)。旧会话过期，正常微信登录刷新身份；登录可能初始化用户资料，但未执行报名、取消、投稿、审核等业务写入，没有改变模拟器全局数据或存储。
- 字面 `%` 搜索返回空结果，无正向样本；云端结果不证明含 `%` 内容的正向检索。本地对应回归有覆盖。健康响应不返回版本号，API021 身份由控制台截图确认。
- 尚需真实手机验证搜索跨页、快速切换、弱网、详情及个人页取消与重报名、人数和计划一致、手动选城记忆及投稿归属；安卓／iPhone 字号、键盘和字体仍待验收。
- 尚需真实 MySQL 并发名额、重复请求与事务回滚验收。没有把本地 SQL.js 串行测试或本轮只读检查记为多实例压力验收。

综合机器可读证据见[发布证明](.artifacts/discovery-cancellation-release-20261011/publication-proof.json)。历史 `0.6.20261011.1` 定位候选上传失败记录保留，`0.5.20261009.1` 是前一体验版；两者均不替代本轮新发布证明。最新已做／未做清单见[开发手册](Weculture开发手册.md)，完整时间线见[开发日志](Weculture开发日志.md)。
