# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20260915-STOCKHOME-007

app: stockhome

source_branch: main

source_commit: 038e173199ad8daee3ed3fd268673c8642976eb7

production_baseline_commit: 117e41d3c12153f9594f0d8bc8cd78098ba9b4bf

release_commits: `117e41d`（baseline）→ `52c5a7c`/`d909c9f`/`f14b97f`/`b0007b4`（notice
`20260907-STOCKHOME-006`の事後記録4件。`ops/**`のみで build input に影響しない）→
`40c7947`（task `20260915-001`、本notice当初対象の通知先修正。**build inputに影響**）→
`1122158`/`5f36e55`/`cb7e194`（本notice自体の作成・改訂3件。`ops/**`のみ）→
`4105725`（task `20260915-002`、notice `20260915-STOCKHOME-008`対象の取り消し・復元機能追加。
**build inputに影響**）→ `c4954ee`/`d7a1f7d`（notice `008`の作成・改訂2件。`ops/**`のみ）→
`5699b30`（task `20260915-003`、S007-B01修正。householdId+userIdでプッシュ端末query・
通知集約・`lastPushAt`更新を絞る。**build inputに影響**）→ `038e173`（task `20260915-004`、
S008-B02〜B04修正。取り消し・復元処理のtransaction統合とHTTP認可テスト追加。
**build inputに影響**）。

**S008-B01対応（VPS管理レビュー §3、両notice共通）**: notice `20260915-STOCKHOME-008`の
source（`4105725`、S007-B01未解消のためVPS管理側から一旦deploy対象外とされていた）に
S007-B01・S008-B02〜B04の修正を重ねた結果、**本notice `007` と notice `008` は
同一の最終source commit `038e173` を共有する**。両noticeを分けてdeployすることはなく、
`038e173`から作る1つのAPI artifactとしてreview・承認・deployする（VPS管理側が受理済みの
結合リリース方針、`stockhome_undo_actions_review_20260915.md` §1参照）。

impact_level: L2

status: accepted

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 変更概要

2026-09-03の全体点検所見A-4（優先度「高」）の修正。品目ごとの通知先設定
`notify_target_type`（`all` / `representative` / `specific_user`）を、夜間バッチ
（`daily_batch`、19:55 JST）が正しく尊重するようにした。

- 修正前: バッチの品目抽出条件が `notifyTargetType: 'all'` 固定だったため、
  「代表者のみ」「特定ユーザー」を選んだ品目は LINE 通知・プッシュ通知のどちらにも
  一切載らなかった（ホーム画面の表示だけは3種を正しく解釈しており、画面と通知の
  挙動が食い違っていた）。
- 修正後: LINE（ReadyGoOutbox、21:00の世帯一括配信）は引き続き `all` の品目のみを
  対象にする（世帯全員が読む一括配信のため、個人宛て化はしない）。プッシュ通知は
  `push_devices.user_id` を使い、`all` → 世帯の有効メンバー全員 / `representative` →
  有効な `role=admin` のみ / `specific_user` → 指定ユーザーのみ（該当ユーザーが
  世帯の有効メンバーでない場合は送信先なし）へ個人単位で送信する。いずれも
  `User.isActive=false` のユーザーは除外する。

新規APIエンドポイント・DBスキーマ変更・env変数変更は無い。`apps/api` 内5ファイルの
変更のみで、`apps/mobile` / `packages/shared` / `apps/gas` に差分は無い（品目フォーム・
ホーム画面は既に3種へ対応済みのため変更不要）。

設計はClaude、実装はCodex（ai-watch経由、アプリ側task `20260915-001`）が行い、Claudeが
コードレビューと純粋関数テストの実行確認を行った。

**S007-B01対応（VPS管理レビュー、2026-09-15、task `20260915-003`）**: 初版の
`sendPushToUser`は`userId`だけで端末検索・通知集約を行っており、schema上は同一ユーザーが
複数household（`household_members`は多対多）に所属できるにもかかわらず、その場合に
他householdの品目名が1通の通知本文へ混ざる、または他householdの端末へ送信されうる欠陥を
VPS管理側が指摘した。`sendPushToUser`の端末検索・`lastPushAt`更新を`householdId + userId`で
絞り、夜間バッチの新規アラート集約も`(household, user)`単位へ変更した（`apps/api/src/services/pushNotify.ts`・
`apps/api/src/services/batch.ts`）。詳細は下記「現在と変更後」表・「Health・テスト」参照。

