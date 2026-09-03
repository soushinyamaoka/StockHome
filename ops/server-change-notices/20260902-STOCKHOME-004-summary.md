# Server Change Notice

notice_id: 20260902-STOCKHOME-004

app: stockhome

source_branch: main

source_commit: 5cd6c66

impact_level: L3

status: ready_for_review

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: verified

## 変更概要

VPS管理側の第3回レビュー（`stockhome_push_notification_review_20260902.md`、
notice `blocked`、blocker B11〜B12）を受けて改訂した（第1回レビューのB01〜B06、
第2回レビューのB07〜B10は既に対応済み・解消確認済み）。

**第3回レビュー対応（B11〜B12、`task_id: 20260902-009`）**:

- B11: 新設した20:10 JSTの定期job（`push_receipt_check_and_cleanup`）が
  空の`catch {}`で例外を握りつぶすだけで、`job_start`/`job_end`/`run_id`が
  無かった点を修正。共通ログ規約に合わせ、開始時に`job_start`、完了時に同一
  `run_id`で`job_end`（成功/失敗を区別）を出す構造にした。**receiptの問い合わせ自体が
  最終的に失敗した場合（Expo応答なし・retry尽きた場合）は、例外が投げられなくても
  job失敗として`job_end.status: failure`にする**（「例外が無い＝job成功」とみなさない）
- B12: `push_tickets`の保持ポリシー説明を、`cleanupPushTickets`関数単体の挙動と、
  実運用でのjob実行順序（receipt確認が先→cleanupが後、同一job内）を区別する形へ
  訂正した。24時間を超えた`pending`はreceipt確認で`ReceiptExpired`（error）へ
  既に閉じられてから7日後に削除対象となるため、「pendingのまま7日以上残る」ことは
  実運用では起こらない

**第2回レビュー対応（B07〜B10、`task_id: 20260902-008`、解消済み）**:

- B07: 2つのmigration.sqlに明示的な`BEGIN`/`COMMIT`を追加し、途中失敗時に
  中途半端な状態を残さないようにした。使い捨てPostgreSQLで全migration履歴
  （初期化〜push_tickets）を最初から適用するrehearsalを実施し、全件成功を確認した。
  noticeの誤った「CREATE TABLEのみ自動ロールバックされる」という記述を、
  実際のPrisma migration失敗時の復旧手順に置き換えた
- B08: 送信約15分後（20:10 JST）の独立したreceipt確認scheduleを追加した。
  夜間バッチ冒頭のreceipt確認は前夜分の安全網として維持する
- B09: `push_tickets`のうち確定済み（ok/error）行を7日で削除する保持ポリシーを実装した
- B10: production baseline commitの誤り（`ade30be`は反映後のdocsのみのcommitで、
  実際にdeployされたのは`7d18a32`）を訂正し、runtime contractのfailure_mode・
  token説明の矛盾・external依存（receipt endpoint未記載）を修正した

本noticeは、前回production反映（notice `20260902-STOCKHOME-003`、実際にdeployされた
source commitは`7d18a32`（実装commit`19ff1af`と同一コード内容。`ade30be`は反映後の
実施結果を記録しただけのdocsのみのcommitであり、それ自体はdeployされていない。
VPS管理レビューB10指摘対応で訂正）、`verified`）以降の**未反映変更すべて**をまとめて対象とする
（B02指摘対応。従来はプッシュ通知のみを記載していたが、それより前の2機能改修も
未反映のままrelease差分に含まれるため、まとめて1つのproduction計画として扱う）。

1. **反映記録ログ**（`267a0e6`）: 読み取り専用API `GET /api/reflections` とモバイル画面の追加
2. **Gmail取込価格の信頼性判定**（`cb6c871`）: 検出金額を無条件に単価保存しない修正。
   候補確定APIに任意の `price` フィールドを追加
3. **スマホプッシュ通知**（`b48df2e`〜`d25f929`）: 在庫アラートが新たに発生した品目を
   Expo Push Service経由で通知する。VPS管理レビューで指摘されたB03（timeout/retry）・
   B04（receipt確認）は修正済み（task_id: 20260902-007）

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

