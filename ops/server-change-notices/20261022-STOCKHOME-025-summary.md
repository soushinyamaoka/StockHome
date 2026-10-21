# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20261022-STOCKHOME-025

app: stockhome

source_branch: main

source_commit: e6984b0b5fb3a15d4bb75f8c2dc61382ed0e0687

production_baseline_commit: f6148459f4caa7abc92daa7251c8396bf34c155e

release_commits: f6148459f4caa7abc92daa7251c8396bf34c155e..e6984b0b5fb3a15d4bb75f8c2dc61382ed0e0687

impact_level: L2

status: ready_for_review

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 変更概要

API の本番依存パッケージの脆弱性対応。`package-lock.json` のみを更新する（`package.json` は不変、既存のsemver範囲内）。

| パッケージ | 変更 | 依存元 | 解消するadvisory（件数と深刻度の内訳） |
|---|---|---|---|
| `fast-jwt` | 6.2.4 → 6.3.5 | `@fastify/jwt@10.1.0`（`^6.2.0`） | 6件: critical 1（GHSA-ww5h-9m49-7xx4）、high 3（GHSA-8wpc-h4q6-8fxv、GHSA-5hjw-83fp-phq9、GHSA-g3jj-5cmm-3hxx）、moderate 2（GHSA-x937-hj6v-793p、GHSA-687g-22h4-j4w4） |
| `fast-uri` | 3.1.6 → 3.1.9 | `fastify`内の`@fastify/ajv-compiler`・`ajv`・`fast-json-stringify@6` | 3件: high 2（GHSA-qw65-cvwx-89v3、GHSA-58mr-gqgx-xq4g）、moderate 1（GHSA-hrr3-gc8f-f4qj） |
| `fast-uri`（fastify直下の別copy） | 4.2.1 → 4.2.3 | `fast-json-stringify@7` | （advisory対象外。`npm update fast-uri` で同時にpatch更新） |

アプリコード・schema・migration・env・Dockerfile・compose の変更なし。

**advisory単位とnpm audit集計の区別**: 上表の件数・深刻度は advisory 単位で、GitHub Advisory Database（`gh api advisories/<GHSA ID>`、2026-10-22確認）の各advisoryの severity による
（GitHub上の `medium` を moderate と表記）。一方、下記の `npm audit` の「critical 1・high 1・moderate 2」は**パッケージ単位の集計**で、
1パッケージを、そのパッケージに該当するadvisoryの最も高い深刻度で1件と数えたもの（`fast-jwt`→critical 1、`fast-uri`→high 1、`uuid`・`node-cron`→moderate 2）。

## 変更理由

notice 024 の production build 時に、VPS管理側から既存依存パッケージの脆弱性警告の確認依頼があった（2026-10-22）。
アプリ側で `npm audit --omit=dev`（api・shared workspace）を実行したところ、パッケージ単位の集計で本番依存に critical 1件（`fast-jwt`）、high 1件（`fast-uri`）、moderate 2件（`uuid`・`node-cron`）があった（advisory単位の内訳は「変更概要」の表）。

### 本アプリへの実影響（更新前の評価）

- `fast-jwt`: 6件とも、空のkey・公開鍵/JWKを使う方式（RSA・JWK）・検証cacheの有効化・`clockTolerance: Infinity`・claim validator の利用等が成立条件。
  本アプリは `@fastify/jwt` を十分な長さのHS256共有秘密（`JWT_SECRET`、production起動時に未設定を拒否）だけで使い、cache・clockTolerance・独自claim validatorを設定していないため、
  **実際に悪用できる条件は確認されなかった**。critical 1件を含むadvisoryを残す理由が無いため更新する
- `fast-uri`: 外部入力のURIを組み立て直す処理をアプリでは使っていない。Fastify内部のschema処理用。影響は小さいが同時に更新
- `uuid`（moderate、`node-cron@3.0.3` 経由）: 問題はbuf引数を渡すv3/v5/v6の使い方のみで、`node-cron` はその使い方をしていない。
  解消には `node-cron` v4（破壊的変更）への更新が必要なため、**本noticeでは対象外**とし残置する

## server_impact判定

server_impact: approval_required

判定理由: 本番imageに入る依存パッケージ（lockfile）を変更するため、image再build・再起動が必要。

