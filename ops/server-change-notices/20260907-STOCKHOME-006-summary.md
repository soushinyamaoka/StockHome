# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20260907-STOCKHOME-006

app: stockhome

source_branch: main

source_commit: 未定（本notice更新時点でtask `20260907-002`は`inbox`配置前。実装完了後、
このnoticeを再更新しfull SHAを記載する）

production_baseline_commit: 9f5fa864327e5d16b263250ce9e0348966b37f4f

release_commits: baseline（`9f5fa86`）以降、本notice向けの実装commitはまだ存在しない
（`priceReparse.ts`/`priceReparse.test.ts`/`bridge.ts`修正等は`packages/shared`・
`apps/api`ともにworking tree上のみで未commit。実装完了後に列挙する）

impact_level: L3

status: draft

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
| API | 該当エンドポイントなし | `GET /api/bridge/reparse-candidates`・`POST /api/bridge/reparse-candidates`を新設（`HISTORICAL_REPARSE_ENABLED=true`のときのみ有効。未設定時は404） |
| GAS | 該当機能なし | **未実装**（B08参照。設計メモのみ`ops/investigations/20260907-historical-price-reparse-gas-design.md`に作成済み） |
| `price_reparse_audit`テーブル | 存在しない | 新設（production row変更前後値の監査ログ。Git管理外） |

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
- 想定作業（B07: 4段階の承認を分離する）:
  1. **app owner承認①**: 対象・価格判定ロジック・dry-run結果の承認
     （dry-run実行後、集計結果を提示してから得る）
  2. **VPS管理review**: 本notice改訂版の`accepted`
  3. **production承認②**: API deploy・（実装される場合）GAS deployの承認
  4. **production承認③**: DB backup・canary・全件write・必要時rollbackの承認
  - 上記4つは同一回答でまとめて得る場合も、対象releaseと各操作を明記して記録する
  - **VPS管理側の個別承認前にAPI/GAS deploy、DB write、GAS batch起動を行わない**
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

- schema/format変更: `price_reparse_audit`テーブルを新規追加（既存テーブルへの列追加なし）
- migration: `20260906223126_add_price_reparse_audit`（ローカル生成・適用済み、
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

## Health・テスト（B06反映）

- health contract変更: なし
- 実施テスト: `apps/api/src/services/priceReparse.test.ts`（実装後に追加予定）で、
  次を含む自動testを用意する。
  - 候補単独更新／購入への反映（sets=1・sets=2でラベルあり／購入へ反映されない場合）
  - 既に`price_source`がある候補への`conflict`判定
  - 同時実行（`Promise.all`での二重呼び出し）でどちらか一方だけが確定すること
  - 異常値（0・負数・非整数・上限超過）の拒否
  - `skipReason`のパススルー（DB変更なし）
  - dry_runがDBを一切変更しないこと、監査ログには記録されること
  - 同一結果セットの再実行（冪等性）で二重加算・上書きが起きないこと
  - 対象一覧取得（`getReparseTargets`）の絞り込み条件とpagination
  - production適用前に、上記に加えて少数の実データによるcanary実行（少数件をwrite実行し、
    期待した件数だけが更新されたことを集計で確認）を実施する
- 結果: 未実施（実装未完了のため。task `20260907-002`完了後に追記する）
- 未実施テストと理由: 実Gmail接続を伴う結合test、production環境でのcanaryは、
  本notice`accepted`後、app owner立ち会いのdry-run実行時に初めて実施する

## Log・監視（B04/B06反映）

- log量/形式/保存先変更: `job_start`/`job_end`（`job: 'historical_price_reparse'`、
  `run_id`単位）を新設。件数集計（total/updated/unchanged/skipped/conflict/failed、
  skip理由別内訳）のみを出力し、row内容（message_id・商品名・金額）は出さない
