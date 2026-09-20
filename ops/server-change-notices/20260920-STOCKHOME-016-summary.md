# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20260920-STOCKHOME-016

app: stockhome

source_branch: main

source_commit: e36e8271f29591ebd7e830e8d799dadbd889f09f

production_baseline_commit: ec6e541b8bf88654baa68c3dd3b1c2fcbdb9d6ad

release_commits:（baseline以降。notice 015以降の分のみ再掲。それ以前の全commit列は
notice 010・012・013・014・015の提出内容を参照）

- `ec6e541`（baseline。notice `20260918-STOCKHOME-009`でproduction反映・`verified`済み）
- （中略。notice 010〜014までの全commitは各noticeのrelease_commits参照）
- `42a48d8`（notice `20260920-STOCKHOME-015`のsource。所見C-3対応。**本noticeの対象外**）
- `9695255`（notice 015の新規作成。`ops/**`のみ）
- `6400c6f`（所見A-10・C-6対応の実装。`apps/api`のみ）
- `e36e827`（**本notice対象・最終source**。`candidateIntake.householdFallback.test.ts`の
  検証内容の安定化（DB全体の状態に依存しない決定的なアサーションへ変更）。テストのみ）

**本noticeが対象とするのは所見A-10・C-6への対応。notice 010〜015はいずれも別変更の
ため分離したままとする。production反映時はVPS管理側の方針により、notice 010〜015と
本noticeを1つの計画へまとめる想定。**

impact_level: L2

status: ready_for_review

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 変更概要

2026-09-03の全体点検所見のうち2件への対応（task `20260920-011`／`20260920-012`、
Codexが実装）。

- **A-10**（優先度「低」）: 在庫計算の「今日」は実行環境の**ローカル時刻getter**
  （`getFullYear()`等、プロセスの`TZ`環境変数に依存）、メール取込は**明示的に+9h**した
  固定JST基準（TZ非依存）と、2通りの日付算出方法が同居していた。`docker-compose`の
  `TZ: Asia/Tokyo`設定が外れると在庫の「今日」判定が静かに1日ズレる状態だった。
- **C-6**（優先度「中」）: Gmail取込の世帯解決が、メールから利用者を特定できない場合
  「最初に作られたhousehold」へ無条件にフォールバックしていた。ユーザーとの相談の結果、
  拡張はせず**単一世帯前提を明記した上で、household 2件以上の状態でフォールバックが
  発動したら警告ログを出す**安全網のみを追加する方針とした。

## 変更理由

2026-09-03の全体点検所見への対応（優先度「低」1件・「中」1件）。詳細は
`stockhome-review-findings-20260903.md`（点検報告書）を参照。

## server_impact判定

server_impact: notify

判定理由: 在庫計算の日付基準算出ロジックを変更する（実行結果自体は`TZ:
Asia/Tokyo`が設定されている現行のproduction環境下では変わらないが、算出方法が
変わるため）。新規ログイベント`household_resolution_fallback`を追加する。
port/bind/domain/health endpoint/起動command/env名/DB schema/migration/volume/
cron/既存API contract（エンドポイントの追加削除）は変更していない。

## 現在と変更後

| 項目 | 現在 | 変更後 |
|---|---|---|
| 在庫計算の「今日」算出 | `d.getFullYear()`等のローカルgetter（プロセスの`TZ`環境変数に依存。`TZ: Asia/Tokyo`が無いとJST 0時〜8時台の日付がズレる） | `utils/date.ts`の`jstDateOnly`（`getTime()`+9h してUTC getterで取得。TZ環境変数に一切依存しない） |
| メール取込の日付算出 | `candidateIntake.ts`内のローカル`jstDateOnly`（TZ非依存、変更なし） | `utils/date.ts`の共通`jstDateOnly`を参照する形へ統一（ロジック自体は無変更） |
| Gmail取込の世帯解決フォールバック | 無条件に最初のhouseholdへフォールバック、ログ無し | household 2件以上の状態でフォールバックが発動した場合のみ`household_resolution_fallback`警告ログを出す（emailそのものは出力しない） |

## 影響対象

- service/container: `stockhome-api-prod`（`apps/api/src/services/stockCalc.ts`・
  `candidateIntake.ts`・`apps/api/src/utils/date.ts`・`apps/api/src/lib/logger.ts`の
  変更。route追加・削除は無し、既存fieldの変更は無し）
- URL/port/health: 変更なし
- cron/timer/worker: 変更なし（`todayDateOnly()`のexport名・シグネチャ・戻り値の
  意味は変更していないため、呼び出し元の`daily_batch`・`routes/dashboard.ts`・
  `routes/purchases.ts`・`candidateIntake.ts`への影響なし）
- dependency: 変更なし
- data/DB/volume: schema変更なし
- log/monitoring: 新規イベント`household_resolution_fallback`（warn）を追加。
  既存イベントの意味・形式は変更なし

## production変更

- 必要性: あり
- 想定作業: 通常のAPI deployで反映される。現行production環境は既に
  `TZ: Asia/Tokyo`が設定されているため（`docker-compose.prod.yml`）、
  日付算出の**実際の計算結果**はdeploy前後で変わらない（アルゴリズムの
  頑健性が上がるのみ）。世帯解決フォールバックの挙動も、現行の単一世帯運用では
  変わらない（household 1件のため警告ログは出ない）。
- downtime: 既存と同じ（brief-restart）
- maintenance window: 不要

`production_change: required`のため、`deployment_status: not_started`のままVPS管理側へ引き継ぐ。

## 利用者への影響

