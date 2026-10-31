# Weculture API

本地开发默认使用 `sql.js` 文件数据库，以便无需 Docker 即可联调。生产环境仅支持 MySQL，禁止使用 `synchronize`。

```powershell
npm install
npm run dev
```

服务地址：`http://localhost:3000/api/v1`。种子数据会创建试点学校“北京语言大学”、邀请码 `BLCU2026` 和后台账号：

- 超级管理员：`admin` / `Weculture@2026`
- 学校运营：`blcu-operator` / `Weculture@2026`
- 内容审核：`blcu-reviewer` / `Weculture@2026`

这些凭据仅用于本地开发，生产环境须通过环境变量初始化并立即更换。

## 测试与迁移

```powershell
npm test
npm run build
npm run migration:show
npm run migration:run
```

`npm test` 使用一次性内存数据库，不会改写本地开发数据。

截至2026-10-25，旅行计划参数、分享、话题／活动时间筛选、评论及用户搜索／作者主页的累积工作已随`weculture-api-022`与小程序`0.8.20261025.1`体验版配套发布。API由用户手工部署，平台截图确认端口3000、1个实例、状态正常；小程序官方上传成功，用户提供的公众平台新截图明确显示蓝色“体验版”，开发者Phosper🍊。截图提交时间2026-10-25 21:11:09是上传提交时间，不是设体验版操作时间。尚未取得可用二维码，小程序正式审核／发布尚未提交，真机验收未完成。API195项、小程序195项共390项本地检查、API构建及页面编译通过；官方包主包1,562,467字节、字体包1,925,822字节、总包3,488,289字节，133个源码文件上传前后指纹一致。差异及证据见[0.7与0.8差异说明](../Weculture体验版0.7与0.8差异说明20261025.md)、[体验版确认截图](../.artifacts/release-20261025/miniprogram-0.8-trial-confirmed-user-proof.png)、[上传记录](../.artifacts/release-20261025/miniprogram-upload.log)、[官方包大小](../.artifacts/release-20261025/miniprogram-upload-info.json)与[上传后源码清单](../.artifacts/release-20261025/after-upload-source.json)。

API022部署后12次真实私有云烟测通过，包含健康检查200、匿名读取401、用户／作者读取及评论／计划SQL读取200；评论和路线计划均无正向行，未直接查询迁移记录，不能据此宣称完整迁移历史或业务写入已验证。未执行评论、保存计划、报名、投稿或审核等业务写入，正常微信登录可能初始化用户资料；真机及真实MySQL并发未验收。数据库备份任务已确认成功，仍需核对`RoutePlanDetails1792454400000`与`PostComments1792458000000`实际迁移记录与数据；回退评论迁移会删除评论表。见[云端烟测](../.artifacts/release-20261025/api022-readonly-1792933802381.json)、[发布状态](../.artifacts/release-20261025/publication-status.json)、[API说明](PHASE2_API.md)及[部署检查清单](../部署检查清单.md)。10月21日及更早交付文档中的“本地未发布／API021”保留其历史时点含义，不代表当前API版本。

## 生产配置

将 `.env.example` 中的配置注入部署平台，不要提交真实 `.env`。必填项包括 MySQL 连接、至少 32 字符的随机 `JWT_SECRET`、`WECHAT_APP_ID`、`WECHAT_APP_SECRET` 和 `CORS_ORIGINS`。若启用 `SEED_DEMO_DATA=true`，初始管理员密码和邀请码也必须由密钥管理服务提供。

微信登录在生产环境调用官方 `jscode2session`，且会拒绝 `dev-` 开头的本地测试身份。
