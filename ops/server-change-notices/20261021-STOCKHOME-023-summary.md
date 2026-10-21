# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20261021-STOCKHOME-023

app: stockhome

source_branch: main

source_commit: e98200ed33260d9a2888f341bf1c70746c7bd59b

production_baseline_commit: 16918f80393461eaeed6f66a6b7fd17c29e964f7

release_commits: 16918f80393461eaeed6f66a6b7fd17c29e964f7..e98200ed33260d9a2888f341bf1c70746c7bd59b

impact_level: L3

status: ready_for_review

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 変更概要

消耗品ごとに**消費の休止**（残数を今の数のまま止める）と再開をできるようにする。

- `items` に列 `consumption_paused_at`（timestamp、null可）を追加（migration `20261021120000_add_item_consumption_paused_at`）
- 在庫計算: 休止中は、経過日数を休止した日までで打ち切る（残数が減らない）。休止中はアラート対象外
- 新規エンドポイント（既存JWT認証配下、`req.auth.householdId` で絞り込み）: `POST /api/items/:id/pause`・`POST /api/items/:id/resume`
- 再開時は、止めていた残数を再開日起点の補正値として書き込み、休止期間分は消費しない
- 休止中の購入（手入力・Gmail取込確定・夜間バッチの counted 化）は既存の積み上げ処理のまま、止まっている残数に加算される

- 休止中は `estimatedDaysLeft`・`predictedOutOfStockDate` を null、アラート3種を false にする（ホーム・夜間通知の対象から自動的に外れる。dashboard/batch のコードは変更なし）
- 品目レスポンス（`serializeItem`）に `consumptionPausedAt`（ISO文字列 or null）を追加
- 休止していない品目の計算は変更なし

## Codex実装メモ

codex_implementation_note: 消費休止・再開のAPI/在庫計算とmobile表示を実装し、API/sharedビルドとmobile型検査は成功。

## 変更理由

app ownerの要望（2026-10-21）: 理由があって消耗品として使わなくなった品目を、在庫数はそのままリストに残したい。
通知OFFだけでは予測上の残数が減り続けるため、在庫計算そのものを止める機能が必要。

## server_impact判定

server_impact: approval_required

判定理由: Prisma migration（既存テーブル `items` への nullable 列追加）を伴うため。
既存データの書き換えは無い。env・port/bind・cron・依存packageの変更は無い。

## 現在と変更後

| 項目 | 現在 | 変更後 |
|---|---|---|
| DB | `items` に休止の列なし | `items.consumption_paused_at`（nullable）追加。既存行は null＝従来どおり |
| API | 休止機能なし | 認証必須の `POST /api/items/:id/pause`・`POST /api/items/:id/resume` を追加 |
| 既存エンドポイント | — | 品目レスポンスに `consumptionPausedAt` が1項目増えるのみ（追加のみで後方互換） |
| 在庫計算 | — | 休止中の品目のみ変化。休止していない品目は不変 |
| mobile | — | 本releaseの反映後、後続のclient releaseで休止/再開ボタンと「休止中」表示を配信 |

## 影響対象

- service/container: `stockhome-api-prod`
- URL/port/health: 変更なし（`/health` も不変）
- cron/timer/worker: 変更なし（夜間バッチは既存の在庫計算を呼ぶため、休止中品目は自動的にアラート対象外になる）
- dependency: 追加なし（`package.json`・`package-lock.json`・`packages/shared` の差分なし）
- data/DB/volume: `items` に nullable 列1つ（`stockhome-postgres-prod` 内）。volume・DB設定の変更なし
- log/monitoring: 新しいlog eventなし

## production変更

- 必要性: あり
- 想定作業: 通常のAPI deploy（`npm run deploy -- -Commit e98200ed33260d9a2888f341bf1c70746c7bd59b`）。
  コンテナ起動時の `prisma migrate deploy` が migration `20261021120000_add_item_consumption_paused_at` を自動適用する
- downtime: 既存と同じ（brief-restart）
- maintenance window: 不要（PostgreSQL 16 でデフォルト値なしの nullable 列追加はメタデータ変更のみで、テーブル書き換えなし。lockは一瞬）

## 利用者への影響

