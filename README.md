# WorkGuide

> 基于 LangGraph 构建的多 Agent 智能工作台与 Agent Runtime，面向本地部署。

WorkGuide 让多个 Agent 在统一的工作流中协作：主 Agent 负责理解任务、拆解步骤、调用工具并委派子 Agent，最终通过可流式的界面返回结果。它提供 **Web UI** 与 **CLI** 两种使用方式，并支持通过 **Skills、Tool、MCP** 扩展能力，是一个自包含、可按需配置的 Agent 系统底座。


## Demo

> Web UI / CLI 演示截图将在后续补充。

## 核心能力

| 能力 | 说明 |
| --- | --- |
| **Multi-Agent** | 主 Agent 与子 Agent（Subagent）协作，支持复杂任务的拆解、委派与执行 |
| **LangGraph Runtime** | 基于 LangGraph 管理 Agent 状态与工作流执行，支持 Checkpoint 持久化 |
| **Tool Calling** | 按任务自动调用 Shell、Python、文件等工具，可在配置中按组启用/禁用 |
| **Skills** | 支持内置与自定义 Skill，运行时加载并注入 Agent 上下文 |
| **Memory** | 基于 DeerMem 的长期记忆与上下文压缩，会话 / Thread 状态持久化 |
| **MCP** | 通过 MCP Server 扩展外部工具与第三方能力 |
| **Sandbox** | 在隔离环境中执行代码与命令，支持本地 / E2B 云沙箱 / Kubernetes provisioner 模式 |
| **Model Management** | 多模型服务商切换，模型项均在 `config.yaml` 中配置（不内置默认模型） |
| **Web + CLI** | 同时提供 Vite + React Web UI 与终端 CLI（交互式 TUI / 无头模式） |

## Agent 执行流程

典型执行链路：

1. 用户在 **Web UI / CLI** 提交任务。
2. 请求进入 **Gateway API**，Agent Runtime 初始化本次运行的 LangGraph 图与线程状态。
3. 主 Agent 根据任务决定调用 **Tool / Skill / MCP**，或**委派子 Agent** 处理子任务。
4. 涉及执行代码或命令时，在 **Sandbox** 中隔离运行。
5. 工具 / 子 Agent 结果返回主 Agent，Agent 继续调度或生成最终答案。
6. 结果通过 **SSE** 流式回传前端；`Conversation / Memory` 持久化，可随时续聊。

> 以上为基于当前实现的高层执行链路，具体行为以实际代码与配置为准。

## 架构

- **前端**（`frontend/`）：Vite + React 聊天界面，通过 `:8001` 调用后端，生产环境经 Nginx 统一入口 `:2026`。
- **Gateway**（`backend/app/gateway/`）：FastAPI REST 入口，承载线程、技能、模型、记忆、MCP、上传、子 Agent 等路由。
- **Agent Runtime**（`backend/packages/harness/workguide/`）：LangGraph 驱动的 Agent 框架，含工具、Skill、Sandbox、Memory、状态管理与扩展机制。
- **动态组件**：Model / Skills / Tools / Sandbox / MCP / Memory 均在运行时根据 `config.yaml` 与 `extensions_config.json` 装配。
- **Redis**：作为跨 Worker 流式事件的 Streams Bridge，可选启动。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 后端 | Python ≥ 3.12 · FastAPI · LangGraph · uv · SQLite(Alembic) · SSE |
| 前端 | React 19 · Vite 6 · TypeScript 5.7 · Tailwind CSS 4 · pnpm |
| 测试 | pytest（后端）· Playwright（前端 E2E）· GitHub Actions |
| 部署 | Docker Compose · Nginx · Helm |

## 快速开始

完整安装说明见 [`Install.md`](./Install.md)。WorkGuide 提供 Docker、本地开发、CLI 三种启动方式；任意方式均需先准备配置文件：

```bash
# 生成 config.yaml 与 extensions_config.json
make config
# Windows 无 make 时手动复制：
#   cp config.example.yaml config.yaml
#   cp extensions_config.example.json extensions_config.json
```

> WorkGuide **不内置、也不默认绑定某个具体模型**。需要你在 `config.yaml` 的 `models:` 下配置可用的 LLM 及对应 API Key（密钥由模型项的 `api_key: $VAR` 引用），如需向量检索 / Embedding 能力还应配置相应模型。

### Docker 部署（推荐）

