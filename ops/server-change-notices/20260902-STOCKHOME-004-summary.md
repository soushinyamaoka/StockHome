# Server Change Notice

notice_id: 20260902-STOCKHOME-004

app: stockhome

source_branch: main

source_commit: 未確定（未commit）

impact_level: L2

status: ready_for_review

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 変更概要

在庫が「そろそろ切れそう」な品目が**新たに**発生したとき、スマートフォンへ
プッシュ通知を送る機能を追加した。既存の ReadyGo 経由 LINE 通知（21:00）は
変更せず、そのまま併存する。

配信経路は Expo Push Service（`https://exp.host`）。夜間バッチ（19:55 JST）が
在庫再計算の直後に、前回 `alert_needed=false` から今回 `true` へ変わった品目だけを
抽出して送信する。

**本APIから外部への通信が発生するのは本変更が初めて**であり、
`ops/runtime-contract.yaml` の `dependencies.external` を `[]` から更新した。

## 変更理由

利用者からの要望。既存の LINE 通知は 21:00 の集約配信のみで、在庫が新たに
切れそうになったことにその場で気づけないため。

## server_impact判定

server_impact: approval_required

判定理由:
1. **DBスキーマ追加**（`push_devices` テーブル）。production はコンテナ起動時の
   `prisma migrate deploy` で自動適用される。
2. **APIコンテナからの新規の外向き通信先**（`https://exp.host`）が増える。
   従来「本APIは外部HTTPを一切呼び出さない」と runtime-contract に記録していた前提が変わる。

port・bind・URL・health・env変数名・secret種類・cron時刻・deploy手順・
GASブリッジ契約・ログ形式（1行1JSON）は不変。

## 現在と変更後

| 項目 | 現在 | 変更後 |
|---|---|---|
| DBテーブル | 既存9テーブル | `push_devices` を追加（migration `20260902073443_add_push_devices`） |
| APIからの外向き通信 | なし | 夜間バッチ実行時のみ `https://exp.host/--/api/v2/push/send` へ HTTPS POST |
| APIエンドポイント | 既存のまま | 認証必須の `POST /api/push-devices`・`DELETE /api/push-devices` を追加 |
| 夜間バッチ | 在庫再計算 → ReadyGoキュー投入 | 同左（**無変更**）＋新規アラート抽出とプッシュ送信を後段に追加 |
| バッチのログ | `job_end` に既存集計 | `new_alerts` / `push_targeted` / `push_accepted` を追加。`push_sent` / `push_send_failed` イベントを新設 |
| cron時刻 | `55 19 * * *`（JST） | 変更なし |
| モバイル依存 | — | `expo-notifications` を追加（APIイメージには入らない） |

## 影響対象

- service/container: `stockhome-api-prod`（次回のDocker build/deployで反映）
- URL/port/health/bind: 変更なし
- cron/timer/worker: 夜間バッチの処理内容のみ追加。**スケジュールは不変**
- dependency: **外部依存を新規追加**（Expo Push Service）。サーバー側npm依存の追加はなし
  （Node 20 のグローバル `fetch` を使用し、`expo-server-sdk` は導入していない）
- data/DB/volume: `push_devices` テーブルを追加。**既存テーブル・既存データ・volume は変更しない**
- log/monitoring: `push_sent` / `push_send_failed` を追加。`job_end` に3項目追加

## production変更

- 必要性: あり（migration適用 + Docker build・container入れ替え）
- 想定作業: `scripts/deploy.ps1`（`npm run deploy`）によるcontainer rebuild・入れ替え。
  コンテナ起動時に `prisma migrate deploy` が `push_devices` を作成する
- downtime: brief-restart（apiコンテナのみ再起動。postgresコンテナ・DBデータは変更しない）
- maintenance window: 未定（VPS管理側の承認後に確定）

**ネットワーク面の確認依頼**: APIコンテナから `https://exp.host`（443/tcp）への
アウトバウンド接続が必要です。VPS のegress制限・ファイアウォール設定で
遮断されていないかご確認ください。遮断されている場合、プッシュは送信されませんが
`push_send_failed` をログに残して**バッチは正常終了**します（在庫計算・LINE通知への
影響はありません）。

`production_change: required` のため、`deployment_status: not_started` のまま
VPS管理側へ引き継ぐ。

## 利用者への影響

- user_maintenance_impact: possible
- 対象利用者・機能: 家庭内利用者が使用するStockHome mobileのAPI機能。
  container入れ替え中の短時間にAPI requestが失敗する可能性がある
- 機能面: 既存機能の動作は変わらない。プッシュ通知は端末登録が済んだ利用者にのみ
  追加で届く。**Android実機での受信にはFCM認証情報の設定と内部配布APKの再ビルドが
  別途必要**（本notice時点で未実施。production反映とは独立した作業）
- iOS: Expo Go 運用のためプッシュ非対応。利用者了承済み（2026-09-02）
- 通知方法: 実施時刻と想定停止時間を含むproduction計画をVPS管理側で作成する際に判断する

## env・secret contract

- 変更: なし
- 変数名・secret種類: 追加・削除・意味変更なし
- Expo Push Service の呼び出しに**APIキー・secretは使用しない**（Expo Push Token は
  端末が発行する送信先識別子であり、DBに保存してリクエスト本文に載せる）