| 項目 | 現在（production, `7d18a32`） | 変更後 |
|---|---|---|
| API | `GET /api/reflections` なし | 追加（読み取り専用、本人分のみ） |
| Gmail取込価格 | `detected_price` を無条件に単価として保存 | セット数2以上等で単価/小計を判別できない場合、自動確定を保留し `null` 保存。手動確定時に単価を入力・上書き可能 |
| `POST /api/import-candidates/:id/confirm` | `matchedItemId` のみ | 任意の `price` フィールドを追加（後方互換） |
| DBテーブル | 既存9テーブル | `push_devices`・`push_tickets` を追加 |
| APIからの外向き通信 | なし | 夜間バッチ実行時のみ `https://exp.host` へHTTPS POST（送信・receipt確認とも） |
| APIエンドポイント | 既存のまま | 認証必須の `POST/DELETE /api/push-devices` を追加 |
| 夜間バッチ | 在庫再計算 → ReadyGoキュー投入 | 冒頭でreceipt確認（前回送信分の実配信結果）→ 同左（**無変更**）→ 新規アラート抽出とプッシュ送信を後段に追加 |
| バッチのログ | `job_end` に既存集計 | `new_alerts`/`push_targeted`/`push_accepted` を追加。`push_dispatched`/`push_receipt_checked`/`push_receipt_check_failed`/`push_tickets_cleaned` イベントを新設 |
| cron時刻（daily_batch） | `55 19 * * *`（JST） | 変更なし |
| cron（新規） | なし | `10 20 * * *`（JST）でreceipt確認+ticket保持期限クリーンアップを独立実行。`job_start`/`job_end`（同一`run_id`）で成否を判別可能（B08・B09・B11対応） |
| モバイル依存 | — | `expo-notifications` を追加（APIイメージには入らない） |

## 影響対象

- service/container: `stockhome-api-prod`（次回のDocker build/deployで反映）
- URL/port/health/bind: 変更なし
- cron/timer/worker: 既存の夜間バッチ（19:55 JST）はスケジュール不変、処理内容のみ追加。
  **新規cron（20:10 JST、receipt確認+ticket保持期限クリーンアップ）を1件追加**（B08・B09対応）
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
3. **migration適用前提条件（B07対応）**: 本番適用前に、使い捨て
   （production構成を再現した使い捨て）PostgreSQLでのrehearsalを実施する。
   Claudeが2026-09-02にローカルで実施したrehearsal（下記「Health・テスト」参照）は
   全migration履歴の適用成功を確認しているが、VPS管理側でも本番同等環境での
   再現rehearsalを推奨する
4. **migration失敗時の復旧手順（B07対応、誤った「CREATE TABLEのみ自動ロールバック」
   記述を訂正）**: 本repositoryはPrisma 5.22.0を使用しており、Prisma Migrateが
   migration.sqlを既定でtransactionに包む前提にはできない。そのため各migration.sqlに
   明示的な`BEGIN`/`COMMIT`を追加した（1ファイル内は全文成功するか、何も反映されない
   かのどちらかになる）。それでも複数migrationファイルにまたがる失敗（例:
   `push_devices`は成功したが`push_tickets`が失敗）は起こり得るため、次の手順で復旧する:
   1. `prisma migrate status`で、どのmigrationが適用済み/失敗と記録されているか確認する
   2. `\d push_devices` / `\d push_tickets`等でテーブルの実在を確認する（explicit
      transactionにより、失敗したmigrationのテーブルは存在しないはず）
   3. テーブル不在を確認できたら `prisma migrate resolve --rolled-back <migration名>`
      でPrismaの記録をロールバック済みとして解決し、原因を修正のうえ再度
      `prisma migrate deploy` を実行する
   4. API自体をrollbackする場合（旧imageへ戻す）は、`push_devices`・`push_tickets`が
      どちらか/両方成功・失敗のいずれの状態でも問題ない。旧バージョンのAPIコードは
      これらのテーブルを一切参照しないため、存在しても存在しなくても無害
5. DB restoreは、dump取得後に他の理由でデータ不整合が生じた場合のみ検討する
   （本変更単体でのrestore必要性は無い）

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
  - **両ファイルとも明示的な`BEGIN`/`COMMIT`で囲み、途中失敗時に中途半端な状態を
    残さないようにした**（B07対応）
  - ローカルDBで適用済み・動作確認済み。**加えて使い捨てPostgreSQL 16
    （postgres:16-alpineコンテナ）で全migration履歴（init〜push_tickets、計5件）を
    最初から適用するrehearsalを実施し、全件成功・テーブル/索引/外部キーが設計どおり
    作成されたことを確認、実施後コンテナは削除した**（B07対応）
- 保持するデータ:
  - `push_devices`: Expo Push Token（端末識別子）、platform、有効フラグ、最終送信日時
  - `push_tickets`: Expoが発行するticket ID、状態（pending/ok/error）、Expoの
    エラーコード文字列のみ。通知本文・トークン・レスポンス全文は保存しない
  - `push_tickets`の**保持ポリシー（B09対応、B12で実行順序を明確化）**: `cleanupPushTickets`
    関数単体は、確定済み（ok/error）行を確認から7日を超えたら削除し、`pending`は
    対象にしない。ただし実際の20:10 jobはreceipt確認を先に実行するため、24時間を
    超えた`pending`はcleanup実行前に`ReceiptExpired`（error）へ既に閉じられている。
    そのため運用上「`pending`のまま7日以上残る」ことは起こらない。削除件数は
    `push_tickets_cleaned`イベントでログに記録する
