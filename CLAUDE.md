# プロジェクト指示文（StockHome React 版）

## 概要

家庭用 消耗品在庫管理アプリ。購入履歴と消費設定から在庫切れ時期を予測し、在庫切れ前に通知する。
GAS 版からの移行プロジェクト。仕様の正は `apps/gas/StockHome_仕様書.md`。

- **モノレポ構成**: `apps/api`（Fastify + Prisma + PostgreSQL） + `apps/mobile`（Expo） + `apps/gas`（Google Apps Script ブリッジ） + `packages/shared`（Zod スキーマ・定数）
- **GAS ブリッジ**（`apps/gas/`、詳細は`apps/gas/CLAUDE.md`）: Gmail 自動取込（各ユーザーの Gmail 権限 + 個人トリガー）と ReadyGo Bot への LINE 通知委譲だけは GAS 側に残し、HTTP で連携する。
  2026-09-13にGitHub管理外の独立フォルダ（`C:\work\PRG\ZZ_Other\GAS\StockHome`、読み取り専用の控えとして当面残置）から本モノレポへ統合した
  - 通信はすべて **GAS からのアウトバウンド**（`X-Bridge-Token` 認証）。GAS Web アプリは「アクセスユーザーとして実行」のため外部からの匿名 POST は受けられない（doPost 方式は不可）
  - Gmail 取込: GAS が解析 → `POST /api/bridge/import-candidates`
  - ReadyGo 通知: API 夜間バッチ(19:55 JST)が `readygo_outbox` キューに積む → GAS 夜間トリガー(20時台)が `GET /api/bridge/readygo-pending` → Inbox 行追加 → `POST /api/bridge/readygo-ack`（ACK 時に notification_log 記録）→ 21:00 の LINE 通知に載る

## 基本ルール

- **アプリのコード実装（機能追加・バグ修正）は Codex が行う。Claude は書かない。**
  `apps/api`・`apps/mobile`・`packages/shared`・`apps/gas`（2026-09-13統合）いずれも対象。
  Claude の担当は調査・設計・Codex 向け指示書（`work/ai_handoff/claude_to_codex/draft/task.md`）の
  作成・結果レビュー。実装依頼を受けたら、まず `work/ai_handoff/BIDIRECTIONAL_WORKFLOW.md` と
  `CLAUDE_DESIGNER_PROMPT.md` を参照し、draft → チャットで配置確認 → inbox 配置の順で進める。
  「進めて」等の包括承認は Claude が実装してよいという意味ではない。
  ※ 依存更新（SDKアップグレード等）・EAS配布・VPSデプロイ・ドキュメント更新は Claude が直接行う。
  ※ `apps/gas/push.bat`・`deploy.bat`（clasp push/deploy）はCodexも実行しない。production承認後に
  ユーザーが手動で実行する（`apps/gas/CLAUDE.md`参照）。
- 実装前に理解した仕様を整理して提示し、不明点は推測せず質問すること。
- 機能の追加・変更時は API・mobile・shared・gasのどこにまたがるかを先に整理すること。Zod スキーマや型の変更は `packages/shared` を起点に検討する。
- スマホ片手操作を最重視。フォームは `Section` でセクション分けし、必須入力は最小限に。

## モデル使い分けルール

- 通常の設計整理・ドキュメント作成: Sonnet
- アーキテクチャ判断、複数案のトレードオフ検討: Opus
- 方針決定から設計文書化まで一括で任せる場合: opusplan モード

## データ層ルール

- 主要テーブルは `household_id` を持ち、API は必ず `req.auth.householdId` で絞り込む。
- 品目（items）は論理削除（`is_active=false` + `deleted_at`）。物理削除しない。
- 在庫計算では `counted_in_inventory=true` の購入履歴のみ加味する。`inventory_effective_at <= today` で counted 化（夜間バッチ）。
- 日付は API レスポンスで `'YYYY-MM-DD'` 文字列に変換（`utils/serialize.ts`）。受信時は `parseDateOnly` で Date 化。
- 書き込み系（購入登録・補正・候補確定）の直後は該当品目の stock_snapshot を即時再計算する。
- **単一世帯運用が前提**（2026-09-03所見C-6、2026-09-20方針決定）。Gmail取込の世帯解決
  （`candidateIntake.ts`の`resolveHouseholdId`）は、メールから利用者を特定できない場合
  「最初に作られたhousehold」へフォールバックする。2世帯目を追加する場合はこの前提が
  崩れるため、フォールバック依存箇所（`candidateIntake.ts`の`resolveHouseholdId`、他に
  `household.findFirst`等の単純化を探すこと）を先に洗い出し、明示的な世帯解決へ置き換える
  設計が必要（household件数が2件以上の状態でフォールバックが発動すると警告ログ
  `household_resolution_fallback`を出す安全網のみ実装済み。防止策ではない）。

## 在庫計算（GAS 版 StockService 準拠）

- 線形消費モデル: 最新購入（または手動補正値）起点に `経過日数 / days_per_unit` を消費として引く
- `manual_override_qty` があれば補正日時起点で優先
- アラート: `残日数 <= lead_days + safety_days` OR `残数 <= low_stock_threshold_qty`
- 例外: `is_inventory_unknown=true` は常にアラート無効 / `inventory_effective_at` から3日以内は通知抑止

## 技術スタック

- mobile: Expo SDK 57 / RN 0.86 / React 19.2 / React Navigation v7 / TanStack Query v5 / react-hook-form
  - 2026-09-04 に SDK 54→55→56→57（最新安定版）へ1段階ずつアップグレード済み。SDK を上げる際は
    `npx expo install expo@^<次のメジャー>.0.0` → `npx expo install --fix` → `npx expo-doctor` の順で1段階ずつ進め、
    各段階で TypeScript コンパイルと `npx expo export --platform android` が通ることを確認する。
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
- GAS 側（`apps/gas/`）を変更したら `apps/gas/push.bat` → `apps/gas/deploy.bat`（clasp）で反映が必要。
  `push.bat`/`deploy.bat`の実行はproductionへの実質的なデプロイ操作のため、notice/production承認プロセスの
  対象（`apps/gas/CLAUDE.md`参照）。
- VPS デプロイ先は `~/stockhome`（HomeAsset の `~/homeasset` と並列）。`ssh vps` で接続。