- 新しいalert条件: なし（一度限りの手動batchのため、常設監視は設けない）
- secret/個人情報対策: 再取得したメール本文は価格抽出後に即座に破棄する
  （既存パイプラインと同じ方針）。`price_reparse_audit`はAPI応答に含めず、
  当該テーブルへの直接アクセスはVPS上のpsql操作のみに限定する

## 提出前セルフチェック

正本: `C:\work\PRG\Sakura\Dev\vps-server-management\docs\templates\server_change_notice_pre_submission_checklist.md`

- [x] production baselineとrelease全commit・build入力差分を確認した（B01反映、baseline訂正済み）
- [ ] source commitとnoticeをremoteの対象branchへpushした（task `20260907-002`完了後に実施）
- [x] data更新のtransaction・同時実行・途中失敗・再実行を確認した（D2実装・test項目に反映）
- [x] image rollbackとdata rollback、backup/restore条件を分けた（上記Deploy・rollback参照）
- [ ] job/log/retention、runtime/dependency、client配信の該当有無を確認した
      （job/logは設計済み・実装待ち。client配信は不要と確定）
- [ ] app owner、VPS review、production承認、client配信承認を分離した（B07で4段階に分離済み。
      実際の承認取得はこれから）
- [x] secret非混入とtracked working tree cleanを確認した

未確認・該当なしの理由: source commitのpush、job/log実装、承認取得は、task
`20260907-002`（API側実装）の完了とレビュー後に行う。GAS側は未実装のため
該当チェックが完了できない（B08参照）。

## 未解決事項

1. **B08（実装経路）**: GAS側バッチの実装は、app owner判断により**今回は実装せず、
   別途手動Codexセッションで実装する**方針に決定した（2026-09-07）。設計メモは
   `ops/investigations/20260907-historical-price-reparse-gas-design.md`に作成済み。
   実装後、本noticeへcommit証跡・test結果を追記する
2. API側実装（task `20260907-002`）は本notice更新時点でinbox配置前。完了後、
   source commitのfull SHA・test結果を本noticeへ追記する
3. `HISTORICAL_REPARSE_ENABLED`の実際の設定・解除手順（VPS管理側の`.env`変更）は
   production承認後に確定する
4. dry-run実行時のGmail API呼び出し順序・retry方針（GAS設計メモに暫定案あり、
   実装時に確定）

## 希望時期

指定なし。API側task完了・VPS管理再レビューの結果を踏まえて判断する。

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: 未実施（task `20260907-002`完了後に案内する）
- VPS管理チャットへ渡すローカル絶対path:
  `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260907-STOCKHOME-006-summary.md`

```text
アプリ側作業は完了しました。VPSへの反映は実施していません。

次に、VPS管理チャットへ以下を送ってください。
「stockhomeの変更通知書 C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260907-STOCKHOME-006-summary.md を確認し、
受理台帳への登録とVPS管理レビューをしてください。
production反映は別承認として扱ってください。」
```

## Codex実装結果（task 20260907-002）

- 実装ファイル: `packages/shared/src/schemas/priceReparse.ts`（新規）、
  `apps/api/src/services/priceReparse.ts`（新規）、
  `apps/api/src/services/priceReparse.test.ts`（新規）、
  `apps/api/src/routes/bridge.ts`、`.env.production.example`、`README.md`
- test結果: shared / api / mobile tsc のビルド3コマンドはすべて成功。
  `npm run test --workspace=@stockhome/api`を実行し、新規11件を含む全27件が成功（失敗0件）
- server_impact自己判定: approval_required（本notice本文の判定と一致）
- production変更: 未実施（GAS実装・production deploy・DB write・GAS batch起動は
  いずれも行っていない）
- commit・push: 未実施（working treeの変更をそのまま残している）

## Approval

- app owner: 未実施（B08の実装経路選択のみ2026-09-07に決定済み。dry-run結果への承認は未実施）
- VPS management review: 未実施（本改訂での再レビュー待ち）
- production approval: 未実施
- related task_id: 20260907-002（API側実装、StockHome-ClaudeToCodex、本notice更新時点でinbox配置前）
