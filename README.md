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

不依赖本地数据文件的集成测试：

```powershell
cd weculture-api
npm test
```

API 服务启动后，还可执行端到端自测：

```powershell
cd weculture-api
npm run self-test
```

完整的人工和独立 AI 验收用例见 [测试标准.md](测试标准.md)；将体验版交给非技术队友时，使用 [队友功能测试说明.md](队友功能测试说明.md)。

## 开发数据库

本地使用未纳入 Git 的 `weculture-api/weculture.sqlite`。生产环境仅允许 MySQL，并且强制关闭 TypeORM `synchronize`，通过版本化迁移建表。

## 生产部署

生产环境不包含真实密钥或域名。复制 `weculture-api/.env.example` 到部署平台的密钥管理中，配置 MySQL、长度不少于 32 位的随机 `JWT_SECRET`、微信 AppID/AppSecret 和后台 CORS 域名，然后先执行 `npm run migration:run` 再启动 API。完整步骤见 [部署检查清单.md](部署检查清单.md)。

需要让队友在各自手机上测试时，按 [手机体验版部署说明.md](手机体验版部署说明.md) 部署微信云托管测试环境并上传体验版。
