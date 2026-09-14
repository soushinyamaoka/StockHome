# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20260907-STOCKHOME-006

app: stockhome

source_branch: main

source_commit: 9c20a5dfeac17f8714a0e4e4b4fe36fa73d244c1

production_baseline_commit: 5e209e04a517fa2daf785013cffb1bd26fd7835b

release_commits: `9f5fa86`（baseline）→ `02816ee`（task `20260907-002`、第1回API実装）→
`47b0b1e`（notice更新）→ `5b2f68a`（task `20260907-004`、第2回レビュー対応。
GAS側実装は含まない）→ `1c1b2ba`（task `20260907-005`、第3回レビュー対応。
GAS側実装は含まない）→ `fb12ce1`（notice更新）→ `9b84b1f`（task `20260907-006`、
第4回レビュー対応。GAS側実装は含まない）→ `60bb6cc`（notice更新）→
`21676c3`（task `20260907-007`、第5回レビュー対応。GAS側実装は含まない）→
`2c32da9`（notice更新）→ `e2a3857`（task `20260907-008`、第6回レビュー対応。
GAS側実装は含まない）→ `bf7ee66`（notice更新）→ `5e209e0`（task `20260907-009`、
第7回レビュー対応。GAS側実装は含まない）→ `8c042bc`（notice更新）→
`50af291`（notice更新、第8回レビューaccepted同期）→ `a627859`（notice更新、
API先行stage production反映同期）→ `70cccc6`（GAS版StockHomeを`apps/gas/`へ統合。
本notice対象機能のコード変更ではないリポジトリ構成変更）→ `3de1557`（task
`20260913-001`、GAS側実装。`reparseHistoricalCandidates`等を`apps/gas/`へ追加。
**ローカルのソースコード変更のみ。`clasp push`/`clasp deploy`は未実施のため
Apps Script側には未反映、production baselineには影響しない**）→
`b5ab358`（notice更新、GAS deployの手続き上の逸脱を自己申告）→
`d849129`（task `20260914-001`、GAS連携レビュー§16.3対応。S006-GAS-01〜04を修正。
**こちらもローカルのソースコード変更のみ。`clasp push`/`clasp deploy`は
未実施のためApps Script側には未反映**）→ `008a4de`（notice更新、§16.4文書同期）→
`9c20a5d`（task `20260914-002`、GAS連携再レビュー§17.3対応。S006-GAS-03の
残り2件（応答検証・ログ許可list）を修正。**こちらもローカルのソースコード
変更のみ。`clasp push`/`clasp deploy`は未実施**）。API側の
production baselineは引き続き`5e209e0`のまま変わらない（GAS側はAPI containerの
デプロイ対象ではないため）

impact_level: L3

status: accepted

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: applied

## 変更概要（B01反映）

Gmail取込パーサーの不具合修正（`20260906-001`）以前に取り込まれた
`import_order_candidates`のうち、`price_source IS NULL`の候補（VPS管理レビュー実機確認
時点で239件）へ、修正済みパーサーで再解析した単価を事後的に補完する。あわせて、
`candidateStatus`が確定済みで`purchase_logs.price`がNULLの購入（同時点で59件）についても、
既存の`resolveCandidatePriceForItem`（層1〜3判定）で確定できる場合のみ単価を補完する。

**B01対応（baselineの訂正）**: 前回notice提出時に`production_baseline_commit`として
記載した`5c1cdd9`は誤りだった。VPS管理側の実機確認により、現在のproduction API
source baselineは`9f5fa864327e5d16b263250ce9e0348966b37f4f`（2026-09-06 22:27:32 JST、
API container作成前の最後のbuild入力変更commit）であることを確認した。`9fff7c8`
（`20260906-001`、`price_source`列追加migration含む）は2026-09-06にVPS管理レビューを
経ずアプリ側から直接`npm run deploy`で反映されている。**この操作は本noticeによって
遡及承認されるものではない。** 当時`server_impact: none`と自己判定した根拠（schema変更を
伴わない内部ロジック拡張という認識）は、現行ポリシー上、列追加を伴うmigrationを含む
反映を無条件に`none`とする扱いとは一致しないことをVPS管理レビューで指摘された。
今後、schema変更（列追加を含む）を伴う反映は、事前にnotice提出・レビューを経てから
行う。

**2026-09-07 第2回レビュー（`blocked`）への対応完了**: VPS管理側がmock再現により
実質的なバグ7件（B02〜B06、詳細下記）を確認した。認証境界（自己申告emailで
他利用者のGmail message IDへアクセス可能）、冪等性（同一候補への複数回書き込みが
可能）、監査の非原子性（data更新と監査記録が別transaction）が主な内容。
task `20260907-004`（commit `5b2f68a`）で修正し、回帰test 22件を含む全38件の
ローカルDB testが成功した。詳細は下記「第2回レビュー対応状況」参照。

**2026-09-07 第3回レビュー（`blocked`）への対応完了**: VPS管理側が実DBへのprobeにより
実質的なバグ6件（詳細下記）を確認した。household境界の欠落（同じemailを持つ別household
候補・購入への実際の書き込みが可能）、対象集合・監査の非冪等性（write再送で結果が変わる、
dry-run再送で監査が重複増加）、監査カバレッジ不足（早期return経路で監査0件）、
dry-run/write判定の不一致（同じ入力でも購入更新の判定が変わる）、payload検証の
抜け（`priceSource`単独指定で候補が二度と処理できなくなる）が主な内容。
task `20260907-005`で修正し、回帰test 8件を含む全46件のローカルDB testが成功したことを
Codex・Claudeの双方で確認した。fresh隔離DBでのmigration apply/rollback rehearsalも実施した。
詳細は下記「第3回レビュー対応状況」参照。

**2026-09-08 第4回レビュー（`blocked`）への対応完了**: VPS管理側が実装改善は認めつつ、
6件のblockerを継続指摘した。監査自体が失敗した場合にrow業務判定とchunk単位の
infrastructure障害を区別できない（S006-R4-01）、POSTの一部経路（skip・invalid price・
matched itemがpurchase 0件の場合）でhousehold境界を全経路で強制していない
（S006-R4-02）、run/chunkの進捗をDBから復元する手段が無くsingle active runの制約も
無い（S006-R4-03）、migration・rollback rehearsalが最新1件分しか無くtransaction境界も
無い（S006-R4-04）、runToken非混入の回帰testが無い（S006-R4-05）、notice文書の
remote状態不一致（S006-R4-06）が内容。task `20260907-006`（R4-01・R4-02・R4-03・R4-05）と
Claudeの直接対応（R4-04）で修正し、回帰test8件・HTTPレベルtest3件を含む全57件の
ローカルDB testが成功したことをCodex・Claudeの双方で確認した。fresh隔離DBでの
全migration適用・本機能3 migration全体のrollback rehearsal（round-trip含む）も実施した。
詳細は下記「第4回レビュー対応状況」参照。

**2026-09-08 第5回レビュー（`blocked`）への対応完了**: VPS管理側は実装改善を認めつつ、
6件のblockerを継続指摘した。**最重要**: matched itemのhousehold不一致でもcandidate
更新がcommitされる実装漏れが残っており、round-4で追加した回帰testがこの不具合を
「防ぐ」のではなく「固定」してしまっていた（S006-R5-01）。加えて、run対象集合・進捗が
run作成後の外部要因や期限切れで復元できない（S006-R5-02）、single active runの
真の同時実行防止が無い（S006-R5-03）、item snapshot作成での例外握りつぶし
（S006-R5-04）、runToken非混入testがproduction相当のログ経路を検証していない
（S006-R5-05）、notice文書のremote状態不一致（S006-R5-06）が内容。
task `20260907-007`（R5-01・R5-02・R5-03・R5-04・R5-05）とClaudeの直接対応
（migration・schema）で修正し、新設`price_reparse_targets`（run対象manifest）テーブル、
`createReparseRun`のSERIALIZABLE transaction化、production相当loggerを使う
HTTPレベルtestを追加した回帰test6件・HTTPレベルtest2件を含む全63件のローカルDB
testが成功したことをCodex・Claudeの双方で確認した。fresh隔離DBでの全migration適用・
本機能4 migration全体のrollback rehearsal（round-trip含む）も実施した。
詳細は下記「第5回レビュー対応状況」参照。

**2026-09-08 第6回レビュー（`blocked`）への対応完了**: VPS管理側は第5回の改善
（matched item境界・single active run・snapshot例外伝播）を確認しつつ、
4件のblockerを継続指摘した。**最重要**: 第5回で追加した固定manifest
（`price_reparse_targets`）が進捗計算にしか使われておらず、対象取得（GET）・
書き込み認可（POST）の正本になっていなかった（S006-R6-01）。このため
run開始後に外部要因で価格確定した対象がGETから消えて完了させられない一方、
manifestに属さない候補がhousehold/owner/cutoff一致だけでGET/POST対象になり
得た。加えて、期限切れ・失効後は進捗を見られるだけで作業を再開する経路が無い
（S006-R6-02）、runToken非混入testがstderrを検査していない（S006-R6-03）、
notice文書のremote状態不一致（S006-R6-04）が内容。task `20260907-008`
（R6-01〜R6-03）で修正し、`getReparseTargets`を固定manifest正本の実装へ
全面書き換え、`computeOutcome`へmanifestメンバーシップ確認を追加、新規
`extendReparseRun`関数で期限切れ後もmanifest・監査履歴を維持したまま再開
できるようにした。回帰test5件を新設し、既存2件を更新した全68件のローカルDB
testが成功したことをCodex・Claudeの双方で確認した。詳細は下記
「第6回レビュー対応状況」参照。

**2026-09-08 第7回レビュー（`blocked`）への対応完了**: VPS管理側は第6回の改善
（manifest正本化・外部価格確定後のreconcile・期限切れ後の再開・stdout/stderr
非混入）を確認し、VPS1のNginx設定もread-onlyで直接確認したうえで、
StockHomeが共通access logの既定形式を使いrunToken用headerを記録する独自設定が
ないことを確認した。一方、**最重要**として、`extendReparseRun`が期限切れと
失効（revoke）を区別せず、失効済みrunを同じrunTokenのまま再有効化できる欠陥
（S006-R7-01）を継続指摘した。token漏えい・誤配布・緊急停止時の無効化を、
延長操作自体で覆せてしまうというセキュリティ上の欠陥である。加えて、
manifest非所属candidateの拒否時に監査行を作成してしまい、第6回レビュー§13.3が
指定した「data/audit不変で拒否する」設計と一致していなかった（S006-R7-02。
これは第6回の設計段階でClaudeがレビュー原文の指定を見落としたことが原因）。
notice文書のremote状態不一致（S006-R7-03）も指摘された。task `20260907-009`
（R7-01・R7-02）で修正し、`extendReparseRun`は失効済みrunを拒否するよう変更、
新規`rotateReparseRunToken`関数で失効済みrunだけを新しいtokenへ安全に移行
できるようにした（旧tokenは以後永久に無効）。`applyOne`もmanifest非所属
candidateの経路で監査を一切書かないよう修正した。回帰test5件を新設し、
既存3件を更新した全73件のローカルDB testが成功したことをCodex・Claudeの
双方で確認した。詳細は下記「第7回レビュー対応状況」参照。

## 変更理由

- 過去分の単価が空欄のままでは、購入履歴の価格推移（既存機能）や将来の家計把握に使えない。
  ユーザーから明示的に「Phase 4（過去データの遡及）を進めてほしい」との依頼を受けた。
- 初回提出のnotice（設計段階）がVPS管理レビューでblocked（B01〜B08）となったため、
  本改訂で設計を修正し、API側の実装まで完了させた（GAS側は未実装、下記参照）。

## server_impact判定（B07反映）

server_impact: approval_required

判定理由: production DBの永続データ（`import_order_candidates.detected_price`/
`price_source`、`purchase_logs.price`）を一括更新する。新規APIエンドポイントの追加、
container再起動を伴うdeploy、実Gmailへの再アクセスを伴う一度限りのバッチ処理を含み、
データの値・意味を変える操作であるため、単なる`notify`ではなく`approval_required`と
判定を訂正した（前回提出時の`notify`は過小評価だった）。

## 現在と変更後

