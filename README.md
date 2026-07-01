# StockHome（React 版）

家庭用 消耗品在庫管理アプリ。購入履歴と消費設定から在庫切れ時期を予測し、在庫切れ前に LINE（ReadyGo Bot 経由）で通知する。

GAS + スプレッドシート版（`C:\work\PRG\GAS\StockHome`）からの移行版。
構成は HomeAsset と同型のモノレポ（Expo モバイル + Fastify API + PostgreSQL + さくらVPS Docker）。

## 構成

```
apps/api      Fastify 5 + Prisma 5 + PostgreSQL 16（API ポート 4002）
apps/mobile   Expo SDK 54 / React Native 0.81（Expo Go で動作）
packages/shared  Zod スキーマ・定数（API は dist 参照 / mobile は src 直参照）
scripts       app.ps1（起動） / deploy.ps1（VPSデプロイ）
```

- 開発用 DB: Docker PostgreSQL → localhost:**5434**（HomeAsset の 5433 と並行稼働可）
- 本番: さくらVPS `~/stockhome` に Docker Compose（API 公開ポート **4002**）

## GAS ブリッジ連携

Gmail 自動取込と ReadyGo（LINE）通知だけは GAS 側に残し、HTTP で連携する。

通信はすべて **GAS からのアウトバウンド**（`X-Bridge-Token` ヘッダ認証）。
GAS Web アプリは「アクセスユーザーとして実行（要ログイン）」のため、外部からの匿名 POST は受けられない。

| 役割 | 経路 |
|---|---|
| Gmail 取込 | GAS 個人トリガー(6時間毎)が解析 → `POST /api/bridge/import-candidates` |
| ReadyGo 通知 | API 夜間バッチ(19:55 JST)がキューに積む → GAS 夜間トリガー(20時台)が `GET /api/bridge/readygo-pending` → ReadyGo Inbox に行追加 → `POST /api/bridge/readygo-ack`（ここで notification_log 記録） |

GAS 側スクリプトプロパティ: `STOCKHOME_API_URL` / `STOCKHOME_BRIDGE_TOKEN`（未設定の間は従来のシート保存で動作）。
API 側 env: `BRIDGE_TOKEN`（GAS 側トークンと同一値にする）。

## セットアップ（ローカル）

```powershell
npm install
npm run db:up                          # PostgreSQL (Docker, :5434)
cd apps/api; copy .env.example .env; cd ../..      # API の環境変数（DB/JWT/BRIDGE_TOKEN）
cd apps/mobile; copy .env.example .env; cd ../..   # モバイルの接続先 VPS URL（vpsモード用）
npm run api:migrate           # スキーマ適用
npm run api:seed              # デモデータ（demo@example.com / demo1234）
npm run migrate:sheet         # スプレッドシートxlsxから本番データ移行（任意）
npm run app:start:local      # DB+API+Expo 一括起動
```

- **`.env` は2か所**（`apps/api/.env` と `apps/mobile/.env`）。どちらも Git 管理外。
  PC ごとに1回だけ `.env.example` をコピーして実値を設定する（VPS の IP やトークンはコミットしない方針）。
- `apps/mobile/.env` の `EXPO_PUBLIC_API_BASE_URL` は **vpsモード（`app:start`）専用**。
  localモード（`app:start:local`）では無視され PC の LAN IP を自動判定する。

データ移行の詳細は `apps/api/scripts/migrate-from-xlsx.ts` のヘッダコメント参照。
移行ユーザーの初期パスワードは環境変数 `INITIAL_PASSWORD`（未設定なら `changeme1234`）。各自ログイン後に変更する。

## 日常運用

```powershell
npm run app:start        # Expo のみ起動し VPS の API に接続（普段使い）
npm run app:start:local  # ローカル開発（DB+API+Expo）
npm run app:stop         # 停止
npm run deploy           # VPS 再デプロイ（-- -DryRun で送信内容確認）
```

## 夜間バッチ

API プロセス内の node-cron が毎日 **19:55 JST** に実行:

1. `inventory_effective_at` 到来分の `counted_in_inventory` 更新
2. 全品目の在庫再計算 → stock_snapshot 更新
3. アラート品目（notify_target_type=all・通知ON・スヌーズ外）を1メッセージに集約 → `readygo_outbox` キューに投入

その後 GAS の夜間トリガー（20時台）がキューを取得して ReadyGo Inbox に行追加（21:00 の LINE 配信に載る）。
notification_log は GAS からの ACK 受信時に記録される（投入成功時のみ記録、GAS 版の方針を踏襲）。

手動実行: アプリの設定画面「夜間バッチを今すぐ実行」（admin のみ）または `POST /api/dashboard/run-batch`。
