# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20261022-STOCKHOME-024

app: stockhome

source_branch: main

source_commit: f6148459f4caa7abc92daa7251c8396bf34c155e

production_baseline_commit: e98200ed33260d9a2888f341bf1c70746c7bd59b

release_commits: e98200ed33260d9a2888f341bf1c70746c7bd59b..f6148459f4caa7abc92daa7251c8396bf34c155e

impact_level: L2

status: ready_for_review

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 変更概要

API image のNode.jsを 20 から **24.22.1** へ更新する（Node.js 20 のEOL対応）。

- `apps/api/Dockerfile`: builder・runtime 両ステージの `FROM node:20-bookworm-slim` を `FROM node:24.22.1-bookworm-slim` に変更（2行のみ）
- `ops/runtime-contract.yaml`: `language_runtime` を同じ値に更新
- `.github/workflows/ci.yml`: CIの2ジョブを `node-version: '24.22.1'` に揃える（artifact外）
- アプリコード・依存package（`package.json`・`package-lock.json`）・Prisma schema・migration・env・compose の変更なし

## 変更理由

Node.js 20 がEOLとなり、セキュリティ修正が提供されなくなるため。VPS管理側の指示（notice 023 review時の補足、2026-10-22）により、
消費休止機能とは別noticeとして扱う。

## server_impact判定

server_impact: approval_required

判定理由: 本番APIコンテナのbase image（言語runtimeのメジャーバージョンとnpm 10→11）を変えるため、image再build・再起動が必要。

impact_level の判断: L2 とした。永続データの値・意味・計算は変えず、migration・secret/auth・network/公開面・runtime user/権限・backup/restore の変更も無い
（L3候補の各項目を確認済み）。ただし言語runtimeのメジャー更新のため full template を使用した。VPS管理側でL3が妥当と判断される場合はそれに従う。

## 現在と変更後

| 項目 | 現在（`e98200e`） | 変更後（`f614845`） |
|---|---|---|
| base image | `node:20-bookworm-slim`（検証時 Node v20.20.2） | `node:24.22.1-bookworm-slim`（Node v24.22.1、npm 11.19.1） |
| OS | Debian 12 bookworm | 同じ（Debian 12 bookworm） |
| OS package | `openssl` | 同じ |
| Prisma | 5.22.0、query engine `debian-openssl-3.0.x` | 同じ（engineの種類も同じ） |
| image size（ローカルbuild） | 415MB | 496MB（+81MB） |
| 起動command・WORKDIR・EXPOSE・user | `node dist/entrypoint.js`・`/app/apps/api`・4002・root | 変更なし |

検証時のbase image digest（参考。Dockerfileはtag指定のまま）: `node@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205`（2026-10-21作成）

## 影響対象

- service/container: `stockhome-api-prod`（image再build・再作成）。`stockhome-postgres-prod` は変更なし
- URL/port/health: 変更なし（`127.0.0.1:4002` bind、`/health` 不変）
- cron/timer/worker: 変更なし（API内の夜間バッチは同じコードのまま）
- dependency: package・lockfileの変更なし。build時の `npm ci` を実行するnpmが 10 → 11.19.1 になる（lockfile v3 のまま、build成功を確認）
- data/DB/volume: 変更なし
- log/monitoring: 形式・event変更なし

## production変更

- 必要性: あり
- 想定作業: 通常のAPI deploy（`npm run deploy -- -Commit f6148459f4caa7abc92daa7251c8396bf34c155e`）。base image `node:24.22.1-bookworm-slim` のpullが発生する
- 適用されるmigration: なし（`prisma migrate deploy` は起動時に走るが、未適用migrationは無い）
- downtime: 既存と同じ（brief-restart）
- maintenance window: 不要

## 利用者への影響

- user_maintenance_impact: possible
- 対象利用者・機能: 単一世帯。反映時はAPIコンテナの短い再起動（brief-restart）があり、その間はアプリの読み込み・保存が一時的に失敗する可能性がある（再試行で回復）。
  反映後の機能・画面・通知の変化はない
- 通知方法: 不要

## env・secret contract

- 変更: なし
- provisioning/rotation: 不要

secret値は記載していない。検証では使い捨ての値のみを使用した。

## Data・migration・backup

- schema/format変更: なし
- migration: なし
- データ書き込み: なし
- backup対象: 変更なし
- backward compatibility: APIのレスポンス・挙動は不変。mobile・GAS側の変更不要

## Deploy・rollback

- deploy前提: なし
- deploy手順の変更: なし
- rollback方法: `npm run deploy -- -RollbackTo e98200ed33260d9a2888f341bf1c70746c7bd59b`（image rollback。Node 20 imageへ戻る）
- image rollbackとdata rollbackの区別: data変更が無いため、image rollbackのみで完全に戻る。data rollbackは不要
- rollback不能条件: なし

## Health・テスト