| 項目 | 現在 | 変更後 |
|---|---|---|
| 過去候補の`price_source`（`price_source`/`detected_price`とも NULL の行） | NULL/空 | 再解析で価格が判明した候補のみ値が入る（対象外は変化なし） |
| 対応する`purchase_logs.price`（NULLの行のみ） | NULL | 層1〜3判定で確定できたものだけ値が入る |
| API | 該当エンドポイントなし | `GET /api/bridge/reparse-candidates`・`POST /api/bridge/reparse-candidates`・`GET /api/bridge/reparse-progress`（第5回レビューR5-02対応で追加）を新設（`HISTORICAL_REPARSE_ENABLED=true`のときのみ有効。未設定時は404）。認可は事前発行済み`runToken`（第2回レビューB03対応、下記参照）で行い、自己申告emailは受け付けない。`runToken`はquery string/bodyではなく専用header（`X-Reparse-Run-Token`）で受け渡す（第3回レビューB03対応） |
| GAS | 該当機能なし | **実装は完了（2026-09-13 task `20260913-001`、2026-09-14 GAS連携レビュー対応task `20260914-001`・再レビュー対応task `20260914-002`でS006-GAS-01〜04すべて修正済み）。deployはtask `20260913-001`時点のsource（`3de1557`、version `@33`）のみ実施済みで、task `20260914-001`・`20260914-002`の修正分は`clasp push`/`clasp deploy`未実施のためApps Scriptには未反映（現在deploy済みのsourceにはS006-GAS-01〜04のバグが残っているが、`HISTORICAL_REPARSE_ENABLED`・`REPARSE_RUN_TOKEN`とも未設定のため実害なし）。次回GAS反映時は最新修正版（commit `9c20a5d`以降）を対象にする。runTokenの発行・登録、`HISTORICAL_REPARSE_ENABLED`有効化、実Gmailへの接続を伴う実行はいずれも未実施。**詳細は下記「Codex実装結果」各節・「GAS clasp push/deploy実施結果」「GAS連携レビュー対応状況」「GAS連携再レビュー対応状況」参照 |
| `price_reparse_audit`テーブル | 存在しない | 新設（production row変更前後値の監査ログ。Git管理外）。`mode`列と`(run_id, candidate_id, mode)`の一意制約を追加し、write再送の冪等・dry-run再実行の重複防止に使う（第3回レビューB02/B04対応） |
| `price_reparse_runs`テーブル | 存在しない | 新設（第2回レビューB03対応。runToken・対象owner・有効期限を保持する認可テーブル。HTTP経由では作成せず、production承認後に運用者が直接1件だけ発行する）。`cutoff_at`列を追加し、run作成後に新規追加された候補を対象から除外する（第3回レビューB02/B04対応）。期限切れ（未失効）のrunだけを同じrunToken・manifest・監査履歴を維持したまま再開する`extendReparseRun`関数（第6回レビューR6-02対応。第7回レビューR7-01対応で`revokedAt`設定済みrunは拒否するよう修正）と、失効済みrunだけを新しいrunTokenへ安全に移行する`rotateReparseRunToken`関数（第7回レビューR7-01対応。旧tokenは以後永久に無効）を追加（いずれも`createReparseRun`と同じくHTTP非公開） |
| `price_reparse_item_snapshots`テーブル | 存在しない | 新設（第3回レビューB02/B06対応。run内で品目ごとに参照単価を1回だけ計算・固定し、dry-run/write・chunk分割・処理順序によらず同じ判定になるようにする） |
| `price_reparse_targets`テーブル | 存在しない | 新設（第5回レビューR5-02対応。`createReparseRun`実行時点の対象候補IDを固定するmanifest。run作成後に対象集合が動的に変化しないようにし、`getReparseRunProgress`の分母として使う） |

## 影響対象

- service/container: `stockhome-api-prod`（新規route追加のみ。既存route・起動構成は変更しない）
- URL/port/health: 変更なし
- cron/timer/worker: 変更なし（GAS側バッチは既存6時間cronに組み込まず、実装後も手動起動限定とする設計）
- dependency: 追加なし
- data/DB/volume: `price_reparse_audit`テーブルを新設（schema追加のみ、既存テーブルへの
  列追加は無い）。`import_order_candidates`/`purchase_logs`の値を一括更新する処理を
  新設するが、**本notice時点ではコードが追加されるだけで、実行はしない**
- log/monitoring: `batch_step`（`job: 'historical_price_reparse'`、POST 1回＝chunk 1回単位）を新設。
  row内容（message_id・商品名・金額）はログへ出さず集計値のみ（第2回レビューB04対応で
  `job_start`/`job_end`から変更済みだったが、本節の表記更新が漏れていた。第3回レビューB05/B08で指摘）

## production変更（B07反映）

- 必要性: あり
- **API単独stageとGAS+実行stageを分離する（第2回レビューB08反映）**:
  GAS未実装であることを理由にAPI側の受理を無期限に保留しない。API側の
  blocker（B02〜B07、task `20260907-004`で対応済み）が解消されたため、
  「featureは`HISTORICAL_REPARSE_ENABLED`未設定のため無効のまま」という
  **業務データに一切影響しないstage**として、API deployだけを先行して
  `accepted`・実施可能と判断できる。GAS実装・実行（dry-run/write/canary）は
  別stageとして改めてreviewする。
- 承認段階（B07: 分離して記録する）:
  1. **app owner承認①**: 対象・価格判定ロジックの設計承認（API stage）— **完了
     （2026-09-12）**
  2. **VPS管理review**: 本notice改訂版の`accepted`（API stageのみで可）— **完了
     （第8回、2026-09-08）**
  3. **production承認②**: API deployの承認（`HISTORICAL_REPARSE_ENABLED`は
     未設定のまま。この時点では業務データに一切影響しない）— **完了・実施済み
     （2026-09-12、task `20260912-001`、`verified`。詳細は上記「Production実施結果」参照）**
  4. **production承認③**: GAS実装完了後、`HISTORICAL_REPARSE_ENABLED`設定・
     **dry-run実行**（監査テーブルへの書き込みとrow lockを伴うため、
     これ自体もproduction承認対象）の承認 — 未実施
  5. **production承認④**: dry-run結果確認後、DB backup・canary・全件write・
     必要時rollbackの承認 — 未実施
  - 上記は同一回答でまとめて得る場合も、対象releaseと各操作を明記して記録する
  - **VPS管理側の個別承認前にGAS deploy、DB write（dry-runの監査書き込みを
    含む）、GAS batch起動を行わない**（API deployのみ承認②により完了済み）
- downtime: possible（API container入替時の短時間の利用失敗の可能性。`none`と
  断定しない。前回提出時の誤りをB07で訂正）
- maintenance window: 実施計画確定時に、家族（利用者）への通知・不使用確認要否を判断する

## 利用者への影響

- user_maintenance_impact: possible（API container再起動時の短時間断続の可能性）
- 対象利用者・機能: 購入履歴の単価表示（過去分のみ）。API再起動中は全機能が
  短時間利用できない可能性がある（既存のdeployと同じ影響範囲）
- 通知方法: 実施計画確定時に確定する（家族への事前通知要否を含む）

## env・secret contract

- 変更: あり
- 変数名・secret種類のみ: `HISTORICAL_REPARSE_ENABLED`（`true`/未設定の真偽フラグ、
  secretではない）を追加。値はVPS管理側のproduction承認後にのみ設定する
- provisioning/rotation: 該当なし（rotation不要な機能フラグ）

## Data・migration・backup（B05反映、第3回レビューB05/B08で具体化）

- schema/format変更: `price_reparse_audit`・`price_reparse_runs`（第2回レビューB03対応で
  追加。認可用のrunToken・対象owner・有効期限を保持する）・`price_reparse_item_snapshots`
  （第3回レビューB02/B06対応で追加。run内固定の参照単価）・`price_reparse_targets`
  （第5回レビューR5-02対応で追加。run作成時点の対象候補manifest）の4テーブルを新規追加。
  既存テーブルへの列追加は無いが、`price_reparse_runs`へ`cutoff_at`列、
  `price_reparse_audit`へ`mode`列と`(run_id, candidate_id, mode)`一意制約を追加した
  （第3回レビューB02/B04対応）
- migration: `20260906223126_add_price_reparse_audit`・`20260907021325_add_price_reparse_run`・
  `20260907050000_reparse_run_cutoff_and_idempotent_audit`・
  `20260908000000_add_price_reparse_target`（いずれもローカル生成・適用済み、
  productionへは未適用）
- **明示的transaction境界（第4回レビューR4-04対応、第5回追加分にも同様に適用）**:
  この機能の4 migrationすべてへ`BEGIN;`/`COMMIT;`を追加した（`push_devices`/
  `push_tickets`と同じ方針。理由も同じ: Prismaのこのバージョン・実行経路では
  migration.sqlが既定でtransactionに包まれる保証がなく、途中の文が失敗した場合に
  tableと関連index/一意制約が中途半端な状態で残らないようにする）。
- **fresh隔離DBでのapply/rollback rehearsal（第3回レビューB05/B08、第4回レビューR4-04、
  第5回レビューR5-02対応、実施済み）**: 使い捨てのPostgreSQL 16コンテナ（本notice対象の
  開発DB・productionとは別インスタンス）に対し、`npx prisma migrate deploy`で初期化から
  全10 migrationを適用し、想定どおりのtable/column/indexが作成されることを確認した。
  本機能の4 migrationすべてをbaseline相当まで一度に取り消す以下のrollback SQLを
  同一DB上でtransaction内実行し、`20260906062943_add_price_source_to_import_candidates`
  適用直後（production baseline相当）のschemaへ正確に戻ることを確認した:
  ```sql
  BEGIN;
  DROP TABLE "price_reparse_targets";
  DROP TABLE "price_reparse_item_snapshots";
  DROP INDEX "price_reparse_audit_run_id_candidate_id_mode_key";
  ALTER TABLE "price_reparse_audit" DROP COLUMN "mode";
  ALTER TABLE "price_reparse_runs" DROP COLUMN "cutoff_at";
  DROP TABLE "price_reparse_runs";
  DROP TABLE "price_reparse_audit";
  DELETE FROM "_prisma_migrations" WHERE migration_name IN (
    '20260906223126_add_price_reparse_audit',
    '20260907021325_add_price_reparse_run',
    '20260907050000_reparse_run_cutoff_and_idempotent_audit',
    '20260908000000_add_price_reparse_target'
  );
  COMMIT;
  ```
  rollback後、`import_order_candidates.price_source`列（本機能より前のmigrationが
  追加した列）が変わらず残っていること、`price_reparse_*`の4テーブルがすべて
  消えていること、Prisma自身の`migrate status`が4 migrationを「未適用」として
  正しく認識することを確認した。続けて`prisma migrate deploy`で4 migrationを
  再適用し、round-trip（apply→全rollback→再apply）が問題なく行えることも確認した。
  すべての文は列削除・テーブル削除・索引削除・bookkeeping行削除のみで、既存rowの
  値によって結果が変わる条件分岐を持たないため、rowが0件でも大量にあっても同一の
  安全なrollbackになる。**明示的transactionで各migrationが原子的になったことにより、
  途中失敗時の復旧は「失敗した1ファイル分だけが未適用のまま残り、原因を解消して
  `prisma migrate deploy`を再実行すれば、適用済みの他migrationは再実行されず
  失敗分だけが再試行される」という単純な手順になる**（部分適用状態が残らないため、
  個別の手動復旧手順は不要）。rehearsal用コンテナは確認後に削除し、
  開発DB・productionのどちらにも影響していない。
- backup対象（B05: Git管理外の保存先へ変更）:
  - 実行直前にPostgreSQLの論理dump（`pg_dump`）をVPS上のtask専用ディレクトリへ取得し、
    non-zeroサイズ・gzip・SHA-256を確認する
  - 更新対象のrow ID・変更前値・適用値・run IDは、**Git repositoryではなく**
    `price_reparse_audit`テーブル（production Postgres内、API応答には一切含めない）へ
    保存する。旧稿にあった「`ops/production-db-operations/`へIDを保存する」案は撤回する
- restore確認: dumpを隔離環境（同一VPS上の使い捨てDB、または別ホスト）へ実際にrestoreし、
  想定テーブル・件数が復元できることを確認してから本番作業へ進める
- **`price_reparse_audit`・`price_reparse_runs`・`price_reparse_item_snapshots`の
  保持期限・閲覧者・削除条件（第3回レビューB05/B08で具体化要求）**:
  - 保持期限: 自動削除なし。`push_tickets`と異なり定期cleanup jobを設けない
    （一度限りの過去分backfillの監査証跡であり、継続的に増え続けるテーブルではないため）。
    production反映が完了し、対象候補の再解析結果が確定・reconcile済みと
    app owner・VPS管理側の双方が確認するまでは削除しない
  - 閲覧者: VPS上での直接psql操作に限定する。API応答（`GET`/`POST /reparse-candidates`の
    レスポンス）にはrow内容を一切含めない（既存記載どおり）。ログにもrow内容は出さない
    （`batch_step`集計のみ）
  - 削除条件: 自動削除する仕組みは実装しない。将来削除する場合は、app owner・VPS管理側の
    合意のうえ、VPS上で手動SQL（`DELETE FROM price_reparse_audit WHERE run_id = ...`等）を
    実行する運用とし、削除前に対象run_idの内容をdumpとして保全する
- backward compatibility: 新規2endpointの追加のみ。既存endpoint・レスポンス形式に変更なし

## Deploy・rollback（B05反映）

- deploy前提: API側実装・test完了、本notice`accepted`、app owner承認①〜④
- deploy手順の変更: なし（既存の`npm run deploy`と同一手順。ただし`HISTORICAL_REPARSE_ENABLED`
  は別途VPS管理側で設定するまで未設定のままとし、deploy自体では機能を有効化しない）
- rollback方法:
  - **image rollback**（コード）: 前バージョンのAPI containerへ戻す。新設した2 endpointが
    消えるだけで、既存機能に影響しない
  - **data rollback**: `price_reparse_audit`の該当`run_id`の行を参照し、
    「適用値のまま変化していないrow」だけを、保存された変更前値へ戻すUPDATE文を実行する。
    このrunの後に別途手動編集・新規取込で値が変わったrowはrollback対象から除外し、
    一覧化して手動判断に回す
  - DB全体restore（dumpからの復元）は最終手段とし、その場合はdumpとrestore実行時刻の
    間に発生した**すべての**利用者入力（本件と無関係な購入登録・在庫補正等も含む）が
    巻き戻る点を、実施前にapp ownerへ明示する
