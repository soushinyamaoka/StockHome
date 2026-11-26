# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20261126-STOCKHOME-029

app: stockhome

source_branch: main

source_commit: 6512adfa38f9a68fea147dcf101ab848e5a32498

production_baseline_commit: 27dc6ef5ccd7e3ba66ab9117e90713d096223e21

release_commits: 27dc6ef5ccd7e3ba66ab9117e90713d096223e21..6512adfa38f9a68fea147dcf101ab848e5a32498

impact_level: L3

status: ready_for_review

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 変更概要

notice 028 で追加した外部連携用トークン（Muse 連携）の**悪用を検知する仕組み**を追加する（`5b7b17b`、差し戻し対応 `6512adf`）。

1. **拒否の通知**: 外部連携用トークンで次の拒否が起きたら、トークンを発行した本人の端末へプッシュ通知する（同じトークンについて24時間に1回まで）
   - 読み取り専用のトークンでの書き込み（403）
   - トークンでは使えないAPI（個人情報・トークン管理・`/api/auth/*`・夜間バッチの手動実行）の呼び出し（403）
   - 取り消したトークンの利用（401）
   連携先は正しく使えば拒否されないため、拒否そのものを想定外の使われ方の合図とする。送信は既存の `sendPushToUser`（世帯と本人で絞り込み）を使う。
   **送る相手は、発行者が今も有効で、その家庭のメンバーである場合だけ**（取り消し済みトークンは発行者の状態を問わず認証の途中まで届くため、通知の直前に確かめる）
   通知の結果は `api_token_alert_sent`（1台以上で受理）・`api_token_alert_no_target`（`cause`: `owner_inactive`／`owner_not_member`／`no_active_device`）・
   `api_token_alert_failed`（`cause`: `push_not_accepted`／`exception`）に分けて記録する
2. **拒否のログ**: 外部連携用トークンの拒否をすべて `event: api_token_denied`（`reason`・`api_token_id`・`method`・`route`）で記録する。存在しないトークンは `reason: unknown`（ID無し）
3. **リクエストログの項目追加**: `event: http_request` に、認証済みのリクエストなら `user_id`・`auth_kind`（`jwt`／`api_token`）・`api_token_id` を追加する
- トークン値・メールアドレスはログに出さない
- 拒否の判定・応答（ステータス・本文）は notice 028 から変えない。アクセスできる範囲も変えない
- 仕様: `docs/EXTERNAL_API.md` の「悪用の検知」（`43864d5`）

## 変更理由

app owner から「APIが悪用されていることを検知する仕組みはあるか」との質問（2026-11-26）。現状は防ぐ仕組みのみで、気づく手段はトークン一覧の最終利用日時だけ、
ログにはどの利用者・トークンのリクエストかが残っていなかった。app owner がおすすめ案（ログへの識別子の追加＋拒否の本人通知）を指示した。

## server_impact判定

server_impact: approval_required

判定理由: 本番APIのコード変更と migration（列追加）があり、image再build・再起動と migration 適用が必要。

impact_level の判断: **L3** とした。認証処理（`plugins/auth.ts`）への追加と migration、ログ項目の追加、外部（Expo）へのプッシュ送信の新しい契機を含むため。
アクセス制御の判定そのもの・JWT・bridge token・認証不要 endpoint・port/bind・env/secret は変更しない。VPS管理側でL2が妥当と判断される場合はそれに従う。

## 現在と変更後

| 項目 | 現在（`27dc6ef`） | 変更後（`6512adf`） |
|---|---|---|
| トークンの拒否 | 401/403 を返すだけ | 同じ応答に加え、`api_token_denied` をログに記録。書き込み・除外API・取り消し済みの場合は本人へプッシュ通知（24時間に1回まで） |
| `http_request` ログ | `method`・`route`・`status`・`duration_ms` | 左記＋認証済みなら `user_id`・`auth_kind`・`api_token_id` |
| 新しいログevent | — | `api_token_denied`、`api_token_alert_sent`、`api_token_alert_no_target`、`api_token_alert_failed`（`api_token_last_used_update_failed` は文字列を定数化しただけで値は同じ） |
| DB | `api_tokens` | `api_tokens.last_alerted_at`（nullable）を追加 |
| 外部への送信 | 夜間バッチ・テスト送信のプッシュ | 左記＋拒否の通知（同じ Expo Push API、同じ送信関数） |

