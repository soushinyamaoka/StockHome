# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20260918-STOCKHOME-009

app: stockhome

source_branch: main

source_commit: ec6e541b8bf88654baa68c3dd3b1c2fcbdb9d6ad

production_baseline_commit: 038e173199ad8daee3ed3fd268673c8642976eb7

release_commits: `038e173`（baseline。notice `20260915-STOCKHOME-007`/`008`のtask
`20260915-002`でproduction反映・`verified`済み）→ `71e375f`/`a1ea7e7`/`f59ec47`/`8116d6e`
（notice `007`/`008`のVPS再レビュー同期・client release計画作成・クローズ処理4件。
いずれも`ops/**`のみでbuild inputに影響しない）→ `7c1c347`（task `20260918-001`、
購入履歴編集機能の初版実装、2026-09-18。**build inputに影響**）→ `0671c62`（本notice・
client release計画の初版作成。`ops/**`のみ）→ `e903e81`（VPS管理初回レビューblocker
対応。`DELETE /purchases/:id`のlock順序をPATCHへ統一、2026-09-18 22:13 JST。
**build inputに影響**。**このcommitを作成したai-watch task_idを誤って
`20260919-001`（翌日日付）と命名したが、実際の作業日はcommitタイムスタンプの
とおり2026-09-18**）→ `ce977f0`（本notice・client release計画をe903e81へ同期。
`ops/**`のみ）→ `ec6e541`（VPS管理再レビューblocker対応。`unconfirmImportCandidate`
（notice`008`由来）のlock順序を`PATCH`/`DELETE`と統一、2026-09-18 22:34 JST。
task_idは正しく`20260918-002`。**本notice対象の最終source。build inputに影響**）。

impact_level: L3

status: ready_for_review

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 変更概要

2026-09-03の全体点検所見B-4（優先度「中」）「購入履歴を直せない（削除して入れ直すしか
ない）」への対応。購入履歴の**数量・単価・備考**を編集する`PATCH /api/purchases/:id`を
新設した。

- 編集できるのは`qty`（数量）・`price`（単価）・`note`（備考）の3項目のみ。
  `purchasedAt`（購入日）・`itemId`（品目）・`source`（購入元）等は編集対象外
  （変更が必要な場合は従来どおり削除→再登録する）。
- 数量を変更した場合、その購入が`counted_in_inventory`済みなら、既存の買い足し積み上げ
  補正値（`item_runtime_states.manual_override_qty`）を**差分（新数量−旧数量）だけ**
  加減算する新規関数`adjustAccumulatedPurchaseQty`を追加した。`manual_override_at`
  （消費の起算日時）は更新しない（訂正であって新しい買い足しではないため）。
- 既存の取消用関数`reverseAccumulatedPurchase`（notice `20260904-STOCKHOME-005`で導入）は、
  本体を`adjustAccumulatedPurchaseQty(tx, itemId, -qty)`への委譲に整理した。
  **シグネチャ・コメント・外部から見た挙動は変更していない**。
- household境界での絞り込み、品目行ロック（既存`lockItemForAccumulation`再利用）・
  購入行の再取得・積み上げ調整・購入行更新・snapshot再計算を単一transactionで行う設計
  （notice `20260915-STOCKHOME-008`のS008-B02/B03対応で確立したパターンを踏襲）。

mobile側は、購入履歴画面の各行に編集ボタンを追加し、既存の購入登録フォーム
（`PurchaseFormScreen`）へ編集モードを持たせた（`ItemFormScreen`の新規/編集切替と
同じ方式）。編集モードでは品目・購入日・購入元を読み取り専用表示にする。

`prisma/schema.prisma`・`apps/gas`の変更はない。設計はClaude、実装はCodex
（ai-watch経由、task `20260918-001`）が行い、Claudeがコードレビューと
DB依存テスト（新規11件＋既存16件の回帰確認、計27件）の実行確認を行った。

**lock順序修正・1回目（VPS管理初回レビュー、2026-09-18、commit `e903e81`）**: 初版の
`DELETE /purchases/:id`（既存route、本機能追加前から存在）は、購入行の情報を
transaction開始前・ノーロックで読み取り、transaction内では購入行削除→品目行ロックの
順で処理していた。一方、新設した`PATCH`は品目行ロック→購入行の順。この**lock順序の
不一致**により、同一購入への同時`PATCH`・`DELETE`が循環待機（deadlock）を起こしうること、
また`DELETE`がtransaction開始前の**古い数量**で積み上げ補正を行いうることをVPS管理側が
指摘した。`DELETE`を`PATCH`と同じ順序（品目行ロック→購入行再取得→削除→積み上げ調整→
snapshot再計算、すべて単一transaction）へ揃え、`reverseAccumulatedPurchase`の呼び出しを
`adjustAccumulatedPurchaseQty`（ロックしない版）へ統一した。