- user_maintenance_impact: possible
- 対象利用者・機能: 単一世帯。反映時はAPIコンテナの短い再起動（brief-restart）があり、その間はアプリの読み込み・保存が一時的に失敗する可能性がある（再試行で回復）。
  反映後は休止中の品目が無いため、見た目・計算・通知の変化はない。
  休止/再開の操作は後続のclient releaseで使えるようになる
- 通知方法: 不要（client release時にアプリ内お知らせで案内予定）

## env・secret contract

- 変更: なし
- provisioning/rotation: 不要

secret値は記載していない。

## Data・migration・backup

- schema/format変更: あり。`items` に `consumption_paused_at TIMESTAMP(3) NULL` を追加。既存列の変更・削除なし
- migration: `20261021120000_add_item_consumption_paused_at`（`ALTER TABLE "items" ADD COLUMN "consumption_paused_at" TIMESTAMP(3);` の1文のみ）
  - Claudeがローカル開発DB（PostgreSQL 16）で適用を確認済み
  - 途中失敗しても既存データへの影響はない（失敗時は `_prisma_migrations` のfailed行を原因除去後に `prisma migrate resolve` で対処）
- データ書き込み:
  - 休止: `items.consumption_paused_at` に現在時刻を設定し、stock_snapshot を再計算
  - 再開: 止めていた残数を `item_runtime_states.manual_override_qty`（補正値、日時=再開時刻）として書き込み、`consumption_paused_at` を null に戻し、stock_snapshot を再計算。
    補正理由は直前の補正が購入積み上げ由来なら `purchase_accumulated_resume`、それ以外は `consumption_resume`。
    購入履歴も補正も無く残数を計算できない品目は補正値を作らない（0扱いにしない）
- backup対象: あり（既存のDB全体backupに含まれる）
- restore確認: 通常のDB restoreに含まれる（個別の隔離restore試験は未実施）
- backward compatibility: 旧mobileは新項目を無視し、新エンドポイントを呼ばない。レスポンスは項目追加のみ

## Deploy・rollback

- deploy前提: なし（envの追加なし）
- deploy手順の変更: なし
- rollback方法: `npm run deploy -- -RollbackTo 16918f80393461eaeed6f66a6b7fd17c29e964f7`（image rollback）
- image rollbackとdata rollbackの区別:
  - image rollbackしても列は残る。旧imageのコードはこの列を参照しないため動作に影響しない
  - rollback時点で休止中の品目があった場合、旧コードでは休止日以降の消費が再び計算される（残数が休止前の速度で減る表示に戻る）。データは失われず、新imageへ戻せば休止状態に戻る
  - 列の削除（data rollback）は不要と判断する。必要になった場合のみ、VPS管理の承認のうえ `ALTER TABLE ... DROP COLUMN` と `_prisma_migrations` の該当行削除を行う
- rollback不能条件: なし

## Health・テスト

- health contract変更: なし
- 実施テスト（Claude、ローカル開発DB=PostgreSQL 16、`e98200e`）:
  - `npx tsx --test apps/api/src/services/stockCalc.pause.test.ts`（DB不要）: 3件成功
    （購入起点・補正起点とも休止日で残数が止まり、半年後も同じ値／休止後の補正（休止中の購入積み上げ）は減らない／アラート3種false・残日数と切れる日null／休止していない品目は従来の値）
  - `npx tsx --test apps/api/src/routes/itemPause.http.test.ts`（DB必須）: 1件（一連のシナリオ）成功
    （休止200・snapshotのアラートfalse・残日数null／再度の休止で日時不変（冪等）／休止中の購入積み上げで残数が加算され休止継続／再開で補正理由 `purchase_accumulated_resume`／再度の再開200（冪等）／在庫不明品目の再開で補正値null／他世帯・存在しない品目404／外した品目409）
  - Codexのサンドボックスでは Node.js が `uv_os_get_passwd returned ENOMEM` でテスト開始前に停止したため、上記はClaudeがローカルで実行。
    実行時にテスト側の期待値2点を修正（休止時刻がJSTで翌日扱いになる点の期待値、fixtureの購入が `counted_in_inventory=false` のままだった点）。実装コードは無修正
  - `npm test --workspace=@stockhome/api`: 209件中204件成功、5件失敗。失敗は `bridge.readygoReclaim.test.ts` 等ReadyGo関連のみで、
    **本変更を退避した状態でも同じく失敗**することを確認（notice 021・022で記録した開発DBの残留データによる既知の不安定と同種。本変更はReadyGoのコードに触れていない）
  - `npx tsc --noEmit`（API・mobile）: 成功
  - `docker build -f apps/api/Dockerfile`（`e98200e` を `git archive` で取り出したbuild context）: 成功