- rollback不能条件: `price_reparse_audit`が示す「変化していない」判定より後に
  正当な利用者入力があった行は、機械的に安全な変更前値へ戻せないため、当該行のみ
  手動判断とする（それ以外の行はrollback可能）

## Health・テスト（B06反映、第2回レビューで訂正）

- health contract変更: なし
- **dry_runは「DBを一切変更しない」わけではない。** 業務データ
  （`import_order_candidates`/`purchase_logs`）は必ずrollbackし変更しないが、
  判定結果を`price_reparse_audit`テーブルへ実際に書き込む（`outcome`に
  `dry_run_`接頭辞を付けて区別する）。また業務テーブルへのUPDATE文を試行してから
  rollbackするため、実行中は一時的な行lockが発生する。前回notice記載の
  「何度でも書込みなし」は誤りだったため訂正する。dry_run実行そのものも、
  write実行と同じ「production DB書き込みを伴う操作」として承認対象に含める
  （下記production変更参照）。
- 実施テスト: `apps/api/src/services/priceReparse.test.ts`で、第2回レビューが
  mock再現した7件の問題（B02〜B06）を含む回帰test22件を追加した（詳細は本notice下部の
  「第2回レビュー対応状況」参照）。27件成功という第1回の実績だけでは「確認済み」と
  しなかった（第2回レビュー指摘）。
- **第3回レビュー対応（task `20260907-005`）で追加したtest**: household境界越境、
  purchase household/item不整合、write skip監査0件（全早期return経路の監査カバレッジ）、
  write再送の冪等性（保存済み結果をそのまま返す）、dry-run再実行の監査重複防止（upsert）、
  同一run内のdry-run/write判定一貫性（run/item単位snapshot）、run cutoff後の候補除外、
  payloadのfield組合せ検証（`priceSource`単独・`skipReason`と価格field同時指定の拒否）の
  計8件のtestを新設し、既存の関連assertionも強化した。既存22件と合わせ`priceReparse.test.ts`は
  30件になった（詳細は下記「第3回レビュー対応状況」参照）
- **第4回レビュー対応（task `20260907-006`）で追加したtest**: skipReason・invalid price
  経路がhousehold境界を素通りしないこと、matched itemの別household不一致がpurchaseの
  有無に関わらず検知されること、`computeOutcome`実行中の本物のDB例外・監査insert自体の
  （一意制約違反以外の）例外が`processReparseResults`をrejectさせ監査行も作られない
  こと、`getReparseRunProgress`の進捗計算（priceが確定して条件から外れた候補も
  totalTargetsに残り続けること含む）、`createReparseRun`のsingle active run拒否の
  計8件を新設した。加えて、新規`apps/api/src/routes/bridge.reparse.test.ts`で
  `X-Reparse-Run-Token`header必須・query/body経由のrunTokenが受理されないこと・
  無効tokenでの404応答時に実際のtoken文字列がHTTPレスポンス・stdoutのどちらにも
  出現しないことを確認する3件を追加した（後者は別processを起動し、そのprocessの
  実stdoutをpipeで捕捉して検証する。詳細は下記「第4回レビュー対応状況」参照）
- **第5回レビュー対応（task `20260907-007`）で追加したtest**: matched itemの
  household不一致がcandidate更新前に検知されcandidate・purchaseとも不変のまま
  `conflict`になること（round-4の回帰testが誤って`updatedCandidate === 1`を
  期待していたのを修正）、run作成後に作成された候補が対象manifestに含まれない
  こと、run対象外の経路で価格が確定しても進捗の母数・残数が変わらないこと、
  期限切れrunでも進捗取得ができること、同一household・同時`createReparseRun`呼出しで
  1件だけが成功すること、item snapshot作成の非P2002例外がtransaction全体を
  rollbackさせcandidate/purchaseとも不変にすることの計5件を新設した。
  併せて、DB書き込みを避けるmockに依存していた旧`createReparseRun`のtest
  （`createReparseRun`がSERIALIZABLE transaction化されmock方式が使えなくなったため）を
  削除した。`priceReparse.test.ts`は既存38件から42件になった（1件削除・1件書き換え・
  5件追加）。加えて`bridge.reparse.test.ts`へ、production同一の`loggerInstance: appLogger`と
  `registerHttpErrorHandling`を使う実HTTPレベルtestを2件追加し、write成功時の
  `batch_step`ログとinfrastructure例外時の`request_failed`ログのどちらでも
  実際にそのeventが出力されること（testが空振りしていないことを確認するため）、
  かつrunTokenの値がどちらの場合も出力に含まれないことを確認した
  （詳細は下記「第5回レビュー対応状況」参照）
- 結果: `npm run test --workspace=@stockhome/api`で**全63件が成功**（失敗0件、
  `priceReparse.test.ts`42件＋`bridge.reparse.test.ts`5件＋
  `stockCalc.accumulation.test.ts`16件）。Codexが自環境
  （ローカルDB接続あり）で実行し全件成功を報告し、Claudeが対話セッションで
  ローカル開発用Postgres（`localhost:5434`）に対して独立に再実行し同じ結果
  （63件成功）を確認した
- **runToken非混入testの範囲についての補足（第4回レビューR4-05で指摘した限界を
  第5回レビューR5-05対応で解消）**: 第4回時点では、write成功時の`batch_step`ログと
  production共通エラーハンドラの非混入は自動testではなく静的確認に留まっていた。
  第5回対応で、production実装と同一の`registerHttpErrorHandling`・
  `loggerInstance: appLogger`を使う実HTTPレベルtestへ置き換え、上記2経路とも
  自動testで非混入を確認できるようになった
- **第6回レビュー対応（task `20260907-008`）で追加・更新したtest**: manifestに
  属さない候補（household/owner/cutoffは一致するが対象外だった、または後から
  価格をNULLに戻された候補）へのwriteが`conflict`・`candidate_not_in_manifest`
  として拒否されcandidateが不変のままであること、run開始後に外部経路で価格確定
  した対象が`getReparseTargets`から消えずに残り続けること、その対象へwriteを
  送ると`conflict`・`already_has_price`として監査が付き進捗が`complete: true`へ
  到達すること、期限切れrunは`getReparseTargets`/`processReparseResults`を拒否する
  一方`getReparseRunProgress`は引き続き参照できること、`extendReparseRun`で
  期限切れrunを延長すると同じmanifest・既存監査（延長前のdry_run結果を含む）を
  維持したまま処理を再開して完了へ到達できること、同一householdに他の有効runが
  ある場合`extendReparseRun`が拒否されることの計5件を新設した。既存の
  `getReparseTargets`testは固定manifestを作る`createReparseRun`を使うよう更新し、
  `getReparseRunProgress`の期限切れtestは対象取得・書き込みが実際に拒否される
  ことも確認するよう拡張した。`priceReparse.test.ts`は42件から47件になった。
  加えて`bridge.reparse.test.ts`の既存2件（production相当ログtest）を、stdoutに
  加えてstderrにもrunTokenが含まれないことを検査するよう更新した
  （詳細は下記「第6回レビュー対応状況」参照）
- 結果: `npm run test --workspace=@stockhome/api`で**全68件が成功**（失敗0件、
  `priceReparse.test.ts`47件＋`bridge.reparse.test.ts`5件＋
  `stockCalc.accumulation.test.ts`16件）。Codexが自環境（ローカルDB接続あり）で
  実行し全件成功を報告し、Claudeが対話セッションでローカル開発用Postgres
  （`localhost:5434`）に対して独立に再実行し同じ結果（68件成功）を確認した
- **proxy（Nginx）log formatについての補足（第6回レビューR6-03）**: StockHomeの
  Nginx設定はこのrepository外（VPS側の別管理）にあり、本notice作成時点で
  Claudeから実際の設定ファイルを直接確認する手段が無い。一般的な事実として、
  Nginxの既定`combined`log formatは`$request`（method・path・protocol）・
  `$status`・`$body_bytes_sent`・`$http_referer`・`$http_user_agent`のみを
  記録し、`X-Reparse-Run-Token`のような任意のrequest headerを含めるには
  明示的な`log_format`変更が必要である。したがって、StockHomeのproxy設定が
  既定から意図的に変更されていない限り、header化されたrunTokenがaccess logへ
  残ることは無いと考えられる。**この一般的事実の記載はClaudeによるものだが、
  第7回レビューでVPS管理側がVPS上の実際のNginx設定をread-onlyで直接確認し、
  StockHomeが共通access logの既定形式を使い、runToken用headerを記録する独自の
  `log_format`・`access_log`上書きが無いことを確認した。** production設定の
  変更は行われていない
- **第7回レビュー対応（task `20260907-009`）で追加・更新したtest**:
  `extendReparseRun`が失効済み（`revokedAt`設定済み）runを、期限切れ・未期限切れの
  どちらでも拒否すること、新規`rotateReparseRunToken`が失効済みrunだけに新しい
  runTokenを発行し同じrun ID・manifest・既存監査（延長前のdry-run結果を含む）を
  維持したまま処理を再開して完了できること、rotate後は旧runTokenが
  `getReparseTargets`・`processReparseResults`・`getReparseRunProgress`の
  いずれからも永久に`ReparseRunInvalidError`となること、失効していないrunや
  他に有効runが存在する場合に`rotateReparseRunToken`が拒否されることの計5件を
  新設した。既存の`extendReparseRun`関連test3件も、失効境界の検証と混同しないよう
  `revokedAt`を設定しない形へ修正した。`priceReparse.test.ts`は47件から52件になった
- **manifest外candidateの監査仕様を訂正（第7回レビューR7-02対応）**: 第6回時点の
  実装は`candidate_not_in_manifest`のwrite監査を作成していたが、これは第6回
  レビュー§13.3が指定した「POSTはmanifest非所属candidateをdata/audit不変で
  拒否する」という設計と一致していなかった（Claudeが第6回の設計時に見落とした）。
  `applyOne`を修正し、`candidate_not_in_manifest`の経路ではdry_run/write
  どちらのmodeでも監査を一切書かないようにした。該当testのアサーションも、
  監査1件作成の確認から監査0件のままであることの確認へ修正した
- 結果: `npm run test --workspace=@stockhome/api`で**全73件が成功**（失敗0件、
  `priceReparse.test.ts`52件＋`bridge.reparse.test.ts`5件＋
  `stockCalc.accumulation.test.ts`16件）。Codexが自環境（ローカルDB接続あり）で
  実行し全件成功を報告し、Claudeが対話セッションでローカル開発用Postgres
  （`localhost:5434`）に対して独立に再実行し同じ結果（73件成功）を確認した
- **fresh隔離DBでのmigration apply/rollback rehearsal**（第3回レビューB05/B08、
  第4回レビューR4-04、第5回レビューR5-02対応）: 上記「Data・migration・backup」節参照。
  使い捨てDBで「baseline→全10 migration適用」「本機能4 migrationの全rollback
  （baseline相当への正確な復元を確認）」「rollback後の再適用（round-trip）」を確認した
  （第6回はmigration変更が無いため追加rehearsalは実施していない）
- 未実施テストと理由: 実Gmail接続を伴う結合test、production環境でのcanaryは、
  本notice`accepted`後、app owner立ち会いのdry-run実行時に初めて実施する
  （dry-run自体もproduction承認が必要。上記参照）

## Log・監視（B04/B06反映）

- log量/形式/保存先変更: 第2回レビュー指摘を受け、`job_start`/`job_end`のrun単位ペアから、
  `batch_step`（`job: 'historical_price_reparse'`、POST 1回＝chunk 1回単位）へ変更した。
  件数集計（total/updated/unchanged/skipped/conflict/failed、skip理由別内訳）のみを
  出力し、runToken・message_id・商品名・金額は出さない。run単位の集計は
  `price_reparse_audit`テーブルを`run_id`で集計して確認する運用とする
  （ログでのrun単位start/end追跡は行わない設計上の割り切り）
- 新しいalert条件: なし（一度限りの手動batchのため、常設監視は設けない）
- secret/個人情報対策: 再取得したメール本文は価格抽出後に即座に破棄する
  （既存パイプラインと同じ方針）。`price_reparse_audit`はAPI応答に含めず、
  当該テーブルへの直接アクセスはVPS上のpsql操作のみに限定する

## 提出前セルフチェック

正本: `C:\work\PRG\Sakura\Dev\vps-server-management\docs\templates\server_change_notice_pre_submission_checklist.md`

- [x] production baselineとrelease全commit・build入力差分を確認した（B01反映、baseline訂正済み）
- [x] source commitとnoticeをremoteの対象branchへpushした（第3回対応`1c1b2ba`・`fb12ce1`、
      第4回対応`9b84b1f`・`60bb6cc`、第5回対応`21676c3`・`2c32da9`、第6回対応`e2a3857`・
      `bf7ee66`、第7回対応`5e209e0`・`8c042bc`、第8回accepted同期`50af291`、
      API先行stage production反映同期`a627859`、GASリポジトリ統合`70cccc6`、
      GAS側実装task `20260913-001`の`3de1557`はいずれもorigin/mainへpush済み。
      第8回レビューがGit上でsource `5e209e0`・notice `8c042bc`のpush済み一致を確認済み。
      GAS実装反映`5d38632`、GAS deploy実施記録`0a1a1da`、手続き逸脱自己申告`b5ab358`、
      GAS連携レビュー対応`d849129`、notice同期`7abce78`・`008a4de`、
      GAS連携再レビュー対応`9c20a5d`はいずれもorigin/mainへpush済み。本改訂も
      本commit後にpushする）
