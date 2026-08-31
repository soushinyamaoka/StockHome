# Server Change Notice

notice_id: 20260831-STOCKHOME-001

app: stockhome

source_branch: main

source_commit: e98f124c6d54a0e5bf21a7f8bebefb6c7a756d17

impact_level: L1

status: ready_for_review

created_by: Codex

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 変更概要

StockHome API に共通ログ規約 v1 準拠の構造化ログを実装した。ログは引き続き stdout へ1行1JSONで出力し、`ts`、`app`、`level`、`event` を全行に付与する設計とした。定期処理には同一 `run_id` の `job_start` / `job_end` を追加し、SIGTERM / SIGINT の graceful shutdown を新設した。Prismaクライアントの内部ログ出力を、pinoを経由しない直接stdout出力からイベント購読経由の構造化ログ（`db_client_log`）へ変更した。夜間バッチは失敗時に安全な範囲（`error_name` / `error_code`）の情報を `job_end` へ含めるようにした。また、push後の自動セキュリティレビューで発見した2件を追加修正した: (1) HTTPエラーハンドラが5xx時にDBエラーの生メッセージ（例: unique制約違反時の入力値を含む文字列）をクライアントへそのまま返していた問題を、5xx時は汎用メッセージのみを返すよう修正、(2) 同じくDBエラーをログへ渡す際に`message`/`meta`を含めていた問題を、`name`/`code`のみに限定するよう修正した。

## 変更理由

VPS管理側がアプリ固有のパーサーを持たずにログを判定でき、夜間バッチの成功・失敗・未実行を区別できるようにするため。

## 2026-09-01 再review（VPS管理側）への対応

`change_notice_ledger.md`「2026-09-01 StockHome 再review」で指摘された5件への対応。

1. **production判定の誤り**: 「今回deployしない」ことと「このcodeを将来反映するのにproduction変更が不要」を混同していた。`production_change`を`none`から`required`へ訂正した（container rebuild・入れ替えが必要なため）。`deployment_status: not_started`は維持。
2. **raw error残存**: `server.ts`のnon-DB error、`candidateIntake.ts`、`bridge.ts`で raw `Error` を `err` へ渡していた箇所を、`task_id: 20260831-010` で許可リスト方式（`logger.ts`の`safeErr()`、`name`/`code`のみ）へ統一した。利用者値を含むエラーでの非混入テストをClaudeが実施済み（詳細は「Health・テスト」参照）。
3. **container起動時の非JSON出力**: `apps/api/Dockerfile`のCMDが`npx prisma migrate deploy && node dist/server.js`で、application logger起動前のPrisma CLI/npm出力が非JSONのまま残る。**本notice・今回の一連の修正では対応しない。** `ops/runtime-contract.yaml`の`logging.format`を`plain`/`schema_version: null`へ正直に訂正し、既知の未解決事項として記録した。修正する場合は別notice・別production承認が必要な変更として扱う（HomeAssetの同種事象と同じ整理）。
4. **runtime contract全体schema未整備**: `ops/runtime-contract.yaml`を`runtime_contract_and_intake_v1.md`§3のschema v1に沿って全体（runtime/network/config/data/jobs/dependencies/deploy/user_impact）へ拡張した。不明値は推測せず`null`のまま残した（`network.public.url`、`verified_against_runtime`等）。
5. **rollback・承認**: `ops/runtime-contract.yaml`の`deploy.rollback`に、production反映時の暫定ロールバック手順（deploy直前のimage ID記録→health check失敗時の手動復旧、または直前commitへ戻してnpm run deploy再実行）を明記した。本notice下部の`Approval`欄も、承認済みと誤解されないよう現状（未承認・VPS管理レビューblocked）を反映した。

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
| Prismaクライアントのログ出力 | pinoを経由しない非JSON直接stdout出力（`log:['error']`等） | イベント購読経由のpino構造化ログ（`event: db_client_log`） |
| 5xxエラーレスポンス | DBエラー等の生メッセージをそのまま返す場合があった | 5xx時は常にHTTPステータスの汎用メッセージのみ返す |
| DBエラーのログ | エラーオブジェクト全体（message/meta含む）を記録 | `name`/`code`のみを記録（message/meta/stackは渡さない） |
| プロセス終了処理 | 明示的な処理なし | SIGTERM / SIGINT graceful shutdown |

## 影響対象

- service/container: `stockhome-api-prod`
- URL/port/health: 変更なし
- cron/timer/worker: 既存夜間バッチのスケジュールは変更せず、構造化された開始・終了ログを追加
- dependency: 新規依存なし
- data/DB/volume: 変更なし
- log/monitoring: 標準出力のログ形式と監視に利用できる固定イベントを変更

## production変更

- 必要性: あり（将来この変更をproductionへ反映する際、apiコンテナのrebuild・入れ替えが必要。今回のnotice更新・commit自体はdeployを伴わない）
- 想定作業: `scripts/deploy.ps1`（`npm run deploy`）によるcontainer rebuild・入れ替え。本notice時点では未実施
- downtime: brief-restart（apiコンテナのみ再起動。postgresコンテナ・DBデータは変更しない）
- maintenance window: 未定（実施判断はVPS管理側の承認後）

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

