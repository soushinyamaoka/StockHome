# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20260920-STOCKHOME-019

app: stockhome

source_branch: main

source_commit: 7fabec64748c4123e6aef13c3f6ef1bb9e2547d5

production_baseline_commit: ec6e541b8bf88654baa68c3dd3b1c2fcbdb9d6ad

release_commits:（baseline以降。notice 018以降の分のみ再掲。それ以前の全commit列は
notice 010〜018の提出内容を参照）

- `ec6e541`（baseline。notice `20260918-STOCKHOME-009`でproduction反映・`verified`済み）
- （中略。notice 010〜017までの全commitは各noticeのrelease_commits参照）
- `332c8c0`（notice `20260920-STOCKHOME-018`の新規作成。所見C-7。`ops/**`のみ。
  **本noticeの対象外**）
- `7fabec6`（**本notice対象・最終source**。所見C-1対応、`users.ts`・
  `corrections.ts`のHTTPレベルテスト追加。テストのみ、実装への変更なし）

**本noticeが対象とするのは所見C-1への対応（自動テストの未カバー領域追加）。
notice 010〜018はいずれも別変更のため分離したままとする。**

impact_level: L1

status: ready_for_review

created_by: Claude

production_change: not_required

vps_management_handoff: required

deployment_status: not_applicable

## 変更概要

2026-09-03の全体点検所見C-1（報告書時点で優先度「高」）「自動テストが1件もない」
への対応。api側には既に152件（本notice時点で163件）のテストがあり指摘時点とは
状況が異なるが、ユーザーとの相談の結果、**api側の未カバー領域を埋める**方針とした
（task `20260920-014`、Codexが実装）。

権限・世帯境界に関わる分岐が多く退行リスクが高い`users.ts`（家族メンバー管理、
admin限定操作・自己ロックアウト防止）と`corrections.ts`（在庫補正、世帯境界
チェック・snapshot再計算）に、それぞれHTTPレベルのテストを新規追加した
（計11シナリオ）。**実装コード（`users.ts`・`corrections.ts`）自体への変更は
一切無い**。

## 変更理由

2026-09-03の全体点検所見への対応（優先度「高」→現状は既にテスト基盤あり、
未カバー領域の補強として対応）。詳細は`stockhome-review-findings-20260903.md`
（点検報告書）を参照。

## server_impact判定

server_impact: none

判定理由: **テストファイルの新規追加のみで、実装（`users.ts`・
`corrections.ts`）・schema・API contract・runtime挙動への変更は一切無い**。
port/bind/domain/health endpoint/起動command/DB schema/migration/volume/cron/
env名/ログ出力、いずれも無変更。

## 現在と変更後

| 項目 | 現在 | 変更後 |
|---|---|---|
| `users.ts`のテストカバレッジ | HTTPレベルテスト0件 | `users.http.test.ts`（6シナリオ: admin/member権限、reusedExisting、自己ロックアウト防止、世帯境界チェック2箇所） |
| `corrections.ts`のテストカバレッジ | HTTPレベルテスト0件 | `corrections.http.test.ts`（5シナリオ: 正常系、世帯境界チェック2箇所、snooze設定・解除） |
| `users.ts`・`corrections.ts`の実装 | 変更なし | 変更なし |

## 影響対象

- service/container: 該当なし（テストファイルのみ、production imageには
  含まれない。`npm test`はci/開発時のみ実行）
- URL/port/health: 変更なし
- cron/timer/worker: 変更なし
- dependency: 変更なし
- data/DB/volume: 変更なし
- log/monitoring: 変更なし

## production変更

- 必要性: なし（`production_change: not_required`）
- 想定作業: 該当なし。deploy不要（実装コードへの変更が無いため、既存
  productionの挙動に一切影響しない）。
- downtime: 該当なし
- maintenance window: 不要

## 利用者への影響

- user_maintenance_impact: none
- 対象利用者・機能: 該当なし
- 通知方法: 不要

## env・secret contract

