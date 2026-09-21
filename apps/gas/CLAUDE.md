# プロジェクト指示文（StockHome GAS ブリッジ）

## 位置づけ

本体機能は React 版（このリポジトリの `apps/api` + `apps/mobile`、Expo + Fastify + PostgreSQL/VPS）へ
移行済み。この GAS プロジェクトは **ブリッジ** として以下のみを担当する:

1. **Gmail 自動取込**: 各ユーザーの Gmail 権限 + 個人トリガーで解析し、候補を新 API へ POST（[ApiBridge.js](src/ApiBridge.js)）
   - スクリプトプロパティ `STOCKHOME_API_URL` / `STOCKHOME_BRIDGE_TOKEN` 設定時のみ API 送信。未設定なら従来のシート保存
2. **ReadyGo 通知の配信**: 夜間トリガー（`deliverStockHomeNotifications`、毎晩20時台）が API の配信待ちキューを
   `GET /api/bridge/readygo-pending` で取得 → `ReadyGoBotService.appendToInbox` → `POST /api/bridge/readygo-ack`
   - **doPost（API→GAS の Webhook）は不可**: Web アプリが「アクセスユーザーとして実行（要ログイン）」のため
     外部からの匿名 POST は Google 側で 401 になる。通信は必ず GAS からのアウトバウンドにすること

セットアップは `setupStockHomeBridge()` を1回実行（API URL 設定・旧 `runDailyBatch` トリガー削除・配信トリガー作成）。
`STOCKHOME_BRIDGE_TOKEN` は秘密情報のためソースに書かず、スクリプトプロパティに手動設定する。
HTML 画面と WebController は並行運用のため残置中。Gmail 設定画面（HtmlGmailSettings）とユーザー別トリガーは存続する。

**2026-09-13 リポジトリ統合**: 従来 `C:\work\PRG\ZZ_Other\GAS\StockHome`（Git管理外の独立フォルダ）に
あったソースを、StockHomeモノレポの `apps/gas/` へ集約した。旧フォルダは当面、読み取り専用の控えとして
残す（削除しない）。`clasp` のリモート紐付け（Apps Scriptのscript ID）はローカルの配置場所に依存しないため、
移行によるGAS側の動作影響はない。`.clasp.json`・`deploy.bat`は個別環境設定（scriptId・デプロイID）を含むため
このディレクトリの `.gitignore` で除外し、それぞれ `.clasp.json.example`・`deploy.bat.example` をコピーして
使う運用は維持する。

## 基本ルール

### 1. 実装前の確認プロセス

- 実装に入る前に、理解した仕様を箇条書きで整理して提示すること。
- 不明点や曖昧な点があれば、推測で進めず必ず質問すること。
- 仕様の確認が取れてから実装を開始すること。

### 2. 影響範囲の事前調査

- 機能の追加・変更を行う際は、実装前に影響を受ける既存の関数・シート・トリガー・HTML 画面を洗い出し、リストとして提示すること。
- 横展開が必要な箇所がある場合は、対応漏れがないよう明示すること。
- 影響範囲の確認が取れてから実装を開始すること。
- **サーバー側（.gs）の関数名・戻り値の形を変えた場合、対応する HTML 画面の `google.script.run` 呼び出しも必ず確認すること。**
- **シートの列を追加/変更した場合、`SheetRepository`・`SheetInitializer`・該当する Service・関連画面すべてに横展開が必要。**

### 3. 段階的な進め方

- 大きな機能は一度に実装せず、以下のような段階に分けて進めること。
  1. データ構造・設計方針の提示 → 確認
  2. サーバー側ロジックの実装（.gs） → 確認
  3. シートとの連携 → 確認
  4. 画面側（HTML + google.script.run）→ 確認
  5. 結合・仕上げ → 確認
- 各段階でユーザーの確認を取ってから次に進むこと。

### 4. その他

