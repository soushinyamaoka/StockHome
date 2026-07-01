# GAS版との差分調査メモ

調査日: 2026-06-12

## 対応状況（2026-06-12 反映）

| # | 項目 | 対応 |
|---|------|------|
| 1 | Gmail取込設定がアプリ内にない | **設計どおり委譲**（trigger/Gmail権限はGASのみ可）。設定画面のGAS外部リンクを正式仕様として明文化。配送バッファ日数はアプリ内で編集可能 |
| 2 | 家族ユーザーの登録・更新がない | **対応**: `POST/PATCH /api/users`（admin限定）＋ 家族管理画面（追加・ロール変更・有効/無効）を追加 |
| 3 | 候補から「新規品目として登録」 | **対応済み**: 候補カードに導線追加、品名を引き継いで登録フォームへ |
| 4 | 自動確定済み候補の反映表示が弱い | **対応**: 確定/自動確定候補に reflection（紐付け品目・登録数量・在庫反映済/待ち・有効期日）を表示 |
| 5 | ReadyGo通知の情報欠落 | **一部対応・要判断**: 「テンプレート破損」は誤検出（現行コードは正しく展開）。URLは旧GAS stocksページがスプレッドシート参照で**現在は古いデータを表示するため意図的に再掲しない**。アプリ誘導の文言に統一。ディープリンクは標準ビルド移行時に追加可 |
| 6 | ホームのアラート件数 | **対応**: 上位5件表示＋総件数（`alertTotal`）＋「ほかN件」リンクでGAS版同等に |
| 7 | ローカルAPIポート不整合 | **対応**: `client.ts` の `API_PORT` を 4001→4002 に修正 |

以下は当初の調査内容（経緯の記録）。

---


対象:
- GAS版: GAS プロジェクト（別リポジトリ `StockHome`）
- React/スマホ版: 本リポジトリ（このドキュメントを含むリポジトリ）

## 概要

GAS版の `StockHome_仕様書.md` と主要サービス、React/スマホ版の API・mobile・shared を比較した。

在庫計算、手動購入登録、在庫補正、スヌーズ、Gmail候補の基本取込、ReadyGo連携キュー化は概ね移植済み。
一方で、GAS版の画面・運用機能の一部はスマホアプリ内に未移植、または仕様が変わっている。

## 不足・差分一覧

### 1. Gmail 自動取込設定がスマホアプリ内にない

GAS版では Gmail 設定画面で以下を操作できる。

- Gmail 自動取込の有効化 / 無効化
- 自分用 installable trigger の有無確認
- 最終取込日時の確認
- Amazon / マツキヨの Gmail 検索クエリ編集
- Gmail 取込の今すぐ実行

GAS側根拠:
- `C:\work\PRG\GAS\StockHome\src\HtmlGmailSettings.html`
- `C:\work\PRG\GAS\StockHome\src\TriggerService.js`
- `C:\work\PRG\GAS\StockHome\src\WebController.js`

スマホ版の状態:
- アプリ設定画面には GAS の Gmail 設定ページを開く外部リンクのみ。
- trigger 管理や検索条件編集はスマホアプリ内 API/UI としては未実装。

React側該当:
- `apps/mobile/src/screens/settings/SettingsScreen.tsx`
- `apps/mobile/app.json` の `extra.gmailSettingsUrl`

補足:
現行リプレース設計では Gmail 権限と個人 trigger は GAS 側に残す方針なので、完全未実装というより「外部GAS画面へ委譲」されている。ただし「スマホアプリ版へのリプレース」として見るなら、GAS版の画面機能はアプリ内に統合されていない。

優先度: 中から高

### 2. 家族ユーザーの登録・更新機能がない

GAS版では設定画面からユーザー登録・更新ができる。

- ユーザー名
- email
- role
- `existing_bot_target_id`
- current_user_id の User Properties 保存

GAS側根拠:
- `C:\work\PRG\GAS\StockHome\src\UserService.js`
- `C:\work\PRG\GAS\StockHome\src\HtmlGmailSettings.html`

スマホ版の状態:
- 家族メンバー一覧表示のみ。
- API は `GET /api/users` のみ。
- 既存 household に家族メンバーを追加・編集・無効化する API/UI がない。
- `/api/auth/register` は新しい household を作成して admin として登録する仕様。

React側該当:
- `apps/api/src/routes/users.ts`
- `apps/api/src/routes/auth.ts`
- `apps/mobile/src/screens/settings/SettingsScreen.tsx`

影響:
- GAS版の「家族複数人で使う」「家族ユーザーを管理する」運用に対して、スマホ版は移行済みユーザーの閲覧中心になっている。
- 新しい家族メンバー追加や既存メンバー情報更新が運用しにくい。

優先度: 高

### 3. Gmail候補から「新規品目として登録」ができない

GAS版の候補画面には、候補の商品名を品目登録画面に渡して新規品目として登録する導線がある。

GAS側根拠:
- `C:\work\PRG\GAS\StockHome\src\HtmlImportCandidates.html`
- `C:\work\PRG\GAS\StockHome\src\Main.js`
- `prefillName` パラメータ

