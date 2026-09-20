# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20260920-STOCKHOME-015

app: stockhome

source_branch: main

source_commit: 42a48d8cdb99e92fdd09c649bd7dc8bb4ed9fea7

production_baseline_commit: ec6e541b8bf88654baa68c3dd3b1c2fcbdb9d6ad

release_commits:（baseline以降。notice 014以降の分のみ再掲。それ以前の全commit列は
notice 010・012・013・014の提出内容を参照）

- `ec6e541`（baseline。notice `20260918-STOCKHOME-009`でproduction反映・`verified`済み）
- （中略。notice 010・011・012・013までの全commitは各noticeのrelease_commits参照）
- `f233ed9`（notice `20260920-STOCKHOME-014`のsource。所見A-5・A-6対応。**本noticeの対象外**、014で`accepted`待ち）
- `78721e5`（notice 014の確定・runtime-contract反映。`ops/**`のみ）
- `42a48d8`（**本notice対象**。所見C-3対応、`BatchRunStatus`テーブル追加。`apps/api`＋`apps/mobile`）

**本noticeが対象とするのは所見C-3への対応（夜間バッチ失敗のアプリ内表示）。
notice 010〜014はいずれも別変更のため分離したままとする。production反映時は
VPS管理側の方針により、notice 010〜014と本noticeを1つの計画へまとめる想定。**

impact_level: L2

status: ready_for_review

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 変更概要

2026-09-03の全体点検所見C-3（優先度「中」）「バッチの失敗が誰にも届かない」への対応
（task `20260920-009`／`20260920-010`、Codexが実装）。

ログは`job_start`/`job_end`で成功・失敗・未実行を判別できるところまで整っているが、
これを見る人がいなければ、夜間バッチ（19:55 JST）が止まっても「通知が来ない日が続く」
だけで気づけなかった。ユーザーとの相談の結果、通知経路の追加（Push/LINE）ではなく、
**アプリ内表示のみ**で対応する方針とした。

夜間バッチ（cron実行）の直近実行結果を新規テーブル`batch_run_status`へ1行だけ記録し、
`GET /api/dashboard`のレスポンスへ`lastBatchRun`として載せる。mobile側は、前回実行が
失敗、または前回成功から26時間を超えて新しい記録が無い（＝バッチ自体が動いていない
可能性）場合にのみ、ダッシュボード上部へ警告バナーを表示する。

## 変更理由

2026-09-03の全体点検所見への対応（優先度「中」1件）。詳細は
`stockhome-review-findings-20260903.md`（点検報告書）を参照。

## server_impact判定

server_impact: notify

判定理由: 新規テーブル追加（schema変更・migration）、`GET /api/dashboard`の
レスポンスへのfield追加、mobile側の新規UI表示を伴うため。
port/bind/domain/health endpoint/起動command/cron schedule/DB接続情報/
既存API contract（エンドポイントの追加削除・既存fieldの変更）は変更していない。

## 現在と変更後

| 項目 | 現在 | 変更後 |
|---|---|---|
| 夜間バッチ失敗の可視化 | ログ（`job_end`のstatus）のみ。見る人がいなければ気づけない | `batch_run_status`テーブルへcron実行時のみ記録し、失敗時・26時間超過時にダッシュボードへ警告バナーを表示 |
| `GET /api/dashboard`のレスポンス | `alerts`・`alertTotal`・`pendingCandidates`・`todayNotifications`・`totalActiveItems` | 上記に`lastBatchRun`（`{status, ranAt, ageHours} | null`）を追加 |
| 手動バッチ実行（検証用ボタン） | （変更なし） | `batch_run_status`は更新しない（検証用実行であり、cronの稼働状況を表すものではないため） |

## 影響対象

- service/container: `stockhome-api-prod`（`apps/api/src/services/batch.ts`・
  `routes/dashboard.ts`の変更、`prisma/schema.prisma`へのモデル追加＋migration。
  route追加・削除は無し、既存fieldの変更は無し）
- URL/port/health: 変更なし
- cron/timer/worker: schedule（19:55 JST）は変更なし。処理内容へ状態記録を追加
- dependency: 変更なし
- data/DB/volume: **新規テーブル`batch_run_status`を追加**（migration
  `20260920210514_add_batch_run_status`）。既存テーブルへの変更は無し
