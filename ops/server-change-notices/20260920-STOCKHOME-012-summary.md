# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20260920-STOCKHOME-012

app: stockhome

source_branch: main

source_commit: b8c0e7140a4939dec368374ccfe05e77efe35e41

production_baseline_commit: ec6e541b8bf88654baa68c3dd3b1c2fcbdb9d6ad

release_commits:（baseline以降、実際のcommit時系列順）

- `ec6e541`（baseline。notice `20260918-STOCKHOME-009`でproduction反映・`verified`済み）
- `2529199`/`813032b`/`3e4be99`/`e46723c`（notice 009・client release記録のdocs更新。`ops/**`のみでbuild inputに影響しない）
- `0a6e781`（task `20260918-003`、品目検索・絞り込み。apps/mobileのみ、notice不要と判定済み）
- `c2b6fa9`/`f45db49`/`fdf42a0`/`a2376bb`（CI設定新設・修正4件。production runtimeに影響しない）
- `12ac1a5`（`ops/runtime-contract.yaml`のみ、C-2バックアップ方針記録）
- `ad432fb`（notice `20260919-STOCKHOME-011`。所見A-1/A-3/B-5対応。**本noticeの対象外**、011で`accepted`済み）
- `084d1d1`/`a9200ee`/`280b101`/`611dbcf`/`71da90f`/`741eeec`/`dcccd40`/`274a7b6`/`b0c1535`/`e5ac6f8`/`3a7c9fb`/`e5d4d62`（notice `20260919-STOCKHOME-010`、C-5ロールバック機構。**本noticeの対象外**、010で`accepted`済み）
- `b8c0e71`（**本notice対象・source**。所見A-2・A-7対応、JWT有効期限延長。`apps/api`のみ）

**本noticeが対象とするのは`b8c0e71`のみ（認証まわりのAPI変更）。notice 010
（deploy/rollback機構）・011（mobile UI・push payload）とは無関係な変更のため、
分離したままとする。両notice ID・全release commitについては前回・前々回の
notice 010提出内容を参照。**

impact_level: L2

status: ready_for_review

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 変更概要

2026-09-03の全体点検所見のうち認証まわり2件と、先行task（notice
`20260919-STOCKHOME-011`）から持ち越した1件への対応（task `20260920-001`、
Codexが実装）。

- **A-2**（優先度「高」）: 家族メンバーを「無効化」してもログインでき、
  発行済みトークンも有効なままだった。`login`・`authenticate`の両方へ
  `User.isActive`検査を追加した。
- **A-7**（優先度「中」）: `JWT_SECRET`未設定でも`'dev-secret-please-change'`
  という公開リポジトリに書かれた文字列で署名したまま無言で起動していた。
  `NODE_ENV=production`かつ`JWT_SECRET`未設定/空文字列のとき、migration実行前に
  `startup_failed`ログを1行出してexit 1するようentrypointへ検査を追加した。
- **JWT有効期限の延長**（7日→90日）: notice 011で「A-2と同じ後続taskで扱う」と
  先送りしていたもの。A-2が入って初めて「無効化の即時反映」が効くため、
  このタイミングで合わせて変更した。

## 変更理由

2026-09-03の全体点検所見への対応（優先度「高」1件・「中」1件）。詳細は
`stockhome-review-findings-20260903.md`（点検報告書）を参照。

## server_impact判定

server_impact: notify

判定理由: APIの認証可否判定（無効化ユーザーの遮断）、JWT発行の有効期限、
production起動時の必須環境変数チェックを変更するため、deploy前に環境変数
（`JWT_SECRET`が実際に設定されていること）と利用者への影響確認が必要と判断した。
port/bind/domain/health endpoint/起動command/DB schema/migration/volume/
cron/API contract（エンドポイントの追加削除）は変更していない。

## 現在と変更後