- 問題報告時は、まず原因を説明し、修正不要な場合はその旨を先に伝える。修正が必要な場合のみ対応方針を提示する。すぐに修正に飛びつかない。
- **「定番の対処」を鵜呑みにせず、挙動を具体的にシミュレートしてから提案すること**（後述「過去の反省」参照）。

---

## GAS 実装上の注意点

### シート・データアクセス

- シート名・列名は [Config.js](src/Config.js) に定数として集約されている。文字列直書きは避けること。
- スプレッドシート ID はスクリプトプロパティ `SPREADSHEET_ID` から取得する。コード中にハードコードしないこと。
- `getDataRange().getValues()` は全行取得するため、`purchase_log` / `notification_log` など追記型シートが巨大化した場合はパフォーマンスに注意する。
- 書き込み系の操作は `LockService` でロックを取る前提の設計。既存パターンに倣うこと。

### Web アプリ（HtmlService）の落とし穴

- **`<base target="_top">` だけでは不十分。必ず `<base href="<?= webAppUrl ?>" target="_top">` のように絶対 URL を指定する。** href 未指定だと iframe URL 基準で相対解決され、リンク遷移が失敗する。
- [Main.js](src/Main.js) の `doGet` は全テンプレートに `webAppUrl = ScriptApp.getService().getUrl()` を渡している。新規 HTML を追加する際も `<head>` 内に `<base href="<?= webAppUrl ?>" target="_top">` を入れること。
- `<a href="?page=xxx">` 形式の内部遷移は Web アプリ URL 基準で解決される前提。`<base href>` を外さないこと。
- サーバー関数のレスポンスは `{success: boolean, data?: any, message?: string}` の形式で統一されている。画面側はこの形式を前提に `withSuccessHandler` で処理する。

### トリガー管理

- 旧・日次バッチ (`runDailyBatch`・`createDailyBatchTrigger`) は2026-09-21に完全に削除した。
  在庫計算・通知判定・ReadyGo投入はAPI側daily_batchへ移行済みで、GAS側のReadyGo通知配信は
  `deliverStockHomeNotifications`（毎晩20時台のinstallable trigger、`createStockHomeNotifyTrigger`
  で作成）のみが担う。`deleteDailyBatchTrigger`は、未移行環境に残る旧triggerを
  `setupStockHomeBridge()`が一括削除するためだけに残置している（notice
  20260920-STOCKHOME-014、第5回VPS管理レビュー対応）。
- Gmail 自動取込はユーザーごとの installable trigger で、各ユーザーが Gmail 設定画面から有効化する。`runMyGmailImport` 実行時の実行者の Gmail だけが対象になる仕組みは崩さないこと。
- トリガー変更を伴う実装の場合は、変更内容を事前に明示すること。

### LINE 通知（ReadyGo Bot 連携）

- **StockHome から LINE Messaging API を直接呼ばない。** アラート配信は ReadyGo Bot（家族向け生活自動化Bot）に委譲。
- API側daily_batchが積んだ配信待ちキューを、GASの`deliverStockHomeNotifications`
  （毎晩20時台のtrigger）が`GET /api/bridge/readygo-pending`で取得し、
  [ReadyGoBotService.appendToInbox](src/ReadyGoBotService.js) を呼んでReadyGo 側
  スプレッドシートの `Inbox` シートに1行追加、`POST /api/bridge/readygo-ack`でAPIへ
  完了報告する。ReadyGo が 21:00 LINE 通知の末尾に「📨 お知らせ」として配信する。
  在庫計算・通知判定自体はAPI側daily_batchが行う（`apps/api/src/services/batch.ts`）。
  GAS側の旧・日次バッチ（`runDailyBatch`経由でGAS自身が在庫計算・通知判定・Inbox投入
  すべてを行う経路）は2026-09-21に完全に削除した。
