# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20260920-STOCKHOME-018

app: stockhome

source_branch: main

source_commit: 332c8c022f195c0a08d1d78d40aa2478c0466ff0

production_baseline_commit: ec6e541b8bf88654baa68c3dd3b1c2fcbdb9d6ad

release_commits:（baseline以降。notice 017以降の分のみ再掲。それ以前の全commit列は
notice 010〜017の提出内容を参照）

- `ec6e541`（baseline。notice `20260918-STOCKHOME-009`でproduction反映・`verified`済み）
- （中略。notice 010〜016までの全commitは各noticeのrelease_commits参照）
- `e690a16`（notice `20260920-STOCKHOME-017`の新規作成。所見C-8・A-9。**本noticeの対象外**）
- `332c8c0`（**本notice対象・最終source**。`ops/runtime-contract.yaml`へ所見C-7の
  方針記載＋本notice fileの新規作成。コード変更は無い）

**本noticeが対象とするのは所見C-7（データ保持方針の明記）への対応のみ。**

impact_level: L1

status: ready_for_review

created_by: Claude

production_change: none

vps_management_handoff: required

deployment_status: not_started

## 変更概要

2026-09-03の全体点検所見C-7（優先度「低」）「ログ類の保持方針がpush_tickets
だけ決まっている」への対応。**コード変更は無く、`ops/runtime-contract.yaml`への
方針記載のみ**（Claude直接作業）。

対象の3テーブル（`notification_logs`・`stock_correction_logs`・
`import_order_candidates`）について、**現時点では自動削除しない**という方針を
理由とともに明記した。`push_tickets`・`readygo_outbox`（所見A-5・A-6対応、
notice 014）とは異なり、これら3テーブルは「再生成不可の監査ログ」または
「削除すると別ロジック（自動確定・価格判定）に副作用が出うるデータ」であり、
単一世帯・低頻度利用では増加も緩やかなため、自動削除の対象にしない判断とした。

## VPS管理レビュー結果への対応（blocked→再提出）

第1回VPS管理レビューで、方針内容自体は受理可能だが以下2点のmetadata不整合を
指摘され（S018-D01）blockedとなった。

1. `source_commit`が、実際に`ops/runtime-contract.yaml`を変更した`332c8c0`
   ではなく、直前notice（017）作成時の`e690a16`のままだった → `332c8c0`へ
   訂正した。
2. `production_change: not_required`・`deployment_status: not_applicable`が
   テンプレート正規値と不一致だった → `production_change: none`・
   `deployment_status: not_started`へ訂正した。

コード変更・方針内容そのものへの変更は無い。

## 変更理由

2026-09-03の全体点検所見への対応（優先度「低」1件）。詳細は
`stockhome-review-findings-20260903.md`（点検報告書）を参照。

## server_impact判定

server_impact: none

判定理由: **コード変更を一切伴わない**。`ops/runtime-contract.yaml`への記述
追加のみで、production APIの挙動・DB schema・runtime・deploy手順には一切
影響しない。port/bind/domain/health endpoint/起動command/DB schema/migration/
volume/cron/API contract/ログ出力、いずれも無変更。

## 現在と変更後

| 項目 | 現在 | 変更後 |
|---|---|---|
| `notification_logs`の保持方針 | runtime-contract.yamlに記載なし | 「自動削除しない」を理由・再検討の目安（10万行）とともに明記 |
| `stock_correction_logs`の保持方針 | runtime-contract.yamlに記載なし | 同上 |
| `import_order_candidates`の保持方針 | runtime-contract.yamlに記載なし | 「自動確定・価格判定への副作用リスクがあるため自動削除しない」を明記 |
| production の実際の挙動 | 変更なし | 変更なし（方針の明文化のみ） |

## 影響対象

- service/container: 該当なし（コード変更なし）
- URL/port/health: 変更なし
- cron/timer/worker: 変更なし
- dependency: 変更なし
- data/DB/volume: 変更なし（削除処理を追加しない、という「現状維持」の明文化）
- log/monitoring: 変更なし