| 項目 | 現在 | 変更後 |
|---|---|---|
| 無効化ユーザーのログイン | `login`は`isActive`を見ておらず、無効化しても引き続きログイン・トークン取得できる | パスワード検証後に`isActive`を検査し、無効なら403（`このアカウントは利用できません`）。誤ったパスワードの場合は引き続き401のまま（無効化状態を第三者へ漏らさない） |
| 無効化ユーザーの発行済みトークン | 無効化後も有効期限内（7日）は認証必須APIを通過できる | `authenticate`が毎回`isActive`を検査し、無効化されていれば即座に403（401ではない。mobile側の401インターセプタによる誤った再ログイン誘導を避けるため） |
| JWT有効期限 | 7日固定 | 90日（家庭内利用を想定した長期化。既存の発行済み7日トークンはそのまま7日で失効し、移行処理は無い） |
| `JWT_SECRET`未設定時の起動 | `NODE_ENV`によらず`'dev-secret-please-change'`で無言起動 | `NODE_ENV=production`のときのみ、migration実行前に`startup_failed`ログを1行出してexit 1。値そのものはログに出さない。開発環境（`NODE_ENV`がproduction以外）は既定値のまま従来どおり起動する |

## 影響対象

- service/container: `stockhome-api-prod`（`apps/api/src/plugins/auth.ts`・`routes/auth.ts`・`entrypoint.ts`の変更。route追加・削除は無し、既存routeのハンドラ本体はisActive検査追加のみ）
- URL/port/health: 変更なし
- cron/timer/worker: 変更なし
- dependency: 変更なし（新規パッケージ追加なし）
- data/DB/volume: 変更なし（`User.isActive`は既存カラム、schema/migration変更なし）
- log/monitoring: `event: startup_failed`に`reason: missing_required_env`・`env_name: JWT_SECRET`のfieldが追加される（値そのものは出力しない）。既存の`startup_failed`イベント自体は変更なし（migration失敗時の用途と共有）

## production変更

- 必要性: あり
- 想定作業: 通常のAPI deployで反映される。**deploy前に、production VPS上の`.env`に`JWT_SECRET`が実際に設定されていることを確認する必要がある**（本変更により、未設定/空文字列だとAPIが起動しなくなるため）。現行のruntime-contract上は設定済みと記録されているが、本変更を機に再確認を推奨する。
- downtime: 既存と同じ（brief-restart）
- maintenance window: 不要

`production_change: required`のため、`deployment_status: not_started`のままVPS管理側へ引き継ぐ。

## 利用者への影響

- user_maintenance_impact: possible
- 対象利用者・機能: 全利用者（家庭内メンバー全員）。通常利用時の挙動は変わらない（ログイン・トークンの有効期限延長は体感上プラス）。**家族メンバーを無効化する運用を使っている場合のみ影響があり、無効化後は即座にログイン・API利用ができなくなる（意図した動作）**
- 通知方法: 不要（機能改善・不具合修正のため事前通知は不要と判断。ただし`JWT_SECRET`未設定時にAPIが起動しなくなる点は、deploy作業者向けの周知が必要）

## env・secret contract

- 変更: なし（`JWT_SECRET`は既存の変数。値の中身・provisioning方法は変更しない）
- 変数名・secret種類のみ: 該当なし（新規env変数の追加はない。`JWT_SECRET`の扱いが「未設定でも起動する」→「production では必須」に変わるのみ）
- provisioning/rotation: 不要

secret値は記載していない。

## Data・migration・backup

- schema/format変更: なし
- migration: なし
- backup対象: なし
- restore確認: 該当なし
- backward compatibility: あり（既存の発行済み7日トークンはそのまま動作し続ける。`User.isActive`は既存カラムで新規データ不要）

## Deploy・rollback

- deploy前提: production VPS上の`.env`に`JWT_SECRET`が設定されていることを事前に確認する
- deploy手順の変更: なし（本notice単体ではdeploy手順自体に変更はない。deploy手順自体の変更はnotice `20260919-STOCKHOME-010`で扱っている）
- rollback方法: 旧image tagへの切り替え（従来手順、またはnotice 010のrollback機構が承認され次第そちらを利用可）
- rollback不能条件: 特になし（DBデータを変更しないため、image rollbackのみで完全に戻せる）