## 影響対象

- service/container: `stockhome-api-prod`（image再build・再作成）。`stockhome-postgres-prod` は migration で列追加のみ
- URL/port/health: 変更なし
- cron/timer/worker: 変更なし
- dependency: なし（`27dc6ef..6512adf` で `package.json`・`package-lock.json`・Dockerfile・compose に差分なし）
- data/DB/volume: `api_tokens` に `last_alerted_at` 列を追加。既存行は null
- log/monitoring: `http_request` の項目追加と上記の新event。1リクエストあたりの行数は変わらない（拒否時のみ `api_token_denied` が1行増える）。
  VPS側でログの項目を前提にした集計・監視があれば確認をお願いしたい
- mobile: 変更なし（通知はサーバー側で文面を作って送る。client配信は不要）
- GAS（bridge）: 変更なし

## production変更

- 必要性: あり
- 想定作業: 通常のAPI deploy（`npm run deploy -- -Commit 6512adfa38f9a68fea147dcf101ab848e5a32498`）。起動時の `prisma migrate deploy` で migration が適用される
- 適用されるmigration: `20261126180000_add_api_token_last_alerted_at`（`ALTER TABLE "api_tokens" ADD COLUMN "last_alerted_at" TIMESTAMP(3)` のみ）
- downtime: 既存と同じ（brief-restart）
- maintenance window: 不要

## 利用者への影響

- user_maintenance_impact: possible
- 対象利用者・機能: 単一世帯。反映時はAPIコンテナの短い再起動（brief-restart）があり、その間はアプリの読み込み・保存と Muse からの問い合わせが一時的に失敗する可能性がある（再試行で回復）。
  反映後、トークンでの拒否があった場合に、発行した本人の端末に通知が届く
- 通知方法: 不要

## env・secret contract

- 変更: なし
- provisioning/rotation: 不要

secret値は記載していない。検証では使い捨ての値のみを使用した。

## Data・migration・backup

- schema/format変更: `api_tokens.last_alerted_at` 追加のみ
- migration: `20261126180000_add_api_token_last_alerted_at`（nullable 列の追加。既存データの書き換えなし）
- データ書き込み: 反映時は無し。反映後、拒否の通知を送るときに `last_alerted_at` を更新する
- backup対象: 変更なし（既存の DB backup に含まれる）
- backward compatibility: API の応答・JWT・mobile・GAS とも不変

## Deploy・rollback

- deploy前提: notice 028 の反映済み（2026-11-26 verified）
- deploy手順の変更: なし
- rollback方法: `npm run deploy -- -RollbackTo 27dc6ef5ccd7e3ba66ab9117e90713d096223e21`（image rollback。notice 028 の反映image）
- image rollbackとdata rollbackの区別: image rollback のみで機能は完全に戻る（旧コードは `last_alerted_at` を参照しない。列は残るが無害）
- rollback不能条件: なし

## Health・テスト