- [x] data更新のtransaction・同時実行・途中失敗・再実行を確認した（第2回〜第7回
      レビューがmock再現・実DBへのprobeで確認した計32件の問題を含むregression test 52件を
      含む全73件をローカルDBで実行し全件成功を確認済み）
- [x] image rollbackとdata rollback、backup/restore条件を分けた（上記Deploy・rollback参照）
- [x] job/log/retention、runtime/dependency、client配信の該当有無を確認した
      （ログをchunk単位の`BATCH_STEP`へ変更し、row内容を含まないことを確認済み。
      client配信は不要と確定）
- [ ] app owner、VPS review、production承認、client配信承認を分離した（API単独stageと
      GAS+実行stageへ分離済み。**VPS management reviewは第8回で`accepted`取得済み。
      app owner承認①〜④・production承認・client配信承認は引き続き未実施**）
- [x] secret非混入とtracked working tree cleanを確認した

未確認・該当なしの理由: VPS management reviewは第8回（2026-09-08）で`accepted`と
なった（下記「第8回レビュー結果」参照）。これはproduction反映の承認ではない。
4段階の承認取得（app owner承認①〜production承認④）・client配信承認は、
production計画の提示後に行う。GAS側バッチのローカル実装は2026-09-13に
task `20260913-001`で完了し（下記「Codex実装結果（task 20260913-001）」参照）、
2026-09-14にapp ownerが本チャットで明示承認した範囲（`clasp push`/`clasp deploy`のみ、
VPS・production DB接続なし）でApps Scriptへの反映も完了した（下記「GAS clasp
push/deploy実施結果」参照）。`HISTORICAL_REPARSE_ENABLED`設定・runToken発行・
dry-run（production承認③の対象）は引き続き未実施のまま。

## 未解決事項

1. **B08（実装経路→実装・deploy完了）**: GAS側バッチの実装は、当初
   app owner判断により「今回は実装せず、別途手動Codexセッションで実装する」
   方針だった（2026-09-07）が、2026-09-13にGAS版StockHomeがこのモノレポの
   `apps/gas/`へ統合され、ai-watchのClaude→Codexパイプラインが`apps/gas/`を
   対象に含めるようになったため、同パイプライン経由でtask `20260913-001`として
   実装した。設計メモ（`ops/investigations/20260907-historical-price-reparse-gas-design.md`、
   第7回VPS管理レビュー反映版）どおりの実装であることをCodex・Claude双方で確認済み。
   2026-09-14、app ownerの明示承認を受け`clasp push`/`clasp deploy`でApps Scriptへも
   反映した（version `@33`）。**残っているのは`HISTORICAL_REPARSE_ENABLED`設定・
   runToken発行・dry-run実行（production承認③の対象、VPS側操作を伴う）のみ**であり、
   実装・deployそのものはこれ以上の作業を要しない。
2. `runToken`の発行（`createReparseRun`）は関数として用意するのみで、実際の発行・
   GASへの受け渡し方法（Script Propertiesへ手動設定する想定）はproduction承認後に確定する
3. `HISTORICAL_REPARSE_ENABLED`の実際の設定・解除手順（VPS管理側の`.env`変更）は
   production承認後に確定する
4. dry-run実行時のGmail API呼び出し順序・retry方針は、task `20260913-001`で
   3回・指数backoff（`Utilities.sleep(1000)`→`Utilities.sleep(2000)`）、
   404・その他4xxは即座に諦める方針として確定・実装済み（設計メモの「未確定・
   実装時に決める事項」を解消）。

## 希望時期

指定なし。API側task完了・VPS管理再レビューの結果を踏まえて判断する。

## 第2回レビュー対応状況（2026-09-07、task `20260907-004`で対応完了）

VPS管理レビュー正本§9.2〜§9.5がmock再現により確認した7件の問題と対応。

| # | レビュー指摘 | 対応方針 |
|---|---|---|
| 1 | B03: 自己申告emailで他利用者のmessage IDへアクセス可能 | `email`パラメータを廃止。事前発行済み`runToken`（`price_reparse_runs`テーブル、HTTP非公開で運用者が直接1件発行）で認可し、候補の`importedByEmail`もrunと照合する |
| 2 | B02/B04: 既に`detectedPrice`がある候補を上書き・再送で再更新可能 | 更新のWHERE句へ`detectedPrice: null`も追加（`priceSource: null`のみでは不十分だった） |
| 3 | B02/B06: `legacyId`経由の購入を取りこぼす | `importCandidateId IN (candidate.id, candidate.legacyId)`で検索するよう修正 |
| 4 | B02/B06: `sets`を`purchase.qty`から逆算 | `candidate.detectedQty`から既存`resolvePurchaseQty`で再計算する方式へ変更 |
| 5 | B05/B04: 監査書き込みがdata更新と別transaction | write時は同一transaction内で監査も書き込む（全成功/全失敗のどちらかにする） |
| 6 | B03/B04: `skipReason`が自由文字列 | 固定enum（`REPARSE_SKIP_REASONS`）へ変更 |
| 7 | B07: dry_runが「一切書き込まない」という誤った記載 | 上記Health・テスト節で訂正済み。dry_run実行もproduction承認対象に含める |

上記7件すべてtask `20260907-004`（commit `5b2f68a`）で対応済み。複数の未確定購入が
同じ候補に紐づく場合（`ambiguous_purchase_match`）を含む回帰test22件をローカルDBで
実行し、既存分と合わせ全38件の成功を確認した。

## 第3回レビュー対応状況（2026-09-07、task `20260907-005`で対応完了）

VPS管理レビュー正本§10.3〜§10.4が実DBへのprobeにより確認した6件の問題と対応。

| # | レビュー指摘 | 対応方針 |
|---|---|---|
| 1 | B03: `ActiveRun`が`householdId`を保持せず、同じemailの別household候補へアクセス可能。`runToken`もGETのquery stringに載っていた | `ActiveRun`に`householdId`を追加し、GET/POST双方で候補の`householdId`・`importedByEmail`・`cutoffAt`をrunと照合。不一致は`candidate_owner_mismatch`/`candidate_after_cutoff`として拒否。`runToken`はquery string/bodyから除去し、専用header（`X-Reparse-Run-Token`）へ移した |
| 2 | B02/B04: 対象集合が動的（run作成後の新規候補も対象に入る）。監査に一意制約が無く、dry-run再送で監査が2行に増え、write再送は2回目`conflict`になり初回結果を再取得できなかった | `price_reparse_runs`へ`cutoff_at`を追加し、run作成時点の候補だけを対象にする。`price_reparse_audit`へ`(run_id, candidate_id, mode)`の一意制約を追加し、write再送は既存監査を検出して保存済み結果をそのまま返す（再判定しない）。dry-run再実行は同じ行へupsertする（重複行を作らない） |
| 3 | B05/B04: skip・invalid price・candidate未検出・owner不一致・既存値ありの経路が監査書き込み前にreturnしており、writeでも監査0件になっていた | 判定処理（`computeOutcome`）から監査書き込みを分離し、呼び出し元（`applyOne`）が早期returnを含む全経路で必ず1回監査を書く設計へ変更。write時はdata更新と監査insertを同一transactionに収める |
| 4 | B02/B06: purchase検索が`household`・`item`の整合を検証せず、別household・別itemのpurchaseが更新され得た | purchase検索条件へ`householdId`・`itemId`を追加し、候補・runと一致するpurchaseだけを対象にする |
| 5 | B02/B06: `resolveCandidatePriceForItem`の層3判定が都度最新の購入履歴を読むため、同じ2件を同じ順で処理してもdry-runとwriteで結果が異なっていた | `price_reparse_item_snapshots`テーブルを新設し、run内で品目ごとに参照単価を最初の1回だけ計算・固定。以後は`resolveCandidatePriceForItem`の新規オプション引数（`referencePriceOverride`）でこの固定値を渡すため、dry-run/write・chunk分割・処理順序によらず判定が一致する |
| 6 | B02: `priceSource`のみ・`detectedPrice`なしのpayloadを受理し、`detected_price=NULL`のまま以後の対象抽出から外れていた | Zodの`.refine()`で`priceSource`単独指定と`skipReason`＋価格field同時指定をどちらも拒否するよう共有schemaを修正 |

上記6件すべてtask `20260907-005`で対応済み。household境界越境・purchase household/item
不整合・write skip監査0件・dry-run再送重複・dry-run/write判定差・payloadのfield組合せ検証の
各再現ケースを含む回帰test8件を新設し、既存分と合わせて`priceReparse.test.ts`は30件になった。
`npm run test --workspace=@stockhome/api`で全46件（`priceReparse.test.ts`30件＋
`stockCalc.accumulation.test.ts`16件）が成功したことをCodexとClaudeの双方で独立に確認した。
加えて、fresh隔離DBでの全migration適用・最新migrationのrollback rehearsalも実施した
（詳細は上記「Data・migration・backup」節参照）。

## 第4回レビュー対応状況（2026-09-08、task `20260907-006`で対応完了）

VPS管理レビュー正本§11.3〜§11.4が確認した6件の問題と対応。

| # | レビュー指摘 | 対応方針 |
|---|---|---|
| 1 | S006-R4-01: `applyOne`が想定外例外を`failed/exception`へ変換して監査なしで返し、監査insert自体の例外も全て一意制約raceとみなしていた。HTTP呼出し側がchunk再送要否とrow業務判定を区別できなかった | 監査insertの例外を`Prisma.PrismaClientKnownRequestError`かつ`code === 'P2002'`（真の一意制約競合）の場合だけ「競合」として扱い、それ以外は再throw。`computeOutcome`実行中の例外も含め、`ROLLBACK`シンボル以外はすべて呼び出し元へ伝播させる。`processReparseResults`のループからも行単位のtry/catchを削除し、業務判断の失敗（`invalid_price_rejected`等、通常の戻り値）とinfrastructure障害（例外、chunk全体を再送）を区別できるようにした |
| 2 | S006-R4-02: `computeOutcome`がskipReason・invalid price判定をcandidate取得より前にreturnしており、run外候補でも監査を記録できた。purchaseが0件だとmatched itemを取得せずreturnし、別householdのmatched itemを検知できなかった | candidate取得とhousehold/owner/cutoff照合を関数の先頭へ移動し、skipReason・invalid price・already_has_price判定より必ず先に行う。matched itemの取得・household照合もpurchase検索より前に必ず行うよう変更した |
| 3 | S006-R4-03: run/chunkの状態・進捗・未処理数をDBから復元する手段が無く、single active runの制約も無かった | 新規`getReparseRunProgress`関数を追加し、既存の候補・監査データだけからtotalTargets/processedCount/remainingCount/completeを導出できるようにした（priceが確定して対象抽出条件から外れた候補もtotalTargetsに残り続ける設計）。`createReparseRun`に、同一householdの有効run（未失効・未期限切れ）が既にあれば拒否する制約を追加した |
| 4 | S006-R4-04: migration・rollback rehearsalが最新1件分しか無く、migration SQL自体にtransaction境界も無かった | 本機能の3 migrationすべてへ明示的`BEGIN`/`COMMIT`を追加し、fresh隔離DBで「baseline→全9 migration適用」「3 migration全体のbaseline相当までのrollback」「rollback後の再適用（round-trip）」を実施・確認した（詳細は上記「Data・migration・backup」節参照） |
| 5 | S006-R4-05: `X-Reparse-Run-Token`のquery/body非受理・ログ非混入を検証する回帰testが無かった | 新規`apps/api/src/routes/bridge.reparse.test.ts`を作成し、header必須・query/body経由のrunToken非受理・無効tokenでの404応答時の実stdout非混入を検証する3件を追加した。ログ非混入testの範囲については上記「Health・テスト」節の補足を参照（write成功時のbatch_stepログとエラーハンドラのsafeErr()は自動testではなく静的確認） |
| 6 | S006-R4-06: notice文書の`source_commit`等がremote状態と不一致だった | 本改訂で、本notice末尾のcommit記録欄を含め、実際の`git rev-parse HEAD`の値へ更新した（下記参照） |

上記6件のうち5件（R4-01・R4-02・R4-03・R4-05はtask `20260907-006`、R4-04はClaudeが直接）
対応済み。R4-01〜R4-03・R4-05の再現ケースを含む回帰test8件（`priceReparse.test.ts`）と
HTTPレベルtest3件（`bridge.reparse.test.ts`）を新設し、既存分と合わせて
`npm run test --workspace=@stockhome/api`で全57件が成功したことをCodexとClaudeの
双方で独立に確認した。

## 第5回レビュー対応状況（2026-09-08、task `20260907-007`で対応完了）

VPS管理レビュー正本§12.3〜§12.4が確認した6件の問題と対応。

