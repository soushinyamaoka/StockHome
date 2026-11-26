# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20261126-STOCKHOME-028

app: stockhome

source_branch: main

source_commit: 27dc6ef5ccd7e3ba66ab9117e90713d096223e21

production_baseline_commit: 378bf05f34df567f33f4866ceb3a1359749cc48a

release_commits: 378bf05f34df567f33f4866ceb3a1359749cc48a..27dc6ef5ccd7e3ba66ab9117e90713d096223e21

impact_level: L3

status: ready_for_review

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 変更概要

アプリ以外のサービス（app owner 世帯で利用する Muse のカスタムコネクタ）から API を呼ぶための**外部連携用トークン**を追加する（`b33b0cf`、個人情報を返すAPIの除外 `5534375`、夜間バッチの手動実行の除外 `27dc6ef`）。

- 利用者がアプリの設定画面で自分のトークンを発行する。トークンは `shk_` で始まる32バイトの乱数で、発行時に1度だけ表示する
- `Authorization: Bearer shk_...` で認証し、**発行した本人として**動く（その人の家庭のデータだけを扱う）。期限なし・取り消すまで有効
- 既定は**読み取り専用**（GET・HEAD のみ）。書き込みはトークンごとにアプリで許可する。許可していないトークンの書き込みは 403
- 書き込みを許可していても、次は参照も含めて 403: トークンの管理（`/api/api-tokens`）、`/api/auth/*`（`me`・`change-password` など）、
  利用者の個人情報を返すAPI（`/api/users`＝メールアドレス、`/api/push-devices`、Gmail取込の `/api/import-candidates`・`/api/reflections`＝取り込んだ人のメールアドレス・メールの件名と本文の一部）。
  app owner の指示（2026-11-26「ユーザー情報の参照ができないようにしたい」）による。
  あわせて夜間バッチの手動実行（`POST /api/dashboard/run-batch`）も 403（VPS管理レビューの差し戻し対応。下記「差し戻しへの対応」）
- トークン本体は保存せず SHA-256 のみを `api_tokens` テーブルに保存する。最終利用日時を最大10分に1回記録する
- 管理API（JWT のみ）: `GET/POST /api/api-tokens`、`PATCH/DELETE /api/api-tokens/:id`。メンバーは自分の分、admin は家族全員の分を一覧・切り替え・取り消しできる。発行は本人の分のみ、1人10個まで
- mobile の設定画面「外部連携」は client release 017 で別途配信する（本noticeの反映後）
- 仕様: `docs/EXTERNAL_API.md`。実装: `apps/api/src/plugins/auth.ts`・`apps/api/src/services/apiTokens.ts`・`apps/api/src/routes/apiTokens.ts`

## 変更理由

app owner 夫妻がそれぞれ Muse（AIアシスタント）から StockHome の品物・保管場所を検索する連携を始める（2026-11-26、app owner の指示）。
既存の JWT は90日で失効するため Muse 側で年4回×2人の入れ直しが必要になり、また家族アカウントそのものの権限を持つため書き込みを API 側で制限できなかった。
連携先ごとに取り消し・書き込み可否を app owner 側で管理できるようにする。

## server_impact判定

server_impact: approval_required

判定理由: 本番APIのコード変更と migration（テーブル追加）があり、image再build・再起動と migration 適用が必要。

impact_level の判断: **L3** とした。認証経路の追加（secret/auth 相当）と migration を含むため。
既存の JWT 認証・ログイン・bridge token・認証不要 endpoint・port/bind・env/secret は変更しない。新しい認証方式で到達できるのは、既存の認証必須 endpoint のうち上記の除外を除いたものだけで、
新しい認証不要 endpoint は無い。

## 現在と変更後