## 変更理由

ユーザーから、2026-09-03の全体点検所見のうち「通知先『代表者のみ／特定ユーザー』を
選んでも全員に飛ぶ」（所見A-4）を含む4件への対応を依頼された（2026-09-15）。
本noticeはそのうち本件1件分。

## server_impact判定

server_impact: notify

判定理由: DBスキーマ変更・migration・新規env var・新規外部依存・新規cron・
port/bind/URL変更・認証境界の変更はいずれも無い。品目・在庫・購入履歴等の業務データを
書き換える処理も無い。一方、通知対象が増えることで、既存のプッシュ送信処理による
`push_tickets`の追加、`push_devices.last_push_at`の更新、Expo応答に応じた無効端末の
`is_active=false`更新が従来より広い通知対象で発生し得る。(a) 夜間バッチの通知ログ（`job_end`・
`batch_step`）のフィールド意味が変わる、(b) 利用者から見える通知の届き方が変わる
（従来通知が一切届かなかった設定の品目に、プッシュ通知が届くようになる）ため、
`none`とはせず`notify`と判定する。データ破壊性・認証境界変更を伴う
`approval_required`相当の変更ではないと判断した。

## 現在と変更後

| 項目 | 現在 | 変更後 |
|---|---|---|
| 夜間バッチの品目抽出条件 | `notifyTargetType: 'all'` 固定 | 通知ON・有効品目すべて（3種とも対象に含める） |
| LINE（ReadyGoOutbox）に載る品目 | `all` のみ（抽出条件で `all` 以外が事前に除外されていたため、結果的に `all` のみ） | `all` のみ（`isBroadcastTarget` で明示的に絞る。**利用者から見た挙動は変化なし**） |
| プッシュ通知の宛先 | 世帯の有効端末全件（`sendPushToHousehold`、`householdId` 単位） | `notify_target_type` に応じて個人単位（`sendPushToUser`、`userId` 単位）。`all`→世帯の有効メンバー全員、`representative`→有効なadminのみ、`specific_user`→指定ユーザーのみ（世帯の有効メンバーでなければ送信先なし）。無効化ユーザー（`User.isActive=false`）は常に除外 |
| `representative`/`specific_user` の品目の通知 | 一切届かない（LINEもプッシュも対象外） | プッシュのみ届く。新規アラート（前回false→今回true）の日に1回だけ（既存の「新規アラートのみプッシュ」方針は変更していないため、LINEのような毎晩のリマインドにはならない） |
| `job_end`/`batch_step(alert_evaluation)`の`processed` | 通知先`all`の品目数のみ | 通知ON・有効な全品目数（3種とも含む）に意味が変わる |
| `job_end`/`batch_step(alert_evaluation)`の`alerts` | `all`のアラート品目数のみ | 全`notify_target_type`のアラート品目数に意味が変わる |
| `job_end`/`batch_step(alert_evaluation)`の`line_alerts`（新規） | 存在しない | LINE本文へ実際に載せた件数（`all`のアラート品目数）。旧`alerts`と同じ算出根拠 |
| `READYGO_QUEUED.alerts` | LINEキューに積んだ件数（`targets.length`、当時から実質`all`限定） | 同じ意味（LINEキューに積んだ件数）。算出元が`result.lineAlerts`に変わっただけで値の意味は不変 |
| `PUSH_DISPATCHED`ログ | 夜間バッチ1回あたり世帯単位で最大1行 | 夜間バッチ1回あたりユーザー単位で複数行になりうる。既存フィールド（`items`/`targeted`/`accepted`/`failed`/`deactivated`）は不変、`user_id`等の個人識別子は追加していない |
| `pushNotify.ts`の関数 | `sendPushToHousehold(householdId, ...)` | `sendPushToUser(householdId, userId, ...)`（旧関数は削除。呼び出し元は`batch.ts`の1箇所のみだったため未使用のまま残していない） |
| プッシュ端末検索・`lastPushAt`更新（S007-B01対応） | `sendPushToUser(userId, ...)`が`userId`のみで絞る | `sendPushToUser(householdId, userId, ...)`へ変更。`findActiveDevicesForHouseholdUser`・`markDevicesPushed`が`householdId + userId + isActive`で絞る |
| 新規アラートの集約単位（S007-B01対応） | `userId`のみ（同一userが複数household所属だと本文が混ざりうる） | `groupNewAlertsByHouseholdUser`で`(householdId, userId)`単位に変更。household境界をまたいで1通に混ざらない |