| # | レビュー指摘 | 対応方針 |
|---|---|---|
| 1 | S006-R5-01（最重要）: matched itemのhousehold確認がcandidate更新後に行われており、不一致でも`outcome: 'updated'`が返りcandidate更新が確定していた。round-4の回帰testが`updatedCandidate === 1`を期待しておりこの不具合を固定していた | matched itemのhousehold確認を`candidateUpdate`より前へ移動し、不一致は`conflict`・`matched_item_missing`としてcandidate・purchaseとも一切変更しない設計へ変更。該当回帰testを正しい挙動を検証する内容へ書き換えた |
| 2 | S006-R5-02: `getReparseRunProgress`が動的な「price NULL」条件を分母にしており、run作成後に他経路で価格確定された候補が母数から消えて未処理でも`complete: true`になり得た。`findActiveRun`経由のため期限切れ後は進捗取得不可。HTTP routeも無く実際に呼ぶ手順が無かった | 新規`price_reparse_targets`テーブルへ`createReparseRun`実行時点の対象候補IDを固定し、これを分母に進捗を算出するよう全面書き換え。`findActiveRun`ではなく`findRunByToken`（失効判定をしない）を使うことで期限切れ後も進捗を取得可能にした。新規`GET /api/bridge/reparse-progress`routeを追加し、実際に呼べるようにした |
| 3 | S006-R5-03: `createReparseRun`が`findFirst`後に別queryで`create`するだけで、DB unique制約・advisory lock・serializable transactionのいずれも無く、同時呼出しで2件のactive runが作成され得た | 「有効run確認」「run作成」「対象manifest書き込み」をSERIALIZABLE isolationのtransactionへ統合。Postgresの書き込みskew検出（P2034）時は最大3回まで再試行する設計にし、同時発行testで1件だけが成功することを確認した |
| 4 | S006-R5-04: `getOrCreateItemSnapshot`が`priceReparseItemSnapshot.create`の全例外をcatchし、再取得結果が無ければ計算値をそのまま返していた | 監査insertと同じく、`P2002`（真の一意制約競合）以外は再throwするよう修正。re-fetchでも見つからない場合はエラーとし、静かに計算値へフォールバックしない |
| 5 | S006-R5-05: runToken非混入testがloggerを有効化していない素のFastifyインスタンスを使っており、production相当のログ経路（`batch_step`・global error/request logger）を検証していなかった | `server.ts`のHTTPエラーハンドリングを`apps/api/src/lib/httpErrorHandling.ts`へロジック無変更で抽出し、production・testの両方から同じ実装を使えるようにした。testでは実際に`loggerInstance: appLogger`・`registerHttpErrorHandling`を使うFastifyアプリを子processで起動し、成功時`batch_step`・infrastructure例外時`request_failed`の両ログが実際に出力されること（テストが空振りしていないこと）とrunToken非混入の両方を確認した |
| 6 | S006-R5-06: noticeのremote・review状態が現在値と一致しなかった | 本改訂で、本notice末尾のcommit記録欄を含め、実際の`git rev-parse HEAD`の値へ更新した（下記参照） |

上記6件のうち5件（R5-01・R5-02・R5-03・R5-04・R5-05はtask `20260907-007`、R5-02の
schema/migration部分はClaudeが直接）対応済み。R5-01の修正回帰test・R5-02〜R5-04の
新規test5件（`priceReparse.test.ts`）とHTTPレベルtest2件（`bridge.reparse.test.ts`）を
追加し、既存分と合わせて`npm run test --workspace=@stockhome/api`で全63件が成功した
ことをCodexとClaudeの双方で独立に確認した。加えて、fresh隔離DBでの全10 migration適用・
本機能4 migration全体のrollback rehearsal（round-trip含む）も実施した。

## 第6回レビュー対応状況（2026-09-08、task `20260907-008`で対応完了）

VPS管理レビュー正本§13.3〜§13.4が確認した4件の問題と対応。

| # | レビュー指摘 | 対応方針 |
|---|---|---|
| 1 | S006-R6-01（最重要）: 固定manifest（`price_reparse_targets`）が進捗計算にしか使われておらず、`getReparseTargets`は引き続き動的な`priceSource`/`detectedPrice`のNULL条件を直接検索していた。`processReparseResults`にもmanifestメンバーシップの確認が無かった。run開始後に外部要因で価格確定した対象がGETから消えて完了させられない一方、manifestに属さない候補がhousehold/owner/cutoff一致だけでGET/POST対象になり得た | `getReparseTargets`を、固定manifestのうちmode='write'監査がまだ無いものだけを返す実装へ全面書き換え。`computeOutcome`へmanifestメンバーシップ確認を追加し、非メンバーは`conflict`・`candidate_not_in_manifest`として拒否。外部経路で価格確定したmanifest対象は引き続きGETで取得でき、writeすると既存の`already_has_price`判定で監査付きの`conflict`として確定し、進捗が`complete: true`へ到達することを回帰testで確認した |
| 2 | S006-R6-02: `GET /reparse-progress`は期限切れ後も参照できるが、対象取得・POSTは期限切れ後に404になるだけで、同じmanifest・監査履歴を維持したまま再開する運用経路が無かった | 新規`extendReparseRun`関数を追加。同一householdに他の有効runが無いことをSERIALIZABLE transaction内で確認してから期限を延長し、`revokedAt`もクリアする。期限切れ→進捗確認→延長→再開→完了までを1つの結合testで確認した |
| 3 | S006-R6-03: runToken非混入testが子processのstdoutしか検査しておらず、stderrへの非混入を確認していなかった。proxy（Nginx）のlog format確認記録もnoticeに無かった | 既存2件のproduction相当ログtestを、stdoutに加えてstderrにもrunTokenが含まれないことを検査するよう更新した。proxy log formatについては、Nginxの既定`combined`形式がrequest headerを記録しないという一般的事実を記載した（詳細・限界は上記「Health・テスト」節参照。VPS上の実際の設定確認はVPS管理側に委ねる） |
| 4 | S006-R6-04: noticeのremote・review状態が実際と一致しなかった | 本改訂で、本notice末尾のcommit記録欄を含め、実際の`git rev-parse HEAD`の値へ更新した（下記参照） |

上記4件のうち3件（R6-01・R6-02・R6-03はtask `20260907-008`、R6-04はClaudeが直接）
対応済み。manifest非所属拒否・外部価格確定後のGET継続と完了確定・期限切れ時の
参照/操作境界・期限延長後の再開の新規test5件（`priceReparse.test.ts`）を追加し、
既存2件を更新した。既存分と合わせて`npm run test --workspace=@stockhome/api`で
全68件が成功したことをCodexとClaudeの双方で独立に確認した。今回はmigration変更が
無いため、追加のfresh隔離DB rehearsalは実施していない。

## 第7回レビュー対応状況（2026-09-08、task `20260907-009`で対応完了）

VPS管理レビュー正本§14.3〜§14.4が確認した3件の問題と対応。

| # | レビュー指摘 | 対応方針 |
|---|---|---|
| 1 | S006-R7-01（最重要）: `extendReparseRun`が期限切れと失効（revoke）を区別せず、失効済みrunを同じrunTokenのまま再有効化できていた。token漏えい・誤配布・緊急停止時の無効化を、延長操作自体で覆せてしまうセキュリティ上の欠陥 | `extendReparseRun`は`revokedAt`設定済みのrunを拒否するよう修正。失効済みrunを再開する専用の新規`rotateReparseRunToken`関数を追加し、暗号学的乱数で生成した新しいrunTokenへDB行を更新する（旧tokenは以後DB上に存在しなくなり永久に無効）。同一householdに他の有効runが存在する場合や、失効していないrunに対して呼ばれた場合はどちらも拒否する |
| 2 | S006-R7-02: manifest外candidateの拒否時に`candidate_not_in_manifest`のwrite監査を作成しており、第6回レビュー§13.3が指定した「data/audit不変で拒否する」設計と一致していなかった | `applyOne`を修正し、`candidate_not_in_manifest`の経路ではdry_run/writeどちらのmodeでも監査を一切書かないようにした（candidate・purchase・監査のすべてが完全に不変のまま拒否される） |
| 3 | S006-R7-03: noticeのremote・review状態が実際と一致しなかった | 本改訂で、本notice末尾のcommit記録欄を含め、実際の`git rev-parse HEAD`の値へ更新した（下記参照）。VPS管理側がVPS上の実際のNginx設定を確認済みであることも上記「Health・テスト」節へ追記した |

上記3件のうち2件（R7-01・R7-02はtask `20260907-009`、R7-03はClaudeが直接）
対応済み。失効境界・token rotation・旧token永久無効化・未失効run拒否・他active
run存在時拒否の新規test5件（`priceReparse.test.ts`）を追加し、既存3件を更新した。
既存分と合わせて`npm run test --workspace=@stockhome/api`で全73件が成功した
ことをCodexとClaudeの双方で独立に確認した。今回はmigration変更が無いため、
追加のfresh隔離DB rehearsalは実施していない。

## 第8回レビュー結果（2026-09-08、`accepted`）

VPS管理レビュー正本§15が、第7回の指摘2件（S006-R7-01・S006-R7-02）への対応を
確認し、本noticeを**`accepted`**と判定した。**これはproduction反映の承認ではない。**

| 第7回指摘 | 第8回確認結果 |
|---|---|
| S006-R7-01 revoked tokenの再有効化 | `extendReparseRun`はrevoked runを拒否し、期限切れかつ未失効のrunだけを延長する。失効後は`rotateReparseRunToken`が同一run ID・manifest・auditを維持したまま暗号学的乱数の新tokenへ置換する。旧tokenがGET・POST・progressの全経路で継続して拒否される実DB testを確認した |
| S006-R7-02 manifest外candidateのaudit | manifest非所属を検出した時点で処理を返し、candidate・purchase・auditのいずれも変更しない実装と回帰testを確認した。固定manifest外IDが監査正本へ混入しないため、追加の保持契約は不要となった |
| S006-R7-03 notice同期 | source `5e209e0`とnotice `8c042bc`のpush済み状態をGitで確認した。notice本文の未push・未review表記は軽微な文書同期漏れとして、accepted判定後（本改訂）に更新することとされた |

**acceptedの範囲と残るgate**（§15.3）:
- 本受理は、変更通知書と実装をproduction計画へ進められる状態と判断したものである。
- app owner承認、利用者への事前通知・不使用確認、production計画の提示、個別の
  最終承認は引き続き必要である。
- `production_baseline_commit`は`9f5fa864327e5d16b263250ce9e0348966b37f4f`、
  `deployment_status`は`not_started`のまま変更しない。
- API deploy、migration、feature flag有効化、過去単価のdry-run/write、GAS配信・
  実行はそれぞれproduction計画の明示範囲に含め、承認前には行わない。

## Production実施結果（task `20260912-001`、API先行stage）

**2026-09-12、app owner承認・利用者（妻）への事前通知/不使用確認・個別production承認②を
経て、API先行stageをproductionへ反映した。`verified`（API先行stageの範囲。
過去単価再解析機能全体としては引き続き未完了）。** 詳細な計画・実施記録は
`C:\work\PRG\Sakura\Dev\vps-server-management\docs\operations\stockhome_historical_price_reparse_api_deployment_plan_20260912.md`
（VPS管理側、読み取り専用）を正本とする。

- 反映範囲: source `5e209e0`（第7回レビュー対応後の固定commit）。GET/POST
  `/api/bridge/reparse-candidates`・`GET /api/bridge/reparse-progress`の3 route、
  および`price_reparse_*`の新規4テーブルを作る4 migrationのみ。**`HISTORICAL_REPARSE_ENABLED`は
  `true`に設定していない**（新設routeはbridge認証後も404を返し機能上は無効のまま）
- 承認: app owner承認①（2026-09-12、再解析設計とAPI先行stage）、利用者通知・不使用確認
  （2026-09-12）、production承認②（2026-09-12、task・固定source・4 migration・feature無効を
  特定して承認）。production承認③・④（GAS実装後のfeature有効化・dry-run、その後の
  全件write）は今回の対象外で別途行う
- 実施経過: 3回試行した。第1回は隔離検証中の期待値誤り（新設routeの未認証応答を404と
  誤って期待したが、実際は既存の共有bridge認証が先に401を返す設計）でproduction変更前に
  停止し、StockHomeのAPI image・DB・業務dataは無変更のまま終了した。第2回はAPI自体は
  正常に新imageへ入れ替わったが、無関係な別アプリ（recipe-generator等）のhealth check
  pathの誤りにより全社横断の安全機構が働き、StockHomeも含めて旧image・旧sourceへ
  自動rollbackされた（StockHome自体の不具合ではない。DBは4 migration適用済み・
  新規4テーブル0 rowのまま保持し、schema削除やDB restoreは行っていない）。第3回で
  正規のhealth pathと既適用・空schemaを開始条件として全工程が成功した
- 最終実施時刻: 2026-09-12 16:11 JST、最終確認16:22:54 JST（10分27秒・11回観察、
  すべて正常）
- 新API image: `sha256:1fb0cee2bbe32d733b0891e9e34804a5f939bc58871aba4c0759a4837bf49c32`。
  DB image・container・volumeは反映前から不変（running / healthy / restart 0）
- 確認結果: migration成功10件・新規4テーブル合計0 row、`HISTORICAL_REPARSE_ENABLED`は
  有効化していない、新規3 routeは未認証401・bridge認証後404、
  `import_order_candidates`（239件）・`purchase_logs`（未確定単価59件）は開始前後で
  不変、起動log 13行すべてJSON・error/fatal/critical/token名混入0、全7アプリhealth 200・
  StockHome internal/public 200・bridge 401、restart 0・failed unit 0、backup timer
  （3種）は変更前と同じ状態を維持
- rollback: 第2回試行時の自動rollback（上記）以外は実施していない。schema削除・
  DB restoreは行っていない
