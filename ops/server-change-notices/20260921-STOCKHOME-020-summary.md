# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20260921-STOCKHOME-020

app: stockhome

source_branch: main

source_commit: cdf2481461d80620687ad08e4196fac1e3cc1668

production_baseline_commit: ec6e541b8bf88654baa68c3dd3b1c2fcbdb9d6ad

release_commits:（baseline以降。notice 019以降の分のみ再掲。それ以前の全commit列は
notice 010〜019の提出内容を参照）

- `ec6e541`（baseline。notice `20260918-STOCKHOME-009`でproduction反映・`verified`済み）
- （中略。notice 010〜019までの全commitはnotice `20260920-STOCKHOME-014`
  以降のrelease_commits参照。notice 010〜019は2026-09-21にVPS管理accepted済み、
  production未反映）
- `b86cc59`（所見B-6初回対応。`GET /api/push-devices`（自分の登録端末一覧）・
  `POST /api/push-devices/test`（指定した1台へテスト通知）を追加、
  `sendTestPushToDevice`を`pushNotify.ts`へ追加（既存`sendPushToUser`とは
  別関数）、設定画面へ「プッシュ通知」セクション（端末一覧・テスト送信
  ボタン）を追加。task `20260921-007`、Codexが実装。**第1回提出分。第1回
  VPS管理レビューでサーバー側のrate limit不足を指摘されblocked**）
- `cdf2481`（**本notice対象・最終source。S020-B01対応**。`PushDevice`へ
  `lastTestSentAt`列を追加（`lastPushAt`とは別。実配信の頻度に影響しない
  ため）。`sendTestPushToDevice`へ、cooldown判定＋枠確保を1つの原子的な
  `updateMany`で行う処理を追加（TOCTOU無し。household当たりpending最大1件
  を保証したS014-B06の並行claim対応と同じ考え方）。`POST
  /api/push-devices/test`はcooldown中に429＋`Retry-After`ヘッダを返す。
  mobile設定画面は429時に「少し待ってください」の案内を表示。task
  `20260921-008`、Codexが実装）

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
追加済み）で流用しない。新規追加は以下4点:
- `GET /api/push-devices`（自分の登録端末一覧）
- `POST /api/push-devices/test`（指定した1台へテスト通知を送信。cooldown中は
  429＋`Retry-After`）
- 設定画面「プッシュ通知」セクション（一覧表示＋テスト送信ボタン。429時は
  「少し待ってください」の案内）
- `PushDevice.lastTestSentAt`列（**schema変更あり**。テスト送信のcooldown判定
  専用。第2回VPS管理レビューS020-B01対応で追加。詳細は下記
  「VPS管理レビュー結果への対応」参照）

**当初の見送りリストにはB-1（買い足し累積）・B-2（消費ペース実績提案）も含まれて
いたが、調査の結果この2件は既にnotice `20260904-STOCKHOME-005`他で実装・
production反映済みであることが判明したため対象外とした（2026-09-21、ユーザーへ
報告済み）。着手するのはB-6のみ。**

## 変更理由

2026-09-03の全体点検所見への対応（機能提案、優先度「中」）。詳細は
`stockhome-review-findings-20260903.md`（点検報告書）を参照。

## VPS管理レビュー結果への対応（第2回：blocked→再提出）

第1回VPS管理レビューで、本人端末だけに送信する認可境界とテスト184件は確認
できたが、テスト通知POSTにサーバー側の回数制限が無いと指摘されblockedと
なった。

> テスト通知POSTにサーバー側の回数制限がありません。user/device単位の
> cooldownをExpo送信前に適用し、429＋Retry-After、通常・制限超過・時間経過後・
> 並行実行のテストを追加してください。mobile側も429時は「しばらく待って
> 再試行」と案内してください。