## 影響対象

- service/container: `stockhome-api-prod`（通常のAPI container再ビルド・入れ替えのみ）
- URL/port/health/bind: 変更なし
- cron/timer/worker: 変更なし。`daily_batch`のスケジュール（19:55 JST、node-cron）・
  `job_start`/`job_end`（同一`run_id`）のペア構造は不変。フィールド追加のみ
- dependency: 追加・削除なし
- data/DB/volume: スキーマ変更なし。品目・在庫・購入履歴等の業務データの書込みは変更なし。
  `householdMember`・`user.isActive`を新たに参照し、通知対象が増えた場合は既存の通知運用
  メタデータ（`push_tickets`、`push_devices.last_push_at`、無効端末の`is_active`）が更新される
- log/monitoring: 上記「現在と変更後」表のとおり。`processed`/`alerts`の意味変化、
  `line_alerts`新規フィールド、`PUSH_DISPATCHED`のユーザー単位分割

## production変更

- 必要性: あり（コンテナ再ビルド・入れ替えのみ。migration不要）
- 想定作業: 既存の`scripts/deploy.ps1`（`npm run deploy`）による通常のcontainer rebuild・入れ替え
- downtime: brief-restart（apiコンテナのみ再起動。postgresコンテナ・DBデータは変更しない）
- maintenance window: 未定。VPS管理側レビュー後に判断

`production_change: required`のため、`deployment_status: not_started`のままVPS管理側へ引き継ぐ。

## 利用者への影響

- user_maintenance_impact: possible
- 対象利用者・機能: 品目の通知先設定で「代表者のみ」「特定ユーザー」を選んでいる利用者
  （2026-09-15時点でこの設定を使っている品目があるかは未確認。0件でも将来この設定を
  使う利用者すべてに影響する）
- 機能面: デプロイ後、これらの品目でアラートが新規発生した日に、対象ユーザー（代表者
  または指定ユーザー）の端末へプッシュ通知が1回届くようになる（従来は無音のままだった）。
  LINE（21:00の一括配信）には引き続き載らない。API/DBの再起動以外に、利用者の操作が
  必要になる変更ではない
- 通知方法: 機能修正であり、利用者（家族）への事前告知は本noticeでは必須としない。
  必要性の判断はVPS管理側・app ownerに委ねる

## env・secret contract

- 変更: なし
- 変数名・secret種類: 追加・削除・意味変更なし
- provisioning/rotation: 不要

secret値は記載しない。

## Data・migration・backup

- schema/format変更: なし
- migration: なし
- backup対象: 通常のdeploy時運用を超える追加backupは不要。業務データの書込みは変わらず、
  追加で発生し得るのは既存の通知運用メタデータ更新のみ
- restore確認: 追加restore試験は不要。誤送信済みの通知は取り消せず、送信済みticket・
  `last_push_at`・無効端末判定もimage rollbackでは巻き戻らないため、deploy後検証で誤振分けを
  検出した場合は送信停止を優先し、必要なメタデータ補正は別承認で扱う
- backward compatibility: 旧API imageへ戻しても、DBスキーマ・データ内容とも一切変更されて
  いないため完全に元の挙動へ戻る

## Deploy・rollback

- deploy前提: 本notice `ready_for_review`後、VPS管理側レビュー・production承認
- deploy手順の変更: なし（既存の`scripts/deploy.ps1`をそのまま使う）
- rollback方法: 旧API imageへ戻すことで、以後の通知先判定を旧挙動へ戻す。既に送信した
  通知は取り消せず、送信に伴って記録された`push_tickets`・`last_push_at`・無効端末判定は
  image rollbackでは巻き戻らない。これらの補正が必要な場合は別のDB変更承認で扱う
- rollback不能条件: 送信済み通知の取り消しは不可。したがって初回19:55実行の前に対象件数を
  read-onlyで確認し、初回実行後は通知先別集計・失敗数を速やかに検証する

## Health・テスト