- 仕様:
  - 集約モデル — 全アラート品目を1つのメッセージにまとめて1行投入（世帯単位。API側で判定）
  - 配信対象 — `notify_target_type=all` の品目のみ（API側`batch.ts`の判定に準拠）
  - 冪等性 — `appendToInbox(body, outboxId)`がInbox行のE列（`stockhome_outbox_id`）へ
    outbox idを本文と同時書き込みし、既存idは再投入をスキップする（notice
    20260920-STOCKHOME-014、S014-B07対応。2026-09-21以前は重複防止を実施していなかった）。
    `deliverStockHomeNotifications`全体を`LockService`で排他し並行実行による二重投入も防ぐ
  - 失敗時 — `READYGO_SPREADSHEET_ID` 未設定や権限不足等は Logger.log のみ、ACKされないため
    API側が該当行を`claimed`のまま保持し、lease（30分）超過後に自動的に再送を試みる
- 必須設定:
  - スクリプトプロパティ `READYGO_SPREADSHEET_ID` に ReadyGo 側スプレッドシート ID
  - GASの`deliverStockHomeNotifications`trigger を実行する Google アカウントが
    ReadyGo スプレッドシートの編集者であること
- 旧 `line_outbox` フローは完全に廃止済み（コード・`SHEET_NAMES` から削除）。スプレッドシート上の `line_outbox` シートタブは手動削除推奨。

### 在庫計算

- 「最新購入からの線形消費」という単純モデル。精度を上げる変更を検討する前に、運用側での在庫補正で十分かを検討すること。
- 補正（`StockCorrectionService`）と新規購入登録の順序関係（新規購入で過去の補正がクリアされる）を壊さないこと。

---

## clasp 運用

### 前提

- `.clasp.json` でスクリプト ID と `rootDir: src` を指定している。`.clasp.json` はこのディレクトリの
  `.gitignore` で除外されているため、`.clasp.json.example` をコピーして自分の scriptId を記入すること。
- **`.claspignore` は `rootDir` 指定時はほぼ不要。** `**/**` + `!src/**` のような設定は **全ファイルを ignore してしまう**（`rootDir: src` の場合、clasp 内部パスは `src/` が既に剥がれているため）。最小構成に留めること。

### デプロイフロー

- [push.bat](push.bat): ローカル `src/` を GAS プロジェクトに push（Web アプリには未反映）
- [deploy.bat](deploy.bat): push + 既存デプロイの新バージョン更新（Web アプリ URL に反映）。
  `deploy.bat` もこのディレクトリの `.gitignore` で除外されているため、`deploy.bat.example` をコピーして
  自分の DEPLOY_ID を記入すること。
- 家族配布用 URL は `/exec` 終わり。
- **`push.bat`・`deploy.bat` の実行（`clasp push`/`clasp deploy`）は production への実質的なデプロイ操作であり、
  StockHome側のnotice/production承認プロセスの対象。ユーザーの明示的な承認なしに実行しないこと**
  （StockHome-ClaudeToCodexパイプライン経由での自動実行時も同様）。

### トラブル時のチェック

1. `clasp push -f` が `Script is already up to date` と出る → `.claspignore` が過剰に除外していないか確認
2. GAS エディタを F5 リロードしても反映されない → スクリプト ID が `.clasp.json` と一致しているか確認
3. Web アプリに反映されない → `push` 後に `deploy` を実行したか確認（push だけでは URL に反映されない）

---

## 技術スタック

- Google Apps Script (GAS) — 単一プロジェクト
- Google Spreadsheet（組み込み `SpreadsheetApp`）— データベースとして使用
- Gmail（組み込み `GmailApp`）— Amazon/マツキヨ注文メールの自動取込
- LINE Messaging API — **ReadyGo Bot 経由で配信**（ReadyGo 側スプレッドシートの `Inbox` シート越し）
- HtmlService — Web アプリ UI

---

## プロジェクト構成