- deploy前提: 本notice更新時点ではdeployしない。production反映はVPS管理側の個別承認（`scheduled`遷移）を経てから実施する
- deploy手順の変更: なし（既存の`scripts/deploy.ps1`／`docker compose -f docker-compose.prod.yml up -d --build api`をそのまま使う）
- rollback方法: 正式なイメージバージョン管理・ロールバック手順は現状未整備（既知の課題として`ops/runtime-contract.yaml`の`known_gaps`に記録）。暫定手順: (1) deploy直前にVPS管理側が稼働中containerのimage ID（`docker inspect --format '{{.Image}}' stockhome-api-prod`）を記録する。(2) 新イメージのhealth確認（`GET /health`が200、かつ`event: startup`の構造化ログ1行が出ること）に失敗した場合、記録したimage IDから手動で再起動するか、直前のgit commitへ戻して`npm run deploy`を再実行する。
- rollback不能条件: なし（DB schema・永続データの変更を伴わないため、DBロールバックは不要）

## Health・テスト

- health contract変更: なし
- 実施テスト: sharedビルド、APIビルド、mobile TypeScript型チェック、`apps/api/src` の `console.*` 検索、指定観点のコードレビュー（Codex）に加え、Claudeが対話セッションでローカルDBを使った動的検証を完了: `npm run db:up`→`npm run api:dev`で起動、`/health`をquery文字列付きで叩いてもrouteに漏れないことを確認、出力1行を実際に`JSON.parse`して`ts`/`app`/`level`/`event`を確認、`runDailyBatch()`を直接実行して`job_start`/`job_end`が同一`run_id`・`status: success`で対になることを確認、`docker compose stop postgres`でDBを止めた状態で以下をすべて実機確認: (1) `/api/auth/login`のレスポンスが汎用メッセージのみで生のDBエラーを含まないこと、(2) `db_client_log`が非JSONではなく`{event, target}`のみの1行JSONになっていること（`message`/`meta`なし）、(3) `job_end`に`error_name`が入り`status: failure`が欠落なく出ること、(4) `db_client_log`の`level`キー重複が解消されていること、(5) `safeErr()`に利用者値（メールアドレス・パスワード・token文字列を含むError/非Errorの3パターン）を渡し、戻り値が`name`/`code`以外を一切含まないことを直接検証、(6) DB停止状態で実際に`victim@example.com`宛のログインを試行し、`request_failed`ログの`err`に`{"name":"PrismaClientInitializationError"}`のみが記録され、メールアドレスが一切含まれないことを確認
- 結果: 全ビルド成功、`console.*` 0件、静的コードレビュー適合、上記動的検証すべて成功
- 未実施テストと理由: graceful shutdown（SIGTERM経路）の動的確認のみ未実施。Windows開発環境では外部からSIGTERM相当を配送する標準手段がなく（Node.jsのシグナル処理はWindows上ではCtrl+C由来のSIGINTのみ確実という制約）、コードレビューに留まる。productionはDocker/Linuxコンテナで稼働し`docker compose stop`/`down`は正しくSIGTERMを送るため、production動作への疑義ではないと判断
- 追加修正の履歴: `unclassified`ログ（`task_id: 20260831-005`）、5xxメッセージ・DBエラーログの秘匿化（`task_id: 20260831-006`）、Prisma非JSON出力・バッチ失敗診断情報（`task_id: 20260831-008`）、`db_client_log`のlevelキー重複（`task_id: 20260831-009`）、raw error残存への許可リスト方式適用（`task_id: 20260831-010`）を、いずれも実機確認のうえ解消済み

## Log・監視

- log量/形式/保存先変更: 保存先はstdoutのまま。既定のHTTPログは1リクエスト2行から1行へ減り、バッチは1実行あたり数行増える。形式は共通ログ規約 v1 準拠JSONへ変更。Prismaクライアントが直接出力していた非JSON行を廃止し、全てpino経由の1行1JSONへ統一した
- 新しいalert条件: 本タスクでは監視条件を変更しない。固定 `event` と `job_end.status` を監視に利用可能
- secret/個人情報対策: 禁止データをログ呼び出しへ渡さず、共通loggerに認証情報等を削除するredact保険を設定。server側のマスク規則は変更しない

## 未解決事項

- `external_call_failed` / `dependency_failed` は、`apps/api/src` に該当する外部HTTP呼び出し・内部API依存がないため実装していない。
- graceful shutdown のSIGTERM経路の動的確認のみ未実施（Windows開発環境の制約。上記「Health・テスト」参照）。
- コンテナ起動時のPrisma CLI（`prisma migrate deploy`）・npm自体の非JSON出力が残っている。`ops/runtime-contract.yaml`の`logging.format: plain`／`schema_version: null`で正直に記録済み。修正は別notice・別production承認が必要な変更として扱う。
- 正式なイメージバージョン管理・ロールバック手順が未整備。暫定手順は「Deploy・rollback」に記載済みだが、正式な仕組み（タグ付きイメージ保持等）は別途整備が必要。
- `network.public.url`・`network.health.public`はVPS側（Nginx等）の正本を未確認のため`ops/runtime-contract.yaml`で`null`のまま。
- `verified_against_runtime`は`null`。本notice・runtime-contractの内容はリポジトリ内の正本とローカルDocker環境の検証に基づき、production実機との照合はしていない（VPS管理側の別作業を要する）。

## 希望時期

未定

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: 実施済み（本タスク最終応答）
- VPS管理チャットへ渡すローカルpath: `ops/server-change-notices/20260831-STOCKHOME-001-summary.md`

## Approval

- app owner: 未承認（ユーザー本人の確認待ち）
- VPS management review: blocked（2026-09-01 再review。詳細は`change_notice_ledger.md`「2026-09-01 StockHome 再review」）
- production approval: 未承認
- related task_id: 20260831-004, 20260831-005, 20260831-006, 20260831-008, 20260831-009, 20260831-010（20260831-002/003/007はblockedで未実装のため含まない）
