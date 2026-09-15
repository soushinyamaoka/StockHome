# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20260915-STOCKHOME-008

app: stockhome

source_branch: main

source_commit: 4105725a39b40f92c05957f004cc0e36a8e44b78

production_baseline_commit: 117e41d3c12153f9594f0d8bc8cd78098ba9b4bf

release_commits: `117e41d`（baseline）→ `40c7947`（task `20260915-001`、notice
`20260915-STOCKHOME-007`対象の通知先修正。**build inputに影響**）→ `1122158`/`5f36e55`/`cb7e194`
（notice `20260915-STOCKHOME-007`の作成・改訂3件。いずれも`ops/**`のみでbuild inputに
影響しない）→ `4105725`（task `20260915-002`、本notice対象の取り消し・復元機能追加。
**build inputに影響**）。

**重要: 本noticeのsource commitには、notice `20260915-STOCKHOME-007`（通知先フィルタ修正、
未production反映）の変更が不可分に含まれる。** 両noticeはlinear historyで連続しており、
`4105725`のAPI containerイメージには自動的に`40c7947`のコードも含まれる。
production反映は本notice単独では行えず、**`20260915-STOCKHOME-007`のS007-B01修正・
S007再レビュー完了とあわせて1つのdeployとして扱う必要がある**（下記「production変更」参照）。

impact_level: L3

status: ready_for_review

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 変更概要

2026-09-03の全体点検所見B-3（優先度「中」）「取り消せない操作が3つある」への対応。
以下3つの新規APIエンドポイントと対応するmobile UIを追加した。

1. **`POST /api/import-candidates/:id/unconfirm`**: 取込候補の確定（`confirmed` /
   `auto_confirmed`）を取り消す。紐づく`purchase_log`を削除し、`counted_in_inventory`
   だった場合は既存の`reverseAccumulatedPurchase`（notice `20260904-STOCKHOME-005`で
   導入済み）で積み上げ分を近似的に差し戻し、`candidateStatus`を`detected`へ戻す。
2. **`POST /api/import-candidates/:id/unignore`**: 候補の無視（`ignored`）を取り消し、
   `detected`へ戻す（副作用なし、単純なステータス更新）。
3. **`POST /api/items/:id/restore`**: 論理削除された品目を復元する
   （`isActive: true`、`deletedAt`/`deletedBy`を`null`に戻し、stock snapshotを再計算）。

mobile側は、確定済み/無視済みの取込候補カードへ「確定を取り消す」「無視を取り消す」
ボタンを、非アクティブ品目カードへ「元に戻す」ボタンをそれぞれ追加した
（いずれも既存の削除確認と同じ`Alert.alert`確認ダイアログを経由する）。

`packages/shared` / `apps/gas` / DBスキーマの変更はない。設計はClaude、実装はCodex
（ai-watch経由、task `20260915-002`）が行い、Claudeがコードレビューと
DB依存回帰テスト5件の実行確認を行った。

## 変更理由

ユーザーから、2026-09-03の全体点検所見のうち4件（通知先フィルタ・取り消せない操作・
購入履歴編集・品目検索絞り込み）への対応を依頼された（2026-09-15）。本noticeはそのうち
「取り消せない操作」1件分。押し間違えたときにDBを直接操作するしかない状態を解消する。

## server_impact判定

server_impact: approval_required

判定理由: DBスキーマ変更・migration・新規env var・新規外部依存・新規cron・
port/bind/URL変更・認証境界の変更はいずれも無い。一方、`unconfirm`は既存の
`purchase_log`行を**削除**し、積み上げ補正値（`item_runtime_states.manual_override_qty`）
を**書き換える**新しい書き込み経路である。`restore`も論理削除フラグ・snapshotという
永続データを書き換える。これらは「利用者が明示的に取り消し操作を選んだ結果としての
データ削除・書き換え」であり、notice `20260904-STOCKHOME-005`（買い足し累積機能）が
`item_runtime_states`の書き込み意味を変えたときと同様にL3・`approval_required`と判定する。
新規write系APIエンドポイントの追加でもある。

## 現在と変更後

| 項目 | 現在 | 変更後 |
|---|---|---|
| 取込候補の確定（`confirmed`/`auto_confirmed`） | 戻す手段なし。誤確定はDB直接操作のみ | `POST /:id/unconfirm`で取り消し可能。紐づく購入履歴を削除し、積み上げ分を近似的に差し戻す |
| 取込候補の無視（`ignored`） | 戻す手段なし | `POST /:id/unignore`で`detected`へ戻せる（副作用なし） |
| 品目の論理削除 | 復元手段なし。一覧には残るが操作導線がない | `POST /:id/restore`で`isActive`を復帰しsnapshotを再計算 |
| `purchase_log`の削除経路 | 手動購入の取消（`DELETE /purchases/:id`）のみ | Gmail自動取込確定の取消（`unconfirm`）でも同じ`reverseAccumulatedPurchase`パスを通って削除されるようになる |
| mobile: 候補一覧（確定/無視済み表示時） | ボタンなし | 「確定を取り消す」「無視を取り消す」ボタン（確認ダイアログ付き） |
| mobile: 品目一覧（非アクティブ表示時） | ボタンなし | 「元に戻す」ボタン（確認ダイアログ付き） |

