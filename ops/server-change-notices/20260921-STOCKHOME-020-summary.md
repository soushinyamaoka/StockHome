# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20260921-STOCKHOME-020

app: stockhome

source_branch: main

source_commit: b86cc59379dce6a3d584d2ba3b98360c6a0cf719

production_baseline_commit: ec6e541b8bf88654baa68c3dd3b1c2fcbdb9d6ad

release_commits:（baseline以降。notice 019以降の分のみ再掲。それ以前の全commit列は
notice 010〜019の提出内容を参照）

- `ec6e541`（baseline。notice `20260918-STOCKHOME-009`でproduction反映・`verified`済み）
- （中略。notice 010〜019までの全commitはnotice `20260920-STOCKHOME-014`
  以降のrelease_commits参照。notice 010〜019は2026-09-21にVPS管理accepted済み、
  production未反映）
- `b86cc59`（**本notice対象・最終source**。所見B-6対応。`GET
  /api/push-devices`（自分の登録端末一覧）・`POST /api/push-devices/test`
  （指定した1台へテスト通知）を追加、`sendTestPushToDevice`を
  `pushNotify.ts`へ追加（既存`sendPushToUser`とは別関数）、設定画面へ
  「プッシュ通知」セクション（端末一覧・テスト送信ボタン）を追加。schema
  変更・migrationなし。task `20260921-007`、Codexが実装）

**本noticeが対象とするのは所見B-6への対応（プッシュ通知の疎通確認機能の新設）。
notice 010〜019は別変更のため分離したままとする。**

impact_level: L2

status: ready_for_review

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 変更概要

2026-09-03の全体点検所見B-6（「プッシュ通知の疎通を確かめる手段がない」）への対応
（task `20260921-007`、Codexが実装）。

現状、プッシュ通知は「前回false→今回trueの新規アラート」でしか飛ばないため、
届かないときに端末側の問題なのかトークン失効なのか切り分けられない。設定画面に
「この端末に通知を送ってみる」ボタンと、登録済み端末の一覧（機種・有効/無効・
最終送信日時）を追加する。

`PushDevice`モデルの`lastPushAt`列は既存（notice `20260902-STOCKHOME-004`で
追加済み）で、schema変更・migrationは不要。新規追加は以下3点のみ:
- `GET /api/push-devices`（自分の登録端末一覧）
- `POST /api/push-devices/test`（指定した1台へテスト通知を送信）
- 設定画面「プッシュ通知」セクション（一覧表示＋テスト送信ボタン）

**当初の見送りリストにはB-1（買い足し累積）・B-2（消費ペース実績提案）も含まれて
いたが、調査の結果この2件は既にnotice `20260904-STOCKHOME-005`他で実装・
production反映済みであることが判明したため対象外とした（2026-09-21、ユーザーへ
報告済み）。着手するのはB-6のみ。**

## 変更理由

2026-09-03の全体点検所見への対応（機能提案、優先度「中」）。詳細は
`stockhome-review-findings-20260903.md`（点検報告書）を参照。

## server_impact判定

server_impact: notify

判定理由: 新規APIエンドポイント2件を追加し、設定画面のUIが変わる。
port/bind/domain/health endpoint/起動command/DB schema/migration/volume/cron
schedule/既存API contract（既存エンドポイントの破壊的変更）は変更していない
（新規追加のみで既存エンドポイントは無変更）。実Expo Push APIへの新規送信
経路が増える（既存の`sendPushToUser`と同じExpo Push API・同じ外部依存）。

## 現在と変更後

| 項目 | 現在 | 変更後 |
|---|---|---|
| 端末一覧の確認手段 | 無し（DBを直接見るしかない） | `GET /api/push-devices`で自分の登録端末（機種・有効/無効・最終送信日時）を取得できる |
| 通知疎通の確認手段 | 無し（実際にアラートが出るまで分からない） | `POST /api/push-devices/test`で任意のタイミングにテスト通知を送信し、Expo API側の成否（`DeviceNotRegistered`等）を即座に確認できる |
| 設定画面 | プッシュ通知に関する表示なし | 「プッシュ通知」セクションを新設。端末一覧とテスト送信ボタンを表示 |

## 影響対象

- service/container: `stockhome-api-prod`（`apps/api/src/routes/pushDevices.ts`・
  `apps/api/src/services/pushNotify.ts`・`apps/api/src/utils/serialize.ts`の変更。
  route追加のみ、既存route・既存関数は無変更）
- URL/port/health: 変更なし
- cron/timer/worker: 変更なし（夜間バッチ・push receipt確認jobには触れない）
- dependency: 変更なし（新規パッケージ追加なし）
- data/DB/volume: 変更なし（`lastPushAt`列は既存、schema変更なし）
- log/monitoring: 既存の`push_send_failed`イベントを流用（新規イベント追加なし）

## production変更

- 必要性: あり
- 想定作業: 通常のAPI deployで反映される。migrationは発生しない（schema変更なし）。
- downtime: 既存と同じ（brief-restart）
- maintenance window: 不要
- mobile側: 設定画面の変更を含むため、次回EAS Update配信が必要
  （`ops/client-releases/`で別途管理。VPS管理側のproduction承認対象外）

## 利用者への影響

- user_maintenance_impact: possible
- 対象利用者・機能: 全利用者。設定画面に新しいセクションが増える（既存の操作フローは
  変更なし）。「この端末に通知を送ってみる」を押すと実際にプッシュ通知が1通届く
  （利用者が意図的に押した場合のみ）。
