# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20260919-STOCKHOME-011

app: stockhome

source_branch: main

source_commit: 611dbcf34ef309e4da55823ab5a490ec1723fe91

production_baseline_commit: ec6e541b8bf88654baa68c3dd3b1c2fcbdb9d6ad

release_commits:（baseline以降、実際のcommit時系列順）

- `ec6e541`（baseline。notice `20260918-STOCKHOME-009`でproduction反映・`verified`済み）
- `2529199`/`813032b`/`e46723c`/`3e4be99`（notice 009・client release記録のdocs更新。`ops/**`のみでbuild inputに影響しない）
- `0a6e781`（task `20260918-003`、品目検索・絞り込み。apps/mobileのみ、notice不要と判定済み）
- `c2b6fa9`/`f45db49`/`fdf42a0`/`a2376bb`（CI設定新設・修正4件。production runtimeに影響しない）
- `12ac1a5`（`ops/runtime-contract.yaml`のみ、C-2バックアップ方針記録）
- `ad432fb`（20:38:52。task `20260919-006`初版、所見A-1/A-3/B-5対応。**本notice対象**）
- `084d1d1`（20:56:36。scripts/deploy.ps1・docker-compose.prod.ymlのみ、C-5ロールバック機構。**本noticeの対象外**、別notice`20260919-STOCKHOME-010`で扱う）
- `a9200ee`（21:14:40。notice 010・011の新規作成。`ops/**`のみ）
- `280b101`（21:16:57。commit`12ac1a5`へのVPS管理レビュー訂正2点反映。`ops/runtime-contract.yaml`のみ）
- `611dbcf`（21:52:24。**本notice source**。VPS管理レビューblocker対応3点。
  `apps/api/src/services/pushNotify.ts`・`pushNotify.payload.test.ts`（新規）・
  `apps/mobile/src/hooks/useAuth.tsx`・`apps/mobile/src/lib/push.ts`・
  `apps/mobile/src/navigation/index.tsx`・`apps/mobile/src/navigation/navigationRef.ts`・
  `apps/mobile/src/screens/stocks/StockListScreen.tsx`）

**前回提出時（source_commit `ad432fb`）の記載で、`084d1d1`と`ad432fb`の時系列を
逆に記載していた誤りをここで訂正した（実際は`ad432fb`が先、`084d1d1`が後）。**

**本noticeが対象とするのは`ad432fb`→`611dbcf`の一連の変更（mobile UI・push
payload・今回の修正）。`084d1d1`（deploy/rollback機構、C-5）は内容的に無関係な
別変更のため、別notice（`20260919-STOCKHOME-010`）のまま分離する。**

impact_level: L2

status: ready_for_review

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 変更概要

2026-09-03の全体点検所見のうち3件への対応（task `20260919-006`、Codexが実装）に、
2026-09-19のVPS管理レビューで指摘されたblocker3点への修正を加えたもの。

**初版（`ad432fb`）の内容:**

- **A-1**（優先度「高」）: API障害・オフライン・トークン失効時、mobileが空データを
  「◎ 在庫はみんな足りています」と誤表示していた。共通`ErrorState`コンポーネントを
  新設し、ホーム・在庫一覧・品目一覧の3画面で通信失敗時に「読み込めませんでした」＋
  再試行を表示するようにした。
- **A-3**（優先度「高」）: JWTは7日固定で更新機構が無く、失効後は全画面が401になり
  A-1と重なって「空データ」に見えていた。mobile側に、Authorizationヘッダ付き
  リクエストが401を受けた場合のみトークンを破棄しログイン画面へ戻す仕組みを
  追加した。**JWT有効期限（7日）自体は変更していない**（`apps/api/src/plugins/auth.ts`
  に差分なし）。
- **B-5**（優先度「中」）: プッシュ通知はタップしてもアプリが開くだけで、該当品目へ
  遷移していなかった。APIのExpo Push送信payloadへ`data`フィールドを追加し、
  単一品目のアラートのときのみ`itemId`を含める。

**今回の修正（`611dbcf`、VPS管理レビューblocker対応3点）:**

1. **navigation準備前に通知情報を消去しない**: `useLastNotificationResponse`の
   処理が、`NavigationContainer`がまだmountされていない（`navigationRef.isReady()`
   がfalseの）状態でも無条件に`clearLastNotificationResponse()`を呼んでおり、
   遷移できないまま通知情報が失われ、以後二度と該当品目へ遷移できなくなる不具合が
   あった。`navigationRef.ts`に`onNavigationReady`/`notifyNavigationReady`を追加し、
   `NavigationContainer`の`onReady`から発火するようにした。`useAuth.tsx`は
   navigation準備完了（`navReady`）を待ってから処理し、`navigateToStockItem`が
   実際に遷移できた場合（返り値`true`）だけ`clearLastNotificationResponse()`を
   呼ぶよう修正した。
