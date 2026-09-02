# Server Change Notice

notice_id: 20260902-STOCKHOME-004

app: stockhome

source_branch: main

source_commit: 未確定（B03・B04対応中。実装完了・commit後に確定する）

impact_level: L3

status: ready_for_review

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 変更概要

VPS管理側の再レビュー（`stockhome_push_notification_review_20260902.md`、
notice `blocked`、blocker B01〜B06）を受けて全面改訂した。

本noticeは、前回production反映（notice `20260902-STOCKHOME-003`、
source_commit `ade30be`、`verified`）以降の**未反映変更すべて**をまとめて対象とする
（B02指摘対応。従来はプッシュ通知のみを記載していたが、それより前の2機能改修も
未反映のままrelease差分に含まれるため、まとめて1つのproduction計画として扱う）。

1. **反映記録ログ**（`267a0e6`）: 読み取り専用API `GET /api/reflections` とモバイル画面の追加
2. **Gmail取込価格の信頼性判定**（`cb6c871`）: 検出金額を無条件に単価保存しない修正。
   候補確定APIに任意の `price` フィールドを追加
3. **スマホプッシュ通知**（`b48df2e` 以降、対応中）: 在庫アラートが新たに発生した品目を
   Expo Push Service経由で通知する。B03（timeout/retry未実装）・B04（receipt未確認）の
   修正を実装中（task_id: 20260902-007）

配信経路は Expo Push Service（`https://exp.host`）。夜間バッチ（19:55 JST）が
在庫再計算の直後に、前回 `alert_needed=false` から今回 `true` へ変わった品目だけを
抽出して送信する。既存の ReadyGo 経由 LINE 通知（21:00）は変更せず併存する。

**本APIから外部への通信が発生するのは本変更が初めて**であり、
`ops/runtime-contract.yaml` の `dependencies.external` を `[]` から更新済み。

## 変更理由

1・2: 利用者からの要望（反映内容の可視化、価格データの信頼性向上）。
3: 利用者からの要望。既存のLINE通知は21:00の集約配信のみで、在庫が新たに
切れそうになったことにその場で気づけないため。

## server_impact判定

server_impact: approval_required

判定理由（B01対応でL2からL3へ訂正）:
1. **DBスキーマ追加が2件**（`push_devices`・`push_tickets` テーブル）。
   production はコンテナ起動時の `prisma migrate deploy` で自動適用される
2. **APIコンテナからの新規の外向き通信先**（`https://exp.host`）が増える。
   従来「本APIは外部HTTPを一切呼び出さない」という前提が変わる
3. schema/dataに関わる変更を含むため、管理ポリシー上はL2ではなく**L3**と判定する
   （VPS管理レビューB01指摘）

port・bind・URL・health・env変数名・secret種類・cron時刻・deploy手順・
GASブリッジ契約・ログ形式（1行1JSON）は不変。1・2の変更はAPI契約の追加的拡張のみで
既存エンドポイントの破壊的変更はない。

## 現在と変更後

| 項目 | 現在（production, `ade30be`） | 変更後 |
|---|---|---|
| API | `GET /api/reflections` なし | 追加（読み取り専用、本人分のみ） |
| Gmail取込価格 | `detected_price` を無条件に単価として保存 | セット数2以上等で単価/小計を判別できない場合、自動確定を保留し `null` 保存。手動確定時に単価を入力・上書き可能 |
| `POST /api/import-candidates/:id/confirm` | `matchedItemId` のみ | 任意の `price` フィールドを追加（後方互換） |
| DBテーブル | 既存9テーブル | `push_devices`・`push_tickets` を追加 |
| APIからの外向き通信 | なし | 夜間バッチ実行時のみ `https://exp.host` へHTTPS POST（送信・receipt確認とも） |
| APIエンドポイント | 既存のまま | 認証必須の `POST/DELETE /api/push-devices` を追加 |
| 夜間バッチ | 在庫再計算 → ReadyGoキュー投入 | 冒頭でreceipt確認（前回送信分の実配信結果）→ 同左（**無変更**）→ 新規アラート抽出とプッシュ送信を後段に追加 |
| バッチのログ | `job_end` に既存集計 | `new_alerts`/`push_targeted`/`push_accepted` を追加。`push_dispatched`/`push_receipt_checked`/`push_receipt_check_failed` イベントを新設 |
| cron時刻 | `55 19 * * *`（JST） | 変更なし |
| モバイル依存 | — | `expo-notifications` を追加（APIイメージには入らない） |

