# frontend/Dockerfile — WorkGuide Vite + React SPA container
# -------------------------------------------------------------
# compose 以 `context: ../` + `dockerfile: frontend/Dockerfile` 构建本镜像，
# 因此 Dockerfile 内所有 COPY 路径都相对仓库根目录。
#
# 阶段：
#   build -> pnpm install --frozen-lockfile + pnpm build（产出 dist/）
#   dev   -> 面向 docker-compose-dev.yaml 的 Vite dev server（热更新）
#   prod  -> 轻量 nginx 静态托管 dist（listen :3000，SPA history 回退）
#
# 前端是纯静态 SPA；/api/* 由外层 nginx(docker/nginx) 转发到 gateway，
# 本镜像不代理任何 API，也不需要任何运行时环境变量。

# ── Builder ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

ARG NPM_REGISTRY
ARG COREPACK_NPM_REGISTRY
ARG APK_MIRROR
ARG PNPM_STORE_PATH=/root/.local/share/pnpm/store

RUN if [ -n "${APK_MIRROR}" ]; then \
      sed -i "s|https://dl-cdn.alpinelinux.org/alpine|${APK_MIRROR}|g" /etc/apk/repositories; \
    fi \
    && apk add --no-cache libc6-compat \
    && corepack enable \
    && if [ -n "${COREPACK_NPM_REGISTRY}" ]; then export COREPACK_NPM_REGISTRY="${COREPACK_NPM_REGISTRY}"; fi \
    && if [ -n "${NPM_REGISTRY}" ]; then pnpm config set registry "${NPM_REGISTRY}"; fi

WORKDIR /app/frontend

# 先只复制锁文件安装依赖，源码变更时可复用依赖层
# pnpm-workspace.yaml 携带 allowBuilds（esbuild 等构建脚本放行），必须一并复制，
# 否则 pnpm 11 会忽略 esbuild 的 postinstall 导致 ERR_PNPM_IGNORED_BUILDS。
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# 复制全部前端源码并构建（typecheck + vite build）
COPY frontend/ ./
RUN pnpm build

# ── dev：Vite dev server（docker-compose-dev.yaml 使用 target: dev）─────
FROM node:22-alpine AS dev

ARG NPM_REGISTRY
ARG COREPACK_NPM_REGISTRY
ARG APK_MIRROR

RUN if [ -n "${APK_MIRROR}" ]; then \
      sed -i "s|https://dl-cdn.alpinelinux.org/alpine|${APK_MIRROR}|g" /etc/apk/repositories; \
    fi \
    && apk add --no-cache libc6-compat \
    && corepack enable \
    && if [ -n "${COREPACK_NPM_REGISTRY}" ]; then export COREPACK_NPM_REGISTRY="${COREPACK_NPM_REGISTRY}"; fi \
    && if [ -n "${NPM_REGISTRY}" ]; then pnpm config set registry "${NPM_REGISTRY}"; fi

WORKDIR /app/frontend

COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY frontend/ ./

EXPOSE 3000
# --host 0.0.0.0 使 Vite 在 compose 网络内可从 frontend:3000 访问；
# /api 由 nginx 转发，HMR 通过 nginx 的 / 代理 + Upgrade 头透传。
CMD ["pnpm", "dev", "--host", "0.0.0.0"]

# ── prod：静态 Web Server（target: prod）───────────────────────────────
FROM nginx:1.27-alpine AS prod

# 仅托管静态资源 + SPA history 回退，避免深链刷新 404
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]