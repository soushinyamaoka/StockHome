# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20260919-STOCKHOME-011

app: stockhome

source_branch: main

source_commit: ad432fbafc745661a5f8e14033192753233738d4

production_baseline_commit: ec6e541b8bf88654baa68c3dd3b1c2fcbdb9d6ad

release_commits: `ec6e541`（baseline。notice `20260918-STOCKHOME-009`でproduction反映・
`verified`済み）→ `2529199`/`813032b`/`e46723c`/`3e4be99`（notice 009・client release
記録のdocs更新。`ops/**`のみでbuild inputに影響しない）→ `0a6e781`
（task `20260918-003`、品目検索・絞り込み。apps/mobileのみ、notice不要と判定済み）→
`c2b6fa9`/`f45db49`/`fdf42a0`/`a2376bb`（CI設定新設・修正4件。production runtimeに
影響しない）→ `12ac1a5`（`ops/runtime-contract.yaml`のみ、C-2バックアップ方針記録）→
`084d1d1`（scripts/deploy.ps1・docker-compose.prod.ymlのみ変更、C-5ロールバック機構。
**本noticeの対象外**。別notice `20260919-STOCKHOME-010`で扱う）→ `ad432fb`
（本notice source。task `20260919-006`、所見A-1/A-3/B-5対応。
**apps/mobile・apps/apiのソース変更あり、API build inputに影響する**。
**本notice対象**）。

**本noticeが対象とするのは`ad432fb`のみ（mobile UI・push payload変更）。
`084d1d1`（deploy/rollback機構、C-5）は内容的に無関係な別変更のため、別途独立した
notice（`20260919-STOCKHOME-010`）を作成済み。次回のVPS反映では両commitが同一の
tarball転送に含まれることになるが、変更の性質は独立している。**

impact_level: L2

status: ready_for_review

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 変更概要

2026-09-03の全体点検所見のうち3件への対応（task `20260919-006`、Codexが実装）。

- **A-1**（優先度「高」）: API障害・オフライン・トークン失効時、mobileが空データを
  「◎ 在庫はみんな足りています」と誤表示していた。共通`ErrorState`コンポーネントを
  新設し、ホーム・在庫一覧・品目一覧の3画面で通信失敗時に「読み込めませんでした」＋
  再試行を表示するようにした。
- **A-3**（優先度「高」）: JWTは7日固定で更新機構が無く、失効後は全画面が401になり
  A-1と重なって「空データ」に見えていた。mobile側に、Authorizationヘッダ付き
  リクエストが401を受けた場合のみトークンを破棄しログイン画面へ戻す仕組みを
  追加した。**JWT有効期限（7日）自体は変更していない**（`apps/api/src/plugins/auth.ts`
  に差分なし。有効期限延長は所見A-2「無効化ユーザーがログインできる」と同じ
  後続taskで扱う）。
- **B-5**（優先度「中」）: プッシュ通知はタップしてもアプリが開くだけで、該当品目へ
  遷移していなかった。**APIのExpo Push送信payloadへ`data`フィールドを追加**し、
  単一品目のアラートのときのみ`itemId`を含める（複数品目がまとまった通知には
  含めない）。mobile側は通知タップ時、`itemId`があれば在庫一覧の該当品目へ
  スクロール、無ければ在庫一覧を開く。

## 変更理由

2026-09-03の全体点検所見への対応。優先度「高」2件・「中」1件。詳細は
`stockhome-review-findings-20260903.md`（点検報告書）を参照。

## server_impact判定

server_impact: notify

判定理由: APIのExpo Push payloadに`data`フィールドを追加し、夜間batch
（`daily_batch`）が生成する通知内容が変わるため、本番deploy前にVPS運用側への
変更通知・確認が必要と判断した。port、bind、domain、health endpoint、起動command、
systemd/Docker、env変数名、DB schema/migration、volume、cron/timer、ログ形式の
変更はないことを確認した（task `20260919-006`のresultで自己判定済み、Claudeが
再確認）。

## 現在と変更後

| 項目 | 現在 | 変更後 |
|---|---|---|
| API障害時のmobile表示 | `isError`を一切見ておらず、通信失敗時も「◎ 在庫はみんな足りています」等に見える（ホーム・在庫一覧・品目一覧） | `isError`のときは共通`ErrorState`（「読み込めませんでした」＋再試行）を表示 |
| 401受信時のmobile動作 | 何もしない（トークンが残ったまま各画面がエラー状態を示さず空データのように見える） | Authorizationヘッダ付きリクエストが401を受けたときのみトークンを破棄しログイン画面へ自動遷移。ログイン失敗時の401（Authorizationヘッダ無し）は対象外、既存の挙動のまま |
| Expo Push送信payload | `title`・`body`のみ | 単一品目アラートのときのみ`data: { itemId }`を追加。複数品目時は`data`を付けない |
| 通知タップ時のmobile動作 | アプリが開くだけ | `itemId`があれば在庫一覧の該当品目へスクロール、無ければ在庫一覧を開く。killed状態からの起動時も`useLastNotificationResponse`経由で同じ遷移が働く |

## 影響対象

- service/container: `stockhome-api-prod`（`apps/api/src/services/pushNotify.ts`・`batch.ts`の変更。route追加・削除は無し、既存routeのハンドラ本体も無変更）
- URL/port/health: 変更なし
- cron/timer/worker: 変更なし（`daily_batch`のスケジュール・実行条件は無変更。送信payloadの中身のみ変わる）
- dependency: 変更なし
- data/DB/volume: 変更なし（schema/migration無し）
- log/monitoring: 変更なし

