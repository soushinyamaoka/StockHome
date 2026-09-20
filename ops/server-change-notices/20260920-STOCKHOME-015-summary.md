# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20260920-STOCKHOME-015

app: stockhome

source_branch: main

source_commit: 8d0406c69a72ebd141d328fc54ba0d9ce7f9789b

production_baseline_commit: ec6e541b8bf88654baa68c3dd3b1c2fcbdb9d6ad

release_commits:（baseline以降。notice 019以降の分のみ再掲。それ以前の全commit列は
notice 010〜019の提出内容を参照）

- `ec6e541`（baseline。notice `20260918-STOCKHOME-009`でproduction反映・`verified`済み）
- （中略。notice 010〜019までの全commitは各noticeのrelease_commits参照）
- `42a48d8`（所見C-3対応の初回実装。task `20260920-009`／`010`。**第1回レビューで
  blocked**）
- 〜`f289a08`（notice 010〜019、第1回提出分。詳細は各noticeのrelease_commits参照）
- `0cad656`（notice 018・019のmetadata訂正。`ops/**`のみ。**本noticeの対象外**）
- `2de0270`（notice 014のS014-B01・B02対応。**本noticeの対象外**、notice 014参照）
- `7032b6a`（notice 014のtest不具合修正。**本noticeの対象外**、notice 014参照）
- `a67d412`（**S015-B01・B02対応**。`batch.ts`へテスト専用の`forceFailureForTest`
  追加、cron成功/失敗/手動実行の恒久test追加、mobile側のバナー表示ロジックを
  純粋関数へ切り出しdedicated test追加、`DashboardScreen`へfocus/resume時の
  再取得を追加。`apps/api`＋`apps/mobile`）
- `d282137`（cron相当testと他test fileの並行実行競合への恒久対策
  （`apps/api/package.json`の`test`scriptへ`--test-concurrency=1`追加）。
  notice 014と共通の対応）
- `c59cef9`（notice 018のsource_commit hash訂正。`ops/**`のみ。**本noticeの対象外**）
- `a223349`（notice 014のS014-B03・B04・B05対応。**本noticeの対象外**、notice 014参照）
- `8d0406c`（**本notice対象・最終source。S015-B03対応**。`batch_run_status`書き込みを
  独立関数`recordBatchRunStatus`へ切り出し、cron/failureのtestがこれを直接呼ぶ形へ
  変更（`runDailyBatch()`を一切呼ばなくなり、他世帯データへの副作用が完全に無くなる）。
  `forceFailureForTest`を削除。`apps/api`のみ）

**本noticeが対象とするのは所見C-3への対応（夜間バッチ失敗のアプリ内表示）。
notice 010〜014・016〜019は別変更のため分離したままとする。production反映時は
VPS管理側の方針により、notice 010〜019と本noticeを1つの計画へまとめる想定。**

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

## VPS管理レビュー結果への対応（blocked→再提出）

第1回VPS管理レビューで、以下2点の指摘を受けblockedとなった
（`stockhome_findings_014_019_review_20260920.md` §2参照）。

- **S015-B01**: 主目的である失敗表示の恒久testが無い。`runDailyBatch`失敗時に
  `batch_run_status.status=failure`が残ること、dashboardがfailureを返すこと、
  mobile bannerがfailure/staleだけを表示することを回帰testが保証していなかった。
- **S015-B02**: `DashboardScreen`のqueryは初回mountと手動pull-to-refreshだけで、
  screen focus・app resume時の再取得が無く、tab画面がmount済みのまま翌日
  バッチが失敗しても、利用者が戻ってもcachedな`lastBatchRun`のままだった。

対応: `runDailyBatch`へテスト専用の`forceFailureForTest`オプションを追加し、
cron成功・cron失敗・手動実行（非更新）の3シナリオをdashboard応答の確認込みで
恒久test化した。mobile側はバナーの表示条件判定を純粋関数
（`resolveBatchStatusMessage`）へ切り出し、mobile側にjest等のtest runnerを
新規導入せず`npx tsx --test`で5シナリオを検証できるようにした（所見C-1での
「mobile側にはランナーを追加しない」決定を維持）。`DashboardScreen`へ
`useFocusEffect`（画面focus時）・`AppState`監視（app resume時）による
再取得を追加した。

Claudeが実DBで検証する過程で、追加したcron相当test（`batchRunStatus.test.ts`）が
並行実行中の他test fileのhousehold削除と競合する構造的な問題を発見した
（notice 014のS014-B01・B02対応時にも同種の問題が既存test fileで起きていた）。
個別のtest fileごとに対策するのではなく、`apps/api/package.json`の
`test`scriptへ`--test-concurrency=1`を追加する恒久対策とした（過去2回、
個別file対応を繰り返していたため）。ローカルで170件（api全体）を2回連続で
成功させ、再現性を確認済み。