- health contract変更: なし
- 実施テスト:
  - `npm run build --workspace=@stockhome/shared`: 成功（Codexが実施）
  - `npm run build --workspace=@stockhome/api`: 成功（新規`notifyTarget.test.ts`を含む
    `src/**/*`の型検査も含めて成功。Codexが実施）
  - `npx tsc --noEmit -p apps/mobile/tsconfig.json`: 成功（mobile側に差分が無いことの
    型レベルでの確認。Codexが実施）
  - `notifyTarget.test.ts`（`isNotifyTargetForUser`・`resolveNotifyTargetUserIds`の
    分岐を検証する純粋関数テスト、DBに触れない）6件: 全件成功。Claudeが対話セッションで
    ローカル実行し直接確認した（`npx tsx --test src/services/notifyTarget.test.ts`、
    2026-09-15）
  - 差分の自己点検（Codexが実施、resultに記載）: `batch.ts`に`notifyTargetType: 'all'`を
    含む`where`句が残っていないこと、`sendPushToHousehold`がリポジトリ全体から
    消えていること、`apps/mobile`/`packages/shared`/`apps/gas`/`ops/`/`prisma/`に
    差分が無いことをそれぞれ`grep`・`git diff --stat`で確認済み
- **S007-B01対応の追加テスト（2026-09-15、task `20260915-003`）**:
  - `batch.groupTargets.test.ts`（`groupNewAlertsByHouseholdUser`のDB非依存純粋関数テスト）
    3件: 同一userが2household所属時に本文が混ざらないこと、同一household内の複数ユーザーへの
    正しい分配、対象0人の品目がどのグループにも現れないことを確認。Codexが自環境で実行し
    全件成功、Claudeが対話セッションで再実行し同じ結果（3件成功）を確認した（2026-09-15）
  - `pushNotify.householdScope.test.ts`（`findActiveDevicesForHouseholdUser`・
    `markDevicesPushed`のDB依存テスト）3件: 同一userIdが2household所属時に端末検索・
    `lastPushAt`更新がそれぞれのhouseholdへ正しく限定されること、無効端末が除外されることを
    確認。Claudeが対話セッションでローカル開発用Postgres（`localhost:5434`）に対して実行し
    全件成功を確認した（2026-09-15）
  - 結果: 上記6件すべて成功（失敗0件）
- 未実施テストと理由: 既存のDB依存テスト（`stockCalc.accumulation.test.ts`・
  `priceReparse.test.ts`）は本変更の対象ファイルではなく差分も無いため、本task経由では
  実行していない（ai-watch経由のCodex実行ではDB操作が禁止のため元々対象外）。
  実際のExpo Push送信・LINE配信の実機/実環境確認はローカル開発環境では行っていない
  （外部サービス（Expo Push API・ReadyGo）への実接続を要するため）。production反映後、
  19:55の`daily_batch`初回実行時にログ（`line_alerts`・`push_targeted`・`push_accepted`等）を
  確認することを推奨する

## Log・監視

- log量/形式/保存先変更: 上記「現在と変更後」表のとおり。既存の`event`値
  （`job_start`/`job_end`/`batch_step`/`push_dispatched`等）は削除・改名していない。
  既存フィールドも削除・改名せず、`line_alerts`を追加したのみ。`daily_batch`の
  `job_start`/`job_end`（同一`run_id`）による成功/失敗/異常終了/未実行の判別方法
  （`ops/runtime-contract.yaml`記載の`success_signal`）自体は変更していない
- 新しいalert条件: なし（常設の監視alertを新設する変更ではない）
- secret/個人情報対策: 変更なし。`user_id`・email等の個人識別子をログへ新たに
  出力する変更は行っていない（`PUSH_DISPATCHED`はユーザー単位で複数行に分かれる
  ようになったが、行の中身自体に個人識別子は含まれない）

## 提出前セルフチェック

正本: `C:\work\PRG\Sakura\Dev\vps-server-management\docs\templates\server_change_notice_pre_submission_checklist.md`

- [x] production baselineとrelease全commit・build入力差分を確認した（`production_deployments.yaml`の
      `117e41d`を基準に、baseline以降の全5commitをbuild input該当有無で区別した。上記
      `release_commits`参照）
- [x] source commitとnoticeをremoteの対象branchへpushした（`40c7947`・`5699b30`・
      `038e173`はいずれもCodexが`git push origin main`済み・確認済み。本notice文書の
      改訂commitはこの後に作成する）
- [x] data更新のtransaction・同時実行・途中失敗・再実行を確認した（該当なし。本変更は
      既存データへの書き込み内容・意味を一切変更しないため、この観点のリスクは無い）