- log/monitoring: 変更なし（新規ログイベントは追加していない。既存の`job_end`
  ログはそのまま）
- client: mobile側に新規コンポーネント`BatchStatusBanner`、ダッシュボード画面へ
  組み込み。EAS Update配信が別途必要（`ops/client-releases/`で管理）

## production変更

- 必要性: あり
- 想定作業: 通常のAPI deployで反映される。deploy時に新規migration
  （`batch_run_status`テーブル作成）が自動適用される（entrypointの
  `prisma migrate deploy`、既存の仕組みのまま）。deploy直後は`batch_run_status`
  が0行のため、次回cron実行（19:55 JST）まで`lastBatchRun`は`null`
  （mobile側は警告を表示しない）。
- downtime: 既存と同じ（brief-restart）
- maintenance window: 不要

`production_change: required`のため、`deployment_status: not_started`のままVPS管理側へ引き継ぐ。

## 利用者への影響

- user_maintenance_impact: possible
- 対象利用者・機能: 全利用者（家庭内メンバー全員）。通常時（バッチ正常稼働時）は
  何も表示されず影響なし。**夜間バッチが失敗した場合、または26時間以上実行記録が
  無い場合のみ、ダッシュボード上部に警告バナーが表示される**（新規UI）。
- 通知方法: 不要。mobile側の反映にはEAS Update配信が必要（`ops/client-releases/`の
  手順に従う）。

## env・secret contract

- 変更: なし
- 変数名・secret種類のみ: 該当なし
- provisioning/rotation: 不要

secret値は記載していない。

## Data・migration・backup

- schema/format変更: あり。**新規テーブル`batch_run_status`を追加**
  （`id`・`job_name`（unique）・`status`・`run_id`・`ran_at`・`duration_ms`・
  `error_name`・`updated_at`の8列。他テーブルとの外部キー関係なし）。
- migration: `20260920210514_add_batch_run_status`（`CREATE TABLE`・
  `CREATE UNIQUE INDEX`のみ）。Claudeがローカル開発DBで生成・適用・
  `prisma migrate deploy`相当の動作を確認済み。
- backup対象: あり（`data.persistent_paths`のDB全体backupに含まれる。
  ただし本テーブルの内容は「直近1回のバッチ実行結果」のみで、失えば次回の
  バッチ実行で自然に再生成される非永続的な運用状態のため、実害は小さい）。
- restore確認: 通常のDB restoreに含まれる（個別の復元試験は行っていない。
  他のシンプルなstatusテーブルと同等の扱いでよいと判断）。
- backward compatibility: あり（`GET /api/dashboard`はfield追加のみで既存
  fieldを維持。旧mobile clientは`lastBatchRun`を無視するだけで正常動作する）。

## Deploy・rollback

- deploy前提: なし
- deploy手順の変更: なし（既存のmigration自動適用の仕組みに乗る）
- rollback方法: 旧image tagへの切り替え（従来手順、またはnotice 010のrollback機構）。
  **schema変更を伴うため、image rollbackだけでは`batch_run_status`テーブルは
  残ったままになる**（旧imageのコードはこのテーブルを一切参照しないため、
  存在していても動作に影響しない。テーブル自体の削除は必須ではない）。
- rollback不能条件: 特になし。新規テーブルの内容（直近バッチ実行結果）は
  失われても実害が無いため、data rollbackは不要と判断する。

## Health・テスト

- health contract変更: なし
- 実施テスト:

  **(A) Codex実施分（task `20260920-010`）**
  - `npm run build --workspace=@stockhome/shared` / `--workspace=@stockhome/api`
    （内部で`prisma generate`）: passed
  - `npx tsc --noEmit -p apps/mobile/tsconfig.json`: passed
  - `npx tsx --test apps/api/src/services/batch.groupTargets.test.ts
    apps/api/src/services/notifyTarget.test.ts`: passed

  **(B) 実DBテスト（ローカルPostgres、Claude実施）**
  - migration生成: `prisma migrate diff`で差分SQLを生成（`CREATE TABLE`・
    `CREATE UNIQUE INDEX`のみであることを確認）、`prisma migrate deploy`で
    ローカル開発DBへ適用し成功を確認
  - `npm test --workspace=@stockhome/api`: **148件すべて成功**
    （migration適用後の全件再確認。リグレッション無し）
  - end-to-end確認（スクラッチ環境、commit対象外）: 実際の`runDailyBatch()`
    （cron相当、householdId未指定）を実行し`batch_run_status`へ`status:
    'success'`が記録されることを確認。`GET /api/dashboard`（実HTTP、実認証）が
    `lastBatchRun: {status, ranAt, ageHours}`を返すことを確認。手動実行
    （householdId指定）では`batch_run_status`が更新されない（既存値のまま）
    ことを確認。検証で作成したテストデータはすべて削除済み