impact_level の判断: L2。永続データ・migration・secret・network/公開面・runtime権限・backup/restore の変更は無い。
`fast-jwt` は認証トークン検証のライブラリだが、設定・コードは不変で、検証挙動（下記テスト）が変わらないことを確認した。
dependency/lockfile の変更のため full template を使用した。

## 現在と変更後

| 項目 | 現在（`f614845`） | 変更後（`e6984b0`） |
|---|---|---|
| `fast-jwt` | 6.2.4 | 6.3.5 |
| `fast-uri` | 3.1.6 ／ 4.2.1 | 3.1.9 ／ 4.2.3 |
| `npm audit --omit=dev`（api・shared、パッケージ単位の集計） | critical 1・high 1・moderate 2 | moderate 2（`uuid`／`node-cron`、上記理由で残置） |
| base image・Node.js | `node:24.22.1-bookworm-slim` | 変更なし |
| `package.json` | — | 変更なし |

## 影響対象

- service/container: `stockhome-api-prod`（image再build・再作成）。`stockhome-postgres-prod` は変更なし
- URL/port/health: 変更なし
- cron/timer/worker: 変更なし
- dependency: lockfileの上記3エントリのみ（`git diff f614845..e6984b0 -- package-lock.json` は 9行追加・9行削除）
- data/DB/volume: 変更なし
- log/monitoring: 変更なし

## production変更

- 必要性: あり
- 想定作業: 通常のAPI deploy（`npm run deploy -- -Commit e6984b0b5fb3a15d4bb75f8c2dc61382ed0e0687`）
- 適用されるmigration: なし
- downtime: 既存と同じ（brief-restart）
- maintenance window: 不要

## 利用者への影響

- user_maintenance_impact: possible
- 対象利用者・機能: 単一世帯。反映時はAPIコンテナの短い再起動（brief-restart）があり、その間はアプリの読み込み・保存が一時的に失敗する可能性がある（再試行で回復）。
  ログイン状態（発行済みトークン）は秘密鍵が不変のためそのまま有効で、再ログインは不要。機能・画面の変化はない
- 通知方法: 不要

## env・secret contract

- 変更: なし
- provisioning/rotation: 不要

secret値は記載していない。検証では使い捨ての値のみを使用した。

## Data・migration・backup

- schema/format変更: なし
- migration: なし
- データ書き込み: なし
- backward compatibility: APIのレスポンス・挙動は不変。発行済みJWTの形式・署名方式も不変

## Deploy・rollback

- deploy前提: なし
- deploy手順の変更: なし
- rollback方法: `npm run deploy -- -RollbackTo f6148459f4caa7abc92daa7251c8396bf34c155e`（image rollback）
- image rollbackとdata rollbackの区別: data変更が無いため、image rollbackのみで完全に戻る
- rollback不能条件: なし

## Health・テスト

- health contract変更: なし
- 供給元の確認:
  - 3バージョンとも公開元は GitHub Actions、SLSA provenance 付き（`fast-jwt`: github.com/nearform/fast-jwt、`fast-uri`: github.com/fastify/fast-uri）
  - `npm audit signatures`: 700 packages のregistry署名、173 packages のattestationを検証済み
  - 公開日: `fast-jwt@6.3.5` 2026-10-15、`fast-uri@3.1.9`・`4.2.3` 2026-10-19（いずれも新しいため、provenanceで出所を確認した）
- 実施テスト（Claude、2026-10-22、アプリ側PCのDocker。本番への接続なし。使い捨てのPostgreSQL 16コンテナを使用し、既存の開発DBには接続していない）:
  - **Docker build**（`e6984b0` を `git archive` で取り出したbuild context）: builder・runtime 両方成功。Prisma Client v5.22.0 生成
  - runtime image 内のversion: Node v24.22.1、`fast-jwt` 6.3.5、`fast-uri` 3.1.9。runtimeの `npm ci --omit=dev` の出力は「2 moderate severity vulnerabilities」（`uuid`）のみ
  - **既存テスト**: builder image 内でCIと同じ条件（`TZ=Asia/Tokyo`、`prisma migrate deploy` 後に `npm test --workspace=@stockhome/api`）で **209件すべて成功**
  - **コンテナ起動・DB接続**: runtime image を空DBで起動し、migration 15件成功 → `startup`、`GET /health` 200
  - **認証（JWT）の確認**（runtime image 内、使い捨てのユーザーを作成）:
    - `POST /api/auth/login` 200 → 発行されたトークンで `GET /api/items` 200
    - 正しい秘密鍵で署名した、存在しないユーザーのトークン → 403（検証は通り、所属確認で拒否）
    - 別の秘密鍵で署名 → 401／期限切れ → 401／期限切れかつ `iat` なし → 401／無署名（`alg: none`）→ 401／トークンなし → 401
  - 検証用のコンテナ・ネットワーク・image・DBはすべて削除済み
