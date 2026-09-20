# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20260920-STOCKHOME-014

app: stockhome

source_branch: main

source_commit: 7032b6ab999e816f4cf19fffc1f7c400a8524758

production_baseline_commit: ec6e541b8bf88654baa68c3dd3b1c2fcbdb9d6ad

release_commits:（baseline以降。notice 019以降の分のみ再掲。それ以前の全commit列は
notice 010〜019の提出内容を参照）

- `ec6e541`（baseline。notice `20260918-STOCKHOME-009`でproduction反映・`verified`済み）
- （中略。notice 010〜019までの全commitは各noticeのrelease_commits参照）
- `f233ed9`（所見A-5・A-6対応の初回実装。task `20260920-007`／`008`。**第1回レビューで
  blocked**）
- 〜`f289a08`（notice 010〜019、第1回提出分。詳細は各noticeのrelease_commits参照）
- `0cad656`（notice 018・019のmetadata訂正。`ops/**`のみ。**本noticeの対象外**）
- `2de0270`（**S014-B01・B02対応**。`readygo_outbox`へ`claimed_at`列＋partial unique
  index追加（migration）、batch.tsのpending投入を「insert・競合時update」方式へ変更、
  bridge.tsのfetch/ACKをclaim方式へ変更。`apps/api`のみ）
- `7032b6a`（**本notice対象・最終source**。Claudeが実DBで検証中に見つけたtest自体の
  不具合を修正（`GET /readygo-pending`が全世帯分を返す仕様に対し、testが配列先頭を
  無条件に自世帯の行と仮定していた）。本番実装への変更なし）
- `d282137`（notice 015再対応（S015-B01）と合わせて発見した、cron相当テストと他test
  fileの並行実行競合への恒久対策（`apps/api/package.json`の`test`scriptへ
  `--test-concurrency=1`追加）。**notice 014・015共通の対応、本noticeの対象外
  としても記載**）

**本noticeが対象とするのは所見A-5・A-6への対応（夜間バッチのReadyGoキュー重複抑止・
世帯スコープ・保持期間・claim方式による二重配信防止）。notice 010〜013・016〜019は
別変更のため分離したままとする。production反映時はVPS管理側の方針により、
notice 010〜019と本noticeを1つの計画へまとめる想定。**

impact_level: L2

status: ready_for_review

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 変更概要

2026-09-03の全体点検所見のうち、夜間バッチ・ReadyGoキューまわりの2件への対応
（task `20260920-007`／`20260920-008`、Codexが実装）。

- **A-5**（優先度「中」）: 「夜間バッチを今すぐ実行」（`POST /api/dashboard/run-batch`）が
  世帯を絞らず全品目を処理し、`readygo_outbox`へ無条件に行を積んでいた。19:55の自動実行後・
  GASの取得前（20時台）に押すと、同じアラートが2通キューに入り、そのまま2回LINE配信される
  状態だった。
- **A-6**（優先度「中」）: `readygo_outbox`は毎晩積まれる一方、GASの夜間トリガーが停止しても
  滞留を検知する手段が無く、復旧時に古いアラートが最大20通まとめて流れ得た。配信済み行の
  保持ポリシーも未定義だった（`push_tickets`だけ保持期間が定義済みで非対称）。

## VPS管理レビュー結果への対応（blocked→再提出）

第1回VPS管理レビューで、以下2点の指摘を受けblockedとなった
（`stockhome_findings_014_019_review_20260920.md` §2参照）。

- **S014-B01**: `deleteMany`→別queryの`create`という2ステップ構造のため、
  手動×手動・cron×手動の並行実行で両方がdelete後にcreateし、同一世帯の
  pending行が2件残りうる。
- **S014-B02**: GASが`GET /readygo-pending`で行を取得した直後にbatchが
  その行を削除・再作成すると、GASは旧本文を配信するがACKは「行が無い」
  として無視され、二重配信とnotification_log欠落が起こりうる。