## 影響対象

- service/container: `stockhome-api-prod`（次回のDocker build/deployで反映）
- URL/port/health/bind: 変更なし
- cron/timer/worker: 夜間バッチの処理内容のみ追加。**スケジュールは不変**
- dependency: **外部依存を新規追加**（Expo Push Service）。サーバー側npm依存の追加はなし
  （Node 20 のグローバル `fetch` と `AbortSignal.timeout` を使用。`expo-server-sdk` は導入しない）
- data/DB/volume: `push_devices`・`push_tickets` テーブルを追加。
  **既存テーブル・既存データ・volume は変更しない**
- log/monitoring: `push_dispatched`/`push_receipt_checked`/`push_receipt_check_failed` を追加。
  `job_end` に3項目追加
- API契約: `GET /api/reflections`（新規）、`POST/DELETE /api/push-devices`（新規）、
  `POST /api/import-candidates/:id/confirm` に任意 `price` フィールド追加（既存クライアントは
  未指定のまま呼べるため後方互換）

## production変更

- 必要性: あり（migration適用×2 + Docker build・container入れ替え）
- 想定作業: `scripts/deploy.ps1`（`npm run deploy`）によるcontainer rebuild・入れ替え。
  コンテナ起動時に `prisma migrate deploy` が `push_devices`・`push_tickets` を作成する
- downtime: brief-restart（apiコンテナのみ再起動。postgresコンテナ・DBデータは変更しない）
- maintenance window: 未定（VPS管理側の承認後に確定）

**B01対応: schema変更を伴うためのbackup計画**

1. migration実行**前**に、production PostgreSQLの論理dump（`pg_dump`）を取得する
2. dump完了後、サイズ・gzip整合・SHA-256を確認し、保全先（
   `/home/deploy/stockhome/backups/deploy-<task_id>/db-before.sql.gz` 想定）に保存する
3. `push_devices`・`push_tickets` は**新規テーブル追加のみ**（既存テーブルへの
   `ALTER`・データの `UPDATE`/`DELETE` を含まない）ため、migration自体の失敗時は
   `prisma migrate deploy` が該当tableの`CREATE TABLE`のみロールバックされ、
   既存テーブルへの影響はない
4. API rollback時（旧imageへ戻す場合）、`push_devices`・`push_tickets` は**残したまま**
   でよいと判断する。旧バージョンのAPIコードはこれらのテーブルを参照しないため、
   存在しても無害。DB restoreは、dump取得後に他の理由でデータ不整合が生じた場合のみ
   検討する（本変更単体でのrestore必要性は無い）

**ネットワーク面**: VPS管理側の事前確認（2026-09-02実施）で、稼働中の
`stockhome-api-prod` containerから `exp.host:443` へのDNS解決・TLS 1.3 handshake・
証明書検証が成功しており、network設定変更は不要と判定済み。これは一時点の到達確認であり、
継続的な可用性を保証しない。

`production_change: required` のため、`deployment_status: not_started` のまま
VPS管理側へ引き継ぐ。

## 利用者への影響

- user_maintenance_impact: possible
- 対象利用者・機能: 家庭内利用者が使用するStockHome mobileのAPI機能。
  container入れ替え中の短時間にAPI requestが失敗する可能性がある
- 機能面:
  - 反映記録ログ・価格信頼性判定は、既存の候補確認フローに手動確認の手間が
    一部増える（セット数2以上等で検出価格が信頼できない場合）。それ以外の既存機能は不変
  - プッシュ通知は端末登録が済んだ利用者にのみ追加で届く。**Android実機での受信には
    FCM認証情報の設定（完了済み、commit `38ae8b2`）と内部配布APKの再ビルドが別途必要**
    （production反映とは独立した作業。本notice作成時点でAPKビルド実施中）
