# プロジェクト指示文（StockHome React 版）

## 概要

家庭用 消耗品在庫管理アプリ。購入履歴と消費設定から在庫切れ時期を予測し、在庫切れ前に通知する。
GAS 版（`C:\work\PRG\GAS\StockHome`）からの移行プロジェクト。仕様の正は GAS 版の `StockHome_仕様書.md`。

- **モノレポ構成**: `apps/api`（Fastify + Prisma + PostgreSQL） + `apps/mobile`（Expo） + `packages/shared`（Zod スキーマ・定数）
- **GAS ブリッジ**: Gmail 自動取込（各ユーザーの Gmail 権限 + 個人トリガー）と ReadyGo Bot への LINE 通知委譲だけは GAS 側に残し、HTTP で連携する
  - 通信はすべて **GAS からのアウトバウンド**（`X-Bridge-Token` 認証）。GAS Web アプリは「アクセスユーザーとして実行」のため外部からの匿名 POST は受けられない（doPost 方式は不可）
  - Gmail 取込: GAS が解析 → `POST /api/bridge/import-candidates`
  - ReadyGo 通知: API 夜間バッチ(19:55 JST)が `readygo_outbox` キューに積む → GAS 夜間トリガー(20時台)が `GET /api/bridge/readygo-pending` → Inbox 行追加 → `POST /api/bridge/readygo-ack`（ACK 時に notification_log 記録）→ 21:00 の LINE 通知に載る

## 基本ルール

- 実装前に理解した仕様を整理して提示し、不明点は推測せず質問すること。
- 機能の追加・変更時は API・mobile・shared のどこにまたがるかを先に整理すること。Zod スキーマや型の変更は `packages/shared` を起点に検討する。
- スマホ片手操作を最重視。フォームは `Section` でセクション分けし、必須入力は最小限に。

## データ層ルール

- 主要テーブルは `household_id` を持ち、API は必ず `req.auth.householdId` で絞り込む。
- 品目（items）は論理削除（`is_active=false` + `deleted_at`）。物理削除しない。
- 在庫計算では `counted_in_inventory=true` の購入履歴のみ加味する。`inventory_effective_at <= today` で counted 化（夜間バッチ）。
- 日付は API レスポンスで `'YYYY-MM-DD'` 文字列に変換（`utils/serialize.ts`）。受信時は `parseDateOnly` で Date 化。
- 書き込み系（購入登録・補正・候補確定）の直後は該当品目の stock_snapshot を即時再計算する。

## 在庫計算（GAS 版 StockService 準拠）

- 線形消費モデル: 最新購入（または手動補正値）起点に `経過日数 / days_per_unit` を消費として引く
- `manual_override_qty` があれば補正日時起点で優先
- アラート: `残日数 <= lead_days + safety_days` OR `残数 <= low_stock_threshold_qty`
- 例外: `is_inventory_unknown=true` は常にアラート無効 / `inventory_effective_at` から3日以内は通知抑止

## 技術スタック

- mobile: Expo SDK 54 / RN 0.81 / React 19.1 / React Navigation v7 / TanStack Query v5 / react-hook-form
  - **端末の Expo Go が SDK 54 対応のため SDK を上げないこと**
- api: Node.js + Fastify 5 + Prisma 5 + PostgreSQL 16（開発 DB ポート **5434**、API ポート **4002**。HomeAsset と並行稼働するため番号をずらしている）
- shared: Zod スキーマ + 定数。**API は dist 参照のため shared 変更時は要ビルド**（mobile は src 直参照）

## 起動コマンド

```powershell
npm run app:start       アプリ起動[vps]   Expoのみ。VPSのAPI/DBに接続（Docker不要）
npm run app:start:local アプリ起動[local] DB(Docker)+ローカルAPI+Expo を一括起動
npm run app:stop        アプリ停止
npm run db:up           PostgreSQL（Docker）起動 → localhost:5434
npm run api:dev         API 開発サーバ起動（tsx watch、localhost:4002）
npm run api:migrate     Prisma マイグレーション
npm run mobile:start    Expo起動
npm run deploy          VPS再デプロイ
npm run migrate:sheet   スプレッドシート(xlsx)からのデータ移行
```

## コミット・デプロイ時の注意

- `.env` はコミットしない。`.env.production.example` を更新したら README にも反映。
- Prisma schema 変更時は必ず migration を生成して commit。
- **lockfile は Windows で生成されるため `@esbuild/linux-x64` が欠落しがち。Dockerfile の回避策を消さないこと。**
- GAS 側（`C:\work\PRG\GAS\StockHome`）を変更したら `push.bat` → `deploy.bat`（clasp）で反映が必要。
- VPS デプロイ先は `~/stockhome`（HomeAsset の `~/homeasset` と並列）。`ssh vps` で接続。