## production変更

- 必要性: なし（`production_change: none`）
- 想定作業: 該当なし。deploy不要（コード変更が無いため、既存productionの
  イメージ・DB・挙動に一切影響しない）。
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
- backup対象: なし（削除処理を追加しないため、backup対象範囲に変化なし）
- restore確認: 該当なし
- backward compatibility: 該当なし（コード変更なし）

## Deploy・rollback

- deploy前提: なし（deploy自体が不要）
- deploy手順の変更: なし
- rollback方法: 該当なし（`ops/runtime-contract.yaml`のみの変更のため、
  git revertで文書を戻すだけで完結する）
- rollback不能条件: 特になし

## Health・テスト

- health contract変更: なし
- 実施テスト: 該当なし（コード変更が無いため、自動テスト・ビルド確認は不要と
  判断した）。`ops/runtime-contract.yaml`のYAML構文のみ、`js-yaml`/`yaml`
  パッケージでparse成功を確認済み（Claude実施）。
- 結果: 構文チェック成功
- 未実施テストと理由: コード・DB・API挙動に変更が無いため、動的テストの対象が
  存在しない。

## Log・監視

- log量/形式/保存先変更: なし
- 新しいalert条件: なし
- secret/個人情報対策: 変更なし

## 提出前セルフチェック

正本: `C:\work\PRG\Sakura\Dev\vps-server-management\docs\templates\server_change_notice_pre_submission_checklist.md`

- [x] production baselineとrelease全commit・build入力差分を確認した（コード側の変更が無いため該当なし。`ops/runtime-contract.yaml`のみの差分であることを`git status`で確認済み）
- [x] source commitとnoticeをremoteの対象branchへpushした（`332c8c0`はpush済み、local/origin一致確認済み。本notice fileの訂正分はこれからcommit・pushする）
- [x] data更新のtransaction・同時実行・途中失敗を確認した — 該当なし（DB操作を伴わない変更のため）
- [x] image rollbackとdata rollback、backup/restore条件を分けた — 該当なし（imageの変更が無い）
- [x] job/log/retention、runtime/dependency、client配信の該当有無を確認した（retention: 本noticeそのものが3テーブルの保持方針記載。job/log/runtime/dependency/client配信: いずれも該当なし）
- [ ] app owner、VPS review、production承認、client配信承認を分離した — production承認は不要（`production_change: none`）。VPS reviewは下記Approval参照
- [x] secret非混入とtracked working tree cleanを確認した（`git status --short`で確認。既知の無関係な未追跡ファイルのみ残存）

未確認・該当なしの理由: 本noticeはコード変更を伴わないドキュメント更新のみのため、多くの項目が「該当なし」となる。production承認プロセス自体は不要（`production_change: none`）だが、`ops/runtime-contract.yaml`の内容が実機の運用方針と整合しているかの確認としてVPS管理側へ引き継ぐ。

## 未解決事項

- 3テーブルとも「再検討の目安：10万行」という閾値はClaudeの提案値であり、
  実際の監視・アラート設定は行っていない（所見C-3で追加した滞留可視化の仕組みを
  参考に、将来的に行数監視を追加する余地はある）。

## 希望時期

特に指定なし。コード変更を伴わないため、他noticeのproduction反映計画とは
独立して、VPS管理側の都合の良いタイミングで内容確認いただければ十分。

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要（`ops/runtime-contract.yaml`の内容確認のため。
  production反映作業自体は不要）
- ユーザーへの案内: これから実施
- VPS管理チャットへ渡すローカル絶対path: `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260920-STOCKHOME-018-summary.md`

## Approval

- app owner: 未実施
- VPS management review: 未実施
- production approval: 不要（`production_change: none`）
- related task_id: 該当なし（Claude直接作業、`ops/runtime-contract.yaml`への記載のみ）