- backup対象: 本notice反映時、migration実行前にPostgreSQL論理dumpを取得する（上記
  production変更セクション参照）。以降は既存のDB全体backupに含まれる
- restore確認: 本変更単体でのrestore必要性なし（上記参照）
- backward compatibility: 既存API契約・DB契約に破壊的変更なし。
  旧バージョンのモバイルアプリは端末登録・価格上書きを行わないだけで、従来どおり動作する

## Deploy・rollback

- deploy前提: 本notice作成時点ではdeployしない。production反映はVPS管理側の個別承認を
  経てから実施する
- deploy手順の変更: なし（既存の `scripts/deploy.ps1` をそのまま使う）
- **deploy対象commitは1つに固定する**（B02指摘）。B03〜B12対応
  （task_id: 20260902-007, 20260902-008, 20260902-009）を含めた本release全体
  （1・2・3すべて）の単一のdeploy対象commitとして `source_commit` を確定する
  （本notice末尾のcommit確定を参照）
- rollback方法: source archive退避と旧API image tag保全で旧バージョンへ戻せる。
  **`push_devices`・`push_tickets` テーブルは旧バージョンから参照されないため、
  テーブルを残したままAPIイメージだけを戻せる**（DBロールバック不要）。
  migration自体が部分適用状態で失敗した場合の復旧手順は上記「production変更」節の
  B07対応を参照
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

### プッシュ通知（`b48df2e`〜`d25f929`）

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
- **B07（migration transaction安全性）実施内容**:
  - 2つのmigration.sqlに明示的`BEGIN`/`COMMIT`を追加
  - 編集前の内容で既に適用済みだったローカル開発DBは、該当2テーブル（実データなし、
    検証用テストデータのみで確認後に削除済み）を削除し、Prismaの migration履歴からも
    削除したうえで、編集後の内容で再適用して整合を取り直した
  - **使い捨てPostgreSQL 16コンテナ（他の用途と分離した専用インスタンス）で、
    全migration履歴（`20260611070615_init`〜`20260902130116_add_push_tickets`の計5件）を
    真っさらな状態から`prisma migrate deploy`で適用し、全件成功を確認。`\d`で
    `push_devices`・`push_tickets`のカラム・索引・外部キーが設計どおりであることを
    直接確認した。実施後コンテナは完全に削除し残留なし**
- **B08（receipt確認の独立schedule）動的確認（ローカルDB、検証データ削除済み）**:
  - `checkPushReceipts`→`cleanupPushTickets`の一連呼び出しを直接実行し、
    Expoから`status:'ok'`が返るticketが正しく`ok`へ更新され、`checkedAt`が
    記録されることを確認
  - 確認直後（保持期限内）はcleanupで削除されない（削除件数0）ことを確認
- **B09（push_tickets保持ポリシー）動的確認（ローカルDB、検証データ削除済み）**:
  - 確定から8日経過した`ok`・`error`のticket計2件が削除され、確定から1日の`ok`ticket、
    および10日経過していても`pending`のままのticketは削除されずに残ることを確認
    （削除件数=2、期待どおり）
- **B11（job_start/job_endペアリング）動的確認（ローカルDB、簡易loggerで出力を捕捉、
  Expoへの実送信なし、検証データ削除済み）**:
  - 正常系: `job_start`と`job_end`（同一`run_id`）が出力され、`job_end.status=success`
  - **receipt確認が最終的に失敗（Expo常時503でretry尽きた）場合、個別warn
    （`push_receipt_check_failed`）は出つつ、例外は投げられないが
    `job_end.status=failure`になることを確認**（「例外が無い＝成功」とみなさない
    というB11の要件どおり）
  - `pending`が0件（何もすることがない）場合は`job_end.status=success`
    （何もしないことは失敗ではない）
  - 3パターンとも`job_start`と`job_end`の`run_id`が一致することを確認
- **B12（retention実行順序）動的確認（ローカルDB、検証データ削除済み）**:
  - 30時間前に作成した`pending`ticketをExpo応答に含めずに`runPushReceiptMaintenance`を
    実行したところ、receipt確認の段階で`status: error`・`errorCode: ReceiptExpired`へ
    正しく閉じられ、同じjob内のcleanupでは（`checkedAt`が実行直後のため7日未満）
    まだ削除されずに残ることを確認。実行順序どおりの挙動であることを確認済み