- 変更: なし

## Data・migration・backup

- schema/format変更: なし
- migration: なし
- backup対象: なし
- restore確認: 該当なし
- backward compatibility: 該当なし（実装コード変更なし）

## Deploy・rollback

- deploy前提: なし（deploy自体が不要）
- deploy手順の変更: なし
- rollback方法: 該当なし
- rollback不能条件: 特になし

## Health・テスト

- health contract変更: なし
- 実施テスト:

  **(A) 静的検証（Codex実施）**
  - `npm run build --workspace=@stockhome/shared` / `--workspace=@stockhome/api`: passed
  - `npx tsc --noEmit -p apps/mobile/tsconfig.json`: passed

  **(B) 実DBテスト（ローカルPostgres、Claude実施）**
  - `npx tsx --test apps/api/src/routes/users.http.test.ts
    apps/api/src/routes/corrections.http.test.ts`: **11件すべて成功**
    - `users.http.test.ts`（6件）: 一覧取得（admin/member）、新規追加
      （admin成功・member 403）、既存email再利用（passwordHash不変）、
      自己ロックアウト防止（admin降格拒否）、他世帯userIdで404
    - `corrections.http.test.ts`（5件）: 補正作成・snapshot反映、他世帯
      itemIdで404（補正作成・履歴取得の両方）、snooze設定（7日後の
      snoozeUntil）・解除（null）
  - `npm test --workspace=@stockhome/api`: **163件すべて成功**（既存152件＋
    新規11件。リグレッション無し）

- 結果: すべて成功
- 未実施テストと理由: 該当なし（実装コード変更が無いため、production環境での
  追加確認は不要）。

## Log・監視

- log量/形式/保存先変更: なし
- 新しいalert条件: なし
- secret/個人情報対策: 変更なし

## 提出前セルフチェック

正本: `C:\work\PRG\Sakura\Dev\vps-server-management\docs\templates\server_change_notice_pre_submission_checklist.md`

- [x] production baselineとrelease全commit・build入力差分を確認した（baseline`ec6e541`から`7fabec6`までの全47commitを実際の時系列順で確認。上記release_commits参照）
- [x] source commitとnoticeをremoteの対象branchへpushした（`7fabec6`はpush済み、local/origin一致確認済み。本notice fileはこれからcommit・pushする）
- [x] data更新のtransaction・同時実行・途中失敗を確認した — 該当なし（テスト追加のみで実装への変更が無いため）
- [x] image rollbackとdata rollback、backup/restore条件を分けた — 該当なし（imageの変更が無い）
- [x] job/log/retention、runtime/dependency、client配信の該当有無を確認した（いずれも該当なし。テストファイルのみの追加）
- [ ] app owner、VPS review、production承認、client配信承認を分離した — production承認は不要（`production_change: not_required`）。VPS reviewは下記Approval参照
- [x] secret非混入とtracked working tree cleanを確認した（`git status --short`で確認。既知の無関係な未追跡ファイルのみ残存）

未確認・該当なしの理由: 本noticeはテストファイルの新規追加のみで実装コードへの変更を伴わないため、多くの項目が「該当なし」となる。production承認プロセス自体は不要。

## 未解決事項

- api側の他の未カバー領域（`appConfig.ts`・`notifications.ts`・
  `pushDevices.ts`・`reflections.ts`・`stocks.ts`等のHTTPレベルテスト）は
  本notice範囲外。優先度・要否は別途判断する。

## 希望時期

特に指定なし。コード変更を伴わないため、他noticeのproduction反映計画とは
独立して、VPS管理側の都合の良いタイミングで内容確認いただければ十分。

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要（記録として。production反映作業自体は不要）
- ユーザーへの案内: これから実施
- VPS管理チャットへ渡すローカル絶対path: `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260920-STOCKHOME-019-summary.md`

## Approval

- app owner: 未実施
- VPS management review: 未実施
- production approval: 不要（`production_change: not_required`）
- related task_id: 20260920-014