対応方針: `readygo_outbox`の状態を`pending → claimed → delivered`の3段階に
拡張し、DB上のpartial unique indexで「household当たりpending最大1件」を
並行実行時も保証したうえで、GASが取得(claim)した行にはbatchが一切触れない
設計へ変更した（詳細は下記「現在と変更後」参照）。

Claudeが実DBで検証する過程で、追加したtest自体に2件の不具合を発見・修正した
（本番実装のバグではない）。1件目は並行実行testが3並行`runDailyBatch`実行後の
pending件数を正しく検証できていた一方、fetch/ACK競合testで
「`GET /readygo-pending`が全世帯分の行をまとめて返す」という正しい仕様に対し
testコードが配列の先頭要素を無条件に自世帯の行と仮定しており、ローカル開発DBに
残っていた他世帯の残留行を誤って掴んでいた（commit `7032b6a`で、DBを
`householdId`＋`status`で直接検索する方式へ修正）。2件目はcron相当のtestが
DB全体のhousehold・itemを処理するため、並行実行中の他test fileのhousehold
削除と競合する構造的な問題で、notice 015の再対応とあわせて恒久対策
（`--test-concurrency=1`、commit `d282137`）を適用した。

## 変更理由

2026-09-03の全体点検所見への対応（優先度「中」2件）。詳細は
`stockhome-review-findings-20260903.md`（点検報告書）を参照。

## server_impact判定

server_impact: notify

判定理由: 夜間バッチ（19:55 JST）の挙動と`readygo_outbox`の保持内容が変わり、
LINE通知の配信内容（重複の有無）に影響するため。あわせて`job_end`ログへ4fieldを追加し、
新規ログイベント2種（`readygo_queue_superseded`・`readygo_outbox_cleaned`）を出す。
port/bind/domain/health endpoint/起動command/DB schema/migration/volume/cron schedule/
既存API contract（エンドポイントの追加削除・レスポンス形状の破壊的変更）は変更していない。

## 現在と変更後

| 項目 | 現在 | 変更後 |
|---|---|---|
| 手動バッチ実行の対象範囲 | 全世帯の品目を処理し、全世帯分をキューに積む | 実行者の`req.auth.householdId`の世帯のみを対象に、counted更新・在庫再計算・通知判定・キュー投入を行う |
| ReadyGoキューの状態 | `pending`・`delivered`の2状態 | `pending`・`claimed`・`delivered`の3状態。`GET /readygo-pending`が単一SQL文でpending→claimedへ原子的に遷移させる |
| ReadyGoキューへの投入 | 既存pendingの有無を見ず無条件にinsert（実行のたびに増える） | insertを試み、household当たりpending最大1件のpartial unique indexに違反したら既存pending行をupdate（並行実行時もDBが一意性を保証） |
| GAS取得済み行の扱い | batchの置き換え対象になりうる（二重配信・監査欠落の恐れ） | `claimed`行はbatchの置き換え対象から完全に除外される。新しいアラートは別途新規pending行として積まれる |
| ACKの対象 | `delivered`以外なら無条件に受理 | `claimed`の行のみ受理（`pending`のまま・既に`delivered`の行はACKされない） |
| GAS停止時のキュー滞留 | 毎晩積まれ続け、復旧時に最大20通が一度に流れる | 常に最新1件へ置き換わるため積み上がらない |
| 配信済み(`delivered`)行の保持 | 無制限に残る | 30日を超えた行を削除（cron実行は全世帯、手動実行は当該世帯のみ） |
| 滞留の可視化 | 無し | `job_end`へ`readygo_pending`・`readygo_pending_oldest_age_h`・`readygo_superseded`・`readygo_cleaned`を追加 |

## 影響対象