**lock順序修正・2回目（VPS管理再レビュー、2026-09-18、commit `ec6e541`）**: 1回目の
修正後もなお、notice `20260915-STOCKHOME-008`由来の`unconfirmImportCandidate`
（候補確定の取り消し、`apps/api/src/services/candidateIntake.ts`）が、`purchases.ts`の
`PATCH`/`DELETE`と異なる順序（購入行削除→品目行ロック）のままであることをVPS管理側が
指摘した。確定済み候補に紐づく購入は`PATCH`/`DELETE /purchases/:id`からも操作できる
ため、同一購入への同時`unconfirm`と`PATCH`（または`DELETE`）が1回目と同種のdeadlock・
補正不整合を起こしうる状態だった。`unconfirmImportCandidate`も品目行ロック→購入行
再取得の順へ揃え、`reverseAccumulatedPurchase`の呼び出しを`adjustAccumulatedPurchaseQty`
へ統一した。詳細は下記「現在と変更後」表・「Health・テスト」参照。

## 変更理由

ユーザーから、2026-09-03の全体点検所見のうち4件（通知先フィルタ・取り消せない操作・
購入履歴編集・品目検索絞り込み）への対応を依頼された（2026-09-15）。本noticeはそのうち
「購入履歴編集」1件分。数量・単価の打ち間違いを直す手段が削除のみだったため、
訂正のハードルを下げる。

## server_impact判定

server_impact: approval_required

判定理由: DBスキーマ変更・migration・新規env var・新規外部依存・新規cron・
port/bind/URL変更・認証境界の変更はいずれも無い。一方、新規`PATCH`は既存の
`purchase_log`行を**書き換え**、`item_runtime_states.manual_override_qty`という
永続データも**書き換える**新しい書き込み経路である。notice `20260915-STOCKHOME-008`
（取り消し・復元機能）が同様の理由でL3・`approval_required`と判定されたのと同じ理由で、
本noticeもL3・`approval_required`とする。新規write系APIエンドポイントの追加でもある。

## 現在と変更後

| 項目 | 現在 | 変更後 |
|---|---|---|
| 購入履歴の数量・単価・備考の訂正 | 手段なし（削除して再登録するしかない） | `PATCH /api/purchases/:id`で編集可能 |
| 購入履歴の`purchasedAt`・`itemId`・`source`等 | 変更手段なし | 変更手段なし（本notice後も変わらず対象外） |
| 積み上げ補正値の調整経路 | 購入登録（加算・起算日更新）・購入取消（減算のみ、起算日は更新しない）の2経路 | 上記2経路に加え、購入編集による**差分**加減算（起算日は更新しない）が追加される |
| `reverseAccumulatedPurchase`の内部実装 | 直接`manual_override_qty`を減算 | `adjustAccumulatedPurchaseQty(tx, itemId, -qty)`へ委譲（外部から見た挙動は不変） |
| mobile: 購入履歴画面の各行 | 削除ボタンのみ | 編集ボタン（鉛筆アイコン）を追加 |
| mobile: 購入登録フォーム（`PurchaseFormScreen`） | 新規登録専用 | `purchaseId`パラメータで編集モードに切替。品目・購入日・購入元は読み取り専用表示 |
| `DELETE /purchases/:id`のlock順序（VPS指摘1回目対応） | transaction開始前・ノーロックで購入情報を読み取り、購入行削除→品目行ロックの順（`PATCH`と逆順） | `PATCH`と同じ品目行ロック→購入行再取得→削除→積み上げ調整→snapshot再計算を単一transactionで実行。`reverseAccumulatedPurchase`呼び出しを`adjustAccumulatedPurchaseQty`へ統一 |
| `unconfirmImportCandidate`のlock順序（VPS指摘2回目対応） | 候補行ロック後、購入行削除→品目行ロックの順（`PATCH`/`DELETE`と逆順） | 候補行ロック後、紐づく購入があれば品目行ロック→購入行再取得→削除→積み上げ調整→snapshot再計算の順。`PATCH`/`DELETE`と同じ順序に統一 |

## 影響対象

