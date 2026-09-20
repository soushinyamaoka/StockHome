# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20260920-STOCKHOME-014

app: stockhome

source_branch: main

source_commit: （本変更の最終commit確定後にClaudeが記入）

production_baseline_commit: ec6e541b8bf88654baa68c3dd3b1c2fcbdb9d6ad

release_commits:（baseline以降。notice 013以降の分のみ再掲。それ以前の全commit列は
notice 010・012・013の提出内容を参照）

- `ec6e541`（baseline。notice `20260918-STOCKHOME-009`でproduction反映・`verified`済み）
- （中略。notice 010・011・012・013までの全commitは各noticeのrelease_commits参照）
- `0f27da3`（notice `20260920-STOCKHOME-013`のsource。**本noticeの対象外**、013で`accepted`済み）
- `11a9a15`（notice `20260920-STOCKHOME-012`のsource。**本noticeの対象外**、012で`accepted`済み）
- `115b1ab`（notice 012・013の第2回レビュー反映。`ops/**`のみ）
- `74cb471`（**本notice対象**。所見A-5・A-6対応の実装。`apps/api`のみ）
- （追補commit。本taskの修正分。確定後にClaudeが記入）

**本noticeが対象とするのは所見A-5・A-6への対応（夜間バッチのReadyGoキュー重複抑止・
世帯スコープ・保持期間）。notice 010〜013はいずれも`accepted`済みの別変更のため、
分離したままとする。production反映時はVPS管理側の方針により、notice 010〜013と
本noticeを1つの計画へまとめる想定。**

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
| ReadyGoキューへの投入 | 既存pendingの有無を見ず無条件にinsert（実行のたびに増える） | 投入直前に同一世帯のpendingを削除してから最新1件をinsert（pendingは常に最大1件・最新内容） |
| GAS停止時のキュー滞留 | 毎晩積まれ続け、復旧時に最大20通が一度に流れる | 常に最新1件へ置き換わるため積み上がらない |
| 配信済み(`delivered`)行の保持 | 無制限に残る | 30日を超えた行を削除（cron実行は全世帯、手動実行は当該世帯のみ） |
| 滞留の可視化 | 無し | `job_end`へ`readygo_pending`・`readygo_pending_oldest_age_h`・`readygo_superseded`・`readygo_cleaned`を追加 |

## 影響対象

- service/container: `stockhome-api-prod`（`apps/api/src/services/batch.ts`・`routes/dashboard.ts`・`lib/logger.ts`の変更。route追加・削除は無し、`POST /api/dashboard/run-batch`のレスポンスは既存fieldを維持したままfieldを追加）
- URL/port/health: 変更なし
- cron/timer/worker: schedule（19:55 JST / 20:10 JST）は変更なし。`daily_batch`の処理内容のみ変更
- dependency: 変更なし（新規パッケージ追加なし）
- data/DB/volume: schema変更なし。`readygo_outbox`テーブルの**行の保持挙動**が変わる（pendingの置き換え削除、delivered 30日超の削除）
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

- schema/format変更: なし（`readygo_outbox`の列・型・status値は変更しない）
- migration: なし
- backup対象: なし（削除対象は配信済み(`delivered`)の通知本文と、未配信のまま置き換えられた
  `pending`行。いずれも再生成可能な通知キューであり、購入履歴等の業務データではない）
- restore確認: 該当なし
- backward compatibility: あり（`BatchResult`はfield追加のみで既存fieldを維持。mobile側は
  `alerts`・`queued`しか参照していないため改修不要。旧clientからの`POST /run-batch`も
  そのまま動作する）

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

  **(A) Codex実施分**

  - `npm run build --workspace=@stockhome/shared` / `npm run build --workspace=@stockhome/api` / `npx tsc --noEmit -p apps/mobile/tsconfig.json`: passed
  - `npx tsx --test apps/api/src/services/batch.groupTargets.test.ts apps/api/src/services/notifyTarget.test.ts`: passed (9 tests)
  - `batch.readygoQueue.test.ts` was not run by Codex because it requires a real PostgreSQL database; Claude will run it.

  **(B) 実DBテスト（ローカルPostgres、Claude実施）**

  （task `20260920-008`完了後にClaudeが記入）

- 結果: （確定後にClaudeが記入）
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

- [ ] production baselineとrelease全commit・build入力差分を確認した — 最終commit確定後にClaudeが記入
- [ ] source commitとnoticeをremoteの対象branchへpushした — 最終commit確定後にClaudeが記入
- [x] data更新のtransaction・同時実行・途中失敗を確認した（キューの置き換え削除→insertは
  同一バッチ内の連続操作。途中失敗時はpendingが0件になり得るが、翌日の実行で最新内容が
  再度積まれるため復旧する。購入履歴等の業務データは一切変更しない）
- [x] image rollbackとdata rollback、backup/restore条件を分けた（上記「Deploy・rollback」参照）
- [x] job/log/retention、runtime/dependency、client配信の該当有無を確認した（job: daily_batchの
  処理内容変更。log: field追加・新規イベント2種。retention: `readygo_outbox`のdelivered 30日。
  runtime/dependency: 変更なし。client配信: mobile側の変更を含まないため該当なし）
- [ ] app owner、VPS review、production承認、client配信承認を分離した — いずれも未実施。下記Approval参照
- [ ] secret非混入とtracked working tree cleanを確認した — 最終commit確定後にClaudeが記入

## 未解決事項

- `readygo_outbox`の`delivered`保持期間（30日）はClaudeの提案値であり、VPS管理側・app ownerからの
  指定値ではない。運用開始後に長すぎる／短すぎると判断された場合は調整が必要。
- 滞留検知（`readygo_pending_oldest_age_h`）はログへ出すところまでで、閾値超過時の通知経路は
  本noticeの範囲外（所見C-3として別途対応予定）。

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
- related task_id: 20260920-007（実装）、20260920-008（テスト分離の修正）