2. **品目へのスクロール失敗時に再試行する**: `StockListScreen`の
   `onScrollToIndexFailed`が空実装（何もしない）だった。FlatListの仮想化により
   対象indexがまだ計測されていないと`scrollToIndex`が失敗することがあるため、
   `scrollToOffset`で近似位置へ移動してから`scrollToIndex`を再試行する実装へ
   変更した（`highlightItemId`変更時にリトライ状態をリセット、1回のみ再試行して
   無限ループを防止）。
3. **単一／複数品目のPush payloadテストを追加**: `pushNotify.payload.test.ts`を
   新規作成し、`sendPushToUser`がExpo Push payloadへ単一品目時のみ`data.itemId`を
   含め、複数品目時は含めないことをDB依存テストで検証した
   （`global.fetch`をstubし外部送信はしない）。**このテストの実装過程で、
   `pushNotify.ts`の`sendPushToUser`内でパラメータ名`data`とExpo APIレスポンス
   処理用のローカル変数`data`が同名衝突し、TDZ（Temporal Dead Zone）による
   `ReferenceError`でランタイムクラッシュする既存バグを発見した**
   （`group.map((device) => ({ ... ...(data ? { data } : {}) }))`という参照が、
   同じブロック内で後から宣言される`const data = (sent.body as {...})?.data`に
   よってshadowされ、TDZエラーになっていた）。型チェック・ビルドでは検出できない
   実行時エラーで、本テスト追加により初めて発覚したため、ローカル変数を`tickets`
   へリネームして修正した。この関数は`daily_batch`から呼ばれるため、
   **修正前のコードのままproduction反映されていた場合、夜間バッチの通知送信処理が
   例外で失敗していた可能性が高い**（本notice提出時点でproduction未反映のため
   実害はない）。

## 変更理由

2026-09-03の全体点検所見への対応（優先度「高」2件・「中」1件）に加え、
2026-09-19のVPS管理レビューでのblocker指摘への対応。詳細は
`stockhome-review-findings-20260903.md`（点検報告書）を参照。

## server_impact判定

server_impact: notify

判定理由: APIのExpo Push payloadに`data`フィールドを追加し、夜間batch
（`daily_batch`）が生成する通知内容が変わるため、本番deploy前にVPS運用側への
変更通知・確認が必要と判断した。加えて今回、`sendPushToUser`内の変数名衝突による
ランタイムクラッシュを修正しており、これは夜間batchの通知送信処理の信頼性に
直接関わる修正である。port、bind、domain、health endpoint、起動command、
systemd/Docker、env変数名、DB schema/migration、volume、cron/timer、ログ形式の
変更はないことを確認した。

## 現在と変更後

| 項目 | 現在 | 変更後 |
|---|---|---|
| API障害時のmobile表示 | `isError`を一切見ておらず、通信失敗時も「◎ 在庫はみんな足りています」等に見える（ホーム・在庫一覧・品目一覧） | `isError`のときは共通`ErrorState`（「読み込めませんでした」＋再試行）を表示 |
| 401受信時のmobile動作 | 何もしない | Authorizationヘッダ付きリクエストが401を受けたときのみトークンを破棄しログイン画面へ自動遷移 |
| Expo Push送信payload | `title`・`body`のみ | 単一品目アラートのときのみ`data: { itemId }`を追加。複数品目時は`data`を付けない |
| 通知タップ時のmobile動作 | アプリが開くだけ | `itemId`があれば在庫一覧の該当品目へスクロール、無ければ在庫一覧を開く。**navigation未準備時は通知情報を保持し、準備完了後に遷移する**（今回修正） |
| スクロール失敗時の挙動 | 何もしない（対象が表示されないまま） | 近似位置へ移動してから1回再試行する（今回修正） |
| `sendPushToUser`の`data`引数付き呼び出し | **TDZエラーでランタイムクラッシュ（既存バグ、今回発見）** | 正常動作（ローカル変数名を`tickets`へ変更） |

## 影響対象

- service/container: `stockhome-api-prod`（`apps/api/src/services/pushNotify.ts`の変更。route追加・削除は無し）
- URL/port/health: 変更なし
- cron/timer/worker: 変更なし（`daily_batch`のスケジュール・実行条件は無変更。送信payloadの中身と、送信処理自体のバグ修正）
- dependency: 変更なし
- data/DB/volume: 変更なし（schema/migration無し）
- log/monitoring: 変更なし