- 通知方法: 不要

## env・secret contract

- 変更: なし
- 変数名・secret種類のみ: 該当なし
- provisioning/rotation: 不要

secret値は記載していない。

## Data・migration・backup

- schema/format変更: なし（`push_devices.last_push_at`列は既存）
- migration: なし
- backup対象: なし（テスト送信で作られる`push_tickets`行は、既存の
  `checkPushReceipts`/`cleanupPushTickets`と同じ保持期間ポリシーに従う。
  新規ポリシー追加は不要）
- restore確認: 該当なし
- backward compatibility: 既存の`POST /api/push-devices`・`DELETE
  /api/push-devices`は無変更。新規追加のみ

## Deploy・rollback

- deploy前提: なし（migration不要）
- deploy手順の変更: なし（通常のAPI deployのみ。GAS側の変更は無い）
- rollback方法: 旧image tagへの切り替え（従来手順、またはnotice 010のrollback機構）
- rollback不能条件: 特になし。テスト送信で記録された`push_tickets`行・
  更新された`last_push_at`はrollback後もDBに残るが、既存のticket保持期間
  ポリシーの対象内であり実害はない

## Health・テスト

- health contract変更: なし
- 実施テスト:

  **(A) Codex実施分（task `20260921-007`）**
  - `npm run build --workspace=@stockhome/shared` / `--workspace=@stockhome/api`: passed
  - `npx tsc --noEmit -p apps/mobile/tsconfig.json`: passed
  - 新規test 2fileはDB必須のためCodexは実行せず、Claudeが実行

  **(B) 実DBテスト（ローカルPostgres、Claude実施）**
  - `npx tsx --test --test-concurrency=1
    apps/api/src/services/pushNotify.testSend.test.ts
    apps/api/src/routes/pushDevices.http.test.ts`: **9件すべて成功**
    （`sendTestPushToDevice`単体5件: 成功時のlastPushAt更新・ticket記録、
    存在しないtoken・他世帯端末はnull、DeviceNotRegistered時の無効化、
    Expo API失敗時のsend_failed、無効化済み端末への成功送信での復帰／
    HTTPレベル4件: 自分の端末だけを一覧取得、自分の端末へのテスト送信、
    他世帯の端末への404、同世帯でも他ユーザーの端末への404）
  - `npm test --workspace=@stockhome/api`: **184件すべて成功**（既存175件＋
    新規9件。リグレッションなし）

- 結果: すべて成功
- 未実施テストと理由: production VPS上での実Expo Push API疎通確認は未実施
  （production環境への接続はVPS管理側の個別承認後に限られるため）。deploy後に
  実際に「この端末に通知を送ってみる」を押して届くことを確認いただくのが実機確認になる。

## Log・監視

- log量/形式/保存先変更: なし（既存の`push_send_failed`イベントを、テスト送信時にも
  そのまま使う。新規イベント追加なし）
- 新しいalert条件: なし
- secret/個人情報対策: 変更なし（Expo Push Tokenはログへ出力しない。既存の
  `sendPushToUser`と同じ扱い）

## 提出前セルフチェック

正本: `C:\work\PRG\Sakura\Dev\vps-server-management\docs\templates\server_change_notice_pre_submission_checklist.md`

- [x] production baselineとrelease全commit・build入力差分を確認した（baseline
  `ec6e541`から`b86cc59`までのcommitを実際の時系列順で確認。上記
  release_commits参照）
- [x] source commitとnoticeをremoteの対象branchへpushした（`b86cc59`はpush済み、
  local/origin一致確認済み。本noticeの確定分はこれからcommit・pushする）
- [x] data更新のtransaction・同時実行・途中失敗を確認した（テスト送信は1端末に
  対する単発の`update`のみで、他のデータへの副作用は無い。失敗時もticket記録の
  失敗が送信結果を左右しない設計にした）
- [x] image rollbackとdata rollback、backup/restore条件を分けた（上記
  「Deploy・rollback」参照）
- [x] job/log/retention、runtime/dependency、client配信の該当有無を確認した
  （job: 変更なし。log: 既存イベント流用。retention: 既存ticket保持ポリシーの範囲内。
  runtime/dependency: 変更なし。client配信: mobile側UI変更のためEAS Update配信が必要）
- [ ] app owner、VPS review、production承認、client配信承認を分離した —
  いずれも未実施。下記Approval参照
- [x] secret非混入とtracked working tree cleanを確認した（`git status
  --short`で確認。既知の無関係な未追跡ファイルのみ残存）

## 未解決事項

- テスト通知の連打（誤タップ連続等）に対するrate limit・cooldownは実装していない
  （client側でボタンを`loading`中は無効化するのみ）。Expo Push API自体のrate
  limitに委ねる設計。低頻度な個人利用アプリのため実害は無いと判断しているが、
  運用開始後に問題があれば追加を検討する。
- 端末一覧に`isActive: false`（無効化済み）の端末も表示する設計にした
  （診断目的。「かつて登録されていたが今は届かない端末」も見えたほうが
  トラブルシューティングに有用と判断）。削除UIは今回追加していない
  （必要になれば別途対応）。

## 希望時期

特に指定なし。notice 010〜019と同じ計画にまとめてproduction反映する想定
（VPS管理側の方針次第）。

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: これから実施
- VPS管理チャットへ渡すローカル絶対path:
  `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260921-STOCKHOME-020-summary.md`

## Approval

- app owner: 未実施
- VPS management review: 未実施
- production approval: 未実施
- related task_id: 20260921-007
