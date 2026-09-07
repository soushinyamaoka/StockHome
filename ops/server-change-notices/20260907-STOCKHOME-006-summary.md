# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20260907-STOCKHOME-006

app: stockhome

source_branch: main

source_commit: 5b2f68a5ea5e426f42b2edb91f57c95a5c08fdf1

production_baseline_commit: 9f5fa864327e5d16b263250ce9e0348966b37f4f

release_commits: `9f5fa86`（baseline）→ `02816ee`（task `20260907-002`、第1回API実装）→
`47b0b1e`（notice更新）→ `5b2f68a`（task `20260907-004`、第2回レビュー対応。
GAS側実装は含まない）

impact_level: L3

status: ready_for_review

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

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
| API | 該当エンドポイントなし | `GET /api/bridge/reparse-candidates`・`POST /api/bridge/reparse-candidates`を新設（`HISTORICAL_REPARSE_ENABLED=true`のときのみ有効。未設定時は404）。認可は事前発行済み`runToken`（第2回レビューB03対応、下記参照）で行い、自己申告emailは受け付けない |
| GAS | 該当機能なし | **未実装**（B08参照。設計メモのみ`ops/investigations/20260907-historical-price-reparse-gas-design.md`に作成済み） |
| `price_reparse_audit`テーブル | 存在しない | 新設（production row変更前後値の監査ログ。Git管理外） |
| `price_reparse_runs`テーブル | 存在しない | 新設（第2回レビューB03対応。runToken・対象owner・有効期限を保持する認可テーブル。HTTP経由では作成せず、production承認後に運用者が直接1件だけ発行する） |

## 影響対象

- service/container: `stockhome-api-prod`（新規route追加のみ。既存route・起動構成は変更しない）
- URL/port/health: 変更なし
- cron/timer/worker: 変更なし（GAS側バッチは既存6時間cronに組み込まず、実装後も手動起動限定とする設計）
- dependency: 追加なし
- data/DB/volume: `price_reparse_audit`テーブルを新設（schema追加のみ、既存テーブルへの
  列追加は無い）。`import_order_candidates`/`purchase_logs`の値を一括更新する処理を
  新設するが、**本notice時点ではコードが追加されるだけで、実行はしない**
- log/monitoring: `job_start`/`job_end`（`job: 'historical_price_reparse'`）を新設。
  row内容（message_id・商品名・金額）はログへ出さず集計値のみ

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
  1. **app owner承認①**: 対象・価格判定ロジックの設計承認（API stage）
  2. **VPS管理review**: 本notice改訂版の`accepted`（API stageのみで可）
  3. **production承認②**: API deployの承認（`HISTORICAL_REPARSE_ENABLED`は
     未設定のまま。この時点では業務データに一切影響しない）
  4. **production承認③**: GAS実装完了後、`HISTORICAL_REPARSE_ENABLED`設定・
     **dry-run実行**（監査テーブルへの書き込みとrow lockを伴うため、
     これ自体もproduction承認対象）の承認
  5. **production承認④**: dry-run結果確認後、DB backup・canary・全件write・
     必要時rollbackの承認
  - 上記は同一回答でまとめて得る場合も、対象releaseと各操作を明記して記録する
  - **VPS管理側の個別承認前にAPI/GAS deploy、DB write（dry-runの監査書き込みを
    含む）、GAS batch起動を行わない**
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

## Data・migration・backup（B05反映）

- schema/format変更: `price_reparse_audit`・`price_reparse_runs`（第2回レビューB03対応で
  追加。認可用のrunToken・対象owner・有効期限を保持する）の2テーブルを新規追加
  （既存テーブルへの列追加なし）
- migration: `20260906223126_add_price_reparse_audit`・
  `20260907021325_add_price_reparse_run`（いずれもローカル生成・適用済み、
  productionへは未適用）