| 項目 | 現在（`378bf05`） | 変更後（`27dc6ef`） |
|---|---|---|
| 認証必須APIの認証方式 | JWT（90日） | JWT（不変）＋外部連携用トークン（`shk_`、期限なし・取り消し可） |
| 外部連携用トークンの権限 | — | 発行者本人として動作。既定は GET・HEAD のみ。書き込みはトークンごとの許可制。トークン管理・`/api/auth/*`・個人情報を返すAPI（users・push-devices・import-candidates・reflections）・夜間バッチの手動実行は常に不可 |
| 新しいendpoint | — | `GET/POST /api/api-tokens`、`PATCH/DELETE /api/api-tokens/:id`（JWT のみ） |
| DB | — | `api_tokens` テーブル追加（hash・先頭10文字・書き込み可否・最終利用・取り消し日時） |
| Authorization が `Bearer shk_...` の場合 | JWT として検証され 401 | `api_tokens` で照合。無効・取り消し済みは 401、利用者無効は 403 |

## 影響対象

- service/container: `stockhome-api-prod`（image再build・再作成）。`stockhome-postgres-prod` は migration でテーブル追加のみ
- URL/port/health: 変更なし（`127.0.0.1:4002` bind、`/health` 不変、認証不要 endpoint の追加なし）
- cron/timer/worker: 変更なし
- dependency: なし（`378bf05..27dc6ef` で `package.json`・`package-lock.json`・Dockerfile・compose に差分なし）
- data/DB/volume: `api_tokens` テーブル追加（household・user への外部キー、ON DELETE CASCADE）。既存テーブルは不変
- log/monitoring: 最終利用日時の記録に失敗した場合のみ warn（`event: api_token_last_used_update_failed`）。トークン値はログに出さない
- mobile: 現行（client release 016）は新APIを呼ばないため、そのまま動作する。設定画面は client release 017 で、本noticeの反映後に配信する
- GAS（bridge）: 変更なし

## production変更

- 必要性: あり
- 想定作業: 通常のAPI deploy（`npm run deploy -- -Commit 27dc6ef5ccd7e3ba66ab9117e90713d096223e21`）。起動時の `prisma migrate deploy` で migration が適用される
- 適用されるmigration: `20261126120000_add_api_tokens`（`CREATE TABLE api_tokens`、index 3件、外部キー2件のみ）
- downtime: 既存と同じ（brief-restart）
- maintenance window: 不要

## 利用者への影響

- user_maintenance_impact: possible
- 対象利用者・機能: 単一世帯。反映時はAPIコンテナの短い再起動（brief-restart）があり、その間はアプリの読み込み・保存が一時的に失敗する可能性がある（再試行で回復）。
  ログイン状態は不変（JWT の発行・検証は変更なし）。反映だけでは画面の変化はない（client release 017 の配信後に設定画面へ「外部連携」が出る）
- 通知方法: 不要

## env・secret contract

- 変更: なし（新しい env・secret は無い。トークンは利用者がアプリで発行し、DBには hash のみ保存）
- provisioning/rotation: 不要。トークンの失効は利用者が取り消して発行し直す

secret値は記載していない。検証では使い捨ての値のみを使用した。

## Data・migration・backup

- schema/format変更: `api_tokens` テーブル追加のみ
- migration: `20261126120000_add_api_tokens`（追加のみ。既存データの変更・ロックを伴う操作は無い）
- データ書き込み: 反映時は無し。反映後、利用者がトークンを発行・使用したときに `api_tokens` へ書き込む
- backup対象: 既存の DB backup にそのまま含まれる（hash のみで、backup からトークンとして使うことはできない）
- backward compatibility: 既存の API・応答形式・JWT は不変。現行 mobile・GAS とも変更不要

## Deploy・rollback

- deploy前提: なし
- deploy手順の変更: なし
- rollback方法: `npm run deploy -- -RollbackTo 378bf05f34df567f33f4866ceb3a1359749cc48a`（image rollback。notice 027 の反映image）
- image rollbackとdata rollbackの区別: image rollback のみで機能は完全に戻る（旧コードは `api_tokens` を参照せず、`shk_` トークンは JWT として検証され 401 になる）。
  `api_tokens` テーブルは残るが無害。削除する場合は別途 notice とする
- rollback不能条件: なし

## Health・テスト

