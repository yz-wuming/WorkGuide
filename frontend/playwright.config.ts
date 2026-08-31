import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { defineConfig } from "@playwright/test";

const require = createRequire(import.meta.url);
// vite 的 exports 不暴露 bin/vite.js 子路径，故从主入口向上两级推导包根
const viteIndex = require.resolve("vite");
// vite: <pkg>/dist/node/index.js → 包根需再上溯一级到 <pkg>/bin/vite.js
const viteBin = join(dirname(dirname(dirname(viteIndex))), "bin", "vite.js");

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    actionTimeout: 15_000,
  },
  webServer: [
    // 前端 Vite dev server；/api 代理到已运行的 Gateway(8001)
    {
      command: `node "${viteBin}" --port 3000 --strictPort`,
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 120_000,
      stdout: "pipe",
    },
  ],
});