- backup対象（B05: Git管理外の保存先へ変更）:
  - 実行直前にPostgreSQLの論理dump（`pg_dump`）をVPS上のtask専用ディレクトリへ取得し、
    non-zeroサイズ・gzip・SHA-256を確認する
  - 更新対象のrow ID・変更前値・適用値・run IDは、**Git repositoryではなく**
    `price_reparse_audit`テーブル（production Postgres内、API応答には一切含めない）へ
    保存する。旧稿にあった「`ops/production-db-operations/`へIDを保存する」案は撤回する
- restore確認: dumpを隔離環境（同一VPS上の使い捨てDB、または別ホスト）へ実際にrestoreし、
  想定テーブル・件数が復元できることを確認してから本番作業へ進める
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
- 結果: `apps/api/src/services/priceReparse.test.ts`の新規22件を含め、
  `npm run test --workspace=@stockhome/api`で**全38件が成功**（失敗0件）。
  Codex実行環境にはローカルDB接続が無かったため、Claudeが対話セッションで
  ローカル開発用Postgres（`localhost:5434`）に対して実行し確認した
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
- [x] source commitとnoticeをremoteの対象branchへpushした（`5b2f68a`、origin/mainへpush済み）
- [x] data更新のtransaction・同時実行・途中失敗・再実行を確認した（第2回レビューが
      mock再現した7件を含むregression test 22件をローカルDBで実行し全件成功を確認済み）
- [x] image rollbackとdata rollback、backup/restore条件を分けた（上記Deploy・rollback参照）
- [x] job/log/retention、runtime/dependency、client配信の該当有無を確認した
      （ログをchunk単位の`BATCH_STEP`へ変更し、row内容を含まないことを確認済み。
      client配信は不要と確定）
- [ ] app owner、VPS review、production承認、client配信承認を分離した（API単独stageと
      GAS+実行stageへ分離済み。**実際の承認取得はこれから**）
- [x] secret非混入とtracked working tree cleanを確認した

未確認・該当なしの理由: 4段階の承認取得（app owner承認①〜production承認④）は、
本notice改訂によるVPS管理再レビュー後に行う。GAS側バッチ実装（B08）は
app owner判断により今回は対象外（別途手動Codexセッションで実装予定）。

## 未解決事項

1. **B08（実装経路）**: GAS側バッチの実装は、app owner判断により**今回は実装せず、
   別途手動Codexセッションで実装する**方針に決定した（2026-09-07）。設計メモは
   `ops/investigations/20260907-historical-price-reparse-gas-design.md`に作成済み
   （第2回レビュー指摘を受けて修正予定、下記参照）。
2. `runToken`の発行（`createReparseRun`）は関数として用意するのみで、実際の発行・
   GASへの受け渡し方法（Script Propertiesへ手動設定する想定）はproduction承認後に確定する
3. `HISTORICAL_REPARSE_ENABLED`の実際の設定・解除手順（VPS管理側の`.env`変更）は
   production承認後に確定する
4. dry-run実行時のGmail API呼び出し順序・retry方針（GAS設計メモに暫定案あり、
   GAS実装時に確定）

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

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: task `20260907-004`完了・commit `5b2f68a`push済み。本notice更新後に実施
- VPS管理チャットへ渡すローカル絶対path:
  `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260907-STOCKHOME-006-summary.md`

```text
アプリ側作業は完了しました。VPSへの反映は実施していません。

次に、VPS管理チャットへ以下を送ってください。
「stockhomeの変更通知書 C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260907-STOCKHOME-006-summary.md を確認し、
第2回レビュー§9.3〜§9.5への対応状況を確認のうえ、再レビューをしてください。
production反映は別承認として扱ってください。」
```

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

## Approval

- app owner: 未実施（B08の実装経路選択のみ2026-09-07に決定済み。dry-run結果への承認は未実施）
- VPS management review: 未実施（第2回`blocked`。本notice改訂・commit `5b2f68a`push済みで
  再レビュー依頼可能な状態）
- production approval: 未実施
- related task_id: 20260907-002（第1回API実装、`success`・commit `02816ee`。
  第2回レビューで問題7件検出）、20260907-003（Codex CLI異常終了のため未完了）、
  20260907-004（20260907-003の再発行。第2回レビュー対応、`success`・commit `5b2f68a`・
  ローカルDB test 38件全成功）
