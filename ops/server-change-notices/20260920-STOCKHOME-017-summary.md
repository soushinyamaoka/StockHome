# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20260920-STOCKHOME-017

app: stockhome

source_branch: main

source_commit: faf8d7baf2a8ed5556c7e4b2e38e8192d835ef36

production_baseline_commit: ec6e541b8bf88654baa68c3dd3b1c2fcbdb9d6ad

release_commits:（baseline以降。notice 016以降の分のみ再掲。それ以前の全commit列は
notice 010〜016の提出内容を参照）

- `ec6e541`（baseline。notice `20260918-STOCKHOME-009`でproduction反映・`verified`済み）
- （中略。notice 010〜015までの全commitは各noticeのrelease_commits参照）
- `e36e827`（notice `20260920-STOCKHOME-016`のsource。所見A-10・C-6対応。**本noticeの対象外**）
- `5851a8d`（notice 016の新規作成、CLAUDE.md記載。`ops/**`＋`CLAUDE.md`のみ）
- `58c1259`（**本notice対象**。fastify 5.8.5→5.12.5、`npm audit fix`非破壊的。Claude直接）
- `5e373ad`（**本notice対象**。`prisma`をdevDependenciesからdependenciesへ再分類。Claude直接）
- `faf8d7b`（**本notice対象・最終source**。所見C-8: `apps/api/Dockerfile`のruntime image
  slim化。所見A-9: mobile平文HTTPのdev限定化。task `20260920-013`）

**本noticeが対象とするのは所見C-8（npm audit残件・runtime image構成）・A-9
（mobile平文HTTP許可の範囲）への対応。notice 010〜016はいずれも別変更のため
分離したままとする。production反映時はVPS管理側の方針により、notice 010〜016と
本noticeを1つの計画へまとめる想定。**

impact_level: L2

status: ready_for_review

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 変更概要

2026-09-03の全体点検所見のうち2件への対応。

- **C-8**（優先度「低」）: `ops/investigations/OPS-P1-08-npm-audit-findings.md`
  （2026-09-01調査）で指摘されていた残件のうち解消可能な2点に対応した。
  (1) `fastify`を5.8.5→5.12.5へ更新（`npm audit fix`、非破壊的）。
  (2) `apps/api/Dockerfile`のruntimeステージを本番専用の別installへ変更し、
  `xlsx`（移行スクリプト専用、upstream修正無しのhigh脆弱性×2）・`typescript`・
  `tsx`等のdevDependenciesをruntime imageから除外した。
- **A-9**（優先度「中」）: mobile側の`NSAllowsArbitraryLoads`（iOS）・
  `usesCleartextTraffic`（Android）がビルド種別に関係なく有効だった。
  ユーザーとの相談の結果、**バンドルIDの変更は行わず**、平文HTTP許可を
  開発ビルド限定に絞った。

## 変更理由

2026-09-03の全体点検所見への対応（優先度「低」1件・「中」1件）。詳細は
`stockhome-review-findings-20260903.md`（点検報告書）を参照。

## server_impact判定

server_impact: notify

判定理由: production runtimeイメージの構成（依存パッケージ範囲）が変わる。
`fastify`のマイナーバージョン更新、`prisma`パッケージの依存分類変更を伴う。
port/bind/domain/health endpoint/起動command/env名/DB schema/migration/volume/
cron/既存API contract（エンドポイントの追加削除）は変更していない。

## 現在と変更後

| 項目 | 現在 | 変更後 |
|---|---|---|
| `fastify`バージョン | 5.8.5（lockfile解決済み） | 5.12.5（`npm audit fix`、moderate脆弱性2件を解消） |
| runtime imageのnode_modules | devDependencies込み（163MB、`xlsx`・`typescript`・`tsx`含む） | 本番専用install（53MB、devDependencies除外） |
| `prisma`パッケージの分類 | devDependencies（誤り。`entrypoint.ts`が起動時migrationで実際に使用） | dependencies（実態に合わせて修正） |
| iOS平文HTTP許可 | 常時有効（`NSAllowsArbitraryLoads: true`） | 開発ビルドのみ有効。本番ビルドは`infoPlist`未設定（既定のATS有効＝HTTPS限定） |
| Android平文HTTP許可 | 常時有効（`usesCleartextTraffic: true`） | 開発ビルドのみ有効。本番ビルドは既定（HTTPS限定） |

