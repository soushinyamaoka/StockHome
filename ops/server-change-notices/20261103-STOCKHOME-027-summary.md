# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20261103-STOCKHOME-027

app: stockhome

source_branch: main

source_commit: 378bf05f34df567f33f4866ceb3a1359749cc48a

production_baseline_commit: 1268d4df68f960a9877fcedb227f3b9da8db6bef

release_commits: 1268d4df68f960a9877fcedb227f3b9da8db6bef..378bf05f34df567f33f4866ceb3a1359749cc48a

impact_level: L2

status: ready_for_review

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 変更概要

API の本番依存パッケージの脆弱性対応（notice 026 の production build 時に VPS管理側が記録した npm audit 指摘への対応）。

| パッケージ | 変更 | 依存元 | 解消するadvisory |
|---|---|---|---|
| `zod` | 3.25.76 → 4.6.7（**メジャー更新**、`package.json` を `^3.23.8` → `^4.6.7`） | `@stockhome/api`・`@stockhome/shared` の直接依存 | GHSA-mrhx-c7xc-m3w5（high）。3.x の修正版は無い（影響範囲 `< 4.6.6`） |
| `fastify` | 5.12.5 → 5.12.7（lockfileのみ、既存semver範囲内） | `@stockhome/api` の直接依存 | GHSA-389g-gv7q-r4x8（low） |
| `ip-address` | 10.7.2 → 10.7.5（lockfileのみ） | `fastify` 系の推移的依存 | GHSA-rxp7-6hxx-x8q5（moderate。GitHub上は medium） |
| `find-my-way` | 9.9.0 → 9.10.0（lockfileのみ） | `fastify` の依存 | （advisory対象外。`npm update fastify` で同時にminor更新） |

- アプリコード・schema・migration・env・Dockerfile・compose の変更なし（zod 4 で型エラー・コード修正は発生しなかった）
- `fastify` は最新の 5.12.8 ではなく 5.12.7 に留めた。5.12.8 は 2026-11-02 公開で provenance が無く、5.12.7（2026-10-13公開）で上記advisoryは解消済みのため
- commit: `f01a17a`（zod 4・fastify・ip-address）、`378bf05`（fastify を 5.12.7 に留める）

## 変更理由

notice 026 の production build ログで、npm audit が runtime に high 1件、builder に high 2件を報告した（2026-11-03、VPS管理側の記録）。
アプリ側で `npm audit --omit=dev`（api・shared workspace）を実行したところ、パッケージ単位の集計で本番依存に high 1件（`zod`）、moderate 3件（`ip-address`・`uuid`・`node-cron`）、low 1件（`fastify`）があった。

### 本アプリへの実影響（更新前の評価）

- `zod`（high）: 長さ制限の無い配列schemaに大量の不正要素を送ると、要素ごとの検証エラーが蓄積してメモリを使い切る。
  本アプリの配列schemaの多くは件数上限が無く、Fastify の body 上限（既定1MB）内でも負荷をかけられる可能性はある。
  ただし該当するAPIはいずれも認証（JWT）または bridge token が必要で、利用者は単一世帯のため、**外部から悪用される現実的な経路は確認されなかった**。
  3.x に修正版が無く、残すと今後も指摘が続くため、4.x へ更新する
- `fastify`（low）: header 検証の schema（`propertyNames`）の大文字小文字の扱い。本アプリは header schema を使っていない。patch 更新で解消できるため更新
- `ip-address`（moderate）: IPv6 文字列の解析が長い入力で遅くなる。patch 更新で解消できるため更新
- `uuid`（moderate、`node-cron@3.0.3` 経由）: notice 025 と同じ理由（`node-cron` は該当する使い方をしていない。解消には `node-cron` v4 の破壊的変更が必要）で**対象外**とし残置する

## server_impact判定

server_impact: approval_required

判定理由: 本番imageに入る依存パッケージ（manifest・lockfile）を変更するため、image再build・再起動が必要。

impact_level の判断: L2 とした。`zod` は全APIの入力検証に使うライブラリのメジャー更新だが、下記テストで**入力を受け付けるか・受け付けた値（既定値・変換後の値）が
更新前と一致する**ことを確認した。変わるのは、検証に失敗したときの英語の既定エラーメッセージの文言と、一部で同じ項目のエラーが複数件返る点だけ
（独自に設定した日本語メッセージは不変、400応答の形式 `{ message, errors: { formErrors, fieldErrors } }` も不変）。
永続データ・在庫計算・migration・secret/auth・network/公開面・runtime権限・backup/restore の変更は無い。dependency変更のため full template を使用した。
VPS管理側でL3が妥当と判断される場合はそれに従う。