- service/container: `stockhome-api-prod`（`apps/api/src/services/batch.ts`・`routes/bridge.ts`・`routes/dashboard.ts`・`lib/logger.ts`の変更。route追加・削除は無し、`POST /api/dashboard/run-batch`のレスポンスは既存fieldを維持したままfieldを追加）
- URL/port/health: 変更なし
- cron/timer/worker: schedule（19:55 JST / 20:10 JST）は変更なし。`daily_batch`の処理内容のみ変更
- dependency: 変更なし（新規パッケージ追加なし）
- data/DB/volume: **schema変更あり**。`readygo_outbox`へ`claimed_at`列（nullable DateTime）を追加し、`(household_id) WHERE status = 'pending'`のpartial unique indexを追加する（migration
  `20260920222509_readygo_outbox_claim`）。既存列の型・意味は変更なし
- log/monitoring: `job_end`へ4field追加、新規イベント`readygo_queue_superseded`・`readygo_outbox_cleaned`。既存イベントの意味・形式は変更なし

## production変更

- 必要性: あり
- 想定作業: 通常のAPI deployで反映される。deploy直後の初回`daily_batch`（19:55 JST）で、
  既存の`delivered`行のうち30日を超えたものが一度にまとめて削除される可能性がある
  （削除件数は`readygo_outbox_cleaned`イベントに出る）。DBのschemaは変更しないため、
  migrationは発生しない。
- downtime: 既存と同じ（brief-restart）
- maintenance window: 不要

`production_change: required`のため、`deployment_status: not_started`のままVPS管理側へ引き継ぐ。

## 利用者への影響

- user_maintenance_impact: possible
- 対象利用者・機能: 全利用者（家庭内メンバー全員）。通常の夜間配信は従来どおり1日1通で変化なし。
  **設定画面の「夜間バッチを今すぐ実行」を押したときの挙動が変わる**（従来は押すたびに
  LINE配信キューが増えていたが、以後は最新1件へ置き換わる＝二重配信されない）。
  これは不具合修正であり、利用者にとっては意図した動作。
- 通知方法: 不要

## env・secret contract

- 変更: なし
- 変数名・secret種類のみ: 該当なし
- provisioning/rotation: 不要

secret値は記載していない。

## Data・migration・backup

- schema/format変更: **あり**。`readygo_outbox`へ`claimed_at`列（nullable、既定値なし）と
  partial unique index（`readygo_outbox_pending_household_unique`、`household_id`に対し
  `status = 'pending'`の行のみ）を追加。既存列の削除・型変更は無い
- migration: `20260920222509_readygo_outbox_claim`（`ALTER TABLE ADD COLUMN`・
  `CREATE UNIQUE INDEX`のみ）。Claudeがローカル開発DBで生成・適用し、重複するpending
  insertが実際に拒否されること（`duplicate key value violates unique constraint`）を
  確認済み
- backup対象: なし（削除対象・追加対象とも配信キューの運用状態であり、購入履歴等の
  業務データではない）
- restore確認: 該当なし
- backward compatibility: あり（`BatchResult`はfield追加のみで既存fieldを維持。mobile側は
  `alerts`・`queued`しか参照していないため改修不要。旧clientからの`POST /run-batch`も
  そのまま動作する。`status`列の値が増える（`claimed`追加）が、既存コードが`status`を
  文字列として扱う箇所は本notice対応で全て更新済み）

## Deploy・rollback

- deploy前提: なし
- deploy手順の変更: なし
- rollback方法: 旧image tagへの切り替え（従来手順、またはnotice 010のrollback機構）
- rollback不能条件: 特になし。ただし**rollback前に削除された`readygo_outbox`行は戻らない**
  （image rollbackで削除ロジックは無効化されるが、既に削除済みの行はDB restoreしない限り
  復元されない）。削除対象は上記のとおり再生成可能な通知キューのため、実害は無いと判断する。

## Health・テスト