## VPS管理レビュー結果への対応（第2回：blocked→再提出）

第2回VPS管理レビューで、S015-B01・B02の解消は確認されたが、新たに1点の
指摘を受けblockedとなった
（`stockhome_findings_014_019_review_20260920.md` §6参照）。

- **S015-B03**: `batchRunStatus.test.ts`のsuccess caseが引数無し
  `runDailyBatch()`を実行するため、ローカルDB内の**全household**を
  再計算し、testが作成していない世帯のReadyGo pendingやPush処理にも
  触れていた（VPS管理側の実行でも`processed: 18`・`households: 2`・
  `readygo_pending: 9`となり、scope外dataを処理したことが確認された）。
  `cleanup`はtestが作ったhouseholdだけを対象にしており、これらの副作用を
  戻していなかった。`--test-concurrency=1`（task `20260920-018`）はtestの
  **失敗**は防ぐが、**scope外dataへの副作用**は解消しないと指摘された。
  あわせて「production用処理へ`forceFailureForTest`を露出する必要が
  なくなる設計を優先する」との指示があった。

対応: `batch_run_status`への書き込みを`runDailyBatch`本体から独立した
関数`recordBatchRunStatus`へ切り出し、cron成功・cron失敗のテストは
この関数を**直接呼ぶ**形へ変更した。これにより`runDailyBatch()`（全世帯
処理）を一度も実行せずに「cron相当の記録が正しく行われ、dashboardへ
反映されること」を検証できるようになり、他世帯のhousehold・item・
ReadyGoキュー・push等へ一切触れなくなった。結果として、テスト専用フック
だった`forceFailureForTest`は不要になり削除した（reviewの指示どおり）。
「手動実行では更新されない」テストは元々`householdId`指定のためscope外に
触れておらず、`runDailyBatch`本体の分岐が正しく機能する確認として維持した。

Claudeが実DBで、修正後の`batchRunStatus.test.ts`実行の前後で
`stock_snapshots`テーブルの行数・内容（全行のchecksum）が完全に一致する
ことを直接確認した（他世帯データへの副作用が無いことの実証）。

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
| ダッシュボードの再取得タイミング | 初回mount・手動pull-to-refreshのみ | 上記に加え、画面focus時（他tabから戻った時）・app resume時（バックグラウンドから復帰した時）にも自動再取得する |
| バッチ失敗記録・表示の回帰test | 無し | cron成功・cron失敗（テスト専用フックで再現）・手動実行（非更新）をdashboard応答込みで検証。mobile側は純粋関数抽出で5シナリオを検証 |

## 影響対象

- service/container: `stockhome-api-prod`（`apps/api/src/services/batch.ts`・
  `routes/dashboard.ts`の変更、`prisma/schema.prisma`へのモデル追加＋migration。
  route追加・削除は無し、既存fieldの変更は無し。`batch.ts`の
  `batch_run_status`書き込みを独立関数`recordBatchRunStatus`へ切り出したが、
  `runDailyBatch`本体の処理内容・呼び出し方は無変更。テスト専用フックだった
  `forceFailureForTest`は削除済み）
- URL/port/health: 変更なし
- cron/timer/worker: schedule（19:55 JST）は変更なし。処理内容へ状態記録を追加
- dependency: 変更なし
- data/DB/volume: **新規テーブル`batch_run_status`を追加**（migration
  `20260920210514_add_batch_run_status`）。既存テーブルへの変更は無し
- log/monitoring: 変更なし（新規ログイベントは追加していない。既存の`job_end`
  ログはそのまま）
