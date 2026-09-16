# Weculture 管理后台

```powershell
npm install
npm run dev
```

访问 `http://localhost:5173`。API 服务必须先运行。演示账号为 `admin` / `Weculture@2026`。

生产构建前配置 HTTPS API 地址：

```powershell
Copy-Item .env.example .env.production
# 编辑 .env.production 中的 VITE_API_BASE_URL
npm run build
```

演示账号只会在 Vite 开发模式预填，生产构建不会带入密码。
