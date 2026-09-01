# Server Change Notice

notice_id: 20260901-STOCKHOME-002

app: stockhome

source_branch: main

source_commit: 48e271634ecf4c52b07725fd349077965e2f1545

impact_level: L1

status: ready_for_review

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 変更概要

`OPS-P1-08`（StockHome dependency audit）のVPS管理側review完了を受け、
`operations_gap_analysis.md`「OPS-P1-08 StockHome dependency audit対応方針（2026-09-01）」の
Phase Aを実施した。`--force`を使わず、`npm audit`で検出された6件のうち解消可能な3系統
（`esbuild`、`fast-uri`、`find-my-way`）だけを`package-lock.json`内で更新した。
アプリケーションコード（`apps/api/src`配下）、各`package.json`の依存宣言範囲、
`apps/api/Dockerfile`は一切変更していない。

## 変更理由

`apps/api` + `packages/shared`スコープの`npm audit`で6件（low1/moderate2/high3）を検出し、
2026-09-01の調査（`ops/investigations/OPS-P1-08-npm-audit-findings.md`）で
到達可能性・安全な更新候補を報告済み。VPS管理側のreview結果
（`operations_gap_analysis.md`「OPS-P1-08 StockHome dependency audit対応方針」）に基づき、
非破壊的な3系統だけを解消するPhase Aを実施する。

## server_impact判定

server_impact: notify

判定理由: port・起動設定・env・DB・API契約・ログ形式・利用者動作はいずれも不変。
一方、`package-lock.json`の更新は将来のDocker build時にruntime imageへ入る依存の内容を
変えるため、VPS管理側への通知対象と判断した。

## 現在と変更後

| 項目 | 現在 | 変更後 |
|---|---|---|
| `esbuild`（devDependency `tsx`経由） | 0.28.0 | 0.28.2 |
| `@esbuild/*`（optional platform packages、26件） | 0.28.0 | 0.28.2 |
| `fast-uri`（`fastify`内部の`ajv-compiler`/`fast-json-stringify`経由） | 3.1.2 | 3.1.6 |
| `find-my-way`（`fastify`本体のルーター） | 9.6.0 | 9.9.0 |
| `node-cron` / `uuid` / `xlsx` / `fastify`本体 | 変更なし | 変更なし（Phase Aの対象外） |
| 各`package.json`の依存宣言範囲 | 変更なし | 変更なし（lock内の解決バージョンのみ更新） |

## 影響対象

- service/container: `stockhome-api-prod`（次回のDocker build/deployで反映）
- URL/port/health: 変更なし
- cron/timer/worker: 変更なし
- dependency: `package-lock.json`内の3系統（上表）のみ。追加・削除は無し
- data/DB/volume: 変更なし
- log/monitoring: 変更なし

## production変更

- 必要性: あり（次回のDocker build・container入れ替えでlock更新が反映される）
- 想定作業: `scripts/deploy.ps1`（`npm run deploy`）によるcontainer rebuild・入れ替え。
  本notice作成時点では未実施
- downtime: brief-restart（apiコンテナのみ再起動。postgresコンテナ・DBデータは変更しない）
- maintenance window: 未定（VPS管理側の承認後に確定）

`production_change: required`のため、`deployment_status: not_started`のまま
VPS管理側へ引き継ぐ。

## 利用者への影響

- user_maintenance_impact: possible
- 対象利用者・機能: 家庭内利用者が使用するStockHome mobileのAPI機能。APIルート、
  レスポンス形状、認証方式、ログ出力は変更しないが、将来の反映時はcontainer入れ替え中の
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
- migration: なし
- backup対象: 変更なし
- restore確認: 対象外
- backward compatibility: API・DB契約に変更なし

## Deploy・rollback

- deploy前提: 本notice作成時点ではdeployしない。production反映はVPS管理側の個別承認を
  経てから実施する
- deploy手順の変更: なし（既存の`scripts/deploy.ps1`／`docker compose -f docker-compose.prod.yml up -d --build api`をそのまま使う）
- rollback方法: 本変更はDB schema・永続データを変更しないため、通常のcontainer rebuild
  ロールバック手順（直近のnotice `20260831-STOCKHOME-001` のDeploy・rollback節、および
  `stockhome_deployment_plan_20260901.md`の実行記録を参照）がそのまま適用できる。
  実際の反映時にVPS管理側が同様の手順（source archive退避、旧image tag記録）を用いる想定
- rollback不能条件: なし（DB schema・永続データの変更を伴わないため、DBロールバックは不要）

## Health・テスト

- health contract変更: なし
- 実施テスト: `npm ci`によるlock file復元（差分なしを確認）、
  `npm audit fix --workspace=@stockhome/api --workspace=@stockhome/shared`（`--force`なし）の
  適用、`git diff -- package-lock.json`による差分確認（esbuild/fast-uri/find-my-way関連のみ、
  node-cron/uuid/xlsx/fastify本体・各package.jsonの宣言範囲は不変を確認）、
  `npm audit --workspace=@stockhome/api --workspace=@stockhome/shared`の再実行（Codex）に加え、
  Claudeが対話セッションで以下を実機確認: sharedビルド・APIビルド・mobile TypeScript確認、
  `npm run db:up`→`npm run api:dev`で起動、`/health`が200、出力1行を実際に`JSON.parse`して
  `ts`/`app`/`level`/`event`を確認、`runDailyBatch()`を直接実行して`job_start`/`job_end`が
  同一`run_id`・`status: success`で対になることを確認、`docker compose stop postgres`で
  DBを止めた状態で再実行し`job_end`が`status: failure`で欠落なく出ることを確認
- 結果: 全ビルド成功、`npm audit`残存が期待値（`low:0, moderate:2, high:1, critical:0, total:3`
  = node-cron/uuid/xlsxのみ）と一致、上記動的検証すべて成功
- 未実施テストと理由: 本変更はDocker build/deployを伴わないため、実際のcontainer上での
  動作確認は次回のproduction反映時にVPS管理側が実施する

## Log・監視

- log量/形式/保存先変更: なし。ログ出力コード自体は本変更で一切変更していない
- 新しいalert条件: なし
- secret/個人情報対策: 変更なし

## 未解決事項

- `node-cron` / `uuid`（moderate、2件）: `node-cron@4.6.0`へのmajor updateが必要。
  API差分の確認を伴う別作業として、`operations_gap_analysis.md`のOPS-P1-08「残存判断」に
  従い個別に方針を決定する。
- `xlsx`（high、2件）: upstreamに修正版が存在しない（`fixAvailable: false`）。
  devDependency専用で`apps/api/scripts/migrate-from-xlsx.ts`（手動実行の移行スクリプト）
  からのみ参照され、`dist/server.js`からは到達しない。期限付きリスク受容・代替library化・
  production imageからのdevDependencies除外（runtime hardening）のいずれかを別途判断する。
- `ops/investigations/OPS-P1-08-npm-audit-findings.md`はOPS-P1-08完了までは削除しない
  （ユーザー指示）。

## 希望時期

未定

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: 実施済み（本タスク最終応答）
- VPS管理チャットへ渡すローカル絶対path:
  `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260901-STOCKHOME-002-summary.md`

## Approval

- app owner: 未承認（ユーザー本人の確認待ち）
- VPS management review: 未実施
- production approval: 未承認
- related task_id: 20260901-002
