# WorkGuide 前端

基于 **Vite + React 19 + TypeScript + Tailwind CSS 4** 的聊天界面，通过 **SSE（Server-Sent Events）** 流式对接后端 Gateway。

## 运行

```bash
cd frontend
pnpm install   # 安装依赖
pnpm dev       # 启动开发服务器，浏览器打开 http://localhost:3000
```

## 与后端对接

- `vite.config.ts` 已配置代理：本地开发的 `/api` 请求会转发到 `http://localhost:8001`（Gateway），避免跨域。
- SSE 流式读取封装在 `src/lib/sse.ts`，聊天状态管理在 `src/lib/useChat.ts`，API 客户端在 `src/lib/api.ts`。
- 生产环境（Docker）下 `/api/*` 由外层 Nginx 转发到 Gateway，前端无需任何运行时环境变量。

## 目录

```
frontend/
├── index.html
├── vite.config.ts        # 启动配置 + /api 代理
├── playwright.config.ts  # E2E 测试配置
├── e2e/                  # Playwright E2E 测试
└── src/
    ├── main.tsx          # 入口
    ├── App.tsx           # 页面骨架（Sidebar + Header + 消息区 + Composer）
    ├── index.css         # Tailwind 引入
    ├── components/       # Composer / Header / Sidebar / MessageList / SettingsDrawer 等
    └── lib/              # api.ts / sse.ts / useChat.ts / modelsStore.ts
```
