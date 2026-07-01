# 本番切替（カットオーバー）手順

ローカル検証済みの状態から、VPS デプロイ → 本番データ移行 → GAS ブリッジ切替を行う手順。
（このドキュメントの手順はすべて本番に影響するため、実行タイミングは運用者が判断する）

> **実施状況（2026-06-12）**: 手順1〜3 と clasp push/deploy は実施済み。
> 残りは「4. GAS エディタでの最終セットアップ」のみ。
> ※ 当初の API→GAS Webhook（doPost）方式は、Web アプリが「アクセスユーザーとして実行」のため
> 匿名 POST が Google 側で 401 となり不可と判明。**GAS→API ポーリング方式**に変更済み。

## 0. 事前準備

- スプレッドシートの最新データを xlsx でエクスポートし、
  GAS プロジェクト（別リポジトリ）の `data/StockHome_Data.xlsx` を差し替える（古い場合）
- ブリッジトークンを生成しておく: `openssl rand -hex 24`（VPS 上で実行可）

## 1. VPS 初期セットアップ（初回のみ）

```bash
ssh vps
mkdir -p ~/stockhome
cat > ~/stockhome/.env << 'EOF'
POSTGRES_USER=stockhome
POSTGRES_PASSWORD=<openssl rand -hex 16 で生成>
POSTGRES_DB=stockhome
JWT_SECRET=<openssl rand -base64 48 で生成>
BRIDGE_TOKEN=<生成したブリッジトークン>
GAS_WEBHOOK_URL=https://script.google.com/macros/s/AKfycbzKFI_fiTSmHXX_WWuzVdiNCxBjFIREtaZcRqYx-NxEp8zFsjWV9PbTiV58Y1WL3-GwhQ/exec
EOF
chmod 600 ~/stockhome/.env
```

ポート 4002 の開放（さくらVPSのパケットフィルタ/ufw を使っている場合）も確認する。

## 2. デプロイ

```powershell
cd <このリポジトリのルート>   # StockHome を配置/clone した場所（絶対パスに依存しない）
npm run deploy          # tar → scp → docker compose up -d --build api → /health 確認
```

## 3. 本番データ移行

```powershell
scp <GASプロジェクト>/data/StockHome_Data.xlsx vps:stockhome/data.xlsx
```

```bash
ssh vps
cd ~/stockhome
# tsx は esbuild 依存。Windows 製 lockfile に @esbuild/linux-x64 が無いため一時追加が必要
docker compose -f docker-compose.prod.yml run --rm --no-deps \
  -v ~/stockhome/apps/api:/work -v ~/stockhome/data.xlsx:/work/data.xlsx -w /work \
  api sh -c "npm install --no-save --no-package-lock @esbuild/linux-x64 && npx tsx scripts/migrate-from-xlsx.ts /work/data.xlsx"
```

- ユーザーのメールは取込候補の `imported_by_email` から自動導出される
- 初期パスワードは全員共通（移行スクリプト `migrate-from-xlsx.ts` の `INITIAL_PASSWORD` 参照）。
  各自ログイン後にアプリの「パスワード変更」で変更する
- やり直す場合は `--reset` を付ける

確認: `curl http://localhost:4002/health`、アプリからログイン → 在庫一覧表示。

## 4. GAS エディタでの最終セットアップ

（clasp push/deploy は実施済み。以下は GAS エディタ上の操作）

1. **スクリプトプロパティに `STOCKHOME_BRIDGE_TOKEN` を追加**
   （プロジェクトの設定 > スクリプト プロパティ。値は VPS の `~/stockhome/.env` の `BRIDGE_TOKEN`）
2. **`setupStockHomeBridge()` を実行**（ApiBridge.js）
   - `STOCKHOME_API_URL` の設定 / 旧 `runDailyBatch` トリガーの削除 /
     ReadyGo 配信トリガー（`deliverStockHomeNotifications`、毎晩20時台）の作成 を一括で行う
3. **`testStockHomeBridge()` を実行** → ログに `OK: API と疎通できました` が出ること

※ ユーザー別の Gmail 取込トリガーはそのまま残す。

## 5. 動作確認

1. **Gmail → API**: GAS エディタで `runMyGmailImport` を手動実行 →
   ログに `[ApiBridge] 候補送信成功` → アプリの取込候補画面に表示される
2. **API → ReadyGo**: アプリ設定画面（admin）→「夜間バッチを今すぐ実行」（キューに積む）→
   GAS エディタで `deliverStockHomeNotifications` を手動実行 →
   ReadyGo スプレッドシートの Inbox に行が追加され、アプリの通知履歴に記録される
   （手動実行しなければ、毎晩20時台のトリガーが自動で配信する）
3. **アプリ**: `npm run app:start`（vpsモード）で Expo Go から一通り操作

## 6. 切替後の運用メモ

- GAS の HTML 画面は当面残るが、購入登録等は新アプリ側で行う（GAS 側のシートはもう更新されない）
- 検証が済んだら GAS の HTML 画面・WebController・Sheet 系サービスは削除してよい
  （残すのは ApiBridge / GmailImportService / パーサー / ReadyGoBotService / TriggerService / Config / Utils）
- パスワード変更機能は未実装。変更が必要な場合は Prisma Studio（`npx prisma studio`）で
  bcrypt ハッシュを直接更新するか、機能追加する
