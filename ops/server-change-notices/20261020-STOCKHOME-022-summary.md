# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20261020-STOCKHOME-022

app: stockhome

source_branch: main

source_commit: 16918f80393461eaeed6f66a6b7fd17c29e964f7

production_baseline_commit: dea7c89a0d60a103e20fae824a65e30a3003d4eb

release_commits: `dea7c89..16918f8`（baseline除く）。build入力に影響するのは次のとおり。
- `8ae0986` 本notice対象の保管場所機能（`apps/api`・`packages/shared`・Prisma schema/migration）
- `16918f8` 第1回レビュー指摘対応: 保管場所の更新を世帯単位で直列化（場所階層の同時更新による循環の防止）と回帰テスト
- `da0dce7` 開発PC用CLI（`apps/api/scripts/storage-cli.ts`）のトークン保存権限の修正（builder stageのbuild contextには入るが、final imageには含まれない）
- `b137d37` `scripts/deploy.ps1` の終了コード修正（artifact外。deploy実行経路のみ。修正後の版で実VPSへ通しで流すのは今回が初）
- `5b09a0a` mobile依存の追加でルート `package-lock.json` が変化（mobile専用package。API imageの `npm ci` はworkspace指定のため対象外だが、lockfile自体はbuild入力）
- 他（`dae77df`・`2a0f5d3`・`cf6b92c`・`3efe1b7`）はmobileのみ、残りはops/docs文書のみ

impact_level: L2

status: ready_for_review

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 変更概要

消耗品と「場所だけ管理する物」（掃除用具など）の**保管場所**を管理するAPIを追加する。

- 新規テーブル5つ: `storage_locations`（深さ可変の場所の木。箱・ケースも末端の場所）、
  `storage_things`（場所だけ管理する物。論理削除）、`storage_placements`（物×場所の多対多＋置き場所メモ）、
  `usage_tags`（用途タグ）、`usage_tag_links`（タグ×物の多対多）。
- 新規エンドポイント（すべて既存JWT認証の配下、`req.auth.householdId` で絞り込み）: `/api/storage/*`
  - 場所: 一覧・作成・更新（移動時の循環・段数上限8のチェック）・削除（中身があれば409）・統合（同名の子は再帰的に統合）
  - 物: 作成・取得・更新・論理削除
  - 置き場所: 作成・移動/メモ更新・削除
  - 用途タグ: 一覧・作成・改名・統合・削除・対象へのタグ付け置換（`PUT /tag-assignments`）
  - 検索: 名前・メモ・タグ・場所パスの部分一致、タグ・場所（配下含む）での絞り込み
  - 一括登録 `POST /import`: 全件を1トランザクションで実行。dry runとエラー時はロールバックし、確認時の表示と実登録を一致させる
- ローカル用CLI `npm run storage`（lookup/search/import）: 利用者がチャットで伝えた内容を、
  **公開API経由**で一括登録するための開発PC側ツール。VPSのartifactには含まれない（final imageは `dist`・`prisma` のみコピー）。

既存の品目・在庫計算・通知・Gmail取込・ReadyGoの処理は変更しない。

## 変更理由

利用者から、消耗品のストックや、たまにしか使わない物（掃除用具・旅行用品など）の置き場所を
登録・検索したいという要望（2026-10-20、app ownerと仕様合意済み）。初回登録はチャット経由で一括で行う。
場所だけの物を `items` に混ぜると、Gmail取込の品名部分一致による自動確定や在庫予測・通知・件数集計の
前提を壊すため、別テーブルにした。

## server_impact判定

server_impact: approval_required

判定理由: Prisma migration（新規テーブル5つ・index・CHECK制約の追加）を伴うため。
既存テーブルの列・データは変更しない（新規テーブルから `items`・`households` への外部キーを張るのみ）。
env・port/bind・cron・依存packageの変更は無い。

## 現在と変更後

