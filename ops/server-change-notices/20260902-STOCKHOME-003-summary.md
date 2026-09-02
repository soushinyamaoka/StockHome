# Server Change Notice

notice_id: 20260902-STOCKHOME-003

app: stockhome

source_branch: main

source_commit: 19ff1af

impact_level: L2

status: ready_for_review

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 変更概要

StockHome APIのcontainer起動時（`apps/api/Dockerfile`のCMD）に、application logger起動前の
Prisma CLI（`prisma migrate deploy`）・npm由来の非JSON出力が混在していた問題
（`ops/runtime-contract.yaml`の`logging.format: plain`/`schema_version: null`として
記録済みの既知の未解決事項）を解消した。HomeAssetの同種対応
（`apps/api/src/entrypoint.ts`、`ops/server-change-notices/20260902-HOMEASSET-002-summary.md`、
別プロジェクト・読み取り専用参照）と同じ設計パターンを採用し、Node entrypointが
Prisma migrationを子processとして実行して構造化ログへ変換し、成功時のみAPIサーバを
子processとして起動する。**`apps/api/src/server.ts`は1バイトも変更していない。**

## 変更理由

container全体のstdout/stderrを1行1JSONへ統一し、監視側がアプリ固有の非JSON行を
特別扱いせずに済むようにするため。

## server_impact判定

server_impact: notify

判定理由: container起動command（Dockerfile CMD）、起動時のmigration実行process、
migration失敗時の終了経路、SIGTERM/SIGINT転送経路、stdout/stderrのログ形式が変わるため。
port・bind・URL・health・DB schema・API contract・env変数名は不変。

## 現在と変更後

| 項目 | 現在 | 変更後 |
|---|---|---|
| APIコンテナ起動command | `sh -c "npx prisma migrate deploy ... && node dist/server.js"` | `node dist/entrypoint.js`（`apps/api/src/entrypoint.ts`） |
| migrationログ | Prisma CLI・npmのプレーンテキストが混在 | `migration_start` / `migration_end`の1行JSONのみ（失敗時は`prisma_error_code`のみ、生出力は渡さない） |
| migration失敗時 | shellの`&&`により`server.js`を起動せず非0終了 | 同じ挙動を維持（entrypointが明示的に`process.exit(migrationExitCode)`） |
| シグナル処理 | shell(PID 1)からserverプロセスへの転送保証が不明瞭 | entrypointがSIGTERM/SIGINTを`server.js`の子processへ明示的に転送 |
| `server.ts`本体 | 変更対象外 | 無変更（`git diff`で確認済み） |
| ログ出力先 | stdout/stderr | stdout/stderr（変更なし） |
| container全体のlogging準拠 | `format: plain` / `schema_version: null` | `format: structured` / `schema_version: 1` |

## 影響対象

- service/container: `stockhome-api-prod`（次回のDocker build/deployで反映）
- URL/port/health: 変更なし
- cron/timer/worker: 変更なし（`server.ts`無変更のため夜間バッチの挙動も不変）
- dependency: 変更なし（既存の`prisma`パッケージをentrypointから直接呼び出すだけ）
- data/DB/volume: schema・migration file・volume・persistent dataの変更なし。既存のmigration適用処理を維持
- log/monitoring: `migration_start` / `migration_end`を追加し、container全体の出力を1行JSONへ統一

## production変更

- 必要性: あり（次回のDocker build・container入れ替えでentrypoint変更が反映される）
- 想定作業: `scripts/deploy.ps1`（`npm run deploy`）によるcontainer rebuild・入れ替え。
  本notice作成時点では未実施
- downtime: brief-restart（apiコンテナのみ再起動。postgresコンテナ・DBデータは変更しない）
- maintenance window: 未定（VPS管理側の承認後に確定）

`production_change: required`のため、`deployment_status: not_started`のまま
VPS管理側へ引き継ぐ。

## 利用者への影響

- user_maintenance_impact: possible
- 対象利用者・機能: 家庭内利用者が使用するStockHome mobileのAPI機能。APIルート、
  レスポンス形状、認証方式、DB契約は変更しないが、将来の反映時はcontainer入れ替え中の
  短時間にAPI requestが失敗する可能性がある
- 通知方法: 事前通知が必要かは、実施時刻と想定停止時間を含むproduction計画をVPS管理側で
  作成する際に判断する

## env・secret contract

- 変更: なし
- 変数名・secret種類のみ: 追加・削除・意味変更なし
- provisioning/rotation: 不要

secret値は記載しない。

## Data・migration・backup

- schema/format変更: なし
- migration: 新規migrationなし。コンテナ起動時の既存`prisma migrate deploy`実行内容は維持（呼び出し方法のみ変更）
- backup対象: 変更なし
- restore確認: 対象外
- backward compatibility: API・DB契約に変更なし

## Deploy・rollback