- health contract変更: なし
- 実施テスト（Claude、2026-11-26、アプリ側PCのDocker。本番への接続なし。使い捨てのPostgreSQL 16コンテナを使用）:
  - **既存テスト＋追加テスト**: `TZ=Asia/Tokyo`、使い捨てのPostgreSQL 16 に `prisma migrate deploy` 後、`apps/api` の全テストを実行し **221件すべて成功**
    （追加7件: 発行と hash 保存、読み取り専用の拒否と許可の切り替え、許可済みでもトークン管理・家族メンバー変更は不可、取り消し・不正・利用者無効、家族一覧の参照不可、
    メンバー／admin の一覧・取り消し範囲、発行者の家庭への書き込み、1人10個の上限。夜間バッチを起動できず他世帯の配信結果確認も走らないこと（下記）、ほか単体テスト2件。除外するAPIの一覧を含む）。実行環境はアプリ側PCの Node v24.16（builder image 内ではない）
  - **型チェック**: `apps/api`・`packages/shared`・`apps/mobile`（テスト以外）とも `tsc --noEmit` でエラー0。mobile 単体テスト62件成功、`npx expo export --platform android` 成功
  - **Docker build**（`b33b0cf`・`5534375`・`27dc6ef` をそれぞれ `git archive` で取り出した build context）: 成功
  - **コンテナ起動と結合確認**: runtime image を使い捨ての空DBに接続して起動。`migration_start` → `migration_end` → `startup`、`GET /health` 200。
    その上で、テスト用アカウントで次を確認:
    トークン発行 201（既定 `allowWrite=false`）→ トークンで `GET /api/storage/search`・`GET /api/items` 200 → `POST /api/storage/locations` 403 →
    `GET /api/auth/me`・`POST /api/auth/change-password`・`GET /api/api-tokens` 403 → JWT で書き込み許可 → `POST /api/storage/locations` 201・`change-password` は 403 のまま →
    取り消し 204 → トークンで 401、JWT は 200 のまま。DB の `token_hash` は64桁の16進のみ、`last_used_at` 記録済み（以上 `b33b0cf`）。
    `5534375` では、書き込みを許可したトークンで `GET /api/storage/search`・`/api/items`・`/api/stocks` 200、`/api/users`・`/api/push-devices`・`/api/import-candidates`・
    `/api/reflections`・`/api/auth/me`・`/api/api-tokens` 403、JWT での `/api/users` は 200 のまま。
    `27dc6ef` では、書き込みを許可した admin のトークンで `POST /api/dashboard/run-batch` 403（`GET /api/dashboard`・`/api/storage/search` は 200、`/api/users` は 403 のまま）、
    同じ admin の JWT では 200（従来どおり）
  - 検証用のコンテナ・ネットワーク・image・DBはすべて削除済み
- 未実施テストと理由: production相当データでの実行（本番接続は行わない方針のため）。反映後にVPS管理側のhealth確認とアプリ側のread-only確認で補う

## Log・監視

- log量/形式/保存先変更: なし（最終利用日時の記録失敗時の warn のみ追加）
- 新しいalert条件: なし

## 提出前セルフチェック

正本: `C:\work\PRG\Sakura\Dev\vps-server-management\docs\templates\server_change_notice_pre_submission_checklist.md`

- [x] production baselineとrelease全commit・build入力差分を確認した（`378bf05..27dc6ef` の API build 入力差分は `apps/api/prisma/`（schema・migration）、
  `apps/api/src/`（auth plugin・server・apiTokens の service/route/テスト）、`packages/shared/src/`（apiToken schema）。他は mobile・docs・ops記録で artifact 外）