## 影響対象

- service/container: `stockhome-api-prod`（新規route3件追加。既存route・起動構成は変更しない）
- URL/port/health/bind: 変更なし
- cron/timer/worker: 変更なし（夜間バッチのロジックには触れていない）
- dependency: 追加・削除なし
- data/DB/volume: スキーマ変更なし。`purchase_log`の削除、`item_runtime_states.manual_override_qty`
  の書き換え、`items.is_active`/`deleted_at`/`deleted_by`の書き換えという、
  いずれも既存カラムへの新しい書き込み経路が増える（新規テーブルは無い）
- log/monitoring: 新規ログeventの追加なし。既存の`job_start`/`job_end`等のバッチログには
  影響しない（本変更は同期的なユーザー操作APIであり、バッチ処理には関与しない）

## production変更

- 必要性: あり（コンテナ再ビルド・入れ替えのみ。migration不要）
- 想定作業: 既存の`scripts/deploy.ps1`（`npm run deploy`）による通常のcontainer rebuild・入れ替え
- **前提条件**: 上記のとおり、本sourceにはnotice `20260915-STOCKHOME-007`
  （S007-B01修正待ち、再レビュー未完了）のコードが不可分に含まれる。したがって
  本notice単独でのproduction承認・deployは行わず、`20260915-STOCKHOME-007`の
  再レビュー完了（S007-B01修正・境界test・app owner承認記録済み、VPS管理側の
  再accepted）を待ってから、両notice分を1回のdeployとしてまとめて承認・実施する
- downtime: brief-restart（apiコンテナのみ再起動。postgresコンテナ・DBデータは変更しない）
- maintenance window: 未定。VPS管理側レビュー後に判断

`production_change: required`のため、`deployment_status: not_started`のままVPS管理側へ引き継ぐ。

## 利用者への影響

- user_maintenance_impact: possible
- 対象利用者・機能: 取込候補の確定・無視、品目の削除操作を行う利用者全員
  （誤操作時の回復手段が増えるため、基本的には利用者に有利な変更）
- 機能面: デプロイ後、確定済み/無視済みの候補、削除済みの品目それぞれに取り消し・復元の
  ボタンが表示されるようになる。既存の確定・無視・削除操作自体の挙動は変更しない
- 注意点: `unconfirm`による積み上げ差し戻しは、`reverseAccumulatedPurchase`の既知の制約
  （その後の別の積み上げ・補正で上書き済みの場合は完全には一致しない、近似的な巻き戻し）を
  引き継ぐ。これはnotice `20260904-STOCKHOME-005`で既にapp owner承認済みの制約と同じもの
- 通知方法: 機能追加であり、利用者（家族）への事前告知は本noticeでは必須としない

## env・secret contract

- 変更: なし
- 変数名・secret種類: 追加・削除・意味変更なし
- provisioning/rotation: 不要

secret値は記載しない。

## Data・migration・backup

- schema/format変更: なし
- migration: なし
- backup対象: 通常のdeploy時運用を超える追加backupは不要と判断する。ただし`unconfirm`は
  `purchase_log`行を実際に削除する新しい経路であるため、deploy直前の通常dumpに加え、
  deploy直後の初回利用状況（`unconfirm`/`restore`の呼び出し有無）をVPS管理側で
  把握できるようにしておくことが望ましい
- restore確認: 追加のrestore試験は不要（スキーマ変更が無いため、通常のdeploy手順の
  範囲で足りる）
- backward compatibility: 旧API imageへ戻しても、新規3エンドポイントが消えるだけで
  既存機能に影響しない。ただし、**`unconfirm`によって削除された`purchase_log`行や、
  差し戻された`manual_override_qty`、`restore`によって復帰した`items.is_active`等は、
  image rollbackでは元に戻らない**（データの削除・書き換えを伴う操作のため）。
  これらの補正が必要な場合は別のDB変更承認で扱う

## Deploy・rollback

- deploy前提: 本notice`ready_for_review`後、VPS管理側レビュー・production承認。
  上記のとおりnotice`20260915-STOCKHOME-007`の再レビュー完了とあわせて1回のdeployとする
- deploy手順の変更: なし（既存の`scripts/deploy.ps1`をそのまま使う）
- rollback方法: 旧API imageへ戻すことで、以後の新規エンドポイントは404になる。
  ただし取り消し・復元操作によって**既に行われたデータの削除・書き換え**
  （削除済み`purchase_log`、差し戻し済み`manual_override_qty`、復帰済み`items`行）は
  image rollbackでは戻らない。これらの補正が必要な場合は別のDB変更承認で扱う
- rollback不能条件: 取り消し・復元操作によるデータ変更そのものは、image rollbackでは
  取り消せない（上記のとおり）。したがって、誤操作が疑われる場合はDB dumpからの
  個別データ復元、または対象品目の在庫補正画面からの手動修正で対応する

## Health・テスト