## production変更

- 必要性: あり
- 想定作業: 通常のAPI deploy（`npm run deploy`）でmobile/API両方のソースが反映される（mobileはこのソース変更だけでは配信されず、別途EAS Update等のclient配信が必要）
- downtime: 既存と同じ（brief-restart、`api`コンテナのみ再ビルド・入れ替え）
- maintenance window: 不要

`production_change: required`のため、`deployment_status: not_started`のままVPS管理側へ引き継ぐ。

## 利用者への影響

- user_maintenance_impact: none
- 対象利用者・機能: 全利用者（家庭内メンバー全員）。エラー表示・自動ログアウト・通知タップ遷移という体験改善のみで、既存機能の後退はない
- 通知方法: 不要

## env・secret contract

- 変更: なし

secret値は記載していない。

## Data・migration・backup

- schema/format変更: なし
- migration: なし
- backup対象: なし
- restore確認: 該当なし
- backward compatibility: あり

## Deploy・rollback

- deploy前提: 通常の`npm run deploy`で反映可能。mobile側の変更はEAS Update等の別途client配信が必要
- deploy手順の変更: なし（deploy手順自体の変更は別notice`20260919-STOCKHOME-010`で扱う）
- rollback方法: 旧image tagへの切り替え（従来手順）
- rollback不能条件: 特になし（DBデータを変更しないため、image rollbackのみで完全に戻せる）

## Health・テスト

- health contract変更: なし
- 実施テスト:
  - `npm run build --workspace=@stockhome/shared`: passed
  - `npm run build --workspace=@stockhome/api`: passed
  - `npx tsc --noEmit -p apps/mobile/tsconfig.json`: passed
  - `npm test --workspace=@stockhome/api`（ローカルPostgres）: **123件すべて成功**
    （既存121件＋新規`pushNotify.payload.test.ts`2件。新規2件は単一／複数品目時の
    Expo Push payload `data`フィールドの有無を検証）
  - 差分自己点検: `packages/shared`・`apps/gas`・`prisma/schema.prisma`・
    `apps/api/src/plugins/auth.ts`・`apps/mobile/App.tsx`・`apps/mobile/package.json`に
    本修正による差分が無いことを確認
- 結果: すべて成功
- 未実施テストと理由: mobile UIの実機確認（navigation準備タイミングの実機での
  再現含む）はclient配信後にapp ownerが行う想定（既存の運用と同様）。navigation
  未準備時の挙動はロジックレベルでは修正済みだが、実機でのタイミング依存の
  再現テストは自動化していない。

## Log・監視

- log量/形式/保存先変更: なし
- 新しいalert条件: なし
- secret/個人情報対策: 変更なし

## 提出前セルフチェック

正本: `C:\work\PRG\Sakura\Dev\vps-server-management\docs\templates\server_change_notice_pre_submission_checklist.md`

- [x] production baselineとrelease全commit・build入力差分を確認した（baseline`ec6e541`から`611dbcf`までの全commitを実際の時系列順で確認。上記release_commits参照。前回の時系列誤りを訂正済み）
- [x] source commitとnoticeをremoteの対象branchへpushした（`611dbcf`はpush済み。本notice fileはこれからcommit・pushする）
- [ ] data更新のtransaction・同時実行・途中失敗・再実行を確認した — 該当なし（DBデータ更新を伴わない変更のため）
- [x] image rollbackとdata rollback、backup/restore条件を分けた
- [x] job/log/retention、runtime/dependency、client配信の該当有無を確認した
- [ ] app owner、VPS review、production承認、client配信承認を分離した — いずれも未実施。下記Approval参照
- [x] secret非混入とtracked working tree cleanを確認した

未確認・該当なしの理由: 「data更新のtransaction」項目はDBデータを一切扱わない変更のため該当なし。app owner・VPS review・production承認はいずれも本notice提出時点で未実施のまま記録する。

## 未解決事項

- mobile側UIの実機確認（client配信後、app owner）は未実施。
- navigation未準備タイミングの実機再現テストは自動化していない（ロジックは修正・単体確認済み）。
- JWT有効期限延長（所見A-2と同じ後続task）は本notice・本taskの対象外。

## 希望時期

特に指定なし。

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: これから実施
- VPS管理チャットへ渡すローカル絶対path: `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260919-STOCKHOME-011-summary.md`

## Approval

- app owner: 未実施
- VPS management review: 1回目blocked（2026-09-19、blocker4点。うちコード修正3点は`611dbcf`で対応、commit順序記載誤り1点は本改訂で訂正）
- production approval: 未実施
- related task_id: 20260919-006