- 同時実行・再実行:
  - 休止・再開は、既存の購入積み上げと同じ品目行ロック（`lockItemForAccumulation`、`SELECT ... FOR UPDATE`）を最初に取ってから読み書きする。
    購入積み上げ・夜間バッチのcounted化と同じ品目で競合しても直列化され、休止前後どちらかの一貫した状態で計算される（品目行→購入行のlock順序規約に沿う）
  - 休止・再開とも冪等（休止中の休止は日時を変えない、休止していない品目の再開は何もしない）
- 未実施テストと理由: production相当データでの実行（休止中品目は反映直後0件のため、既存品目の計算は不変）

## Log・監視

- log量/形式/保存先変更: なし（既存の `http_request` が新ルート分増えるのみ）
- 新しいalert条件: なし
- secret/個人情報対策: 新しいログ出力なし

## 第1回レビュー指摘と対応（2026-10-22）

前回review対象: 通知書 `0969c24`（source `e98200e`）。今回の差分は本通知書の更新のみ（source・release範囲は不変）。

| 指摘 | 対応 |
|---|---|
| `deployment_status: not_applied` は規約外 | `not_started` に修正 |
| 影響レベルは L3 が妥当（migrationに加え、休止状態を保存し、在庫計算と通知対象を変えるため） | `impact_level: L3` に修正。L3として full template の節（「変更理由」を追加）とセルフチェックを再確認 |
| `user_maintenance_impact: none` と brief-restart の説明が不整合 | `possible` に修正し、反映時の短い再起動の影響を「利用者への影響」に記載 |

## 提出前セルフチェック

正本: `C:\work\PRG\Sakura\Dev\vps-server-management\docs\templates\server_change_notice_pre_submission_checklist.md`

- [x] production baselineとrelease全commit・build入力差分を確認した（稼働baseline `16918f8`＝notice 022の反映commit。build入力の差分は `apps/api` の schema・migration・src のみ）
- [x] source commitとnoticeをremoteの対象branchへpushした（引き継ぎ時に source `e98200e` と通知書の最新commitの両方がremoteと一致することを伝える）
- [x] data更新のtransaction・同時実行・途中失敗・再実行を確認した
- [x] image rollbackとdata rollback、backup/restore条件を分けた
- [x] job/log/retention（変更なし）、runtime/dependency（変更なし）、client配信（後続で別計画）の該当有無を確認した
- [x] app owner、VPS review、production承認、client配信承認を分離した
- [x] 永続データの値・計算を変えるためL3とした（第1回レビュー指摘により修正）
- [x] `deployment_status: not_started` であることを確認した
- [x] secret非混入とtracked working tree cleanを確認した（未追跡は `ops/production-db-operations/` のみで、git管理外・artifact対象外）

未確認・該当なしの理由:
- job/cron: 新設なし
- client配信: mobile変更は同じsource commitに含まれるが、本noticeの本番反映後にclient releaseとして別途計画・承認する
- 隔離restore試験: 未実施（列は通常のDB全体backup/restoreに含まれる前提）
- `tools/review_notice_preflight.ps1`: 未実行（アプリ側PCにPowerShell 7が無いため。notice 022と同じ）。VPS管理側での実行をお願いしたい

## 未解決事項

なし

## 希望時期

特に指定なし。

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- VPS管理チャットへ渡すローカル絶対path:
  `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20261021-STOCKHOME-023-summary.md`

## Approval

- app owner: 2026-10-21、このチャットで内容確認のうえVPS管理へ引き継ぐことを承認
- VPS management review: 第1回（2026-10-22）blocked（deployment_status表記、影響レベルL3、user_maintenance_impactの整合）→ 対応し再提出
- production approval: 未
- related task_id: 20261021-001（ai-watch、Codex実装）