- health contract変更: なし
- 実施テスト（Claude、2026-10-22、アプリ側PCのDocker。本番への接続なし）:
  - **Docker build**（`f614845` を `git archive` で取り出したbuild context）:
    - `docker build --target builder -f apps/api/Dockerfile`: 成功
    - `docker build -f apps/api/Dockerfile`（runtimeまで）: 成功
    - 警告: `npm warn deprecated uuid@8.3.2`（既存の間接依存。Node 20 baselineでも同じ）のみ
  - **Prisma Client生成**: builderステージで `✔ Generated Prisma Client (v5.22.0)`。runtime imageに `libquery_engine-debian-openssl-3.0.x.so.node` が入っていることを確認
  - **既存テスト**: builder image（Node v24.22.1）内で、CIと同じ条件（`TZ=Asia/Tokyo`、使い捨てのPostgreSQL 16コンテナ、
    `prisma migrate deploy` 後に `npm test --workspace=@stockhome/api`）で **209件すべて成功**（fail 0、cancelled 0）。
    （notice 023 で記録したReadyGo関連5件の失敗は、空のDBでは発生しなかった。開発DBの残留データ由来であることの裏付け）
  - **コンテナ起動・DB接続**: runtime image を使い捨ての空DBに接続して起動
    - entrypoint の `migration_start` → `migration_end status=success`（15 migrations）→ `startup`
    - `GET /health` 200、`GET /api/items`（認証なし）401、`POST /api/auth/login`（存在しないユーザー）401、
      `GET /api/bridge/readygo-pending`（bridge token付き）200（DBへの問い合わせを伴う経路）
    - コンテナ内 `node -v` = v24.22.1
  - **比較（baseline）**: 現行本番と同じ `e98200e` を Node 20 でbuild・起動し、起動時のFastify警告
    `FSTDEP023`（`disableRequestLogging` の非推奨）が **Node 20でも同じく1行出る**ことを確認（Node 24由来ではない既存の警告）
  - 検証用のコンテナ・ネットワーク・image・DBはすべて削除済み。既存の開発DB（`stockhome-postgres`）には接続していない
- 未実施テストと理由:
  - production相当データでの起動（本番接続は行わない方針のため）。反映後にVPS管理側のhealth確認とアプリ側のread-only確認で補う
  - 夜間バッチ（19:55）の実時刻実行は未確認（コード不変。バッチ処理自体は既存テストに含まれる）

## Log・監視

- log量/形式/保存先変更: なし
- 新しいalert条件: なし
- 既存の起動時警告 `FSTDEP023`（Fastify）は変わらず1行出る（本変更とは無関係）

## 提出前セルフチェック

正本: `C:\work\PRG\Sakura\Dev\vps-server-management\docs\templates\server_change_notice_pre_submission_checklist.md`

- [x] production baselineとrelease全commit・build入力差分を確認した（`e98200e..f614845` のbuild入力差分は `apps/api/Dockerfile` の2行のみ。他はnotice・client release記録・runtime-contract・CIで、artifact外）
- [x] source commitとnoticeをremoteの対象branchへpushした（引き継ぎ時に source `f614845` と通知書の最新commitがremoteと一致することを伝える）
- [x] Dockerfile、Compose、runtime user、OS package、起動commandの差分を確認した（変更はFROMの2行のみ）
- [x] lockfileと全workspace manifestを含む実際のbuild contextでbuildした
- [x] port、bind、domain、health、認証不要endpointの差分なし
- [x] data変更なしのため、image rollbackのみで戻せることを確認した
- [x] app owner、VPS review、production承認を分離した。client配信は不要
- [x] `deployment_status: not_started` であることを確認した
- [x] secret非混入とtracked working tree cleanを確認した（未追跡は `ops/production-db-operations/` のみで、git管理外・artifact対象外）

未確認・該当なしの理由:
- data/transaction/job: 変更なし
- client配信: 不要（API側のみ）
- `docs/runtime-state/production_deployments.yaml` のstockhome行は `85c5f8f`（2026-09-21）のままだった。
  baselineはVPS管理側の反映報告（2026-10-22、notice 023、`e98200e`）とアプリ側のread-only確認（稼働image `stockhome-api:git-e98200e…`）に基づく
- `tools/review_notice_preflight.ps1`: 未実行（アプリ側PCにPowerShell 7が無いため）。VPS管理側での実行をお願いしたい

## 未解決事項

なし

## 希望時期

特に指定なし（Node.js 20 EOLのため、なるべく早めが望ましい）。

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- VPS管理チャットへ渡すローカル絶対path:
  `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20261022-STOCKHOME-024-summary.md`

## Approval

- app owner: 2026-10-22、このチャットで内容確認のうえVPS管理へ引き継ぐことを承認
- VPS management review: 2026-10-22、L2として技術レビュー受理（sourceと実remote mainの一致、Dockerfileの変更範囲、rollback方針を確認済み。review対象: source `f614845`・通知書 `955ebc7`）
- production approval: 未（別承認）
- related task_id: なし（依存・runtime更新のためClaudeが直接実施）
