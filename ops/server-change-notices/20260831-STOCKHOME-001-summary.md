# Server Change Notice

notice_id: 20260831-STOCKHOME-001

app: stockhome

source_branch: main

source_commit: 未確定（未commit）

impact_level: L1

status: ready_for_review

created_by: Codex

production_change: none

vps_management_handoff: required

deployment_status: not_started

## 変更概要

StockHome API に共通ログ規約 v1 準拠の構造化ログを実装した。ログは引き続き stdout へ1行1JSONで出力し、`ts`、`app`、`level`、`event` を全行に付与する設計とした。定期処理には同一 `run_id` の `job_start` / `job_end` を追加し、SIGTERM / SIGINT の graceful shutdown を新設した。

## 変更理由

VPS管理側がアプリ固有のパーサーを持たずにログを判定でき、夜間バッチの成功・失敗・未実行を区別できるようにするため。

## server_impact判定

server_impact: notify

判定理由: ログ形式と必須フィールドを変更し、graceful shutdown を新設したため。出力先は stdout のままで、server側のマスク規則とログ量の大幅な増加はない。

## 現在と変更後

| 項目 | 現在 | 変更後 |
|---|---|---|
| 出力先 | stdout | stdout（変更なし） |
| ログ形式 | pino 既定JSON | 共通ログ規約 v1 準拠の1行1JSON |
| 必須フィールド | 共通必須フィールドなし | `ts` / `app` / `level` / `event` |
| HTTPリクエストログ | Fastify既定の1リクエスト2行 | 応答完了時の `http_request` 1行 |
| 夜間バッチ | 成否を機械判定できる開始・終了ログなし | 同一 `run_id` の `job_start` / `job_end` |
| プロセス終了処理 | 明示的な処理なし | SIGTERM / SIGINT graceful shutdown |

## 影響対象

- service/container: `stockhome-api-prod`
- URL/port/health: 変更なし
- cron/timer/worker: 既存夜間バッチのスケジュールは変更せず、構造化された開始・終了ログを追加
- dependency: 新規依存なし
- data/DB/volume: 変更なし
- log/monitoring: 標準出力のログ形式と監視に利用できる固定イベントを変更

## production変更

- 必要性: なし（本タスクではdeployしない）
- 想定作業: 本タスクの範囲外
- downtime: なし
- maintenance window: 不要

## 利用者への影響

- user_maintenance_impact: none
- 対象利用者・機能: なし。既存APIルート、レスポンス形状、認証方式は変更しない
- 通知方法: 利用者向け通知は不要

## env・secret contract

- 変更: なし
- 変数名・secret種類のみ: 追加・削除・意味変更なし
- provisioning/rotation: 不要

secret値は記載しない。

## Data・migration・backup

- schema/format変更: なし
- migration: なし
- backup対象: 変更なし
- restore確認: 対象外
- backward compatibility: API・DB契約に変更なし

## Deploy・rollback

- deploy前提: 本タスクではdeployしない。production反映の要否と手順は別途VPS管理側で検討する
- deploy手順の変更: なし
- rollback方法: production未反映のため本タスクでは不要。将来の反映時は対象コード差分の復旧手順を別途定める
- rollback不能条件: なし（DB・永続データ変更なし）

## Health・テスト

- health contract変更: なし
- 実施テスト: sharedビルド、APIビルド、mobile TypeScript型チェック、`apps/api/src` の `console.*` 検索、指定観点のコードレビュー（Codex）に加え、Claudeが対話セッションでローカルDBを使った動的検証を実施済み: `npm run db:up`→`npm run api:dev`で起動、`/health`をquery文字列付きで叩いてもrouteに漏れないことを確認、出力1行を実際に`JSON.parse`して`ts`/`app`/`level`/`event`を確認、`runDailyBatch()`を直接実行して`job_start`/`job_end`が同一`run_id`・`status: success`で対になることを確認、`docker compose stop postgres`でDBを止めた状態で再実行し`job_end`が`status: failure`で欠落なく出ることを確認
- 結果: 3コマンド成功、`console.*` 0件、静的コードレビュー適合、上記動的検証すべて成功
- 未実施テストと理由: graceful shutdown（SIGTERM経路）の動的確認のみ未実施。Windows開発環境では外部からSIGTERM相当を配送する標準手段がなく（Node.jsのシグナル処理はWindows上ではCtrl+C由来のSIGINTのみ確実という制約）、コードレビューに留まる。productionはDocker/Linuxコンテナで稼働し`docker compose stop`/`down`は正しくSIGTERMを送るため、production動作への疑義ではないと判断
- 追加修正: 動的検証中に発見したFastify内部の`listen()`ログ（`event: "unclassified"`、bind先アドレスごとに出力）を`task_id: 20260831-005`で修正し、再起動して0件になったことを確認済み

## Log・監視

- log量/形式/保存先変更: 保存先はstdoutのまま。既定のHTTPログは1リクエスト2行から1行へ減り、バッチは1実行あたり数行増える。形式は共通ログ規約 v1 準拠JSONへ変更
- 新しいalert条件: 本タスクでは監視条件を変更しない。固定 `event` と `job_end.status` を監視に利用可能
- secret/個人情報対策: 禁止データをログ呼び出しへ渡さず、共通loggerに認証情報等を削除するredact保険を設定。server側のマスク規則は変更しない

## 未解決事項

- `external_call_failed` / `dependency_failed` は、`apps/api/src` に該当する外部HTTP呼び出し・内部API依存がないため実装していない。
- graceful shutdown のSIGTERM経路の動的確認のみ未実施（Windows開発環境の制約。上記「Health・テスト」参照）。
- `ops/runtime-contract.yaml` を作成済み（動的検証済みの内容を記録）。

## 希望時期

未定

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: 実施済み（本タスク最終応答）
- VPS管理チャットへ渡すローカルpath: `ops/server-change-notices/20260831-STOCKHOME-001-summary.md`

## Approval

- app owner:
- VPS management review:
- production approval:
- related task_id: 20260831-004, 20260831-005
