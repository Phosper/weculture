# Weculture 单校内测工程

本仓库按《Weculture小程序系统设计文档》实现为三个独立工程：

| 目录 | 说明 | 本地地址 |
| --- | --- | --- |
| `weculture-api` | NestJS API、认证、审核、业务数据与种子数据 | `http://127.0.0.1:3000/api/v1` |
| `weculture-miniprogram` | 微信原生小程序 | 使用微信开发者工具导入 |
| `weculture-admin` | React 运营后台 | `http://127.0.0.1:5173` |

## 本地启动

依次打开两个终端：

```powershell
cd weculture-api
npm install
npm run dev
```

```powershell
cd weculture-admin
npm install
npm run dev
```

然后使用微信开发者工具导入 `weculture-miniprogram`。其默认 API 地址是本机 `http://127.0.0.1:3000/api/v1`，开发者工具须关闭域名校验；部署体验版和正式版前，必须替换为备案 HTTPS 域名。

## 本地演示身份

- 学校邀请码：`BLCU2026`
- 平台超级管理员：`admin` / `Weculture@2026`
- 学校运营管理员：`blcu-operator` / `Weculture@2026`
- 内容审核员：`blcu-reviewer` / `Weculture@2026`

这些凭据仅用于本地开发。生产环境必须通过部署环境变量初始化管理员并更换密码。

## 验证

API 服务启动后，可执行：

```powershell
cd weculture-api
npm run self-test
```

完整的人工和独立 AI 验收用例见 [测试标准.md](测试标准.md)。

## 开发数据库

本地使用 `weculture-api/weculture.sqlite`，因为当前环境未提供容器运行时。实体模型、`schoolId` 行级隔离和服务边界均以 MySQL 部署为目标；生产部署时需改为 MySQL 数据源并使用正式迁移，禁止开启 TypeORM 的 `synchronize`。