## 影響対象

- service/container: `stockhome-api-prod`（`apps/api/Dockerfile`のruntimeステージ
  構成変更。`fastify`・`prisma`の依存分類変更。route追加・削除は無し）
- URL/port/health: 変更なし
- cron/timer/worker: 変更なし
- dependency: `fastify` 5.8.5→5.12.5（`package.json`の宣言`^5.8.5`の範囲内、
  package-lock.jsonのみ変更）。`prisma`をdevDependencies→dependenciesへ移動
- data/DB/volume: 変更なし
- log/monitoring: 変更なし（新規ログイベントの追加は無い）
- client: mobile側`app.config.js`の変更。**次回EAS buildから反映**（既存の
  配布済みclientには影響しない。挙動が変わるのは本番ビルドの平文HTTP許可が
  外れる点のみで、production APIは既にHTTPS化済みのため実害なし）

## production変更

- 必要性: あり
- 想定作業: 通常のAPI deployで反映される（`docker compose ... up -d --build`が
  変更後のDockerfileでイメージを再ビルドする）。schema変更・migrationは無いため
  DB側の作業は不要。
- downtime: 既存と同じ（brief-restart）
- maintenance window: 不要
- **ローカルDockerでの検証**: `docker build`→`docker run`（ローカル開発DB接続）で
  migration成功・`/health`200・DB依存route（login、401応答）を確認済み
  （下記「Health・テスト」参照）。

`production_change: required`のため、`deployment_status: not_started`のままVPS管理側へ引き継ぐ。

## 利用者への影響

- user_maintenance_impact: none
- 対象利用者・機能: API側は該当なし（runtimeの構成変更のみ、挙動に変化なし）。
  mobile側は次回EAS build配信後、本番ビルドで（既にHTTPSのみのproduction API
  へ接続しているため）体感できる変化はない。
- 通知方法: 不要

## env・secret contract

- 変更: なし
- 変数名・secret種類のみ: 該当なし
- provisioning/rotation: 不要

secret値は記載していない。

## Data・migration・backup

- schema/format変更: なし
- migration: なし
- backup対象: なし
- restore確認: 該当なし
- backward compatibility: あり（API contract・DB schemaとも無変更）

## Deploy・rollback

- deploy前提: なし
- deploy手順の変更: なし
- rollback方法: 旧image tagへの切り替え（従来手順、またはnotice 010のrollback機構）
- rollback不能条件: 特になし（DBデータを変更しないため、image rollbackのみで
  完全に戻せる）

## Health・テスト

- health contract変更: なし
- 実施テスト:

  **(A) Claude実施分（fastify更新・Dockerfile変更、依存分類変更）**
  - `npm run build --workspace=@stockhome/shared` / `--workspace=@stockhome/api`: passed
  - `npx tsc --noEmit -p apps/mobile/tsconfig.json`: passed
  - `npm test --workspace=@stockhome/api`: **152件すべて成功**（fastify更新後、
    prisma依存分類変更後それぞれで再確認。リグレッション無し）
  - `docker build -f apps/api/Dockerfile .`: 成功。`node_modules`が163MB→53MBへ
    縮小、`xlsx`・`typescript`・`tsx`・`prisma`（CLI、devDependency時代の
    `require.resolve`失敗を経て再分類後は正しく含まれる）を確認
  - `docker run`（ローカル開発DB接続）: `migration_start`→`migration_end
    status:success`（11 migrations）→`startup`ログを確認。`GET /health`が
    `{"status":"ok"}`（200）、`POST /api/auth/login`（存在しないemail）が
    401（DB接続・Prisma Client動作の確認）を確認
  - **試行錯誤の経緯**: 最初の実装（`prisma`をdevDependenciesのまま
    `--omit=dev`）ではmigrationが`exit_code:1`で失敗した。原因は
    `entrypoint.ts`が`require.resolve('prisma/build/index.js')`で起動時に
    `prisma`パッケージを直接参照しており、実質runtime依存だったこと。
    `prisma`をdependenciesへ再分類し、かつruntimeで`prisma generate`を
    再実行せず（`npx prisma`はローカル未installだとnpmから最新の非互換
    メジャーバージョン(v7、schemaのurlプロパティ非互換)を取得してしまう
    ことを確認済み）、builderが生成した`node_modules/.prisma`をそのまま
    コピーする方式に修正して解決した。

  **(B) Codex実施分（task `20260920-013`、mobile変更）**
  - `npm run build --workspace=@stockhome/shared` / `--workspace=@stockhome/api`: passed
  - `npx tsc --noEmit -p apps/mobile/tsconfig.json`: passed
  - `app.config.js`の構文チェック（`node -e "require('./app.config.js')"`): passed