## 現在と変更後

| 項目 | 現在（`1268d4d`） | 変更後（`378bf05`） |
|---|---|---|
| `zod` | 3.25.76 | 4.6.7（`apps/api/node_modules`・`packages/shared/node_modules` に配置。mobile の開発ツール `@expo/cli` 用の 3.25.76 は runtime image に入らない） |
| `fastify` / `find-my-way` / `ip-address` | 5.12.5 / 9.9.0 / 10.7.2 | 5.12.7 / 9.10.0 / 10.7.5 |
| `npm audit --omit=dev`（api・shared、パッケージ単位の集計） | high 1・moderate 3・low 1 | moderate 2（`uuid`／`node-cron`、上記理由で残置） |
| builder の `npm ci`（devDependencies込み） | high 2・moderate 2 ほか | high 1（`xlsx`）・moderate 2 |
| base image・Node.js | `node:24.22.1-bookworm-slim` | 変更なし |
| 入力エラー時の400応答 | 例: `"password":["Expected string, received number"]` | 例: `"password":["Invalid input: expected string, received number"]`（独自の日本語メッセージは不変） |

## 影響対象

- service/container: `stockhome-api-prod`（image再build・再作成）。`stockhome-postgres-prod` は変更なし
- URL/port/health: 変更なし（`127.0.0.1:4002` bind、`/health` 不変）
- cron/timer/worker: 変更なし
- dependency: `apps/api/package.json`・`packages/shared/package.json` の `zod` の範囲指定と、`package-lock.json`（`git diff 1268d4d..378bf05 -- package-lock.json` は 29行追加・11行削除）
- data/DB/volume: 変更なし
- log/monitoring: 形式・event変更なし
- mobile: `packages/shared` を通じて次回のmobile配信から zod 4 が含まれる。APIの応答形式は不変のため、現行のmobile（client release 015）はそのまま動作する。本noticeに伴うclient配信は不要

## production変更

- 必要性: あり
- 想定作業: 通常のAPI deploy（`npm run deploy -- -Commit 378bf05f34df567f33f4866ceb3a1359749cc48a`）
- 適用されるmigration: なし
- downtime: 既存と同じ（brief-restart）
- maintenance window: 不要

## 利用者への影響

- user_maintenance_impact: possible
- 対象利用者・機能: 単一世帯。反映時はAPIコンテナの短い再起動（brief-restart）があり、その間はアプリの読み込み・保存が一時的に失敗する可能性がある（再試行で回復）。
  ログイン状態は不変（JWT関連の変更なし）。画面・機能の変化はない
- 通知方法: 不要

## env・secret contract

- 変更: なし
- provisioning/rotation: 不要

secret値は記載していない。検証では使い捨ての値のみを使用した。

## Data・migration・backup

- schema/format変更: なし
- migration: なし
- データ書き込み: なし
- backward compatibility: 受け付ける入力と保存される値は不変（下記テスト）。GAS（bridge）・mobile とも変更不要

## Deploy・rollback

- deploy前提: なし
- deploy手順の変更: なし
- rollback方法: `npm run deploy -- -RollbackTo 1268d4df68f960a9877fcedb227f3b9da8db6bef`（image rollback。notice 026 の反映image）
- image rollbackとdata rollbackの区別: data変更が無いため、image rollbackのみで完全に戻る
- rollback不能条件: なし

## Health・テスト

- health contract変更: なし
- 供給元の確認（2026-11-03）:
  - `npm audit signatures`: 670 packages のregistry署名、220 packages のattestationを検証済み
  - `zod@4.6.7`（2026-10-12公開）・`ip-address@10.7.5`（2026-10-25公開）は SLSA provenance 付き。`fastify@5.12.7`（2026-10-13公開）・`find-my-way@9.10.0`（2026-10-10公開）は provenance なし（従来の版も同様）