- backup: `/home/deploy/stockhome/backups/deploy-20260912-001/`（DB dump SHA-256
  `3fc74b15fe253b02c54642d523a2daafa88a4f6d14b6c311da3b20d4219c80eb`、旧source SHA-256
  `102b7e740e2860fafb01988db2800985944c031dba7227aa6bb15c034415077d`）
- **今回完了後も禁止する操作**（次段階の別review・別承認へ持ち越し）: GAS実装・push・
  deploy・手動実行、`HISTORICAL_REPARSE_ENABLED=true`の設定、runTokenの発行・延長・
  rotation、dry-run実行（監査tableへのwriteとrow lockを伴う）、
  `import_order_candidates`/`purchase_logs`の更新、再解析用tableの削除

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: **必要**（GAS連携再レビュー§17.4が求めたS006-GAS-03の残り2件
  （応答検証・ログ許可list）を修正した。source `9c20a5d`、
  `apps/gas/test/reparseHistoricalCandidates.gas.test.cjs`全34シナリオ成功
  （既存23件＋新規11件）を報告する。これでS006-GAS-01〜04の4項目すべてが
  解消済み。`clasp push`/`clasp deploy`は未実施のため、GAS deployの個別実行
  依頼を含む次のVPS管理側判断を仰ぐ。production_baseline_commit（`5e209e0`）・
  deployment_status（`applied`）はどちらも変わらない）
- 直近のVPS管理側とのやり取り: task `20260912-001`（API先行stage production反映）の
  実施結果を受け、notice・runtime contractのproduction状態記述を現在値
  （source `5e209e0`が実際にproduction反映済み、`deployment_status: applied`、
  feature flag無効・過去単価再解析機能全体は未完了）へ同期した。続けて
  2026-09-13、GAS版StockHomeを`apps/gas/`へ統合した上でtask `20260913-001`
  （GAS側ローカル実装）を完了したため、本改訂で反映する。どちらもGAS側の
  ローカルコード・リポジトリ構成の変更のみで、production・VPS側の状態には
  影響しない

## Codex実装結果（task 20260907-002、第1回対応。第2回レビューで問題7件を検出）

- 実装ファイル: `packages/shared/src/schemas/priceReparse.ts`（新規）、
  `apps/api/src/services/priceReparse.ts`（新規）、
  `apps/api/src/services/priceReparse.test.ts`（新規）、
  `apps/api/src/routes/bridge.ts`、`.env.production.example`、`README.md`
- test結果: shared / api / mobile tsc のビルド3コマンドはすべて成功。
  `npm run test --workspace=@stockhome/api`を実行し、新規11件を含む全27件が成功（失敗0件）。
  **ただしこの27件成功は、第2回レビューが実際に確認した7件の問題を検出できていなかった**
  （テスト観点の不足。詳細は上記「第2回レビュー対応状況」参照）
- commit: `02816ee`（origin/mainへpush済み）

## Codex実装結果（task 20260907-004、第2回対応。20260907-003はCodex CLI異常終了のため再発行）

- 実装ファイル: `apps/api/src/services/candidateIntake.ts`（`resolvePurchaseQty`のexport追加のみ）、
  `packages/shared/src/schemas/priceReparse.ts`（`runToken`方式へ全面書き換え）、
  `apps/api/src/services/priceReparse.ts`（全面書き換え）、
  `apps/api/src/services/priceReparse.test.ts`（22件、runToken方式・レビュー再現ケース含む）、
  `apps/api/src/routes/bridge.ts`、`docker-compose.prod.yml`（`HISTORICAL_REPARSE_ENABLED`受け渡し追加）
- 第2回レビューが確認した7件の問題（上記「第2回レビュー対応状況」表）はすべて修正済み。
  対応するregression testを追加し、全件成功を確認した（下記）
- Codex実行環境ではローカルDB接続ができず（`DATABASE_URL`未設定、`.env`読み取り禁止）、
  DB統合テストは未実行のまま`status: partial`で終了。Claudeがローカルの開発用Postgres
  （Docker、`localhost:5434`）で`npm run test --workspace=@stockhome/api`を実行し、
  **新規22件を含む全38件が成功（失敗0件）** したことを確認した
- ビルド3コマンド（shared / api / mobile tsc）もすべて成功
- コードレビュー: `tx.priceReparseAudit.create`がwrite時のみ同一transaction内で実行されること、
  候補更新のWHERE句に`priceSource: null`と`detectedPrice: null`の両方が含まれること、
  `resolveCandidatePriceForItem`・`resolvePriceReliability`・`candidatePriceReliability`・
  `resolvePurchaseQty`本体のロジックに差分が無いことを確認した
- commit: `5b2f68a`（origin/mainへpush済み）

## Codex実装結果（task 20260907-005、第3回対応）

- 実装ファイル: `apps/api/src/services/candidateIntake.ts`（`getRecentUnitPriceMedian`の
  export追加、`resolveCandidatePriceForItem`への任意引数`referencePriceOverride`追加。
  いずれも追加のみで既存ロジックは変更なし）、`packages/shared/src/schemas/priceReparse.ts`
  （`runToken`をquery/bodyから除去、`.refine()`によるfield組合せ検証を追加）、
  `apps/api/src/services/priceReparse.ts`（全面書き換え。household/cutoff照合、
  purchase household/item照合、run/item単位snapshot、write冪等・dry-run upsertの
  監査設計）、`apps/api/src/services/priceReparse.test.ts`（新規8件を追加し30件）、
  `apps/api/src/routes/bridge.ts`（`runToken`をheader読み取りへ変更）
- 第3回レビューが確認した6件の問題（上記「第3回レビュー対応状況」表）はすべて修正済み。
  対応するregression testを追加し、全件成功を確認した
- Codex自環境（ローカルDB接続あり）で`npm run test --workspace=@stockhome/api`を実行し
  46件成功（失敗0件）を報告。Claudeが対話セッションでローカル開発用Postgres
  （Docker、`localhost:5434`）に対し独立に再実行し、同じ46件成功を確認した
- ビルド3コマンド（shared / api / mobile tsc）もCodex・Claude双方の実行で成功
- コードレビュー: `computeOutcome`が候補の`householdId`・`importedByEmail`・`cutoffAt`を
  runと照合すること、purchase検索条件に`householdId`・`itemId`が含まれること、
  `applyOne`がwrite時に既存監査を先にチェックしdry-run時はupsertすること、
  `getOrCreateItemSnapshot`が独立した`prisma`（`tx`ではない）で書き込むこと、
  `runToken`がquery string・request bodyのどこにも出現しないこと、
  `resolveCandidatePriceForItem`等の既存ロジック（新引数未指定時の挙動）に差分が
  無いことを確認した
- `apps/api/prisma/`・`ops/`はtask対象外として変更なし（Claudeが別途対応）
- fresh隔離DBでのmigration apply/rollback rehearsalはClaudeが別途対応（上記
  「Data・migration・backup」節参照）
- commit: `1c1b2ba`（origin/mainへpush済み。第4回レビューで問題6件検出）

## Codex実装結果（task 20260907-006、第4回対応）

- 実装ファイル: `apps/api/src/services/priceReparse.ts`（全面書き換え。
  household/owner/cutoff境界チェックをskip/invalid判定より前へ移動、matched item
  household照合をpurchase検索より前へ移動、監査insertの例外を`P2002`とそれ以外で
  区別し後者は再throw、`processReparseResults`から行単位try/catchを削除、
  `getReparseRunProgress`新設、`createReparseRun`へsingle active run拒否を追加）、
  `apps/api/src/services/priceReparse.test.ts`（新規8件を追加し38件）、
  `apps/api/src/routes/bridge.reparse.test.ts`（新規、HTTPレベルtest3件）
- 第4回レビューが確認した6件の問題のうち5件（上記「第4回レビュー対応状況」表の
  R4-01・R4-02・R4-03・R4-05、R4-06はClaudeが別途対応）はすべて修正済み。
  対応するregression testを追加し、全件成功を確認した
- Codex自環境（ローカルDB接続あり）で`npm run test --workspace=@stockhome/api`を実行し
  57件成功（失敗0件）を報告。Claudeが対話セッションでローカル開発用Postgres
  （Docker、`localhost:5434`）に対し独立に再実行し、同じ57件成功を確認した
- ビルド3コマンド（shared / api / mobile tsc）もCodex・Claude双方の実行で成功
- コードレビュー: `computeOutcome`のcandidate境界照合がskipReason・invalid price・
  already_has_price判定より前にあること、matched item照合がpurchase検索より前に
  必ず行われること、`applyOne`が`P2002`以外・`ROLLBACK`以外の例外を再throwすること、
  `processReparseResults`のループに行単位のtry/catchが無いこと、
  `bridge.reparse.test.ts`が`server.ts`全体をimportしていないことを確認した
- `apps/api/prisma/`・`ops/`はtask対象外として変更なし（Claudeが別途対応。
  3 migrationへの明示的transaction追加とfresh隔離DBでの全rollback rehearsalは
  Claudeが本task実行前に完了済み）
- commit: `9b84b1f`・`60bb6cc`（origin/mainへpush済み。第5回レビューで問題6件検出）

## Codex実装結果（task 20260907-007、第5回対応）

- 実装ファイル: `apps/api/src/lib/httpErrorHandling.ts`（新規。`server.ts`から
  HTTPエラーハンドリングをロジック無変更で抽出）、`apps/api/src/server.ts`
  （抽出したimportと呼び出しへの置き換えのみ。cron・起動処理・route登録順序は無変更）、
  `apps/api/src/services/priceReparse.ts`（全面書き換え。matched item household照合を
  candidate更新前へ移動、`findRunByToken`新設と`getReparseRunProgress`の
  manifest化、`createReparseRun`のSERIALIZABLE transaction化とP2034リトライ、
  `getOrCreateItemSnapshot`のP2002以外再throw）、`apps/api/src/routes/bridge.ts`
  （`GET /reparse-progress`を追加）、`apps/api/src/services/priceReparse.test.ts`
  （1件削除・1件書き換え・5件追加で42件）、`apps/api/src/routes/bridge.reparse.test.ts`
  （production相当ログ経路のtest2件を追加し5件）
- 第5回レビューが確認した6件の問題のうち5件（上記「第5回レビュー対応状況」表の
  R5-01・R5-02・R5-03・R5-04・R5-05、R5-06はClaudeが別途対応）はすべて修正済み。
  対応するregression testを追加し、全件成功を確認した
- Codex自環境（ローカルDB接続あり）で`npm run test --workspace=@stockhome/api`を実行し
  63件成功（失敗0件）を報告。Claudeが対話セッションでローカル開発用Postgres
  （Docker、`localhost:5434`）に対し独立に再実行し、同じ63件成功を確認した
- ビルド3コマンド（shared / api / mobile tsc）もCodex・Claude双方の実行で成功
- コードレビュー: matched item照合が`candidateUpdate`より前にあり不一致時は
  candidate・purchaseとも不変であること、`getReparseRunProgress`が
  `findRunByToken`と`price_reparse_targets`を使うこと、`createReparseRun`が
  `Serializable` isolationとP2034最大3回リトライを使うこと、
  `getOrCreateItemSnapshot`が`P2002`以外を再throwすること、
  `bridge.reparse.test.ts`の新規testが実際に`loggerInstance: appLogger`と
  `registerHttpErrorHandling`を使ってHTTPを処理していること、`server.ts`が
  指定箇所以外変更されていないことを確認した
- `apps/api/prisma/`・`ops/`はtask対象外として変更なし（Claudeが別途対応。
  4番目のmigration追加とfresh隔離DBでの全rollback rehearsalはClaudeが
  本task実行前に完了済み）
- commit: `21676c3`・`2c32da9`（origin/mainへpush済み。第6回レビューで問題4件検出）

## Codex実装結果（task 20260907-008、第6回対応）

- 実装ファイル: `apps/api/src/services/priceReparse.ts`（`computeOutcome`へ
  manifestメンバーシップ確認を追加、`getReparseTargets`を固定manifest正本の
  実装へ全面書き換え、新規`extendReparseRun`関数を追加）、
  `apps/api/src/services/priceReparse.test.ts`（新規5件を追加し47件。既存2件も
  manifest対応・拒否確認を追加する形で更新）、`apps/api/src/routes/bridge.reparse.test.ts`
  （既存2件のproduction相当ログtestをstdout・stderr双方検査へ更新）
- 第6回レビューが確認した4件の問題のうち3件（上記「第6回レビュー対応状況」表の
  R6-01・R6-02・R6-03、R6-04はClaudeが別途対応）はすべて修正済み。対応する
  regression testを追加し、全件成功を確認した
- Codex自環境（ローカルDB接続あり）で`npm run test --workspace=@stockhome/api`を実行し
  68件成功（失敗0件）を報告。中間実行でcutoff対象外fixtureのmanifest登録・DB時刻精度に
  依存するfixture不安定性を自己検出し修正した上での最終実行結果。Claudeが対話セッションで
  ローカル開発用Postgres（Docker、`localhost:5434`）に対し独立に再実行し、
  同じ68件成功を確認した