- [x] source commitをremoteの対象branchへpushした（通知書のcommitも引き継ぎ時にremote一致を伝える）
- [x] lockfileと全workspace manifestを含む実際のbuild contextでbuildした
- [x] Dockerfile、Compose、runtime user、OS package、起動commandの差分なし
- [x] port、bind、domain、health、認証不要endpointの差分なし
- [x] migration は追加のみで、image rollback だけで機能が戻ることを確認した（旧コードは新テーブルを参照しない）
- [x] app owner、VPS review、production承認を分離した。mobile は本noticeの反映後に client release 017 で配信する
- [x] `deployment_status: not_started` であることを確認した
- [x] secret非混入とtracked working tree cleanを確認した（未追跡は `ops/production-db-operations/` のみで、git管理外・artifact対象外）

未確認・該当なしの理由:
- dependency: 変更なし
- `tools/review_notice_preflight.ps1`: 未実行（アプリ側PCにPowerShell 7が無いため）。VPS管理側での実行をお願いしたい

## 差し戻しへの対応（2026-11-26）

VPS管理レビュー（blocked）の指摘: 管理者が発行した書き込み可トークンで夜間バッチ（`POST /api/dashboard/run-batch`）を起動でき、
バッチ内のプッシュ通知の配信結果確認（`checkPushReceipts`）は世帯を限定しないため、他世帯の端末を無効化し得る。

- 対応（`27dc6ef`）: 外部連携用トークンで受け付けないAPIに `/api/dashboard/run-batch` を追加した（`apps/api/src/services/apiTokens.ts`）。
  拒否は認証の段階（`plugins/auth.ts` の preHandler）で行うため、route の処理（`runDailyBatch`）には到達しない。夜間バッチの手動実行は JWT（アプリのログイン、admin）に限られる
- 回帰テスト（`apps/api/src/routes/apiTokens.http.test.ts` 末尾）: 他世帯の端末と未確認の配信記録（push ticket）を用意し、Expo への問い合わせ（`fetch`）を
  「端末未登録」を返すスタブに置き換えたうえで、書き込みを許可した admin のトークンで起動する。次をすべて確認する:
  応答 403、`fetch` の呼び出し 0 回、他世帯の push ticket は `pending` のまま、他世帯の端末は有効のまま、`batch_run_status` の `daily_batch` が更新されない
- 修正を外した状態（拒否リストから `/api/dashboard/run-batch` を除いた状態）では、このテストが失敗する（応答 200）ことを確認してから、修正を戻して全件実行した（221件成功）
- 他の route から世帯を限定しない処理を呼ぶ箇所が無いかを確認した。`checkPushReceipts` を route から呼ぶのは `run-batch` だけで、
  手動の在庫再計算（`POST /api/stocks/recalculate`）など他の処理は `req.auth.householdId` で絞り込んでいる

## 未解決事項

- JWT（admin）での夜間バッチの手動実行は、従来どおり `checkPushReceipts` を世帯を限定せずに実行する（本notice以前からの挙動。単一世帯運用のため実害は無い）。
  2世帯目を追加する場合は、配信結果確認を世帯で絞るか、手動実行から外す必要がある（CLAUDE.md の単一世帯前提の洗い出し対象に加える）

## 希望時期

特に指定なし。

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- VPS管理チャットへ渡すローカル絶対path:
  `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20261126-STOCKHOME-028-summary.md`

## Approval

- app owner: 承認（2026-11-26、app ownerがVPS管理チャットへ引き継ぎ済み。VPS管理側の受理台帳に記録）
- VPS management review: 差し戻し（blocked、2026-11-26。preflight ready_with_manual_checks・機械判定のblocker 0件、通知commit `aaa4a77` が GitHub main と一致、
  VPS1の稼働imageは baseline `378bf05` と一致。指摘1件: 書き込み可トークンから夜間バッチを起動でき、他世帯の端末を無効化し得る）→ 対応済み（上記「差し戻しへの対応」）。
  再レビュー: 受理（accepted、2026-11-26。指摘 S028-B01 解消。書き込み可のadminトークンでも夜間バッチ起動前に403となることをコードで確認、
  preflight 機械判定blocker 0件、GitHub main が通知書 `0a73085` と一致。APIテスト221件はアプリ側報告に基づく。production反映の承認ではない）
- production approval: 未
- related task_id: なし（app ownerの指示によりClaudeが直接実装）
