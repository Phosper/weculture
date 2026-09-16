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

## 生产配置

将 `.env.example` 中的配置注入部署平台，不要提交真实 `.env`。必填项包括 MySQL 连接、至少 32 字符的随机 `JWT_SECRET`、`WECHAT_APP_ID`、`WECHAT_APP_SECRET` 和 `CORS_ORIGINS`。若启用 `SEED_DEMO_DATA=true`，初始管理员密码和邀请码也必须由密钥管理服务提供。

微信登录在生产环境调用官方 `jscode2session`，且会拒绝 `dev-` 开头的本地测试身份。