- health contract変更: なし
- 実施テスト（Claude、2026-11-26、アプリ側PCのDocker。本番への接続なし。使い捨てのPostgreSQL 16コンテナを使用）:
  - **既存テスト＋追加テスト**: `TZ=Asia/Tokyo`、使い捨てのPostgreSQL 16 に `prisma migrate deploy` 後、`apps/api` の全テストを実行し **234件すべて成功**（実行環境はアプリ側PCの Node v24.16）。
    追加3件（`apps/api/src/routes/apiTokens.http.test.ts`。テストアプリは production と同じログ経路 `registerHttpErrorHandling` を通す）:
    - 読み取り専用トークンで書き込み → 403、本人の端末へ1回送信（文面を確認）、`last_alerted_at` 記録。続けて書き込み・`/api/users` を試しても送信は1回のまま
    - 正しい利用（検索）では送信0回。取り消したトークンの利用 → 401、本人へ1回送信
    - ログ: トークンの検索は `auth_kind=api_token`・`api_token_id`・`user_id` 付き、JWT は `auth_kind=jwt`、拒否は `api_token_denied`（`write_not_allowed`・`unknown`）。トークン値はログ全体に含まれない
    差し戻し対応で追加した10件は下記「差し戻しへの対応」
  - **テストが効いていることの確認**: commit 後に、通知の呼び出しを外した版（2件失敗）と、24時間の制限を外した版（1件失敗）でテストが失敗することを確認し、commit 済みの状態へ戻して再実行（全件成功）
  - **型チェック**: `apps/api` の `tsc --noEmit` でエラー0
  - **Docker build**（`5b7b17b` と `6512adf` をそれぞれ `git archive` で取り出した build context）: 成功
  - **コンテナ起動と結合確認**: runtime image を使い捨ての空DBに接続して起動、`GET /health` 200。テスト用アカウントのトークンで、検索 200・書き込み 403・`/api/users` 403、存在しないトークン 401。
    コンテナのログに `http_request`（`auth_kind=api_token`・`api_token_id`）、`api_token_denied`（`write_not_allowed`・`denied_route`・`unknown`）、
    `api_token_alert_sent`（`push_targeted=0`、テスト用アカウントは端末未登録のため送信先なし）を確認。発行したトークンと存在しないトークンの文字列はログに0件。DBの `last_alerted_at` 記録済み（以上 `5b7b17b`）。
    `6512adf` では、端末未登録のテスト用アカウントで読み取り専用の書き込み → `api_token_denied` と `api_token_alert_no_target`（`cause=no_active_device`、`push_targeted=0`）を確認し、
    `api_token_alert_sent` は出ないこと、続けて取り消し済みトークンの利用（401）は24時間以内のため通知ログが出ないことを確認
  - 検証用のコンテナ・ネットワーク・image・DBはすべて削除済み
- 参考: コンテナ起動時に Fastify の非推奨警告（`FSTDEP023`、`disableRequestLogging`）が出るが、`server.ts` の既存設定によるもので本変更とは無関係
- 未実施テストと理由: 実端末へのプッシュ到達（本番接続は行わない方針のため）。反映後、app owner の了承を得て、app owner のトークンで読み取り専用の書き込みを1回試し、通知の到達を確認したい

## Log・監視

- log量/形式/保存先変更: `http_request` に項目追加。拒否時に `api_token_denied` が1行増える。保存先は不変
- 新しいalert条件: アプリ内の本人通知のみ（VPS側の監視条件は変更しない）

## 提出前セルフチェック

正本: `C:\work\PRG\Sakura\Dev\vps-server-management\docs\templates\server_change_notice_pre_submission_checklist.md`

- [x] production baselineとrelease全commit・build入力差分を確認した（`27dc6ef..6512adf` の API build 入力差分は `apps/api/prisma/`（schema・migration）、
  `apps/api/src/`（logger・httpErrorHandling・auth plugin・apiTokenAlerts・テスト）。他は mobile の版表示・ops記録で artifact 外）
- [x] source commitをremoteの対象branchへpushした（通知書のcommitも引き継ぎ時にremote一致を伝える）
- [x] lockfileと全workspace manifestを含む実際のbuild contextでbuildした
- [x] Dockerfile、Compose、runtime user、OS package、起動commandの差分なし
- [x] port、bind、domain、health、認証不要endpointの差分なし
- [x] migration は nullable 列の追加のみで、image rollback だけで機能が戻ることを確認した
- [x] app owner、VPS review、production承認を分離した。client配信は不要
- [x] `deployment_status: not_started` であることを確認した
- [x] secret非混入とtracked working tree cleanを確認した（未追跡は `ops/production-db-operations/` のみで、git管理外・artifact対象外）

