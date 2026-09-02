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

deployment_status: verified

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
- 実施結果: 2026-09-02 14:22 JST、VPS管理側が承認済みtask `20260902-003`としてAPI container imageを更新
- downtime: API container入れ替え時に短時間再起動。health待機中の一時的な空応答後、internal/publicとも200へ復帰
- maintenance window: 妻への通知・不使用確認後に実施

新API image `sha256:080d206c1405f5f4837f817137bcf66584967003013049610f5e669228d92598`を反映し、API/DB稼働、health、bridge、bind、DB image/volume不変、起動ログを確認した。productionの進行状態はVPS管理側受理台帳を正本とする。

## 利用者への影響

- user_maintenance_impact: possible
- 対象利用者・機能: 家庭内利用者が使用するStockHome mobileのAPI機能。APIルート、
  レスポンス形状、認証方式、DB契約は変更しないが、将来の反映時はcontainer入れ替え中の
  短時間にAPI requestが失敗する可能性がある
- 通知方法: 事前通知が必要かは、実施時刻と想定停止時間を含むproduction計画をVPS管理側で
  作成する際に判断する。2026-09-02は妻への事前通知・不使用確認後に実施し、反映後の利用者影響は確認されていない

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

- deploy前提: VPS管理側review、妻への通知・不使用確認、task `20260902-003`の個別承認後に実施済み
- deploy手順の変更: なし（既存の`scripts/deploy.ps1`／`docker compose -f docker-compose.prod.yml up -d --build api`をそのまま使う）。APIコンテナ内部のCMDのみ変更
- rollback方法: 旧sourceを`/home/deploy/stockhome/backups/deploy-20260902-003/source-before.tgz`、旧API imageを`stockhome-api:rollback-20260902-003`として保全。旧imageを`stockhome-api:latest`へ戻し、同じComposeと既存`.env`でAPIだけを再作成する手順を確定済み
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
- production検証: API/DB running、internal/public health 200、未認証bridge 401、bind `127.0.0.1:4002`、restart count 0、DB image/volume不変を確認
- 起動ログ検証: 7行すべてJSON、必須field欠落0、`migration_start` 1件、成功した`migration_end` 1件、`startup` 1件、critical/failure/禁止pattern 0件

## Production実施結果

- production task: `20260902-003`
- 実施開始: 2026-09-02 14:22:46 JST
- source: `7d18a32fcdcc60379d861225a11911d08c95da39`
- artifact SHA-256: `4e1af019aca536b74a769fcc8ce1a8a9b2755a8f4e748f6cbd14b136458408cc`（local/VPS一致）
- 旧source backup SHA-256: `738b3019e4512be7691f05ac8c551fc8fb7421fb3b2a586c71571f95ab5faa18`
- 旧API image: `sha256:2398c455102232bff61c5d85724eb4d1d6a7684797120b9ecf0a58dd381e7bc0`
- 新API image: `sha256:080d206c1405f5f4837f817137bcf66584967003013049610f5e669228d92598`
- rollback: 条件に該当せず未実施。rollback source/imageは保全済み
- data: DB containerを停止・再作成せず、schema/migration/data/volume変更なし。計画どおりDB dumpなし
- cleanup: local/remote転送artifact、一時検証script、deploy lockを削除済み

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

2026-09-02に反映・検証済み。

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: 実施済み（本タスク最終応答）
- VPS管理チャットへ渡すローカル絶対path:
  `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260902-STOCKHOME-003-summary.md`

## Approval

- app owner: 2026-09-02、ユーザー本人が実装・通知内容を承認
- VPS management review: 2026-09-02受理・production検証完了
- production approval: 2026-09-02、妻への通知・不使用確認後、ユーザーがtask `20260902-003`をVPS管理側のproduction反映計画で今すぐ実施することを最終確認
- related task_id: 20260902-001