- 実施テスト（Claude、2026-11-03、アプリ側PCのDocker。本番への接続なし。使い捨てのPostgreSQL 16コンテナを使用）:
  - **Docker build**（`378bf05` を `git archive` で取り出したbuild context）: builder・runtime 両方成功。
    runtimeの `npm ci --omit=dev` の出力は「2 moderate severity vulnerabilities」（`uuid`／`node-cron`）のみ
  - **runtime依存の比較**: `1268d4d` と `378bf05` の runtime image の `/app/node_modules` 直下（94件／93件）の name@version を比較し、
    差分は `fastify`・`find-my-way`・`ip-address` の更新と、直下の `zod@3.25.76` が無くなったことのみ。image内の zod は
    `/app/apps/api/node_modules/zod`・`/app/packages/shared/node_modules/zod` の 4.6.7 だけで、3.x は残っていない
  - **既存テスト**: builder image（Node v24.22.1）内で、CIと同じ条件（`TZ=Asia/Tokyo`、使い捨てのPostgreSQL 16、`prisma migrate deploy` 後に `npm test`）で **211件すべて成功**
  - **型チェック**: `apps/api`・`packages/shared` とも `tsc --noEmit` でエラー0。mobile も zod 起因のエラーなし（mobile単体テスト61件成功、`npx expo export --platform android` 成功）
  - **入力検証の新旧比較**: `packages/shared` の全schema（44個）に、同じ乱数列で作った不正値・境界値を含む入力を各1,500件（計6.6万件）通し、zod 3.25.76 と 4.6.7 の結果を比較した。
    **受け付けるか否か・受け付けた後の値（既定値・trim・型変換の結果）は全件一致**。違いはエラーの文言（英語の既定メッセージ）と、一部で同じ項目のエラーが複数件になる点のみ
  - **コンテナ起動**: runtime image を使い捨ての空DBに接続して起動。`migration_end status=success` → `startup`、
    `GET /health` 200、`GET /api/items`（認証なし）401、`GET /api/bridge/readygo-pending`（bridge token付き）200、
    `POST /api/auth/login` に不正な入力で 400（応答形式 `{ message, errors: { formErrors, fieldErrors } }` が従来どおり）
  - 検証用のコンテナ・ネットワーク・image・DBはすべて削除済み
- 補足: 開発用DB（既存データあり）で実行した際は ReadyGo 関連の5件が失敗したが、テストが前提とする空DBでないことが原因で、使い捨てDBでは全件成功した（zod 4 とは無関係）
- builderの high 1件は `xlsx`（移行スクリプト専用のdevDependency、npm上に修正版なし）で、runtime imageには入らない（notice 025 と同じ）
- 未実施テストと理由: production相当データでの実行（本番接続は行わない方針のため）。反映後にVPS管理側のhealth確認とアプリ側のread-only確認で補う

## Log・監視

- log量/形式/保存先変更: なし
- 新しいalert条件: なし

## 提出前セルフチェック

正本: `C:\work\PRG\Sakura\Dev\vps-server-management\docs\templates\server_change_notice_pre_submission_checklist.md`

- [x] production baselineとrelease全commit・build入力差分を確認した（`1268d4d..378bf05` のbuild入力差分は `apps/api/package.json`・`packages/shared/package.json`・`package-lock.json` のみ。他はops記録でartifact外）
- [x] source commitをremoteの対象branchへpushした（通知書のcommitも引き継ぎ時にremote一致を伝える）
- [x] lockfileと全workspace manifestを含む実際のbuild contextでbuildした
- [x] Dockerfile、Compose、runtime user、OS package、起動commandの差分なし
- [x] port、bind、domain、health、認証不要endpointの差分なし
- [x] data変更なしのため、image rollbackのみで戻せることを確認した
- [x] app owner、VPS review、production承認を分離した。client配信は不要（APIの応答形式は不変）
- [x] `deployment_status: not_started` であることを確認した
- [x] secret非混入とtracked working tree cleanを確認した（未追跡は `ops/production-db-operations/` のみで、git管理外・artifact対象外）

未確認・該当なしの理由:
- data/transaction/job: 変更なし
- `uuid`（moderate）: 上記理由で残置。`node-cron` v4 への更新は、必要になった時点で別noticeとする
- `xlsx`（builderのみ、high）: npm上に修正版が無く、runtime imageに入らないため残置
- `tools/review_notice_preflight.ps1`: 未実行（アプリ側PCにPowerShell 7が無いため）。VPS管理側での実行をお願いしたい

## 未解決事項

なし

## 希望時期

特に指定なし。

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- VPS管理チャットへ渡すローカル絶対path:
  `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20261103-STOCKHOME-027-summary.md`

## Approval

- app owner: 承認（2026-11-03、app ownerがVPS管理チャットへ引き継ぎ済み）
- VPS management review: 技術レビュー受理（2026-11-03。preflight ready_with_manual_checks・blocker 0件、通知commit `a8c167e` がlocal・実remote mainで一致、L2判定妥当。production反映の承認ではない）
- production approval: 未
- related task_id: なし（依存更新のためClaudeが直接実施）