- [x] image rollbackとdata rollback、backup/restore条件を分けた（上記「Deploy・rollback」
      参照。データ書き込みが無いためimage rollbackのみで完結する）
- [x] job/log/retention、runtime/dependency、client配信の該当有無を確認した
      （job/logは該当あり・上記に詳述。runtime/dependency/client配信は該当なし）
- [x] app owner、VPS review、production承認、client配信承認を分離した（app owner承認済み、
      VPS reviewは2026-09-15に`accepted`。production承認は未実施。client配信は非該当）
- [x] secret非混入とtracked working tree cleanを確認した（`git status`で未追跡fileは
      本notice作成前から存在する無関係な2件（`ops/investigations/OPS-P1-08-npm-audit-findings.md`、
      `ops/production-db-operations/`）のみで、本commitには含まれていないことを確認した）

未確認・該当なしの理由: production承認はVPS management reviewとは分離し、結合releaseの
実施計画提示後に得るため未実施。client配信はnotice 007単独では非該当。

## 未解決事項

- 監視側が`job_end.processed`/`job_end.alerts`の絶対値を閾値監視（急な増減の検知等）に
  使っている場合、本変更で意味が変わる（`processed`は通知先絞り込み品目も含むようになり、
  `alerts`も同様に増加しうる）ため、該当の有無をVPS管理側で確認していただきたい。
  該当する場合は閾値の見直しが必要になる可能性がある
- 2026-09-15時点で実際に「代表者のみ」「特定ユーザー」を設定している品目が何件あるかは
  未確認（production DBを確認していない）。0件であれば本変更のproduction反映直後の
  利用者影響は実質的に無い

## 希望時期

指定なし。VPS管理側レビューの結果を踏まえて判断する。

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: 本notice作成後にチャットで案内する
- VPS管理チャットへ渡すローカル絶対path:
  `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260915-STOCKHOME-007-summary.md`

## Approval

- app owner: **2026-09-15、ユーザー（app owner）がS007-B04記載の4点を明示承認**
  （VPS管理レビュー正本
  `C:\work\PRG\Sakura\Dev\vps-server-management\docs\operations\stockhome_notification_target_review_20260915.md`
  §2 S007-B04）。承認範囲は次の4点。
  1. LINEは引き続き`all`の品目だけで、`representative` / `specific_user`はプッシュだけに載る
  2. プッシュはアラートが`false`→`true`へ変わった日に1回だけで、毎晩の再通知ではない
  3. deploy時点ですでにalert中の品目へ、修正適用を理由とした遡及プッシュは送られない
  4. 無効ユーザーと、対象householdに所属しない指定ユーザーへは送らない
  - **production反映の承認・S007-B01修正内容の承認は、上記4点とは別に必要**。上記は
    通知挙動の設計そのものへの承認であり、production deployの実施承認ではない
- VPS management review: 初回2026-09-15実施・`blocked`（S007-B01〜B04、正本上記参照）。
  S007-B02（task_id名前空間分離）・S007-B03（rollback/メタデータ記述訂正）はVPS管理側が
  noticeへ直接反映し、アプリ側で確認・commit済み（commit `5f36e55`）。S007-B04は
  上記のとおりapp owner承認済み。**S007-B01（household境界）はtask `20260915-003`
  （commit `5699b30`）で解消し、追加テスト6件（上記「Health・テスト」参照）すべて成功を
  Claudeが確認済み**。続く2回目のVPS管理レビュー（`stockhome_undo_actions_review_20260915.md`）
  でS008-B01〜B06（notice `20260915-STOCKHOME-008`対象）が新たに指摘され`blocked`。
  S008-B02〜B04はtask `20260915-004`（commit `038e173`）で解消し、追加テスト17件
  （notice `008`の「Health・テスト」参照）すべて成功を確認済み。S008-B05（client配信計画）は
  `ops/client-releases/20260915-STOCKHOME-004-plan.md`として作成済み。S008-B06は
  notice `008`でapp owner承認済み。**本改訂により007/008とも全blocker解消、
  最終source `038e173`で再レビューへ回す**
- production approval: 未実施
- source task_id（app/ai-watch）: 20260915-001（初版）, 20260915-003（S007-B01修正）,
  20260915-004（S008-B02〜B04修正。007自体の変更は無いが最終sourceを共有するため記載）
- related VPS task_id: 未採番（`20260915-001`はVPS2管理画面レイアウト作業で使用済み）