| 項目 | 現在 | 変更後 |
|---|---|---|
| DBテーブル | 既存のみ | 新規5テーブル追加（既存は不変） |
| API | `/api/storage/*` なし | 認証必須の `/api/storage/*` を追加 |
| 既存エンドポイント | — | 変更なし |
| mobile | — | 本releaseでは変更なし（画面は後続のclient releaseで別途） |

## 影響対象

- service/container: `stockhome-api-prod`
- URL/port/health: 変更なし（`/health` も不変）
- cron/timer/worker: 変更なし
- dependency: 追加なし（`apps/api/package.json` はnpm scriptを1行追加したのみ）。ルート `package-lock.json` はmobile依存分の差分あり（上記）
- data/DB/volume: 新規テーブル5つ（`stockhome-postgres-prod` 内）。volume・DB設定の変更なし
- log/monitoring: 新しいlog eventなし（既存の `http_request` のみ）

## production変更

- 必要性: あり
- 想定作業: 通常のAPI deploy（`npm run deploy -- -Commit 16918f80393461eaeed6f66a6b7fd17c29e964f7`）。
  コンテナ起動時の `prisma migrate deploy` が migration `20261020120000_add_storage_locations` を自動適用する
- downtime: 既存と同じ（brief-restart）
- maintenance window: 不要（新規テーブル作成のみで既存テーブルのlock・書き換えなし）

## 利用者への影響

- user_maintenance_impact: none
- 対象利用者・機能: 単一世帯。反映直後は画面が無いため、利用者から見える変化はない。
  反映後、app owner がチャット経由（CLI）で初回登録を始める
- 通知方法: 不要

## env・secret contract

- 変更: なし（VPS側）
- 変数名・secret種類のみ: CLIの接続先・認証情報（`STORAGE_CLI_API_URL`・`STORAGE_CLI_EMAIL`・`STORAGE_CLI_PASSWORD`）は
  開発PCの `apps/api/.env.local`（gitignore対象）にのみ置く。CLIのトークンキャッシュは `apps/api/.data/`（gitignore対象）
- provisioning/rotation: 不要

secret値は記載していない。

## Data・migration・backup

- schema/format変更: あり。新規5テーブル。既存テーブルへの列追加・変更・削除なし
- migration: `20261020120000_add_storage_locations`
  - `CREATE TABLE`×5、`CREATE INDEX`/`CREATE UNIQUE INDEX`、外部キー、
    手書きの式ユニークindex（`storage_locations` の兄弟名一意: `(household_id, COALESCE(parent_id, ''), name)`）と
    CHECK制約2つ（置き場所・タグ付与は item か thing のどちらか一方のみ）
  - Prismaのmigrationとして1トランザクションで適用される。新規テーブルのみのため、途中失敗しても既存データへの影響はない
    （失敗時は `_prisma_migrations` にfailed行が残るので、原因除去後に `prisma migrate resolve` で対処）
  - Claudeがローカル開発DB（PostgreSQL 16）で `prisma migrate deploy` による適用を確認済み
  - 外部キー: 場所の親子・置き場所→場所は `ON DELETE NO ACTION`（中身のある場所の削除をDBでも拒否しつつ、
    世帯削除時のcascadeは文末判定で通る）。`items`・`storage_things`・`households` への参照は `CASCADE`
    （`items` は運用上物理削除しない）
- backup対象: あり。**利用者が登録する永続データ**（場所・物・置き場所・タグ）になるため、既存のDB全体backupに含まれることが前提
- restore確認: 通常のDB restoreに含まれる（個別の隔離restore試験は未実施）
- backward compatibility: 既存APIのレスポンス・挙動は不変。旧mobileは新エンドポイントを呼ばない

## Deploy・rollback

- deploy前提: なし（envの追加なし）
- deploy手順の変更: なし。ただし `scripts/deploy.ps1` は `b137d37` の修正版で初の実VPS実行になる。
  終了コード0と `DEPLOY_RESULT=success` の両方を確認する