未確認・該当なしの理由:
- dependency: 変更なし
- `tools/review_notice_preflight.ps1`: 未実行（アプリ側PCにPowerShell 7が無いため）。VPS管理側での実行をお願いしたい

## 差し戻しへの対応（2026-11-26）

VPS管理レビュー（差し戻し）の指摘2点と対応（`6512adf`）:

1. **通知結果のログ分類**: 送る先が無い場合や全端末で受理されなかった場合も `api_token_alert_sent` を出していた。
   → 結果を `sent`（1台以上で受理）／`no_target`／`failed` に分け、それぞれ別の event と `cause` で記録する（`apps/api/src/services/apiTokenAlerts.ts`）。
   一部の端末だけ失敗した場合は `sent` とし、`push_failed` に失敗数を残す。処理の例外は `api_token_alert_failed`（`cause=exception`）
2. **取り消し済みトークン利用時の通知先**: 取り消し済みの判定は、発行者の有効性・所属の確認より前に行うため、無効化された人や家庭から外れた人
   （端末の登録が残っている場合）へ、その家庭の出来事を通知し得た。
   → 通知の直前に、発行者が有効で、トークンの家庭のメンバーであることを確かめる。満たさなければ送らず `api_token_alert_no_target`
   （`cause=owner_inactive`／`owner_not_member`）を記録し、通知済みの印も付けない。拒否の応答（401/403）は不変

回帰テスト（追加10件、全234件成功）:
- `apps/api/src/services/apiTokenAlerts.test.ts`（新規7件、`alertApiTokenDenied` を直接呼び、production と同じ logger 設定でログを集める）:
  一部失敗でも `sent`（`push_failed=1`）／端末なし → `no_target`（`no_active_device`）・送信0回／全端末で受理されない → `failed`（`push_not_accepted`、`push_failed=2`）／
  Expo への送信自体の失敗 → `failed`／24時間以内の2回目 → `throttled`（送信・ログなし）／**発行者の無効化** → 端末があっても送信0回・`owner_inactive`・印なし／
  **家庭から外れた発行者** → 端末が残っていても送信0回・`owner_not_member`。いずれも `no_target`・`failed` のとき `api_token_alert_sent` が出ないことを確認
- `apps/api/src/routes/apiTokens.http.test.ts`（追加3件、HTTP経由）: 無効化された発行者／家庭から外れた発行者の取り消し済みトークン → 401・送信0回・印なし、
  家庭から外れた発行者の有効なトークン → 403・送信0回
- テストが効いていることの確認（commit 後、`6512adf` に対して）: 発行者の確認を外した版で4件、結果の分類を外した版（常に sent）で3件が失敗することを確認し、
  commit 済みの状態へ戻して再実行（対象2ファイル21件成功）

## 未解決事項

- 通知を受けるには、トークンを発行した本人の端末でプッシュ通知が有効になっている必要がある（未登録なら `api_token_alert_no_target` のログのみ）。
  発行者が無効化・家庭から外れた後の取り消し済みトークンの利用は、誰にも通知しない（ログのみ）。管理者へ知らせる必要が出たら別途検討する
- 通知済みの印は送信前に付けるため、Expo への送信に失敗した場合は24時間再送しない（同時多発時の重複送信を防ぐため。失敗はログに残る）

## 希望時期

特に指定なし。

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- VPS管理チャットへ渡すローカル絶対path:
  `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20261126-STOCKHOME-029-summary.md`

## Approval

- app owner: 承認（2026-11-26、app ownerがVPS管理チャットへ引き継ぎ済み）
- VPS management review: 差し戻し（2026-11-26。通知結果のログ分類と、取り消し済みトークン利用時の通知先確認の2点。対象なし・全件失敗、発行者の無効化・所属解除の回帰テストを求める）
  → 対応済み（上記「差し戻しへの対応」）。
  再レビュー: 受理（accepted、2026-11-26。通知結果の分類と発行者の確認、いずれも修正済みと確認。production反映の承認ではない）
- production approval: 未
- related task_id: なし（app ownerの指示によりClaudeが直接実装）