- service/container: `stockhome-api-prod`（新規route1件追加。既存route・起動構成は変更しない）
- URL/port/health/bind: 変更なし
- cron/timer/worker: 変更なし（夜間バッチのロジックには触れていない）
- dependency: 追加・削除なし
- data/DB/volume: スキーマ変更なし。`purchase_log`（`qty`/`price`/`note`列）と
  `item_runtime_states.manual_override_qty`への新しい書き込み経路が増える
  （新規テーブルは無い）
- log/monitoring: 新規ログeventの追加なし。既存の`job_start`/`job_end`等バッチログには
  影響しない（本変更は同期的なユーザー操作APIであり、バッチ処理には関与しない）

## production変更

- 必要性: あり（コンテナ再ビルド・入れ替えのみ。migration不要）
- 想定作業: 既存の`scripts/deploy.ps1`（`npm run deploy`）による通常のcontainer rebuild・入れ替え
- client配信の順序: API先行→別承認でclient配信（新規PATCHは追加のみのAPI変更のため
  旧clientは影響を受けない。新しい編集ボタンは新APIが無いと404エラーになるため、
  client配信はAPI反映`verified`後に限る。client release計画は別途作成する）
- downtime: brief-restart（apiコンテナのみ再起動。postgresコンテナ・DBデータは変更しない）
- maintenance window: 未定。VPS管理側レビュー後に判断

`production_change: required`のため、`deployment_status: not_started`のままVPS管理側へ引き継ぐ。

## 利用者への影響

- user_maintenance_impact: possible
- 対象利用者・機能: 購入履歴を編集する利用者全員（誤入力の訂正手段が増えるため、
  基本的には利用者に有利な変更）
- 機能面: デプロイ後、購入履歴の各行から数量・単価・備考を編集できるようになる。
  品目・購入日・購入元は引き続き編集できない（削除して登録し直す必要がある）
- 注意点: counted済みの購入で数量を訂正すると、その分だけ積み上げ補正値が増減する。
  これは新しい買い足しではなく訂正として扱われるため、消費の起算日（`manual_override_at`）
  は変わらない。`adjustAccumulatedPurchaseQty`はnotice `20260904-STOCKHOME-005`で
  app owner承認済みの「近似的な調整」（その後の別の積み上げ・補正で上書き済みの場合は
  完全一致しない）という既知の制約を引き継ぐ
- 通知方法: 機能追加であり、利用者（家族）への事前告知は本noticeでは必須としない

## env・secret contract

- 変更: なし
- 変数名・secret種類: 追加・削除・意味変更なし
- provisioning/rotation: 不要

secret値は記載しない。

## Data・migration・backup

- schema/format変更: なし
- migration: なし
- backup対象: 通常のdeploy時運用を超える追加backupは不要と判断する。ただし本changeは
  `purchase_log`行の書き換えを伴う新しい経路であるため、deploy直前の通常dumpに加え、
  deploy直後の初回利用状況（`PATCH`の呼び出し有無）をVPS管理側で把握できるように
  しておくことが望ましい（notice `008`と同じ方針）
- restore確認: 追加のrestore試験は不要（スキーマ変更が無いため、通常のdeploy手順の
  範囲で足りる）
- backward compatibility: 旧API imageへ戻しても、新規エンドポイントが消えるだけで
  既存機能に影響しない。ただし、**`PATCH`によって書き換えられた`purchase_log`の
  `qty`/`price`/`note`や、差分調整された`manual_override_qty`は、image rollbackでは
  元に戻らない**（データの書き換えを伴う操作のため）。これらの補正が必要な場合は
  別のDB変更承認で扱う

## Deploy・rollback

- deploy前提: 本notice`ready_for_review`後、VPS管理側レビュー・production承認
- deploy手順の変更: なし（既存の`scripts/deploy.ps1`をそのまま使う）
- rollback方法: 旧API imageへ戻すことで、以後の新規エンドポイントは404になる。
  ただし編集操作によって**既に書き換えられたデータ**（`purchase_log`の
  `qty`/`price`/`note`、差分調整済みの`manual_override_qty`）はimage rollbackでは
  戻らない。これらの補正が必要な場合は別のDB変更承認で扱う
- rollback不能条件: 編集操作によるデータ書き換えそのものは、image rollbackでは
  取り消せない（上記のとおり）。誤操作が疑われる場合はDB dumpからの個別データ復元、
  または対象品目の在庫補正画面からの手動修正で対応する

## Health・テスト

