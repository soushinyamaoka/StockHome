# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20260929-STOCKHOME-021

app: stockhome

source_branch: main

source_commit: dea7c89a0d60a103e20fae824a65e30a3003d4eb

production_baseline_commit: ec6e541b8bf88654baa68c3dd3b1c2fcbdb9d6ad

release_commits:（baseline以降。notice 010〜020の分は各noticeを参照。本notice対象は `dea7c89`）

impact_level: L1

status: draft

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 変更概要

在庫一覧（`GET /api/stocks`）の各要素へ、消費ペースの実績提案
`suggestedDaysPerUnit`（`{ value, sampleCount } | null`）を追加する。
値の算出は既存の `computeSuggestedDaysPerUnit`（`GET /api/items/:itemId/purchases`
で notice `20260904-STOCKHOME-005` 以来使用中）をそのまま流用する。

mobile の在庫一覧は、設定値（`daysPerUnit`）と提案値の差が30%以上、かつ提案の
根拠となる購入間隔が2件以上ある品目にだけ「ペース見直し?」の印を出す。印を押すと
品目編集画面（既存の提案値表示・採用ボタンがある）へ移る。自動書き換えはしない。

## 変更理由

消費ペースの提案値は品目編集画面を開かないと見えず、設定値とのズレに気づけない
（仕様書29.1「使用ペースの自動学習」の仕上げ。AI Progress 登録済みの改善項目）。

## server_impact判定

server_impact: notify

判定理由: 既存エンドポイント `GET /api/stocks` のレスポンスへフィールドを追加する
（追加のみ。既存フィールドは不変で後方互換）。schema・migration・env・port/bind・
cron・依存の変更は無い。

## 現在と変更後

| 項目 | 現在 | 変更後 |
|---|---|---|
| `GET /api/stocks` の各要素 | `item`, `snapshot`, `runtimeState` | 左記＋`suggestedDaysPerUnit`（`{value, sampleCount} \| null`） |
| DBクエリ | 品目＋snapshot＋runtimeState の1回 | 左記＋対象品目の購入履歴（`item_id`, `purchased_at`, `qty` のみ）をまとめて1回 |
| 在庫一覧画面 | 印なし | ズレが大きい品目に「ペース見直し?」 |

## 影響対象

- service/container: `stockhome-api-prod`（`apps/api/src/routes/stocks.ts`）
- URL/port/health: 変更なし
- cron/timer/worker: 変更なし
- dependency: 変更なし
- data/DB/volume: 変更なし（読み取りクエリが1本増えるのみ。単一世帯で購入履歴は数百件規模）
- log/monitoring: 変更なし

## production変更

- 必要性: あり（通常のAPI deployで反映）
- downtime: 既存と同じ（brief-restart）
- maintenance window: 不要
- mobile側: 在庫一覧の変更を含むため次回EAS Update配信が必要（`ops/client-releases/`で別途管理）
- 反映順: 順不同で安全（旧mobileは追加フィールドを読まない。新mobileは旧APIではフィールドが無く印が出ないだけ）

## 利用者への影響

- user_maintenance_impact: none
- 在庫一覧に小さな印が増えるのみ。既存の操作フローは変更なし

## env・secret contract

- 変更: なし

## Data・migration・backup

- schema/format変更: なし
- migration: なし
- backward compatibility: レスポンスへのフィールド追加のみ

## Deploy・rollback

- deploy手順の変更: なし
- rollback方法: 旧image tagへの切り替え（従来手順）
- rollback不能条件: なし（データ書き込みを伴わない）

## Health・テスト

- health contract変更: なし
- Codex実施分:
  - `npm run build --workspace=@stockhome/shared`: passed
  - `npm run build --workspace=@stockhome/api`: passed
  - `npx tsc --noEmit -p apps/mobile/tsconfig.json`: passed
  - `npx tsx --test apps/mobile/src/lib/paceReview.test.ts apps/mobile/src/lib/historyTimeline.test.ts apps/mobile/src/lib/daysPerUnitInput.test.ts apps/mobile/src/lib/quickPurchase.test.ts apps/mobile/src/lib/noticesLogic.test.ts apps/mobile/src/lib/batchStatus.test.ts apps/mobile/src/api/notices.test.ts`: passed (33 tests)
- Claude実施分（実DB、ローカルPostgres）:
  - `npx tsx --test --test-concurrency=1 apps/api/src/routes/stocks.http.test.ts`: 1件成功
    （提案値が既存関数の結果と一致／購入0・1件はnull／他世帯の購入・品目が混ざらない／
    既存フィールド維持）
  - `npm test --workspace=@stockhome/api`: 191件すべて成功（既存190件＋新規1件）。
    なお1回目の全体実行でのみ、ReadyGo関連5件が開発DBの残留データ（claimed行497件）の
    影響と見られる一時的な失敗を示した（本変更は無関係。変更を外した状態でも同一の
    2ファイルを再実行して成功、変更ありでも再実行・全体再実行で成功を確認）

## Log・監視

- 変更なし

## 未解決事項

- 判定基準（差30%以上・購入間隔2件以上）はClaudeの提案値。運用後に多すぎる／少なすぎる場合は mobile 側の定数調整で対応できる（API変更不要）。

## 希望時期

特に指定なし。notice 010〜020と同じ計画にまとめてproduction反映する想定。

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: 実装・検証完了後に実施
- VPS管理チャットへ渡すローカル絶対path:
  `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260929-STOCKHOME-021-summary.md`

## Approval

- app owner: 未実施
- VPS management review: 未実施
- production approval: 未実施
- related task_id: 20260929-004