```
apps/gas/
├── src/
│   ├── *.js (21ファイル)       ← サーバーサイド（Config, Utils, 各Service, Main 等）
│   ├── *.html (9ファイル)      ← 画面テンプレート
│   └── appsscript.json         ← GAS マニフェスト
├── .clasp.json                 ← clasp 設定（scriptId, rootDir）。gitignore対象
├── .clasp.json.example         ← 上記のひな形
├── .claspignore                ← clasp 無視設定（最小構成）
├── .gitignore                  ← このディレクトリ固有の除外設定
├── push.bat                    ← ローカル → GAS 同期
├── deploy.bat                  ← push + Web アプリ新バージョンデプロイ。gitignore対象
├── deploy.bat.example          ← 上記のひな形
├── SETUP_GUIDE.md              ← セットアップ・運用ガイド
├── StockHome_仕様書.md         ← 仕様書
└── CLAUDE.md                   ← 本ファイル
```

### スプレッドシートのシート構成

| シート名 | 役割 |
|---|---|
| `users` | ユーザー情報（ユーザー名、メール、LINE 送信先 ID 等） |
| `items` | 消耗品マスタ |
| `purchase_log` | 購入履歴（追記型） |
| `stock_snapshot` | 日次バッチで計算される在庫スナップショット |
| `item_runtime_state` | 品目ごとの運用状態（スヌーズ、手動補正値等） |
| `notification_log` | 通知履歴 |
| `import_order_candidates` | Gmail 取込候補（未確定） |
| `stock_correction_log` | 在庫補正履歴 |
| `app_config` | アプリ設定（検索クエリ等） |

---

## スクリプトプロパティ

| キー名 | 説明 |
|---|---|
| `SPREADSHEET_ID` | Google スプレッドシートの ID |
| `WEBAPP_BASE_URL` | デプロイされた Web アプリの URL（通知文面のリンク等で使用） |
| `READYGO_SPREADSHEET_ID` | ReadyGo Bot 側スプレッドシートの ID（在庫アラート配信用） |

---

## 過去の反省（同じ失敗を繰り返さないために）

### R-1. 「定番の対処」を鵜呑みにしない

GAS Web アプリの画面遷移が真っ白になる問題で、`<base target="_top">` を追加する定番策を出したが、**href 未指定だと iframe URL 基準で相対解決される**副作用を見落として 1 回無駄なデプロイを挟んだ。

**教訓**: 広く知られた対処でも、**具体的な挙動（href がどこ基準で解決されるか等）まで自分でシミュレートしてから提案する**こと。

### R-2. 設定ファイルは最小から始める

`.claspignore` に「安全寄り」のつもりで `**/**` + `!src/**` を書いたところ、`rootDir: src` と組み合わさって **全ファイルを ignore** した。clasp は「Script is already up to date」と出すだけで、気づかないまま空プロジェクトを push していた。

**教訓**: 設定ファイルは **空または最小構成から始めて、必要になったものだけ追加する**。rootDir 指定時の `.claspignore` はほぼ不要。

### R-3. 診断は「一発で原因が特定できる情報」を最初に聞く

画面が白くなる問題で、キャッシュ → 再デプロイ → GAS 側の内容確認…と順に潰していったが、最初に「**リンククリック後のブラウザアドレスバーの URL は?**」と聞いていれば `googleusercontent.com/userCodeAppPanel?page=...` から即座に iframe 相対解決の問題と特定できた。

**教訓**: 症状を聞いたら、**原因を 1 発で切り分けられる診断情報を真っ先に取りに行く**。順番に潰していく切り分けはラウンドトリップを増やす。

### R-4. バッチファイルの文字コード

Windows cmd でバッチ内に日本語を含めると、エンコーディング次第で parse 失敗して **即閉じ** になる。ファイル冒頭に `chcp 65001 >nul` を入れ、エラーメッセージは可能なら ASCII にする。`goto :end` で **必ず最後の `pause` に到達する構造** にすると、エラー時に原因が読める。