- health contract変更: なし
- 実施テスト:
  - `npm run build --workspace=@stockhome/shared`: 成功（Codexが実施）
  - `npm run build --workspace=@stockhome/api`: 成功（Codexが実施）
  - `npx tsc --noEmit -p apps/mobile/tsconfig.json`: 成功（Codexが実施）
  - `apps/api/src/services/stockCalc.accumulation.test.ts`（既存16件＋新規3件、計19件）:
    新規3件は`adjustAccumulatedPurchaseQty`の正の差分・負の差分（0未満にならないこと）・
    積み上げ由来でない補正値には影響しないことを検証。既存16件は無変更のまま
    全件成功し、回帰がないことを確認
  - `apps/api/src/routes/purchaseEdit.http.test.ts`（JWT認証込みHTTPレベル境界テスト、
    新規8件）: 他household拒否・404・counted購入の数量増減による補正値の差分調整
    （2件）・counted でない購入では補正値不変・単価/備考のみの変更で補正値不変
    （nullへの変更含む）・購入日/品目/購入元/counted状態が不変であること・
    数量0/負数が400で拒否されDBが変化しないこと
  - 結果: 上記合計**27件すべて成功**（失敗0件）。Claudeが対話セッションで
    ローカル開発用Postgres（`localhost:5434`）に対して実行し確認した（2026-09-18）
- **lock順序修正・1回目の追加テスト（2026-09-18、commit `e903e81`）**:
  `apps/api/src/routes/purchaseEdit.http.test.ts`へ4シナリオを追加（既存8件は無変更）。
  - 削除済み購入への再`DELETE`・`PATCH`が404となりDBを変更しないこと
  - **編集後に削除すると、削除時点の数量（編集後の値）で積み上げが差し戻されること**
    （transaction開始前の古い数量を使っていた旧バグを直接再現する回帰test。
    qty=2→5に編集後、削除すると補正値が13→8になる＝5が引かれることを確認。
    旧バグなら編集前の2が引かれ11になっていたはずの箇所）
  - **同一購入への同時`PATCH`×`PATCH`**（`Promise.all`による実並行実行）:
    例外（deadlock）なく両方成功し、最終的な積み上げ補正値の差分が最終数量の
    差分と一致すること（実行順序に依存しない不変条件で検証）
  - **同一購入への同時`PATCH`×`DELETE`**（`Promise.all`による実並行実行）:
    例外（deadlock）なく完了し、実行順序によらず必ず「購入削除・補正値8」という
    同じ最終状態に収束すること
  - 結果: 上記4件を含む`purchaseEdit.http.test.ts`全12件が成功。**deadlockの
    再現性が無いことを確認するため、Claudeが対話セッションで計4回連続実行し、
    いずれも12/12成功**（2026-09-18、ローカル開発用Postgres`localhost:5434`）
- **lock順序修正・2回目の追加テスト（2026-09-18、commit `ec6e541`）**:
  `apps/api/src/routes/purchaseUnconfirmConcurrency.http.test.ts`を新規作成
  （cross-route: `purchaseRoutes`＋`importCandidateRoutes`を同一テストappへ登録）。
  - **同一購入への同時`PATCH`（qty→5）と`POST /import-candidates/:id/unconfirm`**
    （`Promise.all`による実並行実行）: 例外（deadlock）なく両方解決し、`unconfirm`は
    常に200、`PATCH`は200/404いずれか、購入行は必ず削除、候補は`detected`へ戻り
    `matchedItemId`は`null`、積み上げ補正値は実行順序によらず必ず`8`に収束すること
  - 結果: 上記1件を含めて成功。**deadlockの再現性が無いことを確認するため、
    Claudeが対話セッションで計4回連続実行し、いずれも成功**（2026-09-18、
    ローカル開発用Postgres`localhost:5434`）
  - **回帰確認**: `purchaseEdit.http.test.ts`（12件）・`undoActions.http.test.ts`
    （10件）・`candidateIntake.reversal.test.ts`（7件）・
    `stockCalc.accumulation.test.ts`（19件）を合わせた**48件すべて成功**し、
    `unconfirmImportCandidate`の変更による既存機能への回帰が無いことを確認した
    （2026-09-18）
- 未実施テストと理由: `unconfirm`/`restore`等と同様、mobile UIの実機（Expo Go/
  内部配布APK）での見た目・操作確認は未実施。client配信の別承認後に実施する

## Log・監視

- log量/形式/保存先変更: なし（本変更は同期的なユーザー操作APIであり、新規ログeventは
  追加していない。既存の`job_start`/`job_end`等バッチ関連ログには影響しない）
- 新しいalert条件: なし
- secret/個人情報対策: 変更なし。新規ログ出力は無い

## 提出前セルフチェック