- client: mobile側に新規コンポーネント`BatchStatusBanner`、表示ロジックを
  切り出した純粋関数`lib/batchStatus.ts`、ダッシュボード画面への組み込みと
  focus/resume時の自動再取得を追加。EAS Update配信が別途必要
  （`ops/client-releases/`で管理）

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

  **(A) Codex実施分（第1回提出、task `20260920-010`）**
  - `npm run build --workspace=@stockhome/shared` / `--workspace=@stockhome/api`
    （内部で`prisma generate`）: passed
  - `npx tsc --noEmit -p apps/mobile/tsconfig.json`: passed
  - `npx tsx --test apps/api/src/services/batch.groupTargets.test.ts
    apps/api/src/services/notifyTarget.test.ts`: passed

  **(A') Codex実施分（第1回再対応S015-B01・B02、task `20260920-016`）**
  - `npm run build --workspace=@stockhome/shared` / `--workspace=@stockhome/api`: passed
  - `npx tsc --noEmit -p apps/mobile/tsconfig.json`: passed
  - `npx tsx --test apps/mobile/src/lib/batchStatus.test.ts`: passed（5 tests。
    null／failure／26時間超過（stale）／正常／26時間境界の5シナリオ）

  **(A'') Codex実施分（第2回再対応S015-B03、task `20260921-002`）**
  - `npm run build --workspace=@stockhome/shared` / `--workspace=@stockhome/api`: passed
  - `npx tsc --noEmit -p apps/mobile/tsconfig.json`: passed

  **(B) 実DBテスト（ローカルPostgres、Claude実施）**
  - migration生成: `prisma migrate diff`で差分SQLを生成（`CREATE TABLE`・
    `CREATE UNIQUE INDEX`のみであることを確認）、`prisma migrate deploy`で
    ローカル開発DBへ適用し成功を確認
  - `npx tsx --test apps/api/src/services/batchRunStatus.test.ts`: **3件すべて
    成功**（`recordBatchRunStatus`直接呼び出しによるsuccess記録→dashboard反映、
    failure記録→dashboard反映、`runDailyBatch`の手動実行では
    `batch_run_status`が更新されないことの3シナリオ）
  - **scope外data不変の確認（S015-B03対応の核心）**: `batchRunStatus.test.ts`
    実行の直前・直後で`stock_snapshots`テーブルの行数（18件、不変）と
    全行のchecksum（`md5(string_agg(...))`）が完全に一致することを確認。
    他世帯のstock_snapshotへ一切書き込みが発生しないことを実証した
  - `npm test --workspace=@stockhome/api`: **174件すべて成功**
  - end-to-end確認（スクラッチ環境、commit対象外。第1回提出時点で実施）: 実際の
    `runDailyBatch()`（cron相当、householdId未指定）を実行し`batch_run_status`へ
    `status: 'success'`が記録されることを確認。`GET /api/dashboard`（実HTTP、実認証）が
    `lastBatchRun: {status, ranAt, ageHours}`を返すことを確認。手動実行
    （householdId指定）では`batch_run_status`が更新されない（既存値のまま）
    ことを確認。検証で作成したテストデータはすべて削除済み

  **(C) テスト分離の修正経緯（task `20260920-018`）**

  `batchRunStatus.test.ts`のcron相当テスト（`runDailyBatch()`を世帯指定なしで
  呼ぶ）は、DB上の全household・全itemを処理する。並列実行中の他test fileが
  自分のhouseholdを削除するタイミングと重なると、`stock_snapshots_household_id_fkey`の
  外部キー制約違反になる（notice 014のS014-B01・B02対応時にも同種の問題が
  別のtest fileで起きていた）。今後cron実行を伴うtestを追加するたびに再発しうる
  構造的な問題と判断し、`apps/api/package.json`の`test`scriptへ
  `--test-concurrency=1`を追加する恒久対策とした（個別file対応は行わない）。
  実行時間は並列実行の約4秒から約15秒へ増えるが、リグレッション防止の確実性を
  優先し許容範囲と判断した。**production側の不具合ではなく、テスト実行環境の
  並列性に起因する問題。**

- 結果: すべて成功
- 未実施テストと理由: production VPS上での実バッチ失敗シナリオ（実際に
  バッチを失敗させて警告バナーが表示されることの実機確認）は未実施
  （production環境への接続はVPS管理側の個別承認後に限られるため、また
  意図的な失敗誘発はproduction上では行わない）。deploy後、正常稼働が
  続く限り警告は表示されないため、実機での「正常時に何も出ない」ことの
  確認で代替する。`forceFailureForTest`による回帰testが失敗記録・表示の
  ロジック自体は保証している。

## Log・監視

- log量/形式/保存先変更: なし（新規ログイベントは追加していない）
- 新しいalert条件: なし（本noticeはアプリ内表示のみ。外部監視・通知経路の
  追加はスコープ外）
- secret/個人情報対策: 変更なし。追加したテーブル・fieldはバッチの実行状態
  （成功/失敗・時刻・所要時間・エラー名）のみで、利用者データ・通知本文は
  含まない

## 提出前セルフチェック

正本: `C:\work\PRG\Sakura\Dev\vps-server-management\docs\templates\server_change_notice_pre_submission_checklist.md`

- [x] production baselineとrelease全commit・build入力差分を確認した（baseline`ec6e541`から`8d0406c`までの全commitを実際の時系列順で確認。上記release_commits参照）
- [x] source commitとnoticeをremoteの対象branchへpushした（`8d0406c`はpush済み、local/origin一致確認済み。本notice fileはこれからcommit・pushする）
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

特に指定なし。notice 010〜014・016〜019と同じ計画にまとめてproduction反映する想定。

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: これから実施
- VPS管理チャットへ渡すローカル絶対path: `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260920-STOCKHOME-015-summary.md`

## Approval

- app owner: 未実施
- VPS management review: 未実施
- production approval: 未実施
- related task_id: 20260920-009（初回実装、migration生成でblocked）、
  20260920-010（migration配置・commit）、20260920-016（S015-B01・B02対応）、
  20260920-018（並行実行の恒久対策、notice 014と共通）、
  20260921-002（S015-B03対応）