## production変更

- 必要性: あり
- 想定作業: 通常のAPI deploy（`npm run deploy`）でmobile/API両方のソースが反映される（mobileはこのソース変更だけでは配信されず、別途EAS Update等のclient配信が必要）
- downtime: 既存と同じ（brief-restart、`api`コンテナのみ再ビルド・入れ替え）
- maintenance window: 不要

`production_change: required`のため、`deployment_status: not_started`のままVPS管理側へ引き継ぐ。

## 利用者への影響

- user_maintenance_impact: none
- 対象利用者・機能: 全利用者（家庭内メンバー全員）。エラー表示・自動ログアウト・通知タップ遷移という体験改善のみで、既存機能の後退はない
- 通知方法: 不要（機能改善のため、事前の利用者通知は不要と判断）

## env・secret contract

- 変更: なし
- 変数名・secret種類のみ: 該当なし
- provisioning/rotation: 該当なし

secret値は記載していない。

## Data・migration・backup

- schema/format変更: なし
- migration: なし
- backup対象: なし
- restore確認: 該当なし
- backward compatibility: あり（Expo Push payloadへの`data`追加は既存の受信側（旧mobileクライアント）が単に無視するだけで、後方互換）

## Deploy・rollback

- deploy前提: 通常の`npm run deploy`で反映可能。mobile側の変更はEAS Update等の別途client配信が必要（本notice単体ではmobile利用者へ届かない）
- deploy手順の変更: なし（本notice単体ではdeploy手順自体に変更はない。deploy手順自体の変更は別notice`20260919-STOCKHOME-010`で扱う）
- rollback方法: 旧image tagへの切り替え（従来手順、または`20260919-STOCKHOME-010`のrollback機構が承認され次第そちらを利用可）
- rollback不能条件: 特になし（DBデータを変更しないため、image rollbackのみで完全に戻せる）

## Health・テスト

- health contract変更: なし
- 実施テスト:
  - `npm run build --workspace=@stockhome/shared`: passed
  - `npm run build --workspace=@stockhome/api`: passed
  - `npx tsc --noEmit -p apps/mobile/tsconfig.json`: passed
  - 差分自己点検: `packages/shared`・`apps/gas`・`prisma/schema.prisma`・
    `apps/api/src/plugins/auth.ts`・`apps/mobile/App.tsx`・`apps/mobile/package.json`に
    本taskによる差分が無いことを確認
  - `sendPushToUser(`の呼び出し元が`batch.ts`の1箇所のみであることを確認（他の
    呼び出し元があれば引数追加による型エラーが起きうるため）
- 結果: すべて成功
- 未実施テストと理由: DB接続を伴う動的テスト（`npm test --workspace=@stockhome/api`）は
  ai-watch経由のtask実行環境では未実施（DB操作禁止のため）。Claudeが対話セッションで
  本commit `ad432fb`を含む最新状態（ローカルPostgres）に対して実行し、**121件すべて
  成功**を確認済み。mobile UIの実機確認はclient配信後にapp ownerが行う想定
  （既存の運用と同様）。

## Log・監視

- log量/形式/保存先変更: なし
- 新しいalert条件: なし
- secret/個人情報対策: 変更なし（`data.itemId`はアプリ内部のUUID相当であり、個人情報・secretを含まない）

## 提出前セルフチェック

正本: `C:\work\PRG\Sakura\Dev\vps-server-management\docs\templates\server_change_notice_pre_submission_checklist.md`

- [x] production baselineとrelease全commit・build入力差分を確認した（baseline`ec6e541`から`ad432fb`までの全commitを`git log`で確認。上記release_commits参照）
- [x] source commitとnoticeをremoteの対象branchへpushした（`ad432fb`はpush済み。本notice fileはこれからcommit・pushする）
- [ ] data更新のtransaction・同時実行・途中失敗・再実行を確認した — 該当なし（DBデータ更新を伴わない変更のため）
- [x] image rollbackとdata rollback、backup/restore条件を分けた（本変更はimage rollbackのみで完全に戻せる。data rollbackは不要）
- [x] job/log/retention、runtime/dependency、client配信の該当有無を確認した（job: `daily_batch`の送信payload内容のみ変更、スケジュール等は無変更。log/retention: 変更なし。runtime/dependency: 変更なし。client配信: mobile側UI変更を含むため別途EAS Update等が必要。VPS production承認とは別に判断する）
- [ ] app owner、VPS review、production承認、client配信承認を分離した — いずれも未実施。下記Approval参照
- [x] secret非混入とtracked working tree cleanを確認した（`git status --short`で確認。既知の無関係な未追跡ファイルのみ残存）

未確認・該当なしの理由: 「data更新のtransaction」項目はDBデータを一切扱わない変更のため該当なし。app owner・VPS review・production承認はいずれも本notice作成時点で未実施のまま記録する。

## 未解決事項

- mobile側UIの実機確認（client配信後、app owner）は未実施。
- JWT有効期限延長（所見A-2と同じ後続task）は本notice・本taskの対象外。

## 希望時期

特に指定なし。

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: これから実施
- VPS管理チャットへ渡すローカル絶対path: `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260919-STOCKHOME-011-summary.md`

## Approval

- app owner: 未実施
- VPS management review: 未実施
- production approval: 未実施
- related task_id: 20260919-006