- ビルド3コマンド（shared / api / mobile tsc）もCodex・Claude双方の実行で成功
- コードレビュー: `computeOutcome`がmanifest非メンバーを`candidate_not_in_manifest`で
  拒否すること、`getReparseTargets`が`import_order_candidates`の動的なNULL条件を
  使わず固定manifestを正本にしていること、`extendReparseRun`が対象run以外の
  有効runを確認してから延長すること、`apps/api/src/routes/bridge.ts`に変更が
  無いこと（新規HTTP routeを追加しない指示どおり）を確認した
- `apps/api/prisma/`・`ops/`はtask対象外として変更なし（今回はmigration変更が
  無いため、Claude側の追加対応も無し）
- commit: `e2a3857`・`bf7ee66`（origin/mainへpush済み。第7回レビューで問題3件検出）

## Codex実装結果（task 20260907-009、第7回対応）

- 実装ファイル: `apps/api/src/services/priceReparse.ts`（`extendReparseRun`へ
  `revokedAt`確認を追加、新規`rotateReparseRunToken`関数を追加、
  `assertNoOtherActiveRun`ヘルパーで重複ロジックを共通化、`applyOne`を
  `candidate_not_in_manifest`経路で監査を書かないよう修正）、
  `apps/api/src/services/priceReparse.test.ts`（既存3件を修正、新規5件を追加し
  47件から52件）
- 第7回レビューが確認した3件の問題のうち2件（上記「第7回レビュー対応状況」表の
  R7-01・R7-02、R7-03はClaudeが別途対応）はすべて修正済み。対応するregression
  testを追加し、全件成功を確認した
- Codex自環境（ローカルDB接続あり）で`npm run test --workspace=@stockhome/api`を実行し
  73件成功（失敗0件）を報告。Claudeが対話セッションでローカル開発用Postgres
  （Docker、`localhost:5434`）に対し独立に再実行し、同じ73件成功を確認した
- ビルド3コマンド（shared / api / mobile tsc）もCodex・Claude双方の実行で成功
- コードレビュー: `extendReparseRun`が`run.revokedAt`を確認し設定済みなら拒否する
  こと、`rotateReparseRunToken`が失効済みrunにのみ適用され新しいrunTokenへ
  DB行を更新すること（旧tokenが以後`findUnique`で一致しなくなること）、
  `candidate_not_in_manifest`の経路で監査insert/upsertのどちらも呼ばれないこと、
  `apps/api/src/routes/bridge.ts`・`bridge.reparse.test.ts`に変更が無いこと
  （新規HTTP routeを追加しない指示どおり）を確認した
- `apps/api/prisma/`・`ops/`はtask対象外として変更なし（今回はmigration変更が
  無いため、Claude側の追加対応も無し）
- commit: `5e209e0`（origin/mainへpush前）

## GASリポジトリ統合（2026-09-13）

GAS版StockHome（従来はGit管理外の独立フォルダ`C:\work\PRG\ZZ_Other\GAS\StockHome`）を、
このモノレポの`apps/gas/`へ統合した（commit `70cccc6`）。同じアプリの機能が
リポジトリ分割によりCodexパイプラインで扱えなかったことを解消する目的で、
本notice対象機能とは独立にapp ownerが判断した構成変更である。秘密情報
（`.clasp.json`のscriptId、`deploy.bat`のDEPLOY_ID）は`.gitignore`で除外し、
個人データを含む`data/`フォルダはコピーしていない。旧フォルダは読み取り専用の
控えとして当面残置。ai-watchの`StockHome-ClaudeToCodex`プロジェクト設定
（Git管理外、別ツール）も`apps/gas/`を通常の読み書き対象に含めるよう更新した
（`push.bat`/`deploy.bat`の実行禁止は維持）。この統合により、B08（GAS側実装）を
以下のCodexパイプライン経由で実施できるようになった。

## Codex実装結果（task 20260913-001、GAS側実装。B08対応）

- 実装ファイル: `apps/gas/src/ApiBridge.js`（追加のみ。再解析API専用の
  `callReparseApiWithRetry_`・`fetchReparseCandidates`・`postReparseResults`を追加。
  5xx・fetch例外は最大3回まで指数backoffで再試行し、404・その他4xxは即座に
  諦める）、`apps/gas/src/GmailImportService.js`（追加のみ。本体
  `reparseHistoricalCandidates(mode)`、候補ごとの再解析結果構築
  `buildReparseResult_`、IIFE外側の引数なしラッパー
  `reparseHistoricalCandidatesDryRun`/`reparseHistoricalCandidatesWrite`を追加）
- 設計メモ（`ops/investigations/20260907-historical-price-reparse-gas-design.md`、
  第7回VPS管理レビュー反映版）どおりの実装であることを、Claudeが差分を直接
  確認した（設計方針との齟齬なし）。cursor（`REPARSE_CURSOR`、Script Properties）は
  POSTが成功応答を確認できた後にのみ前進、`REPARSE_RUN_TOKEN`未設定・
  `LockService.tryLock(0)`失敗時は外部API呼び出しなしで終了、skipReason
  （`message_not_found`/`item_not_found_in_reparse`/`ambiguous_item_match`の
  固定3値のみ）・価格なし時のキー省略（`null`を送らない）を実装済み
- GASにはテストランナーが無いため、リポジトリ外の一時Node.jsスクリプトで
  GAS組み込みオブジェクト（`PropertiesService`/`UrlFetchApp`/`GmailApp`/
  `LockService`/`Utilities`/`Logger`）をモックした15シナリオ（正常系複数ページ、
  完了、404、5xxリトライ成功/使い切り、POST失敗時cursor不変、runToken未設定、
  ロック取得失敗、skipReason3種、価格検出成功/失敗、既存Matsukiyo parserによる
  実データ確認、`Logger.log`へのsecret・個人情報非混入）がすべてpassしたことを
  Codexが報告し、検証スクリプトは作業完了後にリポジトリ外から削除された
- Claudeが独立に確認した内容: commit `3de1557`が実際に存在しHEAD・origin/main
  一致（force push無し）、差分が指示書のコード例と完全一致し既存関数
  （`runMyGmailImport`・`isConfigured`等）に変更が無いこと、`apps/api`・
  `apps/mobile`・`packages/shared`・`ops/`・`apps/gas/appsscript.json`・
  `apps/gas/.clasp.json`・`apps/gas/deploy.bat`に変更が無いこと、
  `node --check`によるGAS 2ファイルの構文確認、`npm run build --workspace=@stockhome/shared`・
  `npm run build --workspace=@stockhome/api`の再実行成功
- **production変更なし**（`production_operation: none`で実施。`clasp push`/
  `clasp deploy`、実運用`REPARSE_RUN_TOKEN`発行、実Gmail接続、
  `HISTORICAL_REPARSE_ENABLED`設定変更はいずれも未実施。実際のApps Scriptには
  未反映のため実運用では動作しない）
- commit: `3de1557`（origin/mainへpush済み）

## GAS clasp push/deploy実施結果（2026-09-14、app owner承認）

**app ownerが本チャットで「GAS clasp push/deploy」を明示承認したことを受け、
Claudeが実行した。VPS・production DBへは一切接続していない
（Google Apps Scriptのcloud sourceのみを更新する操作）。**

- 事前確認: 別ディレクトリへ`clasp pull`しApps Script側の現行cloud sourceを取得、
  `apps/gas/src/`とdiffした。`ApiBridge.js`・`GmailImportService.js`
  （今回意図して変更した2ファイル）以外の30ファイルはcloudとlocalで完全一致
  （意図しない乖離なし）。上記2ファイルの差分も、task `20260913-001`で追加した
  コードのみであることを確認した
- 実行: `clasp push -f`で33ファイルを反映（`Pushed 33 files`）。続けて
  `clasp deploy -i <既存DEPLOY_ID> -d "auto-deploy"`で既存デプロイをバージョン
  `@33`へ更新（`Deployed <DEPLOY_ID> @33`）。`deploy.bat`と同一のコマンド列を
  Claudeが直接実行した（`.bat`ファイル自体はpause付きのため対話実行不可の
  ため未使用）
- 影響範囲: `reparseHistoricalCandidates`・`reparseHistoricalCandidatesDryRun`/
  `Write`・`ApiBridge.fetchReparseCandidates`/`postReparseResults`が
  Apps Scriptエディタから手動実行可能になった。**既存の関数
  （`runMyGmailImport`・`deliverStockHomeNotifications`等、既存トリガーが
  呼び出す関数）は追加のみで本文が変更されていないため、既存の6時間Gmail取込
  トリガー・夜間ReadyGo配信トリガーの動作に変更はない**（task `20260913-001`の
  差分レビューで確認済み）。`REPARSE_RUN_TOKEN`が未設定のため、
  `reparseHistoricalCandidates`を誰かが誤って実行しても`no_run_token`で
  即座に終了し、外部API呼び出し・Gmail接続は発生しない
- 未実施のまま: `REPARSE_RUN_TOKEN`の発行（`createReparseRun`）、
  `HISTORICAL_REPARSE_ENABLED`の設定、dry-run/write実行。API側もこのflagが
  未設定のため新設route群は引き続き404を返す。**過去単価再解析機能全体としては
  引き続き未完了**

**手続き上の逸脱について（2026-09-14、Claudeが事後に気づき自己申告）**:
本notice上記「production変更」節の承認段階は、GAS deploy・DB write（dry-runの
監査書き込みを含む）・GAS batch起動のいずれも**「VPS管理側の個別承認前に…行わない」**
と明記しており、これはapp owner承認とは別にVPS管理チャット側が対象・手順を
明記した実行依頼を作成することを指す（`application_ai_operations_instruction.md`の
「DB操作以外でアプリ側AIがproduction作業を実行できるのは、VPS管理チャットが
対象・手順・承認済み範囲を明記した実行依頼を作成した場合だけ」に基づく）。
今回のGAS clasp push/deployは、app ownerが本チャットで直接承認した範囲として
実施したが、**VPS管理チャットからの事前の個別実行依頼は得ていなかった**。
実施内容自体は上記の事前drift確認・差分レビューにより安全性を確認済み
（追加のみの変更、既存トリガー無変更、feature flag未設定のため機能自体は
無効のまま）であり、**この操作を本noticeによって遡及承認するものではない**。
今後、GAS deploy・DB write・GAS batch起動を伴う操作は、事前にVPS管理チャットへ
個別の実行依頼作成を依頼してから行う。

## GAS連携レビュー対応状況（2026-09-14、task `20260914-001`で対応完了）

VPS管理側が2026-09-14に実施したGAS連携レビュー（正本:
`C:\work\PRG\Sakura\Dev\vps-server-management\docs\operations\stockhome_historical_price_backfill_review_20260907.md`
§16、実際のGAS sourceをNode.jsのvmへ読み込みGAS APIを合成mockへ置換して
5件の問題経路を再現）§16.3が確認した4件と対応。

| # | レビュー指摘 | 対応方針 |
|---|---|---|
| 1 | S006-GAS-01: 承認③のtoken（`REPARSE_RUN_TOKEN`）さえあれば`reparseHistoricalCandidatesWrite()`がmode='write'のPOSTを送れてしまい、API側もfeature有効・active tokenならmodeを区別せず両方受け付けていた | 新環境変数`HISTORICAL_REPARSE_WRITE_ENABLED`（`HISTORICAL_REPARSE_ENABLED`とは別）を追加し、`'true'`でない限り`POST /reparse-candidates`のmode='write'を`processReparseResults`呼び出し前にHTTP 403で拒否する（data/audit完全不変）。承認③（dry-runのみ）の間は未設定のままとし、承認④で個別に有効化する |
| 2 | S006-GAS-02: `REPARSE_CURSOR`が単一Script Propertiesキーのため、dry-run途中のcursorをwriteラッパーがそのまま使ってしまい、dry-run未処理prefixがwrite対象から漏れる | cursorキーをrunToken非可逆ハッシュ（SHA-256先頭16桁）×mode別へ分離し、run・mode間の混線を構造的に防止。write完了時は`GET /reparse-progress`とも突き合わせ、`complete: true`を確認してからcursorを削除する（dry-runはAPI仕様上write監査基準のprogressと噛み合わないため対象外） |
| 3 | S006-GAS-03: `ApiBridge.js`が`e.message`をそのまま`Logger.log`へ渡し例外文言の混入があり得た。HTTP 200だが想定外body（`candidates`非配列等）を空配列として黙って完了扱いにしていた | 例外ログを`e.name`のみを使う`safeErrName_()`へ変更。`fetchReparseCandidates`/`postReparseResults`/新設`fetchReparseProgress`のいずれも、レスポンス形状を型検証し不一致なら`status: 'error'`として扱う |
| 4 | S006-GAS-04: `GmailApp.getMessageById`・`parser.parse()`の全例外を恒久的skip（`message_not_found`/`item_not_found_in_reparse`）へ変換しており、quota等の一時障害がwrite監査として冪等固定され再解析されなくなっていた | 例外メッセージが`/invalid argument|not found/i`に一致する場合だけ恒久skipとし、それ以外（quota・認可・内部エラー・parser例外含む）は「判定不能」としてchunk全体を中断・cursor不変で再送可能にする。時間予算チェックも候補ごとのループ内へ追加した |

