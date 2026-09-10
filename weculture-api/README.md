# Weculture API

本地开发默认使用 `sql.js` 文件数据库，以便无需 Docker 即可联调；实体和多租户边界与 MySQL 部署一致。生产部署将 TypeORM 数据源替换为 MySQL，并关闭 `synchronize`，改用迁移。

```powershell
npm install
npm run dev
```

服务地址：`http://localhost:3000/api/v1`。种子数据会创建试点学校“北京语言大学”、邀请码 `BLCU2026` 和后台账号：

- 超级管理员：`admin` / `Weculture@2026`
- 学校运营：`blcu-operator` / `Weculture@2026`

这些凭据仅用于本地开发，生产环境须通过环境变量初始化并立即更换。