- builderステージの `npm ci`（devDependencies込み）では high 1件が出るが、これは `xlsx`（移行スクリプト専用のdevDependency）で、runtime imageには入らない（所見C-8対応で別installにしている）
- 未実施テストと理由: production相当データでの実行（本番接続は行わない方針のため）。反映後にVPS管理側のhealth確認とアプリ側のread-only確認で補う

## Log・監視

- log量/形式/保存先変更: なし
- 新しいalert条件: なし

## 第1回レビュー指摘と対応（2026-10-22）

前回review対象: 通知書 `0eff8f8`（source `e6984b0`）。今回の差分は本通知書の記載修正のみ（source・release範囲・lockfile・テスト結果は不変）。

| 指摘 | 対応 |
|---|---|
| `fast-jwt` の6件をすべて critical、`fast-uri` の3件をすべて high と記載していたが、advisoryごとの深刻度が異なる | GitHub Advisory Database で9件の severity を確認し、「変更概要」の表を advisory単位の内訳（`fast-jwt`: critical 1・high 3・moderate 2、`fast-uri`: high 2・moderate 1）に訂正 |
| advisory件数と `npm audit` のパッケージ単位の集計（critical 1・high 1・moderate 2）を区別する | 「変更概要」に両者の数え方の違いを追記し、「変更理由」「現在と変更後」の `npm audit` の値に「パッケージ単位の集計」と明記 |

## 提出前セルフチェック

正本: `C:\work\PRG\Sakura\Dev\vps-server-management\docs\templates\server_change_notice_pre_submission_checklist.md`

- [x] production baselineとrelease全commit・build入力差分を確認した（`f614845..e6984b0` のbuild入力差分は `package-lock.json` の3エントリのみ。他は notice 024 の記録でartifact外）
- [x] source commitとnoticeをremoteの対象branchへpushした（引き継ぎ時に source `e6984b0` と通知書の最新commitがremoteと一致することを伝える）
- [x] lockfileと全workspace manifestを含む実際のbuild contextでbuildした
- [x] Dockerfile、Compose、runtime user、OS package、起動commandの差分なし
- [x] port、bind、domain、health、認証不要endpointの差分なし
- [x] data変更なしのため、image rollbackのみで戻せることを確認した
- [x] app owner、VPS review、production承認を分離した。client配信は不要（mobileの依存は不変）
- [x] `deployment_status: not_started` であることを確認した
- [x] secret非混入とtracked working tree cleanを確認した（未追跡は `ops/production-db-operations/` のみで、git管理外・artifact対象外）

未確認・該当なしの理由:
- data/transaction/job: 変更なし
- client配信: 不要
- `uuid`（moderate）: 上記理由で残置。`node-cron` v4 への更新は、必要になった時点で別noticeとする
- `tools/review_notice_preflight.ps1`: 未実行（アプリ側PCにPowerShell 7が無いため）。VPS管理側での実行をお願いしたい

## 未解決事項

なし

## 希望時期

特に指定なし（critical 指摘の解消のため、早めが望ましい）。

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- VPS管理チャットへ渡すローカル絶対path:
  `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20261022-STOCKHOME-025-summary.md`

## Approval

- app owner: 2026-10-22、このチャットで内容確認のうえVPS管理へ引き継ぐことを承認
- VPS management review: 第1回（2026-10-22）blocked（advisoryの深刻度内訳の誤記、npm audit集計との区別）→ 記載を訂正し、`0eff8f8` からの増分再レビューを依頼。
  第2回（2026-10-22）増分再レビューで技術レビュー受理（advisory単位の深刻度とnpm auditのパッケージ単位集計の区別、GHSA公開情報との整合、preflight `ready_with_manual_checks`・blocker 0、local・cached origin・実remote mainの一致を確認済み。review対象: source `e6984b0`・通知書 `9aeba11`）
- production approval: 未（別承認）
- related task_id: なし（依存更新のためClaudeが直接実施）