- iOS: Expo Go 運用のためプッシュ非対応。利用者了承済み（2026-09-02）
- 通知するdata: 通知本文に品目名・残日数・残数を含む（Expo/Google FCMのサーバーを経由する）。
  利用者はこの内容で通知することを了承済み（2026-09-02、enhanced push securityは
  使用しない前提）
- 通知方法: 実施時刻と想定停止時間を含むproduction計画をVPS管理側で作成する際に判断する

## env・secret contract

- 変更: なし
- 変数名・secret種類: 追加・削除・意味変更なし
- Expo Push Service の呼び出しに**APIキー・secretは使用しない**。Expo Push Token は
  端末が発行する送信先識別子で、secretではないが**漏えい時に第三者が任意の通知を
  送信し得る機微情報**として扱う（B05指摘）。DBに保存するがログには出さない
- provisioning/rotation: 不要

secret値は記載しない。

## Data・migration・backup

- schema変更: **あり**。`push_devices`・`push_tickets` テーブルを新規作成
- migration:
  - `apps/api/prisma/migrations/20260902073443_add_push_devices/`
  - `apps/api/prisma/migrations/20260902130116_add_push_tickets/`
  - いずれも `CREATE TABLE` + 索引 + 外部キー（`ON DELETE CASCADE`）のみ
  - **既存テーブルへの `ALTER`・データの `UPDATE`/`DELETE` を一切含まない**
  - ローカルDBで適用済み・動作確認済み
- 保持するデータ:
  - `push_devices`: Expo Push Token（端末識別子）、platform、有効フラグ、最終送信日時
  - `push_tickets`: Expoが発行するticket ID、状態（pending/ok/error）、Expoの
    エラーコード文字列のみ。通知本文・トークン・レスポンス全文は保存しない
- backup対象: 本notice反映時、migration実行前にPostgreSQL論理dumpを取得する（上記
  production変更セクション参照）。以降は既存のDB全体backupに含まれる
- restore確認: 本変更単体でのrestore必要性なし（上記参照）
- backward compatibility: 既存API契約・DB契約に破壊的変更なし。
  旧バージョンのモバイルアプリは端末登録・価格上書きを行わないだけで、従来どおり動作する

## Deploy・rollback

- deploy前提: 本notice作成時点ではdeployしない。production反映はVPS管理側の個別承認を
  経てから実施する
- deploy手順の変更: なし（既存の `scripts/deploy.ps1` をそのまま使う）
- **deploy対象commitは1つに固定する**（B02指摘）。B03・B04対応（task_id: 20260902-007）の
  実装・動的検証・commitが完了した時点のHEADを、本release全体（1・2・3すべて）の
  単一のdeploy対象commitとし、本noticeの `source_commit` を確定させる
- rollback方法: source archive退避と旧API image tag保全で旧バージョンへ戻せる。
  **`push_devices`・`push_tickets` テーブルは旧バージョンから参照されないため、
  テーブルを残したままAPIイメージだけを戻せる**（DBロールバック不要）
- rollback不能条件: なし

## Health・テスト

- health contract変更: なし

### 反映記録ログ（`267a0e6`）

- 静的: shared/api/mobile ビルド成功、`console.*` 0件、`server.ts` 差分が2行の追加のみ
- 動的（ローカルDB、3ユーザー/2世帯/購入履歴29件で検証、検証データ削除済み）:
  全29件が本来の持ち主に表示、他ユーザー・他世帯への漏れ0件、未認証401、
  `limit`不正値のクランプ動作確認

### Gmail取込価格の信頼性判定（`cb6c871`）

- 静的: 上記と同様に成功。`bridgeCandidateSchema`（GASブリッジ契約）は無変更を確認
- 動的（ローカルDB、検証データ削除済み）: セット数1は従来どおり自動確定+価格保存、
  セット数2は自動確定を保留、価格なしは自動確定、数量不審は既存ガードで保留、
  手動上書きは指定値を保存することを確認

### プッシュ通知（`b48df2e` 以降、B03・B04対応中）

- 静的: shared/api/mobile ビルド成功、`console.*` 0件、`package-lock.json` に
  `expo`/`react`/`react-native` 本体のversion変更なし