- health contract変更: なし
- 実施テスト:
  - `npm run build --workspace=@stockhome/shared`: 成功（Codexが実施）
  - `npm run build --workspace=@stockhome/api`: 成功（新規DB依存テストファイルを含む
    `src/**/*`の型検査も含めて成功。Codexが実施）
  - `npx tsc --noEmit -p apps/mobile/tsconfig.json`: 成功（Codexが実施）
  - `apps/api/src/services/candidateIntake.reversal.test.ts`（`unconfirmImportCandidate`の
    DB依存回帰テスト）5件: 全件成功。Claudeが対話セッションでローカル開発用Postgres
    （`localhost:5434`）に対して実行し確認した（2026-09-15）。内容: counted確定の取り消し
    （積み上げ差し戻し確認）、未counted確定の取り消し（積み上げ不変確認）、`legacyId`経由の
    紐付け、購入履歴が見つからない場合の非エラー処理、取り消し後の再確定（回帰防止）
- 未実施テストと理由: `unconfirm`/`unignore`/`restore`各ルートのHTTPレベル結合テスト
  （認証込み）は作成していない（サービス層の`unconfirmImportCandidate`はDB依存テストで
  検証済みだが、ルート層の404/409判定・`ownerFilter`適用は静的レビューのみ）。
  mobile UIの実機（Expo Go/内部配布APK）での見た目・操作確認は未実施

## Log・監視

- log量/形式/保存先変更: なし（本変更は同期的なユーザー操作APIであり、新規ログeventは
  追加していない。既存の`job_start`/`job_end`等バッチ関連ログには影響しない）
- 新しいalert条件: なし
- secret/個人情報対策: 変更なし。新規ログ出力は無い

## 提出前セルフチェック

正本: `C:\work\PRG\Sakura\Dev\vps-server-management\docs\templates\server_change_notice_pre_submission_checklist.md`

- [x] production baselineとrelease全commit・build入力差分を確認した（baseline`117e41d`から
      HEAD`4105725`までの全5commitをbuild input該当有無で区別した。上記`release_commits`参照。
      notice`20260915-STOCKHOME-007`のsource`40c7947`が不可分に含まれる点を明記した）
- [x] source commitとnoticeをremoteの対象branchへpushした（`4105725`はCodexが
      `git push origin main`済み・確認済み。本notice文書のcommitはこの後に作成する）
- [x] data更新のtransaction・同時実行・途中失敗・再実行を確認した（`unconfirmImportCandidate`は
      `purchase_log`削除と積み上げ差し戻しを同一`$transaction`内で実行し、既存の
      `reverseAccumulatedPurchase`・品目ロック機構をそのまま再利用している。同時実行時の
      挙動はnotice`20260904-STOCKHOME-005`で検証済みの既存機構に依存するため、本notice単独の
      追加検証は行っていない）
- [x] image rollbackとdata rollback、backup/restore条件を分けた（上記「Deploy・rollback」参照。
      データの削除・書き換えを伴うためimage rollbackだけでは戻らない点を明記した）
- [x] job/log/retention、runtime/dependency、client配信の該当有無を確認した（job/logは
      該当なし。runtime/dependencyは該当なし。client配信は本notice単独では未確定、
      APIデプロイ後に別途判断する）
- [ ] app owner、VPS review、production承認、client配信承認を分離した（**app owner承認・
      VPS review・production承認はいずれも未実施**。client配信も未確定）
- [x] secret非混入とtracked working tree cleanを確認した（`git status`で未追跡fileは
      本notice作成前から存在する無関係な2件（`ops/investigations/OPS-P1-08-npm-audit-findings.md`、
      `ops/production-db-operations/`）のみで、本commitには含まれていないことを確認した）

未確認・該当なしの理由: app owner承認・VPS management review・production承認は、
本notice提出後にVPS管理チャットへ引き継いで初めて得られるものであり、本セルフチェック
時点では未実施が正しい状態。

## 未解決事項

- 本source commitにはnotice`20260915-STOCKHOME-007`（S007-B01修正待ち）の内容が
  不可分に含まれるため、本notice単独でのproduction承認は成立しない。両notice分を
  まとめて1回のdeployとして扱う前提でVPS管理側レビューを受ける必要がある
- `unconfirm`/`unignore`/`restore`各ルートのHTTPレベル結合テストは未作成（上記
  「Health・テスト」参照）。production反映前に追加するか、既存の静的レビュー＋
  サービス層テストで十分と判断するかは未確定
- mobile UIの実機確認は未実施

## 希望時期

指定なし。notice`20260915-STOCKHOME-007`の再レビュー完了、VPS管理側レビューの結果を
踏まえて判断する。

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: 本notice作成後にチャットで案内する
- VPS管理チャットへ渡すローカル絶対path:
  `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260915-STOCKHOME-008-summary.md`

## Approval

- app owner: 未実施（本notice記載の利用者影響についての明示承認はこれから）
- VPS management review: 未実施
- production approval: 未実施
- source task_id（app/ai-watch）: 20260915-002
- related VPS task_id: 未採番