- deploy前提: 本notice作成時点ではdeployしない。production反映はVPS管理側の個別承認を
  経てから実施する
- deploy手順の変更: なし（既存の`scripts/deploy.ps1`／`docker compose -f docker-compose.prod.yml up -d --build api`をそのまま使う）。APIコンテナ内部のCMDのみ変更
- rollback方法: 本変更はDB schema・永続データを変更しないため、既存notice
  （`20260831-STOCKHOME-001`、`20260901-STOCKHOME-002`）のDeploy・rollback節、および
  過去のproduction反映実行記録（`stockhome_deployment_plan_20260901.md`、
  `stockhome_dependency_phase_a_deployment_plan_20260901.md`）と同様の手順
  （source archive退避、旧API image tag記録）が適用できる
- rollback不能条件: なし（DB schema・永続データの変更を伴わないため、DBロールバックは不要）

## Health・テスト

- health contract変更: なし
- 実施テスト: `npm run build --workspace=@stockhome/shared`、
  `npm run build --workspace=@stockhome/api`（`dist/entrypoint.js`生成確認）、
  `npx tsc --noEmit -p apps/mobile/tsconfig.json`、`apps/api/src`の`console.*`検索、
  `git diff -- apps/api/src/server.ts`が空であることの確認（Codex）に加え、
  Claudeが対話セッションで**実際にDockerイメージをlocal buildし**、以下を実機確認:
  (1) 成功系: 既存devDB（migration適用済み）に接続してcontainer起動、
  `migration_start`→`migration_end`（`status: success`, `migrations_found: 3`）→`startup`→
  `http_request`の全5行がJSON.parse成功、query文字列（`?token=...`）を付けても`route`に
  漏れないこと、(2) 失敗系: 到達不能なDB（誤ったhost/password）を指定してcontainer起動、
  `migration_start`→`migration_end`（`status: failure`, `exit_code: 1`,
  `prisma_error_code: "P1001"`）のみが出力され、`startup`イベントが一切出ない
  （serverが起動していない）こと、containerの終了コードが非0であること、
  パスワード・ホスト名・接続文字列が出力に一切含まれないこと（grep確認）、
  (3) signal転送: 正常起動中のcontainerへ`docker stop`（実際のLinux SIGTERM）を送り、
  `shutdown`イベントが出力されたうえで終了コード0・0.5秒程度（10秒のSIGKILL猶予に
  達する前）で正常終了すること
- 結果: 全ビルド成功、`console.*` 0件、`server.ts`差分なし、上記Docker動的検証
  （成功系・失敗系・signal転送）すべて成功
- 未実施テストと理由: production containerでの実機確認は次回のproduction反映時に
  VPS管理側が実施する

## Log・監視

- log量/形式/保存先変更: 保存先はstdout/stderrのまま。`migration_start`/`migration_end`の
  2行が起動の都度追加される（1回のみ、リクエスト毎ではない）。container起動シーケンス
  全体が1行1JSONへ統一され、`ops/runtime-contract.yaml`の`logging.format`を`plain`から
  `structured`、`schema_version`を`null`から`1`へ更新した
- 新規event: `migration_start`、`migration_end`
- 新しいalert条件: `migration_end`かつ`status: failure`を監視候補とする
  （既存の`job_end`かつ`status: failure`と同様の扱い）
- secret/個人情報対策: migration失敗時は`prisma_error_code`（例: `P1001`）のみを記録し、
  Prisma CLIの生stdout/stderr・DB接続情報・secret値は一切記録しない。ローカルDocker環境で
  実際に到達不能なDBを指定し、パスワード・ホスト名が出力に含まれないことを確認済み

## 未解決事項

- `migration_end`かつ`status: failure`の自動監視追加は、VPS管理側の段階3 collector作業で
  継続する（HomeAsset同種対応と同じ扱い）。
- `node-cron` / `uuid`（moderate）、`xlsx`（high）の残存dependency auditは、
  `OPS-P1-08`の別途判断事項のまま（本変更の対象外）。
- graceful shutdownのSIGTERM経路は、今回**ローカルDockerイメージのbuild・
  `docker stop`による実機確認で解消済み**（従来の`ops/runtime-contract.yaml`
  known_gapsに記載していたWindows開発環境の制約は、この検証方法により解消した）。

## 希望時期

未定

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: 実施済み（本タスク最終応答）
- VPS管理チャットへ渡すローカル絶対path:
  `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260902-STOCKHOME-003-summary.md`

## Approval

- app owner: 2026-09-02、ユーザー本人が実装・通知内容を承認
- VPS management review: 2026-09-02実施、blocked（VPS管理側の軽微文書修正commit/push待ち）
- production approval: 2026-09-02、妻への通知・不使用確認後、ユーザーがtask `20260902-003`をVPS管理側のproduction反映計画で今すぐ実施することを最終確認。軽微文書修正のcommit/push完了まで実行待ち
- related task_id: 20260902-001