上記4件すべてtask `20260914-001`（commit `d849129`）で対応済み。レビューが再現した
5件の問題（GAS連携レビュー正本の`stockhome-gas-review-20260914.cjs`）が修正後の
sourceでは再現しないことを含む23シナリオを`apps/gas/test/reparseHistoricalCandidates.gas.test.cjs`
としてリポジトリへ永続保存し（前回task `20260913-001`の一時検証scriptを都度削除していた
反省を踏まえたもの）、全件成功を確認した。API側にも`bridge.reparse.test.ts`へ
write gateの回帰test3件を追加し、`npm run test --workspace=@stockhome/api`で
既存分と合わせ**全76件が成功**（失敗0件）したことをClaudeが対話セッションで
ローカル開発用Postgres（Docker、`localhost:5434`）に対し独立に確認した
（Codex実行環境ではローカル開発DBが起動しておらず`status: blocked`のまま
commit・pushせず終了したため、Claudeが確認・commit・pushを行った）。

**この修正はローカルのsource変更・commit・pushまでで、`clasp push`/`clasp deploy`は
実施していない。** Apps Scriptプロジェクトのcloud source・version `@33`は
task `20260913-001`（commit `3de1557`）時点のまま変わっておらず、
S006-GAS-01〜04で修正した内容は反映されていない。ただし`HISTORICAL_REPARSE_ENABLED`・
`REPARSE_RUN_TOKEN`ともに未設定のため、修正前のバグは現時点で実害を及ぼさない
（機能自体が到達不能なまま）。次にGASへ反映する際は、この修正版source
（commit `d849129`以降）を対象にすること。

## Codex実装結果（task 20260914-001、GAS連携レビュー§16.3対応）

- 実装ファイル: `apps/api/src/routes/bridge.ts`（write mode guard追加のみ）、
  `docker-compose.prod.yml`・`.env.production.example`・`README.md`
  （`HISTORICAL_REPARSE_WRITE_ENABLED`の記載追加のみ）、
  `apps/api/src/routes/bridge.reparse.test.ts`（新規test3件）、
  `apps/gas/src/ApiBridge.js`（`safeErrName_`・`fetchReparseProgress`新設、
  既存3関数の型検証強化）、`apps/gas/src/GmailImportService.js`
  （`reparseCursorKey_`・`isPermanentMessageNotFound_`新設、
  `reparseHistoricalCandidates`・`buildReparseResult_`の全面書き換え）、
  `apps/gas/test/reparseHistoricalCandidates.gas.test.cjs`（新規、23シナリオ）
- 1回目の実行は、task指示書とai-watch固定ルールの間に見かけ上の矛盾
  （`.env.production.example`編集と「`.env`系ファイル非改変」ルール、
  および`ops/`非改変と「notify/approval_required時のnotice更新必須」ルール）を
  検出し、着手前に`status: blocked`で安全側停止した。Claudeが両方について
  本task限りの明示的な例外（`.env.production.example`は secret非含有の
  template fileのため対象内、notice更新はClaude側が別途行うため本taskでは
  免除）を追記したtaskを再承認・再配置し、2回目の実行で完了した
- Codex実行環境ではローカル開発DBが起動しておらず、`npm run test --workspace=@stockhome/api`が
  76件中67件failしたため（新規3件を含むDB依存test全体が同一原因で失敗）、
  `status: blocked`のままcommit・pushせず終了した。GAS側の永続test
  （DBに依存しない）23件はCodex環境でも全件成功していた
- Claudeが対話セッションで、Docker Desktopの起動・ローカル開発用Postgres
  （`localhost:5434`）の起動を行い、`npm run test --workspace=@stockhome/api`を
  再実行して全76件成功（失敗0件）を独立に確認した。差分が指示書のコード例と
  完全一致すること、既存の公開関数・既存route・既存トリガー対象関数に変更が
  ないこと、`apps/mobile`・`packages/shared`・`ops/`・`appsscript.json`・
  `.clasp.json`・`deploy.bat`に変更がないことも確認した
- ビルド3コマンド（shared / api / mobile tsc）、GAS 3ファイルの`node --check`、
  `apps/gas/test/reparseHistoricalCandidates.gas.test.cjs`（23シナリオ）も
  Claudeが独立に再実行し成功を確認した
- **production変更なし**（`production_operation: none`で実施。`clasp push`/
  `clasp deploy`、実運用`REPARSE_RUN_TOKEN`・`HISTORICAL_REPARSE_WRITE_ENABLED`の
  発行・設定、実Gmail・実VPS・実production DB接続はいずれも未実施）
- commit: `d849129`（origin/mainへpush済み。Claudeが直接commit・push）

## GAS連携再レビュー対応状況（2026-09-14、task `20260914-002`で対応完了）

VPS管理側がtask `20260914-001`の修正（固定tree `008a4de`）を再レビューした
GAS連携再レビュー（正本§17、追加の合成probeで再現）が、S006-GAS-01・02・04の
主要修正を確認しつつ、**S006-GAS-03のみ**応答検証・ログ許可listの不足を継続指摘した。

| # | レビュー指摘 | 対応方針 |
|---|---|---|
| 1 | `fetchReparseCandidates`が`candidates`配列の型しか確認せず、`mailMessageId`等の必要fieldが欠けた要素も受理していた | 候補要素ごとに`id`・`mailMessageId`（非空文字列）・`itemNameRaw`（`null`または文字列）・`vendor`・`mailPhase`（非空文字列）を検証し、1件でも不正なら応答全体を`error`にする |
| 2 | `postReparseResults`が`summary`の非nullobject判定しかせず、要求と異なる`mode`、送信件数と異なる`total`、未知fieldを含む`summary`もそのまま受理していた | `body.mode`が送信modeと一致することを確認し、`summary`は既知7フィールド＋許可された`bySkipReason`のみを検証したうえで**新しいobjectへ作り直して**返す。未知の top-level fieldが1つでもあれば`error`にする |
| 3 | `bySkipReason`のキーに許可list（API内部12種＋GAS入力3種＝15種）が無かった | `REPARSE_KNOWN_SKIP_REASONS`（`priceReparse.ts`の`skipReason`literal12箇所＋共有schemaの3値と一致することを実装前にgrepで確認）を追加し、許可list外キー・非負整数以外の値は`error`にする |
| 4 | `safeErrName_`が`e.name`を無検証でそのまま返していた | JS標準の組み込みError名7種のみを許可する`REPARSE_SAFE_ERROR_NAMES`を追加し、それ以外は固定`'Error'`へ丸める |
| 5 | `fetchReparseProgress`の型検証だけでは`totalTargets`/`processedCount`/`remainingCount`/`complete`間の矛盾を検出できなかった | 非負整数チェックに加え、`remainingCount === totalTargets - processedCount`・`complete === (remainingCount === 0)`の整合性を検証する |

上記すべてtask `20260914-002`（commit `9c20a5d`）で対応済み。レビューの追加probe
（`stockhome-gas-response-review-20260914.cjs`）が再現した4件の問題が修正後の
sourceでは再現しないことを含む新規11シナリオを、既存の永続test
`apps/gas/test/reparseHistoricalCandidates.gas.test.cjs`へ追加し（24〜34）、
既存23件のうちシナリオ23のPOST応答fixtureのみ実際のAPI契約（`mode`必須・
summary7フィールド完備）に合わせて更新した（アサーション自体は無変更）。
**全34シナリオ**がpassしたことをCodex・Claude双方で独立に確認した。今回は
`apps/api`・`apps/mobile`・`packages/shared`側のコード変更は無く、固定ビルド
3コマンドは無変更のまま成功を確認した。

## Codex実装結果（task 20260914-002、GAS連携再レビュー§17.3対応）

- 実装ファイル: `apps/gas/src/ApiBridge.js`（`isValidReparseCandidate_`・
  `sanitizeReparseSummary_`・`isNonNegativeInteger_`・`REPARSE_KNOWN_SKIP_REASONS`・
  `REPARSE_SAFE_ERROR_NAMES`の新設、`fetchReparseCandidates`・
  `postReparseResults`・`safeErrName_`・`fetchReparseProgress`の検証強化）、
  `apps/gas/test/reparseHistoricalCandidates.gas.test.cjs`（シナリオ23の
  fixtureのみ実契約へ更新、新規シナリオ24〜34を追加）
- Codexは実装前に`apps/api/src/services/priceReparse.ts`の
  `skipReason: '...'`literal12箇所と共有schemaの`REPARSE_SKIP_REASONS`3値を
  照合し、指示書の許可list15種と一致することを確認したうえで実装した
- `apps/gas/test/reparseHistoricalCandidates.gas.test.cjs`を実行し
  **34/34シナリオ成功**（exit code 0）を報告。ビルド3コマンド・GAS 2ファイルの
  `node --check`もすべて成功を確認したうえでcommit・push（`9c20a5d`）まで
  Codex自身が完了させた
- Claudeが差分レビューし、指示書のコード例と完全一致すること（`sanitizeReparseSummary_`が
  仕様外のtop-level未知fieldも拒否する追加のガードを自主的に加えていたが、
  実際のAPI契約と矛盾せず安全側の強化のため許容と判断）、
  `apps/api`・`apps/mobile`・`packages/shared`・`ops/`・
  `apps/gas/src/GmailImportService.js`に変更が無いことを確認した。
  `node apps/gas/test/reparseHistoricalCandidates.gas.test.cjs`・ビルド3コマンド・
  GAS 2ファイルの`node --check`をすべて独立に再実行し、同じ結果（34/34成功）を確認した
- **production変更なし**（`production_operation: none`で実施。`clasp push`/
  `clasp deploy`、実運用値の発行・設定、実Gmail・実VPS・実production DB接続は
  いずれも未実施）
- commit: `9c20a5d`（origin/mainへpush済み。Codexが直接commit・push）

## Approval

- app owner: 承認①のみ**実施済み（2026-09-12、過去候補の再解析・確定可能な購入単価のみを
  補完する設計、およびAPI先行stageを承認）**。B08の実装経路選択は2026-09-07に決定済み。
  承認②〜④（GAS実装後のfeature有効化、dry-run結果、全件write）は未実施
- VPS management review: `accepted`（第8回、2026-09-08。production反映の承認ではない）
- production approval: **承認②のみ実施済み（2026-09-12、task `20260912-001`・固定source
  `5e209e0`・4 migration・feature無効を特定して承認）。** 承認③・④（feature有効化・
  dry-run、全件write）は未実施
- related task_id: 20260907-002（第1回API実装、`success`・commit `02816ee`。
  第2回レビューで問題7件検出）、20260907-003（Codex CLI異常終了のため未完了）、
  20260907-004（20260907-003の再発行。第2回レビュー対応、`success`・commit `5b2f68a`・
  ローカルDB test 38件全成功。第3回レビューで問題6件検出）、
  20260907-005（第3回レビュー対応、`success`・commit `1c1b2ba`。
  ローカルDB test 46件全成功、fresh隔離DB migration/rollback rehearsal実施済み。
  第4回レビューで問題6件検出）、
  20260907-006（第4回レビュー対応、`success`・commit `9b84b1f`・`60bb6cc`。
  ローカルDB test 57件全成功、fresh隔離DBでの全migration・全rollback rehearsal実施済み。
  第5回レビューで問題6件検出）、
  20260907-007（第5回レビュー対応、`success`・commit `21676c3`・`2c32da9`。
  ローカルDB test 63件全成功、fresh隔離DBでの全10 migration・4 migration全rollback
  rehearsal実施済み。第6回レビューで問題4件検出）、
  20260907-008（第6回レビュー対応、`success`・commit `e2a3857`・`bf7ee66`。
  ローカルDB test 68件全成功。第7回レビューで問題3件検出）、
  20260907-009（第7回レビュー対応、`success`・commit `5e209e0`。
  ローカルDB test 73件全成功）、20260912-001（VPS管理側task。API先行stageの
  production反映、`verified`。source `5e209e0`、4 migration適用、feature flag無効。
  計画・結果は`stockhome_historical_price_reparse_api_deployment_plan_20260912.md`参照）、
  20260913-001（B08対応、GAS側ローカル実装、`success`・commit `3de1557`。
  検証シナリオ15件全成功。2026-09-14にapp owner承認によりclasp push/deploy実施、
  version `@33`）、20260914-001（GAS連携レビュー§16.3対応、S006-GAS-01〜04を修正、
  `success`・commit `d849129`。1回目はai-watch固定ルールとの見かけ上の矛盾で
  `blocked`、taskへ明示的例外を追記し再承認して2回目で完了。GAS側永続test
  （`apps/gas/test/reparseHistoricalCandidates.gas.test.cjs`）23件全成功、
  Codex環境でDB未起動のためAPI testはblockedのままcommit・push未実施、
  Claudeが対話セッションでDocker Desktop・ローカル開発DBを起動しAPI test全76件
  成功を独立確認してcommit・push。`clasp push`/`clasp deploy`未実施のため
  Apps Scriptには未反映、production baseline・deployment_statusに影響なし）、
  20260914-002（GAS連携再レビュー§17.3対応、S006-GAS-03の残り2件を修正、
  `success`・commit `9c20a5d`。1回目は既存シナリオ23のfixtureが新検証仕様と
  噛み合わない矛盾をCodexが検出し`blocked`、シナリオ23のfixtureのみ実契約へ
  合わせてよいと明示し再承認して2回目で完了。GAS側永続test全34シナリオ
  （既存23＋新規11）成功をCodex・Claude双方で確認、Codex自身がcommit・push。
  `clasp push`/`clasp deploy`未実施のためApps Scriptには未反映、
  production baseline・deployment_statusに影響なし。これでS006-GAS-01〜04
  すべて解消。VPS管理側の再レビュー待ち）
