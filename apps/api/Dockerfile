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
WORKDIR /app/apps/api
ENV NODE_ENV=production

RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# ワークスペースの配置（symlink）を保ったまま成果物をコピー
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/package.json /app/package-lock.json /app/
COPY --from=builder /app/packages/shared/package.json /app/packages/shared/package.json
COPY --from=builder /app/packages/shared/dist /app/packages/shared/dist
COPY --from=builder /app/apps/api/package.json /app/apps/api/package.json
COPY --from=builder /app/apps/api/dist /app/apps/api/dist
COPY --from=builder /app/apps/api/prisma /app/apps/api/prisma

EXPOSE 4002

# 起動時にマイグレーション適用 → サーバ起動
CMD ["sh", "-c", "npx prisma migrate deploy --schema prisma/schema.prisma && node dist/server.js"]
