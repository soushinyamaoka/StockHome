# syntax=docker/dockerfile:1
# StockHome API 本番イメージ（モノレポ対応マルチステージ）
# ビルドコンテキストはリポジトリルート（docker-compose.prod.yml の context: . を参照）

############
# Builder  #
############
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Prisma エンジンが OpenSSL を必要とする
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# 依存解決（api + shared ワークスペースのみ）。
# lockfile 整合のため全ワークスペースの manifest を先にコピー（キャッシュ効率も向上）
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/mobile/package.json apps/mobile/package.json
RUN npm ci --workspace=@stockhome/shared --workspace=@stockhome/api --include-workspace-root --ignore-scripts

# ソースをコピーしてビルド（api の prebuild が shared ビルド + prisma generate を実行）
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build --workspace=@stockhome/api

############
# Runtime  #
############
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# 本番専用の別installにする（builderのnode_modulesをそのままコピーしない）。
# builderはdevDependencies込みでインストールするため、そのままruntimeへ運ぶと
# xlsx（移行スクリプト専用、high脆弱性あり）等がimage内に残ってしまう（所見C-8対応）。
# lockfile整合のため、npm ci時に全workspaceのmanifestが必要（apps/mobileは
# 直接installしないが、workspaces配下に存在するため必要）
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/mobile/package.json apps/mobile/package.json
RUN npm ci --omit=dev --workspace=@stockhome/shared --workspace=@stockhome/api --include-workspace-root --ignore-scripts

# ワークスペースの配置（symlink）を保ったまま成果物をコピー
COPY --from=builder /app/packages/shared/dist /app/packages/shared/dist
COPY --from=builder /app/apps/api/dist /app/apps/api/dist
COPY --from=builder /app/apps/api/prisma /app/apps/api/prisma
# 上記の別installでは@prisma/clientが未生成のパッケージ骨格のまま入るため、
# builderがビルド時（pinned prisma@5.22.0）に生成済みのclient本体
# （node_modules/.prisma/client、query engineバイナリ含む）をそのままコピーする。
# runtimeでprisma generateは再実行しない（`npx prisma`はローカルpackage.jsonの
# バージョン指定を無視し、未cacheだとnpmから最新版を取得してしまう。実際に
# schemaのurlプロパティ非互換のv7が入って壊れることを確認済みのため、
# ビルド時にpinned版で生成済みの成果物をそのまま使う）
COPY --from=builder /app/node_modules/.prisma /app/node_modules/.prisma

WORKDIR /app/apps/api
EXPOSE 4002

# 起動時: entrypointがmigrationを実行し、成功時のみserverを子processとして起動する。
# migration失敗時は非0終了しserverを起動しない（apps/api/src/entrypoint.ts）
CMD ["node", "dist/entrypoint.js"]