- 上記すべての検証後、既存データ（購入履歴29件・候補56件）が無傷であることを確認済み
- 未実施テストと理由:
  - production containerでの実機確認は次回のproduction反映時にVPS管理側が実施
  - 実端末での通知受信確認は、APKビルド完了後に実施
  - 実際のcron時刻（20:10 JST）到来を待った動作確認は未実施。関数を直接呼び出す形で
    ロジックを検証済みだが、node-cronのスケジューリング自体（時刻起動）は
    既存の`daily_batch`と同じ仕組みを流用しており、個別の起動タイミング確認は
    production反映後の運用で確認する

## Log・監視

- log量/形式/保存先変更: 保存先・形式（1行1JSON）とも変更なし
- 新規event: `push_dispatched`（Expoが受理したことのみを示す。実配信完了は意味しない）、
  `push_receipt_checked`、`push_receipt_check_failed`、`push_send_failed`、
  `push_device_registered`、`push_tickets_cleaned`（B09対応、削除件数・保持日数を記録）
- 既存eventへの追加: `job_end`（daily_batch）に `new_alerts`/`push_targeted`/`push_accepted` を追加。
  **`job_start`/`job_end`（既存の共通イベント名を再利用、`job: push_receipt_check_and_cleanup`）を
  20:10 jobにも追加し、`daily_batch`と同じ規約で成功/失敗/異常終了/未実行を区別できるようにした**
  （B11対応）
- 新しいalert条件: `push_send_failed`・`push_receipt_check_failed` が連日継続する場合は、
  egress遮断・FCM credential不備・Expo側障害の可能性がある
  （在庫計算・LINE通知は継続するため緊急度は低い）
- secret/個人情報対策: Expo Push Token・通知本文・Expoのレスポンス全文はログに出さない。
  記録するのは件数・HTTPステータス・`safeErr`（name/codeのみ）・Expoのエラーコード文字列に限定

## 未解決事項

- **VPS管理側第4回レビューは2026-09-03に完了し、B01〜B12解消として`accepted`判定済み**。
  ただしproduction計画、利用者への事前通知・不使用確認、計画を特定した個別承認は未実施
- **Android実機での通知受信確認**: FCM認証情報の設定・内部配布APKビルドは完了
  （commit `38ae8b2`、APK配布URL: 別途チャットで案内済み）。実機で通知許可ダイアログの
  表示までは確認できたが、APKがproduction API（migration未反映）を参照するため、
  実際のトークン登録・通知配信の確認はproduction反映後に行う（production反映とは
  独立した作業として既に完了）
- iOS（Expo Go 運用）はリモートプッシュ非対応のため対象外。利用者了承済み
- `node-cron`/`uuid`（moderate）、`xlsx`（high）の残存dependency auditは
  `OPS-P1-08` の別途判断事項のまま（本変更の対象外）

## 希望時期

未定（VPS管理側の再レビュー、ネットワーク面の継続確認後に調整）

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: 実施済み（本タスク応答）
- VPS管理チャットへ渡すローカル絶対path:
  `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260902-STOCKHOME-004-summary.md`

## Approval

- app owner: 2026-09-02、ユーザー本人がrelease全体（反映記録ログ・Gmail取込価格の
  信頼性判定・スマホプッシュ通知）の変更範囲、DBスキーマ追加、外部送信data（品目名・
  残日数・残数がExpo/Google FCMのサーバーを経由すること）を確認のうえ承認（B06対応）
- VPS management review: 2026-09-02第1回実施・blocked（B01〜B06）→対応完了。
  同日第2回実施・blocked（B07〜B10）→対応完了。同日第3回実施・blocked（B11〜B12）
  →本notice改訂で対応完了。2026-09-03第4回実施・accepted（production承認とは別）
- production approval: 2026-09-03、妻への通知・不使用確認後、ユーザーがVPS task
  `20260903-001`を本計画で即時反映することを個別承認
- related task_id: 20260902-006, 20260902-007, 20260902-008, 20260902-009,
  20260903-001

## Production実施結果

- production task: `20260903-001`
- production反映: 2026-09-03、source commit `5cd6c66`を反映済み
- 即時確認: API/DB running・restart count 0、internal/public health 200、未認証bridge 401、
  loopback bind `127.0.0.1:4002`、既存DB volume維持、起動ログ全行JSON
- 初回定期job確認: 2026-09-03
  - 19:55 `daily_batch`: run_id `20260903-195500`、status `success`、149 ms、
    counted_updated 0、recalculated 25、processed 11、alerts/new_alerts 0、
    push_targeted/push_accepted 0
  - 20:10 `push_receipt_check_and_cleanup`: run_id `20260903-201000`、status `success`、
    9 ms、checked/ok/errored/deactivated/cleaned 0
- ログ検査: job_start/job_endは各jobで同一run_id、非JSON 0、failure/critical相当0、
  機微情報を示す禁止pattern 0
- rollback: 未実施。反映前source、DB dump、旧API image tagはVPS側で保全済み
- 追加VPS変更・手動job実行: なし