- 動的（ローカルDB、検証データ削除済み、Expoへの実送信なし）:
  - 端末登録API: 登録201、DB一致、同一トークン再登録での冪等性、不正値400、未認証401
  - 新規アラート検知: 前回true→新規0件・送信0回／前回false→新規11件・送信1回／
    直後の再実行→新規0件・送信0回（連日通知され続けないことを確認）
  - 障害時: Expoが500を返してもバッチは`success`で完走
  - 機微情報: 全ログでトークン混入0件
- **B03（timeout/retry）・B04（receipt確認）実装後の動的確認（ローカルDB、
  Expoへの実送信なし、検証データ削除済み・既存データ29件/56件が無傷であることを確認）:**
  - retry: 5xxが2回続いた後に成功 → 3回目で復帰・`accepted`計上（リクエスト回数3で一致）
  - retry対象外: 400（要求誤り）は即座に諦め、**retryしない**（リクエスト回数1）
  - 総上限: 常に503が続く場合、**最大3回試行**で打ち切り、`failed`計上して継続
    （実測1524ms。500ms→1000msの指数backoffの理論値と一致し、実際にAbortSignal.timeout
    とbackoffが機能していることを確認）
  - receipt確認: `status:'ok'`のticketはokへ、`DeviceNotRegistered`のticketはerrorへ
    更新のうえ**該当端末を`is_active=false`に無効化**、応答に含まれない未確定ticketは
    `pending`のまま次回へ持ち越し、の3パターンをすべて確認
  - 保持期間切れ: 作成から24時間超過した`pending`ticketが`ReceiptExpired`として
    自動的に閉じられることを確認
  - batch統合: receipt確認をExpo全断でも例外にせず`runDailyBatch`が正常完走することを確認
- 未実施テストと理由:
  - production containerでの実機確認は次回のproduction反映時にVPS管理側が実施
  - 実端末での通知受信確認は、APKビルド完了後に実施

## Log・監視

- log量/形式/保存先変更: 保存先・形式（1行1JSON）とも変更なし
- 新規event: `push_dispatched`（Expoが受理したことのみを示す。実配信完了は意味しない）、
  `push_receipt_checked`、`push_receipt_check_failed`、`push_send_failed`、
  `push_device_registered`
- 既存eventへの追加: `job_end`（daily_batch）に `new_alerts`/`push_targeted`/`push_accepted` を追加
- 新しいalert条件: `push_send_failed`・`push_receipt_check_failed` が連日継続する場合は、
  egress遮断・FCM credential不備・Expo側障害の可能性がある
  （在庫計算・LINE通知は継続するため緊急度は低い）
- secret/個人情報対策: Expo Push Token・通知本文・Expoのレスポンス全文はログに出さない。
  記録するのは件数・HTTPステータス・`safeErr`（name/codeのみ）・Expoのエラーコード文字列に限定

## 未解決事項

- **task_id 20260902-007（B03: timeout/retry、B04: receipt確認）が完了するまで、
  本noticeは `source_commit` 未確定のまま**。完了後にVPS管理側へ再レビューを依頼する
- **Android実機での通知受信確認**: FCM認証情報の設定は完了（commit `38ae8b2`）。
  内部配布APK（`android-internal`プロファイル）のビルドを実施中。production反映とは
  独立した作業
- iOS（Expo Go 運用）はリモートプッシュ非対応のため対象外。利用者了承済み
- `node-cron`/`uuid`（moderate）、`xlsx`（high）の残存dependency auditは
  `OPS-P1-08` の別途判断事項のまま（本変更の対象外）

## 希望時期

未定（B03・B04完了、VPS管理側の再レビュー、ネットワーク面の継続確認後に調整）

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: 実施済み（本タスク応答）
- VPS管理チャットへ渡すローカル絶対path:
  `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260902-STOCKHOME-004-summary.md`

## Approval

- app owner: 未承認（B01〜B05対応後、release全体の変更範囲と外部送信dataを含めて
  ユーザー本人の確認を得る。B06対応）
- VPS management review: 2026-09-02実施、blocked（B01〜B06）。本notice改訂により再レビュー待ち
- production approval: 未承認
- related task_id: 20260902-006, 20260902-007