需要 [Docker Desktop](https://www.docker.com/products/docker-desktop/)。默认启动 **Frontend + Backend(Gateway) + Redis + Nginx** 四个服务，入口统一走 Nginx。

```bash
# 1. 配置环境变量（填入所选模型服务商的 API Key）
cp .env.example .env

# 2. 生成配置（见上文）
make config

# 3. 一键构建并启动
docker compose -f docker/docker-compose.yaml up --build
```

启动后访问 **<http://localhost:2026>**（Nginx 对外端口，默认仅绑定 127.0.0.1）。

- 首次运行默认开启鉴权；仅本地调试可用 `.env` 中的 `WORKGUIDE_AUTH_DISABLED=1` 跳过。
- Kubernetes /*provisioner* 沙箱模式**默认不启动**，需显式启用 profile：

```bash
docker compose -f docker/docker-compose.yaml --profile provisioner up --build
```

（该模式需要宿主机上的 Kubernetes 集群，并把 `config.yaml` 的沙箱配置为 provisioner 模式。）

### 本地开发

```bash
# 后端 Gateway（:8001）
cd backend && uv sync --all-groups --locked
cd backend && uv run uvicorn app.gateway.app:app --host 0.0.0.0 --port 8001

# 前端 Vite dev server（:3000，/api 自动代理到 :8001）
cd frontend && pnpm install
cd frontend && pnpm dev
```

- 浏览器访问 <http://localhost:3000>；`make dev` 是等价的聚合命令。
- 后端模型密钥放在 `backend/.env`，由 `config.yaml` 的模型项通过 `api_key: $VAR` 引用。

### CLI

不依赖浏览器，直接在终端与 Agent 交互。CLI 入口 `workguide` 由 `workguide-harness` 提供：

```bash
cd backend && uv sync --all-groups --locked

uv run workguide                     # 交互式 TUI（全屏终端界面）
uv run workguide --print "你好"       # 无头一次性问答，打印最终答案
uv run workguide --json "你好"        # 无头流式，输出 newline-delimited JSON 事件
uv run workguide --continue          # 继续最近一次会话
uv run workguide --resume "会话标题"   # 按 id 或标题恢复指定会话
```

Windows 上也可使用仓库根目录的 `workguide.cmd`（或 `workguide`）一键同时拉起前后端并打开浏览器，`workguide --stop` 停止。更多参数见 `uv run workguide --help`。

## 配置

| 文件 | 作用 | 说明 |
| --- | --- | --- |
| `config.yaml` | 主配置 | 模型、数据库（默认 SQLite）、工具、Skill、Sandbox、Memory、鉴权等 |
| `extensions_config.json` | 扩展配置 | MCP Server 与扩展 Skill 的启停 |
| `.env` / `backend/.env` | 密钥与运行时变量 | Docker 用根 `.env`；本地开发用 `backend/.env` |
| `.env.example` | 密钥模板 | 占位模板，不含真实密钥 |

- `config.yaml`、`extensions_config.json`、`.env` 均已 gitignore，**不会进入仓库**。
- 详细配置项不是示例的说明见 **`Install.md`**，避免在首页堆砌配置参考。

## 测试与 CI

**本地（Windows）实测记录**：

- 后端：`173 passed / 3 failed / 3 skipped`。3 个失败均为 **symlink 权限限制**（WinError 1314），属 Windows 环境限制，相关用例为 Linux CI 设计，**非代码缺陷**。
- 前端：`tsc --noEmit` PASS、`pnpm build` PASS。
- Docker：**未运行**（当前机器无 Docker），未验证。

**GitHub Actions（`deploy` 见 `.github/workflows/`）**：已配置 CI 工作流，包括：

- `ci.yml` —— 最小发布门槛：后端核心测试（Skills / Thread / Storage）+ 前端类型检查与生产构建，Push / PR 时触发。
- `backend-unit-tests.yml`、`frontend-unit-tests.yml`、`lint-check.yml`、`e2e-tests.yml` 等工作流。

> 已提交并发布的仓库中，工作流实际运行状态请以 GitHub 仓库的 **Actions** 页面为准。

```bash
# 本地运行核心后端测试
cd backend && uv sync --all-groups --locked
cd backend && uv run pytest tests/test_skills_custom_router.py tests/test_user_scoped_skill_storage.py \
              tests/test_local_skill_storage_write.py tests/test_threads_router.py -q

# 前端类型检查 + 生产构建
cd frontend && pnpm install
cd frontend && pnpm exec tsc --noEmit && pnpm build

# 前端 E2E（Playwright，需已启动后端 :8001）
cd frontend && npx playwright test
```

## 项目结构

```
WorkGuide/
├── backend/            # FastAPI Gateway + LangGraph Agent 运行时 + IM 渠道
│   ├── app/            # REST 路由（threads / skills / models / memory / mcp / uploads…）
│   ├── packages/       # harness（Agent 框架）与 extension-api（扩展契约）
│   └── tests/          # pytest 测试
├── frontend/           # Vite + React 聊天界面（src/ + e2e/）
├── skills/             # 可扩展 Skills 仓库（public 提交 / custom gitignore）
├── docker/             # Docker Compose、Nginx、provisioner
├── deploy/             # Helm Chart
├── scripts/            # 编排与运维脚本
├── docs/               # 设计文档与说明
├── .github/            # GitHub Actions CI
├── Makefile            # 顶层编排
└── README.md
```

## 项目亮点

- 基于 **LangGraph** 构建 Agent Runtime，统一管理状态与工作流。
- 支持 **主 Agent + 子 Agent（Multi-Agent）** 协作与任务委派。
- 通过 **Tool / Skill / MCP** 三种机制组合扩展 Agent 能力。
- 提供 **Memory（DeerMem）** 与 **Checkpoint** 持久化，会话可恢复续聊。
- 提供 **Sandbox** 隔离执行，降低代码 / 命令运行的副作用风险。
- 同时提供 **Web UI、CLI、Docker Compose** 三种使用与部署方式。
- **GitHub Actions** 已配置核心测试与前端构建流水线。

## License

[MIT](./LICENSE)