- user_maintenance_impact: none
- 対象利用者・機能: 該当なし。現行の単一世帯運用・`TZ: Asia/Tokyo`設定下では、
  利用者から見た挙動（在庫計算結果、通知タイミング）は一切変わらない。
- 通知方法: 不要

## env・secret contract

- 変更: なし
- 変数名・secret種類のみ: 該当なし
- provisioning/rotation: 不要

secret値は記載していない。

## Data・migration・backup

- schema/format変更: なし
- migration: なし
- backup対象: なし
- restore確認: 該当なし
- backward compatibility: あり（`todayDateOnly()`の戻り値の意味・型は不変。
  `resolveHouseholdId`のexport化は内部実装の変更で、外部インターフェースへの
  影響なし）

## Deploy・rollback

- deploy前提: なし
- deploy手順の変更: なし
- rollback方法: 旧image tagへの切り替え（従来手順、またはnotice 010のrollback機構）
- rollback不能条件: 特になし（DBデータを変更しないため、image rollbackのみで
  完全に戻せる）

## Health・テスト

- health contract変更: なし
- 実施テスト:

  **(A) Codex実施分（task `20260920-011`）**
  - `npm run build --workspace=@stockhome/shared` / `--workspace=@stockhome/api`: passed
  - `npx tsc --noEmit -p apps/mobile/tsconfig.json`: passed
  - `npx tsx --test apps/api/src/utils/date.test.ts`: passed（3 tests、JST日付境界の
    3シナリオ。TZ環境変数に依存しない純粋関数として検証）

  **(B) 実DBテスト（ローカルPostgres、Claude実施）と修正経緯**
  - `candidateIntake.householdFallback.test.ts`を実行したところ1件失敗した。原因は
    テスト自体の設計誤り（DB全体で最も古いhousehold 2件を期待する検証内容だったが、
    ローカル開発DBには本テストが作成したhousehold以外にも既存householdがあり、
    そちらが返っていた）。**本番コード（`resolveHouseholdId`）自体の不具合ではない**
    （実運用では家庭は1つしか無く、この曖昧さは発生しない）。決定的な内容
    （非null文字列であることの確認）へ修正し（task `20260920-012`）、再実行して
    成功を確認した。
  - `npm test --workspace=@stockhome/api`: **152件すべて成功**（既存148件＋
    新規4件（`date.test.ts`3件＋`householdFallback.test.ts`1件）。リグレッション無し）

- 結果: すべて成功
- 未実施テストと理由: production VPS上での実際の`TZ`未設定シナリオ確認は行っていない
  （production環境は既に`TZ: Asia/Tokyo`が設定されており、意図的に外す検証はリスクが
  ある。ローカルでの純粋関数テストで、TZ環境変数に依存しないことを直接確認済み
  （`date.test.ts`はTZを操作せず、`jstDateOnly`が`getTime()`＋固定オフセットのみで
  計算することをコードレビューと動的テストの両方で確認した）。

## Log・監視

- log量/形式/保存先変更: 新規イベント`household_resolution_fallback`（warn）を追加
- 新しいalert条件: なし（現行の単一世帯運用では発生しない想定のログ。将来household
  が2件以上になった際の早期発見用）
- secret/個人情報対策: 変更なし。`household_resolution_fallback`イベントはemailその
  ものを出力せず、`reason`（`email_not_matched`/`email_missing`の2値のみ）を記録する

## 提出前セルフチェック

正本: `C:\work\PRG\Sakura\Dev\vps-server-management\docs\templates\server_change_notice_pre_submission_checklist.md`

- [x] production baselineとrelease全commit・build入力差分を確認した（baseline`ec6e541`から`e36e827`までの全40commitを実際の時系列順で確認。上記release_commits参照）
- [x] source commitとnoticeをremoteの対象branchへpushした（`e36e827`はpush済み、local/origin一致確認済み。本notice fileはこれからcommit・pushする）
- [x] data更新のtransaction・同時実行・途中失敗を確認した（該当なし。DBデータ更新を伴わない変更のため）
- [x] image rollbackとdata rollback、backup/restore条件を分けた（本変更はimage rollbackのみで完全に戻せる。data rollbackは不要）
- [x] job/log/retention、runtime/dependency、client配信の該当有無を確認した（job: 変更なし。log: 新規イベント1件追加のみ。retention: 該当なし。runtime/dependency: 変更なし。client配信: mobile側の変更を含まないため該当なし）
- [ ] app owner、VPS review、production承認、client配信承認を分離した — いずれも未実施。下記Approval参照
- [x] secret非混入とtracked working tree cleanを確認した（`git status --short`で確認。既知の無関係な未追跡ファイルのみ残存）

未確認・該当なしの理由: app owner・VPS review・production承認は本notice提出時点で未実施のまま記録する。

## 未解決事項

- C-6は「拡張はせず、単一世帯前提を明記＋警告ログ」という対症療法であり、
  複数世帯対応そのものは行っていない（ユーザーとの合意事項）。`CLAUDE.md`に
  今後2世帯目を追加する場合の設計方針（フォールバック依存箇所の洗い出しが
  必要である旨）を記載済み。

## 希望時期

特に指定なし。notice 010〜015と同じ計画にまとめてproduction反映する想定。

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: これから実施
- VPS管理チャットへ渡すローカル絶対path: `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260920-STOCKHOME-016-summary.md`

## Approval

- app owner: 未実施
- VPS management review: 未実施
- production approval: 未実施
- related task_id: 20260920-011（実装）、20260920-012（テスト安定化）