- health contract変更: なし
- 実施テスト:

  **(A) Codex実施分（第1回提出）**

  - `npm run build --workspace=@stockhome/shared` / `npm run build --workspace=@stockhome/api` / `npx tsc --noEmit -p apps/mobile/tsconfig.json`: passed
  - `npx tsx --test apps/api/src/services/batch.groupTargets.test.ts apps/api/src/services/notifyTarget.test.ts`: passed (9 tests)
  - `batch.readygoQueue.test.ts` was not run by Codex because it requires a real PostgreSQL database; Claude will run it.

  **(A') Codex実施分（S014-B01・B02再対応、task `20260920-015`）**

  - `npm run build --workspace=@stockhome/shared` / `--workspace=@stockhome/api`
    （内部で`prisma generate`）: passed
  - `npx tsc --noEmit -p apps/mobile/tsconfig.json`: passed

  **(B) 実DBテスト（ローカルPostgres、Claude実施）**

  - migration検証: `prisma migrate diff`で差分SQLを生成（`ADD COLUMN`のみ。
    partial unique indexは手書き追加）、ローカル開発DBへ適用し、`INSERT`2件で
    2件目が一意制約違反になることを確認
  - `npx tsx --test apps/api/src/services/batch.readygoQueue.test.ts
    apps/api/src/routes/bridge.readygoRace.test.ts`: **8件すべて成功**
    （既存4シナリオ＋並行batch実行でpending 1件のまま（3並行実行）＋
    claimed行がbatch置換の対象外＋claimed行のACK成功とpending行不変＋
    未claimのpending行はACKされない、の4シナリオ追加）
  - `npm test --workspace=@stockhome/api`: **170件すべて成功**（notice 015・016〜019分を
    含む最新状態、`--test-concurrency=1`適用後に2回連続で170/170を確認。下記
    「テスト分離の修正経緯」参照）

  **(C) テスト分離の修正経緯（task `20260920-008`、`20260920-018`）**

  task `20260920-007`時点の実装では、世帯を指定した実行でも
  `updateCountedInInventory()`・`recalculateAllStocks()`を引数なし（全世帯対象）で
  呼んでいた。この状態では新規テストを単体実行すると成功する一方、フルスイートでは
  4件が失敗した（node:testがテストfileを並列実行するため、全世帯再計算の最中に
  他のテストfileが自分のhouseholdを削除し、`stock_snapshots_household_id_fkey`の
  FK違反になる）。`updateCountedInInventory`・`recalculateAllStocks`はいずれも
  既に`householdId?`のoptional引数を持っていた（`routes/stocks.ts`が使用済み）ため、
  引数を渡すだけで「世帯を指定した実行はその世帯のデータにしか触らない」という
  一貫した挙動になり、テスト分離の問題も解消した。**production側の不具合ではなく、
  task 007の実装が世帯スコープを一部にしか適用していなかったことが原因。**

  S014-B01・B02再対応（task `20260920-015`）で追加した
  `bridge.readygoRace.test.ts`は、実DB実行で1件失敗した。原因は
  `GET /readygo-pending`が全世帯分のpending行をまとめて返す仕様（正しい挙動）に
  対し、testが配列の先頭要素を無条件に自世帯の行と仮定していたため、ローカル
  開発DBに残っていた他世帯の残留行（それまでの検証作業で作られたもの）を
  誤って掴んでいたことだった。DBを`householdId`＋`status`で直接検索する方式へ
  修正した（task `20260920-017`、commit `7032b6a`）。**本番実装
  （`batch.ts`・`bridge.ts`）に問題は無い。**

  さらに、notice 015再対応で追加したcron相当テストが、並行実行中の他test file
  のhousehold削除と競合する問題が見つかった。個別のtest file対応を繰り返すのではなく、
  `apps/api/package.json`の`test`scriptへ`--test-concurrency=1`を追加する恒久対策を
  適用した（task `20260920-018`、commit `d282137`。notice 015と共通の対応、詳細は
  notice 015参照）。

- 結果: すべて成功
- 未実施テストと理由: production VPS上での実バッチ実行確認は未実施（production環境への
  接続はVPS管理側の個別承認後に限られるため）。deploy後の初回`daily_batch`で
  `readygo_outbox_cleaned`・`readygo_pending`の値を確認いただくのが実機確認になる。

## Log・監視

- log量/形式/保存先変更: `job_end`へ4field追加、新規イベント2種を追加。1行1JSONの形式は維持
- 新しいalert条件: なし（ただし`readygo_pending_oldest_age_h`が大きい値を取り続ける場合、
  GAS側の夜間トリガー停止を示す。監視条件として使えるが、本noticeでは条件設定までは行わない）
- secret/個人情報対策: 変更なし（通知本文・メールアドレス等はログへ出力しない。追加した4fieldは
  いずれも件数と経過時間の数値のみ）

## 提出前セルフチェック

正本: `C:\work\PRG\Sakura\Dev\vps-server-management\docs\templates\server_change_notice_pre_submission_checklist.md`

- [x] production baselineとrelease全commit・build入力差分を確認した（baseline`ec6e541`から`7032b6a`までのcommitを実際の時系列順で確認。上記release_commits参照）
- [x] source commitとnoticeをremoteの対象branchへpushした（`7032b6a`はpush済み、local/origin一致確認済み。本noticeの確定分はこれからcommit・pushする）
- [x] data更新のtransaction・同時実行・途中失敗を確認した（キューの置き換え削除→insertは
  同一バッチ内の連続操作。途中失敗時はpendingが0件になり得るが、翌日の実行で最新内容が
  再度積まれるため復旧する。購入履歴等の業務データは一切変更しない）
- [x] image rollbackとdata rollback、backup/restore条件を分けた（上記「Deploy・rollback」参照）
- [x] job/log/retention、runtime/dependency、client配信の該当有無を確認した（job: daily_batchの
  処理内容変更。log: field追加・新規イベント2種。retention: `readygo_outbox`のdelivered 30日。
  runtime/dependency: 変更なし。client配信: mobile側の変更を含まないため該当なし）
- [ ] app owner、VPS review、production承認、client配信承認を分離した — いずれも未実施。下記Approval参照
- [x] secret非混入とtracked working tree cleanを確認した（`git status --short`で確認。既知の無関係な未追跡ファイルのみ残存）

## 未解決事項

- `readygo_outbox`の`delivered`保持期間（30日）はClaudeの提案値であり、VPS管理側・app ownerからの
  指定値ではない。運用開始後に長すぎる／短すぎると判断された場合は調整が必要。
- 滞留検知（`readygo_pending_oldest_age_h`）はログへ出すところまで。閾値超過時の
  アプリ内表示は所見C-3（notice `20260920-STOCKHOME-015`）で別途対応済み
  （夜間バッチ自体の成否表示であり、ReadyGoキュー滞留そのものの専用表示ではない点に
  留意）。
- `claimed`のままACKされずに残った行（GASの実行失敗等）を掃除する仕組みは無い
  （`delivered`の30日保持のみ対象）。検証作業でローカル開発DBに70件以上の
  claimed残留行が生じたことをClaudeが確認・削除した実績あり。production運用で
  同様の蓄積が問題になった場合は別途対応が必要。

## 希望時期

特に指定なし。notice 010〜013と同じ計画にまとめてproduction反映する想定。

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: これから実施
- VPS管理チャットへ渡すローカル絶対path: `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260920-STOCKHOME-014-summary.md`

## Approval

- app owner: 未実施
- VPS management review: 未実施
- production approval: 未実施
- related task_id: 20260920-007（初回実装）、20260920-008（テスト分離の修正）、
  20260920-015（S014-B01・B02対応）、20260920-017（testの不具合修正）、
  20260920-018（並行実行の恒久対策、notice 015と共通）