## Health・テスト

- health contract変更: なし
- 実施テスト:
  - `npm run build --workspace=@stockhome/shared`: passed
  - `npm run build --workspace=@stockhome/api`: passed
  - `npx tsc --noEmit -p apps/mobile/tsconfig.json`: passed
  - `npm test --workspace=@stockhome/api`（ローカルPostgres）: **128件すべて成功**
    （既存123件＋新規5件。新規5件は`apps/api/src/routes/authDisabledUser.http.test.ts`
    で、無効化ユーザーのログイン拒否・有効ユーザーのログイン成功・発行済み
    トークンの即時失効・有効ユーザートークンの継続動作・誤ったパスワード時の
    401維持を検証）
  - 差分自己点検: `apps/api/prisma/`・`packages/shared`・`apps/gas`・
    `apps/mobile`・`ops/`に本taskによる差分が無いことを確認。変更ファイルは
    `apps/api/src/plugins/auth.ts`・`apps/api/src/routes/auth.ts`・
    `apps/api/src/entrypoint.ts`・新規テストファイルの4件のみ
- 結果: すべて成功
- 未実施テストと理由: production環境での`JWT_SECRET`未設定時の実際の起動失敗確認は未実施（production VPSへの接続はVPS管理側の個別承認後に限られるため）。deploy時にVPS管理側で`.env`の`JWT_SECRET`設定を確認いただくことで代替する。

## Log・監視

- log量/形式/保存先変更: なし（既存の`startup_failed`イベントへfieldが追加されるのみ）
- 新しいalert条件: なし（既存の`startup_failed`監視があれば、本変更による起動失敗も同じ経路で検知される）
- secret/個人情報対策: 変更なし。`JWT_SECRET`未設定検査は値そのものをログへ出力しない（`env_name`という変数名の文字列のみ）

## 提出前セルフチェック

正本: `C:\work\PRG\Sakura\Dev\vps-server-management\docs\templates\server_change_notice_pre_submission_checklist.md`

- [x] production baselineとrelease全commit・build入力差分を確認した（baseline`ec6e541`から`b8c0e71`までの全commitを実際の時系列順で確認。上記release_commits参照）
- [x] source commitとnoticeをremoteの対象branchへpushした（`b8c0e71`はpush済み、local/origin一致確認済み。本notice fileはこれからcommit・pushする）
- [ ] data更新のtransaction・同時実行・途中失敗・再実行を確認した — 該当なし（DBデータ更新を伴わない変更のため）
- [x] image rollbackとdata rollback、backup/restore条件を分けた（本変更はimage rollbackのみで完全に戻せる。data rollbackは不要）
- [x] job/log/retention、runtime/dependency、client配信の該当有無を確認した（job: 該当なし。log: `startup_failed`イベントへのfield追加のみ。runtime/dependency: 変更なし。client配信: mobile側の変更を含まないため該当なし）
- [ ] app owner、VPS review、production承認、client配信承認を分離した — いずれも未実施。下記Approval参照
- [x] secret非混入とtracked working tree cleanを確認した（`git status --short`で確認。既知の無関係な未追跡ファイルのみ残存）

未確認・該当なしの理由: 「data更新のtransaction」項目はDBデータを一切扱わない変更のため該当なし。app owner・VPS review・production承認は本notice提出時点で未実施のまま記録する。

## 未解決事項

- production VPS上の`.env`に`JWT_SECRET`が実際に設定されていることの確認が、
  deploy前に必要（本変更により未設定だとAPIが起動しなくなるため）。
- 家族メンバーの無効化機能を実際に使った際の実機確認（無効化直後にログイン・
  API利用ができなくなること）は、client配信後にapp ownerが行う想定。

## 希望時期

特に指定なし。

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: これから実施
- VPS管理チャットへ渡すローカル絶対path: `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260920-STOCKHOME-012-summary.md`

## Approval

- app owner: 未実施
- VPS management review: 未実施
- production approval: 未実施
- related task_id: 20260920-001