対応（S020-B01）: `PushDevice`へ`lastTestSentAt`列を新規追加し（migration
`20260921140105_push_device_test_cooldown`）、テスト送信専用のcooldown判定に
使う（実配信`sendPushToUser`の`lastPushAt`とは独立させ、実アラート配信が
テストのcooldownへ影響しないようにした）。cooldown判定は「まずSELECTで
判定してからUPDATEする」方式ではなく、判定条件をWHERE句に含めた単一の
`updateMany`で「判定と枠の確保」を原子的に行う設計にした（2つの並行
リクエストがどちらも判定をすり抜けて二重送信するTOCTOUを避けるため。
S014-B06の並行claim対応と同じ考え方）。cooldown中は`POST
/api/push-devices/test`が429と`Retry-After`ヘッダ（秒数）を返す。mobile
設定画面は429を検知すると「少し待ってください／テスト通知の送信間隔が
短すぎます。しばらく待ってから再試行してください。」を表示する。

Claudeが実DBで、通常（1回目は成功）・制限超過（直後の2回目はExpoへ到達
せずrate_limited）・時間経過後（cooldownウィンドウより古いタイムスタンプを
直接設定し、実際に待たずに検証。再送できることを確認）・並行実行
（`Promise.all`で同時に2回呼び、成功が必ず1件・rate_limitedが必ず1件、
Expoへの到達も1回だけであることを確認。5回連続実行して毎回安定して成功する
ことも確認）の4シナリオを検証した。

## server_impact判定

server_impact: notify

判定理由: 新規APIエンドポイント2件を追加し、設定画面のUIが変わる。
**`PushDevice`へ`lastTestSentAt`列を追加するschema変更を伴う**
（migration `20260921140105_push_device_test_cooldown`）。
port/bind/domain/health endpoint/起動command/volume/cron schedule/既存API
contract（既存エンドポイントの破壊的変更）は変更していない（新規追加のみで
既存エンドポイントは無変更）。実Expo Push APIへの新規送信経路が増える
（既存の`sendPushToUser`と同じExpo Push API・同じ外部依存）。

## 現在と変更後

| 項目 | 現在 | 変更後 |
|---|---|---|
| 端末一覧の確認手段 | 無し（DBを直接見るしかない） | `GET /api/push-devices`で自分の登録端末（機種・有効/無効・最終送信日時）を取得できる |
| 通知疎通の確認手段 | 無し（実際にアラートが出るまで分からない） | `POST /api/push-devices/test`で任意のタイミングにテスト通知を送信し、Expo API側の成否（`DeviceNotRegistered`等）を即座に確認できる |
| 設定画面 | プッシュ通知に関する表示なし | 「プッシュ通知」セクションを新設。端末一覧とテスト送信ボタンを表示 |
| テスト送信の連打防止 | 無し（サーバー側に回数制限なし） | 端末単位で30秒のcooldownを原子的な`updateMany`で保証。cooldown中は429＋`Retry-After`、mobile側は「少し待ってください」の案内を表示（S020-B01対応） |

## 影響対象

- service/container: `stockhome-api-prod`（`apps/api/src/routes/pushDevices.ts`・
  `apps/api/src/services/pushNotify.ts`・`apps/api/src/utils/serialize.ts`の変更。
  route追加のみ、既存route・既存関数は無変更）
- URL/port/health: 変更なし
- cron/timer/worker: 変更なし（夜間バッチ・push receipt確認jobには触れない）
- dependency: 変更なし（新規パッケージ追加なし）
- data/DB/volume: **schema変更あり**。`push_devices`へ`last_test_sent_at`列
  （nullable DateTime）を追加する（migration
  `20260921140105_push_device_test_cooldown`）。既存列（`lastPushAt`含む）の
  型・意味は変更なし
- log/monitoring: 既存の`push_send_failed`イベントを流用（新規イベント追加なし）

## production変更

- 必要性: あり
- 想定作業: 通常のAPI deployで反映される。deploy時に`prisma migrate deploy`で
  migration `20260921140105_push_device_test_cooldown`（`last_test_sent_at`
  列追加）が適用される。
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

- schema/format変更: **あり**。`push_devices`へ`last_test_sent_at`列
  （nullable DateTime、既定値なし）を追加する。既存列（`last_push_at`含む）の
  削除・型変更は無い
- migration: `20260921140105_push_device_test_cooldown`（`ALTER TABLE ADD
  COLUMN`のみ）。Claudeがローカル開発DBで生成・適用し、`prisma migrate
  deploy`が成功すること、既存データに影響しないこと（新規列はnullableで
  既存行はすべてNULLのまま）を確認済み