- rollback方法: `npm run deploy -- -RollbackTo dea7c89a0d60a103e20fae824a65e30a3003d4eb`（image rollback）
- image rollbackとdata rollbackの区別:
  - image rollbackしても新規テーブルは残る。旧imageのコードはこれらを参照しないため動作に影響しない
  - 新規テーブルに書き込まれたデータは image rollback では消えない（再度新imageへ戻せばそのまま使える）。
    テーブル削除（data rollback）は不要と判断する。必要になった場合のみ、VPS管理の承認のうえ `DROP TABLE` と
    `_prisma_migrations` の該当行削除を行う
- rollback不能条件: なし

## Health・テスト

- health contract変更: なし
- 実施テスト（Claude、ローカル開発DB=PostgreSQL 16）:
  - `npx tsx --test --test-concurrency=1 apps/api/src/routes/storage.http.test.ts`: 14件すべて成功（`16918f8`）
    （正規化した名前・兄弟名重複409・木の順の一覧／循環移動400・段数上限／中身のある場所の削除409・
    再帰統合と置き場所メモの引き継ぎ／検索（名前・タグ・場所パス・配下）／消耗品への置き場所・タグ置換／
    タグ改名衝突409・統合／物の論理削除／**他世帯の場所・品目・置き場所へ到達不可**／
    一括登録のdry run非書込・本登録・再実行の冪等性／エラー時の全件ロールバック422／DBのCHECK制約／
    **同時更新の回帰3件**（下記「第1回レビュー指摘と対応」）
  - `npm test --workspace=@stockhome/api`（`16918f8`）: 205件中201件成功、4件失敗。失敗はReadyGo関連2ファイル
    （`bridge.readygoRace.test.ts`・`bridge.readygoReclaim.test.ts`）のみで、**変更を退避したbaseline相当の状態でも同じく失敗**することを確認
    （notice 021でも記録した、開発DBの残留データによる既知の不安定と同種。失敗件数は実行ごとに4〜5件で揺れる。本変更はReadyGoのコードに触れていない）
  - `npx tsc --noEmit`（API・mobile・CLI）: 成功
  - `docker build -f apps/api/Dockerfile`（`16918f8` を `git archive` で取り出したbuild context）: 成功
  - CLI のsmoke test（ローカルAPI＋一時ユーザー）: dry run表示・本登録・検索・一覧が想定どおり。一時データは削除済み
- 同時実行・再実行:
  - 保管場所の更新系トランザクション（場所の作成・更新・削除・統合、置き場所の作成・移動、物の作成、タグの統合・付け替え、一括登録）は、
    開始直後に世帯単位のアドバイザリーロック `pg_advisory_xact_lock(<保管場所の名前空間>, hashtext(household_id))` を取り、
    同じ世帯の更新を1つずつ実行する。ロック取得後に場所の木を読み込んで循環・段数を検査するため、先行の確定済み変更を必ず見る
  - ロックはトランザクション終了で自動解放。行ロックではないので、他機能の households への外部キー参照を妨げない。
    ロック待ちを含むトランザクションのtimeoutは20秒（一括登録は60秒）
  - 場所・置き場所の重複は上記の直列化に加え、DBの一意index（兄弟名・物×場所・タグ×物）でも担保。万一の競合時はP2002を409に変換
  - 一括登録はトランザクション内で処理するため、途中失敗で部分的に登録されることはない。同じ内容の再実行は冪等
    （既存の場所・物・置き場所・タグを再利用し、新規作成0件）
- 未実施テストと理由: production相当データでの実行（単一世帯・数百件規模の想定で、検索は世帯分をメモリ上で処理）

## Log・監視

- log量/形式/保存先変更: なし（既存の `http_request` が新ルート分増えるのみ）
- 新しいalert条件: なし。なお一意index競合（同時操作時のみ）では、既存の仕組みでPrismaの `db_client_log`（error）が1行出る可能性がある
- secret/個人情報対策: 新しいログ出力なし。物の名前・場所名はログに出さない

## 第1回レビュー指摘と対応（2026-10-20）

前回review対象: 通知書 `b7cd72b`（source `8ae0986`）。今回の差分は `8ae0986..16918f8` のうち
`da0dce7`（CLIのみ・artifact外）と `16918f8`（下記）、および本通知書の更新。