- 結果: すべて成功
- 未実施テストと理由: production VPS上での実バッチ失敗シナリオ（実際に
  バッチを失敗させて警告バナーが表示されることの実機確認）は未実施
  （production環境への接続はVPS管理側の個別承認後に限られるため、また
  意図的な失敗誘発はproduction上では行わない）。deploy後、正常稼働が
  続く限り警告は表示されないため、実機での「正常時に何も出ない」ことの
  確認で代替する。

## Log・監視

- log量/形式/保存先変更: なし（新規ログイベントは追加していない）
- 新しいalert条件: なし（本noticeはアプリ内表示のみ。外部監視・通知経路の
  追加はスコープ外）
- secret/個人情報対策: 変更なし。追加したテーブル・fieldはバッチの実行状態
  （成功/失敗・時刻・所要時間・エラー名）のみで、利用者データ・通知本文は
  含まない

## 提出前セルフチェック

正本: `C:\work\PRG\Sakura\Dev\vps-server-management\docs\templates\server_change_notice_pre_submission_checklist.md`

- [x] production baselineとrelease全commit・build入力差分を確認した（baseline`ec6e541`から`42a48d8`までの全37commitを実際の時系列順で確認。上記release_commits参照）
- [x] source commitとnoticeをremoteの対象branchへpushした（`42a48d8`はpush済み、local/origin一致確認済み。本notice fileはこれからcommit・pushする）
- [x] data更新のtransaction・同時実行・途中失敗を確認した（`batch_run_status`はjob_nameの一意制約による単純なupsertで、失敗しても既存`try/catch`が握りつぶしバッチ本体の成否には影響しない。途中失敗時は前回値が残るだけで、翌日の実行で最新値へ更新される）
- [x] image rollbackとdata rollback、backup/restore条件を分けた（上記「Deploy・rollback」参照。新規テーブルはrollback後も残存するが無害）
- [x] job/log/retention、runtime/dependency、client配信の該当有無を確認した（job: daily_batchの処理内容変更のみ、schedule不変。log: 変更なし。retention: 本テーブルは1行のみで増加しないため保持ポリシー不要。runtime/dependency: 変更なし。client配信: mobile側UI変更のためEAS Update配信が必要）
- [ ] app owner、VPS review、production承認、client配信承認を分離した — いずれも未実施。下記Approval参照
- [x] secret非混入とtracked working tree cleanを確認した（`git status --short`で確認。既知の無関係な未追跡ファイルのみ残存）

未確認・該当なしの理由: app owner・VPS review・production承認・client配信承認は本notice提出時点で未実施のまま記録する。

## 未解決事項

- 警告バナーの表示閾値（前回成功から26時間）はClaudeの提案値であり、VPS管理側・
  app ownerからの指定値ではない。19:55 JST cronに対し翌日20時台超過を想定した値。
  運用開始後に調整が必要な場合がある。
- mobile側の反映にはEAS Update配信が必要（API側のみdeployしても、mobile側の
  表示は既存clientには反映されない）。配信タイミングはAPI deployとあわせて
  別途調整する。

## 希望時期

特に指定なし。notice 010〜014と同じ計画にまとめてproduction反映する想定。

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: これから実施
- VPS管理チャットへ渡すローカル絶対path: `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260920-STOCKHOME-015-summary.md`

## Approval

- app owner: 未実施
- VPS management review: 未実施
- production approval: 未実施
- related task_id: 20260920-009（実装、migration生成でblocked）、20260920-010（migration配置・commit）