- backup対象: なし（テスト送信で作られる`push_tickets`行は、既存の
  `checkPushReceipts`/`cleanupPushTickets`と同じ保持期間ポリシーに従う。
  新規ポリシー追加は不要。`last_test_sent_at`もcooldown判定用の一時的な値で
  あり、業務データではない）
- restore確認: 該当なし
- backward compatibility: 既存の`POST /api/push-devices`・`DELETE
  /api/push-devices`は無変更。新規列はnullableのため、旧imageへのrollback時も
  既存の読み書きに影響しない

## Deploy・rollback

- deploy前提: API側は`prisma migrate deploy`でmigration
  `20260921140105_push_device_test_cooldown`（`last_test_sent_at`列追加）が
  正常に適用されること
- deploy手順の変更: なし（通常のAPI deployのみ。GAS側の変更は無い）
- rollback方法: 旧image tagへの切り替え（従来手順、またはnotice 010のrollback機構）
- rollback不能条件: 特になし。テスト送信で記録された`push_tickets`行・
  更新された`last_push_at`・`last_test_sent_at`はrollback後もDBに残るが、
  既存のticket保持期間ポリシーの対象内、または単なるcooldown判定用の値で
  あり実害はない。migration自体（`last_test_sent_at`列追加）はAPI imageの
  rollbackだけでは戻らない（通常のimage rollback手順にschema rollbackは
  含まない）。新規列が残存しても実害は無く、DB restoreを要する事態ではない

## Health・テスト

- health contract変更: なし
- 実施テスト:

  **(A) Codex実施分（第1回、task `20260921-007`）**
  - `npm run build --workspace=@stockhome/shared` / `--workspace=@stockhome/api`: passed
  - `npx tsc --noEmit -p apps/mobile/tsconfig.json`: passed
  - 新規test 2fileはDB必須のためCodexは実行せず、Claudeが実行

  **(A') Codex実施分（第2回再対応S020-B01、task `20260921-008`）**
  - `npm run build --workspace=@stockhome/shared` / `--workspace=@stockhome/api`
    （内部で`prisma generate`）: passed
  - `npx tsc --noEmit -p apps/mobile/tsconfig.json`: passed
  - 新規test 4fileの追加分もDB必須のためCodexは実行せず、Claudeが実行

  **(B) 実DBテスト（ローカルPostgres、Claude実施）**
  - migration検証: `prisma migrate diff`で差分SQLを生成（`ALTER TABLE ADD
    COLUMN`のみ）、ローカル開発DBへ適用し成功を確認
  - `npx tsx --test --test-concurrency=1
    apps/api/src/services/pushNotify.testSend.test.ts
    apps/api/src/routes/pushDevices.http.test.ts`: **13件すべて成功**
    （`sendTestPushToDevice`単体8件: 成功時のlastPushAt更新・ticket記録、
    存在しないtoken・他世帯端末はnull、DeviceNotRegistered時の無効化、
    Expo API失敗時のsend_failed、無効化済み端末への成功送信での復帰の
    既存5件＋cooldown新規3件（制限超過・時間経過後・並行実行）／
    HTTPレベル5件: 自分の端末だけを一覧取得、自分の端末へのテスト送信、
    他世帯の端末への404、同世帯でも他ユーザーの端末への404の既存4件＋
    cooldown中の2回目が429＋Retry-Afterを返す新規1件）
  - 並行実行テスト（`Promise.all`で同時に2回呼ぶ）は5回連続実行し、毎回
    安定して「成功1件・rate_limited 1件・Expo到達1回」を確認済み
  - `npm test --workspace=@stockhome/api`: **188件すべて成功**（既存184件＋
    新規4件。リグレッションなし）

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
  `ec6e541`から`cdf2481`までのcommitを実際の時系列順で確認。上記
  release_commits参照）
- [x] source commitとnoticeをremoteの対象branchへpushした（`cdf2481`はpush済み、
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

- テスト通知の連打に対するサーバー側cooldown（30秒）はS020-B01対応で解消済み。
  cooldown値（30秒）はClaudeの提案値であり、VPS管理側・app ownerからの指定値
  ではない。運用開始後に長すぎる／短すぎると判断された場合は調整が必要。
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
- related task_id: 20260921-007（初回実装）、20260921-008（S020-B01対応、
  cooldown/rate limit追加）