スマホ版の状態:
- 候補画面は既存品目への紐付け、確定、無視が中心。
- 候補の商品名を使って品目登録フォームを開く導線がない。

React側該当:
- `apps/mobile/src/screens/candidates/CandidateListScreen.tsx`
- `apps/mobile/src/screens/items/ItemFormScreen.tsx`

影響:
- Gmailで初めて検出された商品をその場でマスタ化しにくい。
- 候補処理の流れがGAS版より分断される。

優先度: 中

### 4. 自動確定済み候補の確認表示が弱い

GAS版は自動確定済み候補を別セクションで表示し、以下を確認できる。

- 紐付先品目
- 紐付先が削除済みかどうか
- 登録数量
- 在庫反映済み / 反映待ち
- `inventory_effective_at`
- `counted_in_inventory`

GAS側根拠:
- `C:\work\PRG\GAS\StockHome\src\WebController.js`
- `C:\work\PRG\GAS\StockHome\src\HtmlImportCandidates.html`
- `GmailImportService.getAutoConfirmedCandidates`

スマホ版の状態:
- `includeResolved` をONにすれば解決済み候補も一覧には出せる。
- ただし自動確定済み専用の確認表示、反映待ち/反映済み表示、登録数量表示はない。

React側該当:
- `apps/mobile/src/screens/candidates/CandidateListScreen.tsx`
- `apps/api/src/routes/importCandidates.ts`
- `apps/api/src/services/candidateIntake.ts`

影響:
- 自動確定された候補が実際に購入履歴・在庫へどう反映されたか追いにくい。
- 配送バッファにより在庫反映待ちになっている場合の見通しが悪い。

優先度: 中

### 5. ReadyGo 通知本文の情報がGAS版より落ちている

GAS版の ReadyGo 投入メッセージは、在庫予測画面へのURLを含む。

GAS側根拠:
- `C:\work\PRG\GAS\StockHome\src\NotificationService.js`
- `buildBroadcastMessage_`
- `getWebAppBaseUrl() + '?page=stocks'`

スマホ版の状態:
- API側バッチは「StockHomeアプリの在庫予測で確認」という文言のみ。
- URLまたは deep link は含まない。

React側該当:
- `apps/api/src/services/batch.ts`

追加で見つかった問題:
- `buildItemSummaryLine` のテンプレート文字列が壊れており、`${daysLeft}` や `${remainStr}` の値ではなく `{daysLeft}` 風の文字列が通知される可能性がある。

影響:
- LINE/ReadyGo通知から在庫画面へ直接移動できない。
- 通知文の残日数・残量が正しく表示されない可能性がある。

優先度: 高

### 6. ホーム画面アラート件数の仕様が違う

GAS版ホームは在庫アラートを上位5件に絞る。

GAS側根拠:
- `C:\work\PRG\GAS\StockHome\src\WebController.js`
- `visibleAlerts.slice(0, 5)`

スマホ版の状態:
- `/api/dashboard` は条件に合うアラートを全件返す。
- `DashboardScreen` も `alerts.map` で全件表示する。

React側該当:
- `apps/api/src/routes/dashboard.ts`
- `apps/mobile/src/screens/DashboardScreen.tsx`

影響:
- 品目数が増えたとき、ホーム画面がGAS版より長くなる。
- これは不足というより仕様変更だが、GAS版同等を期待するなら差分。

優先度: 低から中

### 7. ローカルAPIポートが仕様とズレている

GAS版との差分ではないが、移行版として明確な不整合。

React/API側:
- API既定ポートは `4002`
- README、Docker、起動スクリプトも `4002` 前提
- しかし mobile の自動解決だけ `4001`

React側該当:
- `apps/api/src/server.ts`
- `apps/mobile/src/api/client.ts`
- `README.md`
- `scripts/app.ps1`

影響:
- `EXPO_PUBLIC_API_TARGET=local` 時に、モバイルアプリがローカルAPIへ接続できない可能性が高い。

優先度: 高

## 優先対応案

1. `apps/mobile/src/api/client.ts` のローカルAPIポートを `4002` に修正する。
2. `apps/api/src/services/batch.ts` の ReadyGo 通知文テンプレートを修正する。
3. Gmail候補画面に「新規品目として登録」導線を追加する。
4. 自動確定済み候補の反映状況を表示する API/UI を追加する。
5. 家族ユーザーの追加・編集・無効化 API/UI を追加する。
6. Gmail設定をスマホアプリ内へ取り込むか、GAS画面委譲を正式仕様として明文化する。
7. ホーム画面アラート件数をGAS版同様に5件へ戻すか、スマホ版仕様として全件表示を明文化する。

## 備考

React/スマホ版では、Gmail取込とReadyGo投入の一部がGAS側に残る設計になっている。
そのため、Gmail trigger 管理は必ずしもAPI側に完全移植すべきとは限らない。
ただしユーザー体験としては、スマホアプリから状態確認・有効化・今すぐ実行ができる方がGAS版に近い。