正本: `C:\work\PRG\Sakura\Dev\vps-server-management\docs\templates\server_change_notice_pre_submission_checklist.md`

- [x] production baselineとrelease全commit・build入力差分を確認した
      （`production_deployments.yaml`のStockHome baseline`038e173`を基準に、
      baseline以降の全9commitをbuild input該当有無で区別した。上記`release_commits`参照）
- [x] source commitとnoticeをremoteの対象branchへpushした（`7c1c347`・`e903e81`・
      `ec6e541`はいずれもCodexが`git push origin main`済み・確認済み。本notice文書の
      改訂commitはこの後に作成する）
- [x] data更新のtransaction・同時実行・途中失敗・再実行を確認した（**VPS管理レビューで
      2回にわたり指摘されたlock順序不一致（1回目: `PATCH`/`DELETE`間、2回目:
      `unconfirmImportCandidate`と`PATCH`/`DELETE`間）を、いずれも品目行ロック→
      購入行再取得の順へ統一して解消した。単一route内の同時実行（`PATCH`×`PATCH`・
      `PATCH`×`DELETE`）に加え、cross-route（`PATCH`×`unconfirm`）の実並行実行testも
      追加し、deadlockが発生しないこと、実行順序によらず最終状態が一致することを
      いずれも複数回の連続実行で確認済み**。上記「Health・テスト」参照）
- [x] image rollbackとdata rollback、backup/restore条件を分けた（上記「Deploy・rollback」
      参照。データの書き換えを伴うためimage rollbackだけでは戻らない点を明記した）
- [x] job/log/retention、runtime/dependency、client配信の該当有無を確認した（job/logは
      該当なし。runtime/dependencyは該当なし。client配信は必要と判定し、別途
      client release計画を作成する）
- [x] app owner、VPS review、production承認、client配信承認を分離した（app owner承認・
      VPS review・production承認・client配信承認はいずれも未実施。下記Approval参照）
- [x] secret非混入とtracked working tree cleanを確認した（`git status`で未追跡file・
      ディレクトリは本notice作成前から存在する無関係な**3件**（`.claude/`〔本アプリ
      リポジトリの`.gitignore`には含まれておらず、環境によっては未追跡として見える〕、
      `ops/investigations/OPS-P1-08-npm-audit-findings.md`、
      `ops/production-db-operations/`）のみで、いずれも本release対象外・本commitには
      含まれていないことを確認した）

未確認・該当なしの理由: app owner承認・VPS management review・production承認・
client配信承認は、本notice提出後にVPS管理チャットへ引き継いで初めて得られるものであり、
本セルフチェック時点では未実施が正しい状態。

## 未解決事項

- mobile UIの実機（Expo Go/内部配布APK）確認は未実施。client配信計画作成後、
  配信・別承認を経てapp ownerが実機で確認する想定

## 希望時期

指定なし。VPS管理側レビューの結果を踏まえて判断する。

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: 本notice作成後にチャットで案内する
- VPS管理チャットへ渡すローカル絶対path:
  `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260918-STOCKHOME-009-summary.md`

## Approval

- app owner: 未実施（本notice記載の利用者影響についての明示承認はこれから）
- VPS management review: 初回2026-09-18実施・`blocked`（`PATCH`/`DELETE`間のlock順序
  不一致によるdeadlock・旧数量での補正不整合の懸念）。commit `e903e81`で`DELETE`の
  lock順序を`PATCH`と統一し、同時実行test 4件（4回連続実行で安定）を追加して解消。
  再レビューも`blocked`継続（`unconfirmImportCandidate`が同じ問題を残していた点、
  記録の日付・task_id誤り、未追跡file件数の記載誤りを指摘）。commit `ec6e541`で
  `unconfirmImportCandidate`のlock順序を統一し、cross-route同時実行test・48件の
  回帰確認を実施。記録の日付・task_id・未追跡件数の誤りも本改訂で訂正した。
  本改訂で再レビューへ回す
- production approval: 未実施
- source task_id（app/ai-watch）: 20260918-001（初版、commit`7c1c347`）,
  20260919-001（lock順序修正1回目、commit`e903e81`。**このtask_idの日付部分は
  命名時の誤りで、実際の作業日はcommitタイムスタンプのとおり2026-09-18
  22:13 JST。ai-watchの記録上の識別子としてはこのまま`20260919-001`で参照する**）,
  20260918-002（lock順序修正2回目、commit`ec6e541`、2026-09-18 22:34 JST。
  こちらは日付・task_idとも正しい）
- related VPS task_id: 未採番