- provisioning/rotation: 不要

secret値は記載しない。

## Data・migration・backup

- schema変更: **あり**。`push_devices` テーブルを新規作成
- migration: `apps/api/prisma/migrations/20260902073443_add_push_devices/`
  - 内容は `CREATE TABLE` + 索引3件（`expo_push_token` の一意索引を含む）+
    外部キー2件（`households` / `users` へ `ON DELETE CASCADE`）のみ
  - **既存テーブルへの `ALTER`・データの `UPDATE`/`DELETE` を一切含まない**
  - ローカルDBで適用済み・動作確認済み
- 保持するデータ: Expo Push Token（端末識別子）、platform、有効フラグ、最終送信日時。
  通知本文や在庫データは保存しない
- backup対象: 変更なし（既存のDB全体backupに含まれる）
- restore確認: 対象外
- backward compatibility: 既存API契約・DB契約に破壊的変更なし。
  旧バージョンのモバイルアプリは端末登録を行わないだけで、従来どおり動作する

## Deploy・rollback

- deploy前提: 本notice作成時点ではdeployしない。production反映はVPS管理側の個別承認を
  経てから実施する
- deploy手順の変更: なし（既存の `scripts/deploy.ps1` をそのまま使う）
- rollback方法: 既存notice（`20260902-STOCKHOME-003` 等）と同様に、
  source archive退避と旧API image tag保全で旧バージョンへ戻せる。
  **`push_devices` テーブルは旧バージョンから参照されないため、テーブルを残したまま
  APIイメージだけを戻せる**（DBロールバック不要）
- rollback不能条件: なし

## Health・テスト

- health contract変更: なし
- 実施テスト（Codex・静的）: shared/api build、mobile TypeScript `--noEmit`、
  `apps/api/src` の `console.*` 0件、`server.ts` の差分がimport 1行+register 1行のみ、
  `package-lock.json` に `expo`/`react`/`react-native` 本体のversion変更が無いこと
  （追加27 package・削除0・既存version変更0）
- 実施テスト（Claude・ローカルDBで動的確認、検証データは全件削除済み）:
  - 端末登録API: 登録201、DBのuser/household一致、**同一トークン再登録で行が増えない
    （冪等性）**、不正トークン形式400、不正platform 400、未認証401
  - 新規アラート検知: 事前に全snapshot `alert_needed=true` → 新規0件・送信0回。
    事前に全て `false` → 新規11件・送信1回。**直後に再実行すると新規0件・送信0回**
    （同じ品目で連日通知され続けないことを確認）
  - 送信内容: 宛先が登録トークンと一致、title「そろそろ切れそう（11件）」、
    body に品目名と残日数
  - 障害時: Expo が HTTP 500 を返しても `push_send_failed` をwarnで記録し、
    **バッチは `status: success` で完走**（在庫計算・ReadyGoキュー投入に影響なし）
  - 機微情報: 全ログ出力を検索し、**Expo Push Token の混入0件**を確認
  - 既存データ: 購入履歴29件・候補56件が無傷であることを確認
  - **Expo Push API への実送信は行っていない**（fetchを差し替えて遮断）
- 未実施テストと理由:
  - production containerでの実機確認は次回のproduction反映時にVPS管理側が実施
  - 実端末での通知受信確認は、FCM認証情報の設定と内部配布APKビルドの完了後に実施

## Log・監視

- log量/形式/保存先変更: 保存先・形式（1行1JSON）とも変更なし。
  夜間バッチ1回につき、送信先の世帯数ぶんの `push_sent` が増える（現状は1世帯=1行）
- 新規event: `push_sent`、`push_send_failed`、`push_device_registered`
- 既存eventへの追加: `job_end`（daily_batch）に `new_alerts` / `push_targeted` /
  `push_accepted` を追加
- 新しいalert条件: `push_send_failed` が連日継続する場合は、egress遮断または
  Expo側障害の可能性がある（在庫計算・LINE通知は継続するため緊急度は低い）
- secret/個人情報対策: Expo Push Token・Expoのレスポンス本文はログに出さない。
  記録するのは件数・HTTPステータス・`safeErr`（name/codeのみ）に限定。
  ローカル動的確認でトークン混入0件を確認済み

## 未解決事項

- **Android実機での通知受信には FCM（Firebase Cloud Messaging）V1 認証情報の設定と、
  内部配布APK（`android-internal` プロファイル）の再ビルドが必要**。
  Firebaseコンソールでの作業を利用者が実施中。production反映とは独立した作業のため、
  本noticeの承認・反映はFCM設定の完了を待たない
- iOS（Expo Go 運用）はリモートプッシュ非対応のため対象外。利用者了承済み
- `node-cron` / `uuid`（moderate）、`xlsx`（high）の残存dependency auditは
  `OPS-P1-08` の別途判断事項のまま（本変更の対象外）

## 希望時期

未定（VPS管理レビューとネットワーク面の確認後に調整）

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: 実施済み（本タスク応答）
- VPS管理チャットへ渡すローカル絶対path:
  `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260902-STOCKHOME-004-summary.md`

## Approval

- app owner: 未承認（ユーザー本人の確認待ち）
- VPS management review: 未実施
- production approval: 未承認
- related task_id: 20260902-006
