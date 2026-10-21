# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20261021-STOCKHOME-023

app: stockhome

source_branch: main

source_commit: （Codex実装のcommit確定後にClaudeが記入）

production_baseline_commit: 16918f80393461eaeed6f66a6b7fd17c29e964f7

release_commits: （Codex実装のcommit確定後にClaudeが記入）

impact_level: L2

status: draft

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_applied

## 変更概要

消耗品ごとに**消費の休止**（残数を今の数のまま止める）と再開をできるようにする。

- `items` に列 `consumption_paused_at`（timestamp、null可）を追加（migration `20261021120000_add_item_consumption_paused_at`）
- 在庫計算: 休止中は、経過日数を休止した日までで打ち切る（残数が減らない）。休止中はアラート対象外
- 新規エンドポイント（既存JWT認証配下、`req.auth.householdId` で絞り込み）: `POST /api/items/:id/pause`・`POST /api/items/:id/resume`
- 再開時は、止めていた残数を再開日起点の補正値として書き込み、休止期間分は消費しない
- 休止中の購入（手入力・Gmail取込確定・夜間バッチの counted 化）は既存の積み上げ処理のまま、止まっている残数に加算される

（詳細はCodex実装・Claudeレビュー後に確定する）

## Codex実装メモ

codex_implementation_note: （Codexが実装結果の要約1行に置き換える）

## server_impact判定

server_impact: approval_required

判定理由: Prisma migration（既存テーブル `items` への nullable 列追加）を伴うため。

（以下の節はCodex実装・Claudeの動作確認後に記入する）