- 結果: すべて成功
- 未実施テストと理由: mobile側の実機・EASビルドでの動作確認は未実施（本notice
  提出時点ではEAS build/配信を伴わないため。次回client release時に配信の
  一環として確認する）。production VPS上での実際のdeploy・イメージ再ビルド
  確認は未実施（VPS管理側の承認後）。

## Log・監視

- log量/形式/保存先変更: なし
- 新しいalert条件: なし
- secret/個人情報対策: 変更なし

## 提出前セルフチェック

正本: `C:\work\PRG\Sakura\Dev\vps-server-management\docs\templates\server_change_notice_pre_submission_checklist.md`

- [x] production baselineとrelease全commit・build入力差分を確認した（baseline`ec6e541`から`faf8d7b`までの全44commitを実際の時系列順で確認。上記release_commits参照）
- [x] source commitとnoticeをremoteの対象branchへpushした（`faf8d7b`はpush済み、local/origin一致確認済み。本notice fileはこれからcommit・pushする）
- [x] data更新のtransaction・同時実行・途中失敗を確認した（該当なし。DBデータ更新を伴わない変更のため）
- [x] image rollbackとdata rollback、backup/restore条件を分けた（本変更はimage rollbackのみで完全に戻せる。data rollbackは不要）
- [x] job/log/retention、runtime/dependency、client配信の該当有無を確認した（job/log/retention: 該当なし。runtime/dependency: fastify更新・prisma分類変更・runtime image構成変更。client配信: mobile側の変更のため次回EAS build配信が必要）
- [ ] app owner、VPS review、production承認、client配信承認を分離した — いずれも未実施。下記Approval参照
- [x] secret非混入とtracked working tree cleanを確認した（`git status --short`で確認。既知の無関係な未追跡ファイルのみ残存）

未確認・該当なしの理由: app owner・VPS review・production承認・client配信承認は本notice提出時点で未実施のまま記録する。

## 未解決事項

- node-cron 3.0.3が依存する`uuid`のmoderate脆弱性は未解消（node-cron 4.x系への
  更新はsemver majorでAPI差分確認が必要なため、本notice範囲外とした。
  `ops/runtime-contract.yaml`のknown_gapsに記録済み）。
- xlsxパッケージ自体（devDependency、`migrate-from-xlsx.ts`専用）は変更していない
  （upstream修正が無いため）。ただしruntime imageからは除外されたため、
  production環境への到達可能性は無くなった。
- mobile側の変更は次回EAS build配信まで既存clientには反映されない。

## 希望時期

特に指定なし。notice 010〜016と同じ計画にまとめてproduction反映する想定。

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: これから実施
- VPS管理チャットへ渡すローカル絶対path: `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260920-STOCKHOME-017-summary.md`

## Approval

- app owner: 未実施
- VPS management review: 未実施
- production approval: 未実施
- related task_id: 20260920-013（mobile実装）。fastify更新・Dockerfile変更・
  prisma分類変更はClaudeが直接実施（依存更新、CLAUDE.md記載の例外規定）