| 指摘 | 対応 |
|---|---|
| baseline欄をSHAのみにする | `production_baseline_commit` を `dea7c89a0d60a103e20fae824a65e30a3003d4eb` のみに修正 |
| 場所階層の同時更新で循環が起きない対策と回帰確認 | `16918f8`: 保管場所の更新系トランザクションを世帯単位のアドバイザリーロックで直列化（上記「同時実行・再実行」）。回帰テスト3件を追加 |

回帰テスト（各8回くり返し、Fastify inject で2リクエストを同時実行）:

1. A を B の下へ、B を A の下へ同時に移動 → 一方は200、他方は循環として400。DB上の木に循環が無い
2. X を Y へ統合しつつ、Y を X の下へ同時に移動 → 「統合200・移動404」か「統合400・移動200」のどちらか。循環が無い
3. 同じ新しい場所パスへの一括登録を同時に2回 → 両方200、場所は1系統だけ作られ、2つの物が同じ末端の場所に置かれる

**ロックを一時的に外した状態では3件とも失敗**することを確認済み（1は循環発生、2は500、3は兄弟名一意indexの競合）。
ロックを戻した状態で3件を含む14件すべて成功。

## 提出前セルフチェック

正本: `C:\work\PRG\Sakura\Dev\vps-server-management\docs\templates\server_change_notice_pre_submission_checklist.md`

- [x] production baselineとrelease全commit・build入力差分を確認した（稼働baseline `dea7c89` はVPS管理側でも確認済み）
- [x] source commitとnoticeをremoteの対象branchへpushした（再提出時に source `16918f8` と通知書の最新commitの両方がremoteと一致することを確認し、引き継ぎ時に伝える）
- [x] data更新のtransaction・同時実行・途中失敗・再実行を確認した
- [x] image rollbackとdata rollback、backup/restore条件を分けた
- [x] job/log/retention（変更なし）、runtime/dependency（lockfileのmobile差分のみ。build成功確認）、client配信（本releaseなし）の該当有無を確認した
- [x] app owner、VPS review、production承認、client配信承認を分離した
- [x] secret非混入とtracked working tree cleanを確認した（未追跡は `ops/production-db-operations/` のみで、git管理外・artifact対象外）

未確認・該当なしの理由:
- job/cron: 新設なし
- client配信: 本releaseではmobile変更なし。画面は後続のclient releaseで、本noticeの本番反映を前提条件として別途計画する
- 隔離restore試験: 未実施（新規テーブルは通常のDB全体backup/restoreに含まれる前提）
- `tools/review_notice_preflight.ps1`: 未実行。アプリ側PCにはWindows PowerShell 5.1しか無く、
  スクリプトが PowerShell 7 の API（`[System.IO.Path]::GetRelativePath`）を使うため実行できなかった。VPS管理側での実行をお願いしたい

## 未解決事項

1. ~~production baselineの食い違い~~ → 第1回レビューで、稼働baselineが `dea7c89` であることをVPS管理側が確認済み
   （アプリ側の read-only 確認: 稼働中imageは `stockhome-api:git-dea7c89…`、本番DBの適用済みmigrationの最新は
   `20260921140105_push_device_test_cooldown`。いずれも2026-10-20時点）。
2. `scripts/deploy.ps1` の修正版（`b137d37`）は実VPSで未実行。今回のdeployで終了コードと `DEPLOY_RESULT=success` を確認したい。

## 希望時期

特に指定なし。本番反映後、app owner がチャット経由で初回登録を始める予定。

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: 本notice作成後に実施
- VPS管理チャットへ渡すローカル絶対path:
  `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20261020-STOCKHOME-022-summary.md`

## Approval

- app owner: 2026-10-20、このチャットで内容確認のうえVPS管理へ引き継ぐことを承認
- VPS management review: 第1回（2026-10-20）指摘あり（baseline欄の表記、場所階層の同時更新対策）→ 本版で対応し再提出
- production approval: 未実施
- related task_id: なし（ai-watch不使用。app ownerの指示によりClaudeが直接実装）
