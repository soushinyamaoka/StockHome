# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20260920-STOCKHOME-014

app: stockhome

source_branch: main

source_commit: e3aa95bb8450270094421db4ee1d4a932b6ea481

production_baseline_commit: ec6e541b8bf88654baa68c3dd3b1c2fcbdb9d6ad

release_commits:（baseline以降。notice 019以降の分のみ再掲。それ以前の全commit列は
notice 010〜019の提出内容を参照）

- `ec6e541`（baseline。notice `20260918-STOCKHOME-009`でproduction反映・`verified`済み）
- （中略。notice 010〜019までの全commitは各noticeのrelease_commits参照）
- `f233ed9`（所見A-5・A-6対応の初回実装。task `20260920-007`／`008`。**第1回レビューで
  blocked**）
- 〜`f289a08`（notice 010〜019、第1回提出分。詳細は各noticeのrelease_commits参照）
- `0cad656`（notice 018・019のmetadata訂正。`ops/**`のみ。**本noticeの対象外**）
- `2de0270`（**S014-B01・B02対応**。`readygo_outbox`へ`claimed_at`列＋partial unique
  index追加（migration）、batch.tsのpending投入を「insert・競合時update」方式へ変更、
  bridge.tsのfetch/ACKをclaim方式へ変更。`apps/api`のみ）
- `7032b6a`（Claudeが実DBで検証中に見つけたtest自体の不具合を修正
  （`GET /readygo-pending`が全世帯分を返す仕様に対し、testが配列先頭を
  無条件に自世帯の行と仮定していた）。本番実装への変更なし）
- `d282137`（notice 015再対応（S015-B01）と合わせて発見した、cron相当テストと他test
  fileの並行実行競合への恒久対策（`apps/api/package.json`の`test`scriptへ
  `--test-concurrency=1`追加）。**notice 014・015共通の対応、本noticeの対象外
  としても記載**）
- `c59cef9`（notice 018のsource_commit hash訂正。`ops/**`のみ。**本noticeの対象外**）
- `a223349`（S014-B03・B04・B05対応。claim SQLへ`FOR UPDATE SKIP LOCKED`＋
  `status`再確認を追加（並行GET二重claim防止）、migrationへ既存pending
  重複の整理DELETEを追加（重複があってもmigration自体が失敗しないように
  する）、`GET /readygo-pending`へ未ACK claimedのlease回収を追加（30分超
  claimedのまま残った行を、新しいpendingが無ければpendingへ戻し同一呼び出し
  で再claim、新しいpendingがあれば削除する）。`apps/api`のみ。**第2回提出分**）
- `16d05eb`（**S014-B06対応**。stale claimed行の回収を、household単位で
  個別の楽観的`updateMany`＋一意制約違反（P2002）時の`deleteMany`フォール
  バックへ変更（従来は全household分をまとめて1回の`updateMany`で回収して
  おり、daily_batchの並行insertと競合すると未処理のP2002で丸ごと失敗して
  いた）。daily_batchとの実並行テスト（5反復）を追加。`apps/api`のみ。
  **第3回提出分**）
- `f6cb13d`（S014-B07初回対応。GAS側`deliverStockHomeNotifications`に
  配信済みidのローカル記録（Script Properties、TTL 7日）を追加。
  `appendToInbox`成功直後・ACK呼び出しより前に記録することで、ACK不達で
  同じ行が再取得されても再投入せずACKだけ再試行するようにした。`apps/gas`
  のみ。**第3回提出分。第4回レビューで「Inbox投入とID記録が別操作のため
  その間の中断で二重投入しうる」と部分対応の指摘を受け、下記commitで
  Inbox行への同時書き込み方式へ置き換えた**）
- `1e8b514`（S014-B07再対応。GAS側の冪等化をScript Properties方式から、
  ReadyGo Inbox行のE列（`stockhome_outbox_id`）へoutbox idを本文と同じ
  `appendRow`呼び出しで同時書き込みする方式へ置き換え（投入と記録が単一
  操作になり中間状態が無い）。`deliverStockHomeNotifications`全体を
  `LockService`で排他し、並行実行による二重投入も防ぐ。`apps/gas`のみ。
  **第4回提出分**）
- `e3aa95b`（**本notice対象・最終source。旧・日次バッチ経路の完全廃止**。
  `BatchController.js`から`runDailyBatch`・`createDailyBatchTrigger`を
  削除、`NotificationService.js`から`processAllNotifications`・
  `evaluateAlertTarget_`・`buildBroadcastMessage_`・`buildItemSummaryLine_`
  を削除（`ReadyGoBotService.appendToInbox`のoutboxId必須化(S014-B07)に
  伴い、この旧経路は呼び出しても必ず失敗する状態だった）。新規
  `legacyBatchRetirement.gas.test.cjs`（8シナリオ）を追加。`apps/gas`のみ）

**本noticeが対象とするのは所見A-5・A-6への対応（夜間バッチのReadyGoキュー重複抑止・
世帯スコープ・保持期間・claim方式による二重配信防止）。notice 010〜013・016〜019は
別変更のため分離したままとする。production反映時はVPS管理側の方針により、
notice 010〜019と本noticeを1つの計画へまとめる想定。**

impact_level: L2

status: ready_for_review

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 変更概要

2026-09-03の全体点検所見のうち、夜間バッチ・ReadyGoキューまわりの2件への対応
（task `20260920-007`／`20260920-008`、Codexが実装）。

- **A-5**（優先度「中」）: 「夜間バッチを今すぐ実行」（`POST /api/dashboard/run-batch`）が
  世帯を絞らず全品目を処理し、`readygo_outbox`へ無条件に行を積んでいた。19:55の自動実行後・
  GASの取得前（20時台）に押すと、同じアラートが2通キューに入り、そのまま2回LINE配信される
  状態だった。
- **A-6**（優先度「中」）: `readygo_outbox`は毎晩積まれる一方、GASの夜間トリガーが停止しても
  滞留を検知する手段が無く、復旧時に古いアラートが最大20通まとめて流れ得た。配信済み行の
  保持ポリシーも未定義だった（`push_tickets`だけ保持期間が定義済みで非対称）。

## VPS管理レビュー結果への対応（blocked→再提出）

第1回VPS管理レビューで、以下2点の指摘を受けblockedとなった
（`stockhome_findings_014_019_review_20260920.md` §2参照）。

- **S014-B01**: `deleteMany`→別queryの`create`という2ステップ構造のため、
  手動×手動・cron×手動の並行実行で両方がdelete後にcreateし、同一世帯の
  pending行が2件残りうる。
- **S014-B02**: GASが`GET /readygo-pending`で行を取得した直後にbatchが
  その行を削除・再作成すると、GASは旧本文を配信するがACKは「行が無い」
  として無視され、二重配信とnotification_log欠落が起こりうる。

対応方針: `readygo_outbox`の状態を`pending → claimed → delivered`の3段階に
拡張し、DB上のpartial unique indexで「household当たりpending最大1件」を
並行実行時も保証したうえで、GASが取得(claim)した行にはbatchが一切触れない
設計へ変更した（詳細は下記「現在と変更後」参照）。

Claudeが実DBで検証する過程で、追加したtest自体に2件の不具合を発見・修正した
（本番実装のバグではない）。1件目は並行実行testが3並行`runDailyBatch`実行後の
pending件数を正しく検証できていた一方、fetch/ACK競合testで
「`GET /readygo-pending`が全世帯分の行をまとめて返す」という正しい仕様に対し
testコードが配列の先頭要素を無条件に自世帯の行と仮定しており、ローカル開発DBに
残っていた他世帯の残留行を誤って掴んでいた（commit `7032b6a`で、DBを
`householdId`＋`status`で直接検索する方式へ修正）。2件目はcron相当のtestが
DB全体のhousehold・itemを処理するため、並行実行中の他test fileのhousehold
削除と競合する構造的な問題で、notice 015の再対応とあわせて恒久対策
（`--test-concurrency=1`、commit `d282137`）を適用した。

## VPS管理レビュー結果への対応（第2回：blocked→再提出）

第2回VPS管理レビューで、S014-B01・B02の解消は確認されたが、新たに3点の
指摘を受けblockedとなった
（`stockhome_findings_014_019_review_20260920.md` §6参照）。

- **S014-B03**: claim SQLの内側SELECTに`FOR UPDATE SKIP LOCKED`が無く、
  外側UPDATE条件にも`status = 'pending'`の再確認が無いため、2つの
  `GET /readygo-pending`が同じpending行を選ぶと、片方の確定後にもう片方が
  同じ行を再度claimして二重に返しうる。
- **S014-B04**: production baselineは同一householdへpendingを複数insert
  できる実装であり、notice 014はまさにその重複を修正する変更である。
  migrationが既存の重複を整理せず直ちにpartial unique indexを作るため、
  重複が1件でもあれば`prisma migrate deploy`が失敗しAPIが起動しない。
- **S014-B05**: `GET /readygo-pending`がclaimした後、GASがReadyGo投入前に
  停止すると、その通知は再取得も削除もされず永久に配送されない（第1回の
  「未解決事項」で開示していたが、第2回レビューで解消が必須と判定された）。

対応:

- claim SQLの内側SELECTへ`FOR UPDATE SKIP LOCKED`を追加し、外側UPDATEへ
  `AND status = 'pending'`を追加した。Claudeが実DBで並行2GETを実際に
  再現し、修正前は5回中4回で同一行を二重claimすること、修正後は5回中5回
  とも正しく1回だけclaimされることを確認済み。
- migrationへ、partial unique index作成の**前**にhouseholdごとの重複
  pendingを整理するDELETEを追加した（最新の1件を残す）。一時DBで
  household当たり3件の重複を作成し、migration適用後に最新1件だけが
  残りindexが正常に作成されることを確認済み。
- `GET /readygo-pending`の先頭で、30分（GAS単体実行の上限6分に十分な
  余裕を持たせた値）を超えてclaimされたまま残る行を回収する処理を追加した。
  同一世帯に新しいpending行が無ければpendingへ戻し（**reclaim処理の直後、
  同一呼び出し内のclaim処理で即座に再度claimされ、レスポンスにも含まれる**。
  reclaim後にpendingのまま残る中間状態は無い）、新しいpending行が既にあれば
  supersede済みとみなして古いclaimed行を削除する。Claudeが実DBで3シナリオ
  （新pendingなし→再claim、新pendingあり→stale側削除・fresh側がclaim、
  lease内→完全に無変更）を確認済み。

## VPS管理レビュー結果への対応（第3回：blocked→再提出）

第3回VPS管理レビュー（チャットフィードバック、正本doc番号は今回未提示）で、
S014-B03・B04・B05の解消は確認されたが、新たに2点の指摘を受けblockedと
なった。

- **S014-B06**: `GET /readygo-pending`のlease回収処理が「全household分を
  まとめて1回の`updateMany`」で行われており、daily_batchの並行insertと
  競合すると、その1回の`updateMany`全体が未処理の`P2002`（一意制約違反）
  で失敗し、リクエスト全体が500になる。VPS管理側の指摘: 「lease回収と
  再claimを単一transaction/SQLへ統合し、batch投入との実並行テストを
  追加してください」。
- **S014-B07**: `apps/gas/src/ApiBridge.js`の`deliverStockHomeNotifications()`
  は、`appendToInbox`成功後、ループの最後でまとめてACKする構造になって
  いる。ACKのHTTP呼び出しだけが失敗（ネットワーク断・GASの実行タイムアウト
  でACK呼び出し前に打ち切り等）すると、API側はその行を`claimed`のまま
  保持し、30分のlease回収後に同じidが再度返される。現状には何の防御も
  無いため、次回実行で再度`appendToInbox`が呼ばれ、ReadyGo Inboxへ同じ
  内容が二重投入され、家族へLINEが2回届く。VPS管理側の指摘: 「outbox ID
  等で冪等化し、ACK不達→再取得のテストを追加してください」。

対応:

- **S014-B06**: stale claimed行の回収を、household単位で個別の楽観的
  `updateMany`（`where: { id, status: 'claimed', claimedAt: { lt } }`）へ
  変更し、一意制約違反（`P2002`）を捕捉したら「同一householdへの新しい
  pending行が並行して作られた＝このstale行はsupersede済み」とみなして
  `deleteMany`へフォールバックする設計へ変更した（`batch.ts`の
  `upsertPendingReadyGoRow`と同じ「insert→catch P2002→フォールバック」の
  作法をreclaimにも適用）。Claudeが実DBで、2つの独立したPrismaClient接続
  を使い、reclaim処理とdaily_batchの並行insertを実際に競合させて検証。
  **修正前のコードは10回中9回で未処理のP2002をthrowした**（500エラーの
  再現）。修正後は同じ並行実行を20回行い**20/20でクラッシュなし・
  household当たりpending件数は常に1件以下**を確認済み。加えて、
  `bridge.readygoReclaim.test.ts`へ、`Promise.all`による実際の並行実行
  （5反復）でdaily_batchの並行insertとの競合を検証するテストを追加した。
- **S014-B07**: GAS側`deliverStockHomeNotifications`に、`appendToInbox`
  成功直後（ACK呼び出しより前）に配信済みoutbox行idをScript Properties
  （TTL 7日。Claudeの提案値、30分のleaseより十分長い）へローカル記録する
  処理を追加した。次回実行時、同じidが既に記録されていれば`appendToInbox`
  を呼ばずスキップし、ACKだけ再試行する。「ACK呼び出しより前に記録する」
  順序により、直後にACKが失敗・タイムアウトしても次回実行時の二重投入を
  防げる。既存の`apps/gas/test/reparseHistoricalCandidates.gas.test.cjs`
  と同じnode:vm手法で新規`apps/gas/test/readygoDelivery.gas.test.cjs`を
  作成し、7シナリオ（通常配信・ACK不達後の再取得での再投入スキップと
  ACK再試行・Inbox投入失敗時は記録しない・混在batch・pending無し・TTL
  prune・壊れた記録の扱い）を検証する。
  **（第4回レビューで部分対応と指摘され、下記「VPS管理レビュー結果への
  対応（第4回）」でInbox行への同時書き込み方式へ置き換えた。本節はその
  変更前の設計の記録として残す）**

## VPS管理レビュー結果への対応（第4回：blocked→再提出）

第4回VPS管理レビューで、S014-B06の解消は確認されたが、S014-B07は部分対応
との指摘を受けblocked継続となった。

- **S014-B07部分対応の指摘**: 前回（task `20260921-004`、commit
  `f6cb13d`）の設計は、`appendToInbox`成功と、GAS Script Propertiesへの
  配信済みid記録が**別操作**だった。VPS管理側の指摘: 「Inbox追加と
  Script PropertiesへのID記録が別操作のため、その間の停止・記録失敗では
  同じ通知が再投入されます。outbox IDをInbox行と同時に保存して再投入前に
  照合するなど、Inbox側で冪等化してください。並行実行対策も追加して
  ください。」
- **notice/runtime contractへの反映指摘**: 「併せてnotice/runtime
  contractへ、GAS→APIの反映順・GAS version確認・rollback、および残っている
  schema/migration・中間状態の記載矛盾を反映してください。」

対応:

- **S014-B07（Inbox側での冪等化）**: `ReadyGoBotService.appendToInbox`を
  outbox id対応にし、ReadyGo Inboxシートへ新規列E（`stockhome_outbox_id`）を
  追加。本文と同じ`appendRow`呼び出しでidを同時に書き込むことで、「Inboxへの
  投入」と「投入済みの記録」を単一のAPI呼び出しへ統合した（途中で処理が
  中断しても、投入済みだが未記録という中間状態が発生しなくなった）。投入前に
  E列を読み、同じidが既に存在すれば投入をスキップしてtrueを返す（呼び出し元
  はACKだけ再試行する）。**並行実行対策**として、`deliverStockHomeNotifications`
  全体を`LockService.getScriptLock()`（`tryLock(0)`、`apps/gas/src/
  GmailImportService.js`の既存箇所と同じ作法）で排他し、read→appendの間に
  別の配信処理が割り込むことを防いだ。旧Script Properties方式
  （`READYGO_DELIVERED_IDS`・TTL 7日）は完全に削除した。`apps/gas/test/
  readygoDelivery.gas.test.cjs`を全面書き換え、9シナリオ（Inbox単体5件:
  通常投入・重複idスキップ・id欠落・spreadsheet未設定・sheet不在／
  配信統合4件: 通常配信・ACK不達後の再取得でのスキップとACK再試行・
  lock保持中の完全スキップ・lock解放と次回実行）で検証した。
  **既知の限界**（コード・下記「未解決事項」にも記載）: ReadyGo Bot側の
  実装次第で、(1) E列追加への非対応、(2) 処理済み行の早期削除・アーカイブ
  による冪等化マーカーの消失、が起こりうる。いずれも外部システム
  （ReadyGo Bot）の挙動に依存し、StockHome側のtestでは検証できない。
- **GAS→APIの反映順・GAS version確認・rollback**: 「production変更」節へ
  3小節（GAS→APIの反映順、GAS versionの確認、rollback（GAS側））として
  追記した。要旨: API先行deployを推奨（wire contractは全ラウンドで不変の
  ため順序を問わず安全だが、より強いサーバ側防御を早く有効化するためAPI
  先行が望ましい）。GAS versionの確認は、`push.bat`がHEADを即座に更新し
  installable triggerがHEADで実行される性質を踏まえ、次回trigger実行後に
  Apps Script実行ログで新コード固有の文言を確認する方法を明記。rollbackは
  対象commitを戻して`push.bat`→`deploy.bat`を再実行する手順とし、Inbox
  列Eの残存データは無害なため削除不要である旨を明記。
- **残っていたschema/migration・中間状態の記載矛盾**: `ops/runtime-
  contract.yaml`の`readygo_outbox`エントリ(4)lease回収の説明が、
  S014-B06で「判定してから実行する（TOCTOU）」方式から「楽観的に実行し
  一意制約違反時にフォールバックする」方式へ変更した後も、旧方式の
  「新しいpending行が既にあれば...とみなして削除する」という判定先行の
  表現のまま残っていた。実際のS014-B06実装（楽観的update＋P2002捕捉時
  フォールバック）に合わせて表現を訂正した。

## VPS管理レビュー結果への対応（第5回：blocked→再提出）

第5回VPS管理レビューで、S014-B07（Inbox側での冪等化）の解消は確認された
（前回参照）が、新たに2点の指摘を受けblocked継続となった。

- **後方互換性の欠落**: `apps/gas/src/NotificationService.js`の
  `processAllNotifications()`が`ReadyGoBotService.appendToInbox(message)`を
  引数1つのまま呼んでいた。前回（S014-B07再対応）で`appendToInbox(body,
  outboxId)`のoutboxId必須化を行ったため、この呼び出しは常に失敗する状態に
  なっていた。VPS管理側の指摘: 「NotificationServiceがappendToInbox(message)
  のままで、outboxId必須化により旧runDailyBatch経路のReadyGo通知が必ず
  失敗します。互換対応するか、旧経路をコード・trigger作成・運用文書から
  完全に廃止し、テストを追加してください。」
- **notice記載の矛盾**: 「noticeの「schema/migration変更なし」「deploy手順
  変更なし」という記載を、実際のmigration・GAS反映・rollback手順へ
  合わせてください。」

対応:

- **旧経路の完全廃止**: 調査の結果、`processAllNotifications()`の呼び出し元
  `BatchController.runDailyBatch()`は、2026-09-13のAPI bridge統合以降完全に
  不要（GAS単体でspreadsheetを在庫DBとして使っていた移行前アーキテクチャの
  残骸）と判定した。API移行時に`setupStockHomeBridge()`が
  `deleteDailyBatchTrigger()`で旧triggerを削除する設計だったが、コード自体は
  削除されずに残っていた。`runDailyBatch`・`createDailyBatchTrigger`・
  `processAllNotifications`・専用private helper（`evaluateAlertTarget_`・
  `buildBroadcastMessage_`・`buildItemSummaryLine_`）を完全に削除した
  （`grep`で他のどのfileからも呼ばれていないことを確認済み。
  `deleteDailyBatchTrigger`は未移行環境の一括削除用に残置、
  `getNotificationLogs`等は`WebController.js`の管理画面が使用するため残置）。
  新規`apps/gas/test/legacyBatchRetirement.gas.test.cjs`（8シナリオ:
  削除確認5件＋「`appendToInbox`を呼ぶのは`ApiBridge.js`のみ」という
  静的ソーススキャンによる同種バグの再発防止2件＋引数数確認1件）を追加し、
  既存の`readygoDelivery.gas.test.cjs`（9件）・
  `reparseHistoricalCandidates.gas.test.cjs`（34件）とあわせて回帰なしを
  確認した。運用文書（`apps/gas/CLAUDE.md`・`SETUP_GUIDE.md`・
  `StockHome_仕様書.md`）もあわせて訂正した（下記参照）。
- **notice記載の矛盾修正**: 「server_impact判定」セクションが
  「DB schema/migration...は変更していない」と記載したままだった
  （S014-B01以前、claim方式への再設計前に書かれたまま放置されていた）。
  実際にはmigration `20260920222509_readygo_outbox_claim`でschema変更が
  あるため訂正した。「## Deploy・rollback」セクションも「deploy前提: なし」
  「deploy手順の変更: なし」のまま放置されており、GAS側deploy手順
  （`push.bat`→`deploy.bat`）の追加を反映していなかったため、migration
  適用・GAS反映手順・rollback手順（API側・GAS側）を具体的に記載する形へ
  全面的に書き直した。
- **運用文書の訂正（Claudeが直接編集）**: `apps/gas/CLAUDE.md`の
  「トリガー管理」「LINE通知（ReadyGo Bot連携）」セクションが、旧
  `runDailyBatch`経路を現行の仕組みであるかのように記載していたため、
  現在の`deliverStockHomeNotifications`経由の配信ブリッジへ書き直した。
  `apps/gas/SETUP_GUIDE.md`は文書全体が移行前（GAS単体・spreadsheetがDB）
  時代の手順であり、全面改訂は本noticeの範囲を超えるため、冒頭へ
  明示的な廃止・注意喚起banner（現在の正しい手順は`apps/gas/CLAUDE.md`
  参照、`runDailyBatch`関連の手順は実行不能である旨）を追加した。
  `apps/gas/StockHome_仕様書.md`の関数一覧から`processAllNotifications()`を
  削除済みと明記し、`appendToInbox(body)`を`appendToInbox(body,
  outboxId)`へ訂正した。

## 変更理由

2026-09-03の全体点検所見への対応（優先度「中」2件）。詳細は
`stockhome-review-findings-20260903.md`（点検報告書）を参照。

## server_impact判定

server_impact: notify

判定理由: 夜間バッチ（19:55 JST）の挙動と`readygo_outbox`の保持内容が変わり、
LINE通知の配信内容（重複の有無）に影響するため。あわせて`job_end`ログへ4fieldを追加し、
新規ログイベント2種（`readygo_queue_superseded`・`readygo_outbox_cleaned`）を出す。
**DB schema/migrationは変更あり**（`readygo_outbox`へ`claimed_at`列＋partial unique
indexを追加するmigration `20260920222509_readygo_outbox_claim`。詳細は下記
「現在と変更後」「Data・migration・backup」参照）。GAS側もReadyGo Inboxシートへ
列Eを追加する変更を伴う（詳細は「production変更」参照）。
port/bind/domain/health endpoint/起動command/volume/cron schedule/既存API contract
（エンドポイントの追加削除・レスポンス形状の破壊的変更）は変更していない。

## 現在と変更後

| 項目 | 現在 | 変更後 |
|---|---|---|
| 手動バッチ実行の対象範囲 | 全世帯の品目を処理し、全世帯分をキューに積む | 実行者の`req.auth.householdId`の世帯のみを対象に、counted更新・在庫再計算・通知判定・キュー投入を行う |
| ReadyGoキューの状態 | `pending`・`delivered`の2状態 | `pending`・`claimed`・`delivered`の3状態。`GET /readygo-pending`が単一SQL文でpending→claimedへ原子的に遷移させる |
| ReadyGoキューへの投入 | 既存pendingの有無を見ず無条件にinsert（実行のたびに増える） | insertを試み、household当たりpending最大1件のpartial unique indexに違反したら既存pending行をupdate（並行実行時もDBが一意性を保証） |
| GAS取得済み行の扱い | batchの置き換え対象になりうる（二重配信・監査欠落の恐れ） | `claimed`行はbatchの置き換え対象から完全に除外される。新しいアラートは別途新規pending行として積まれる |
| 並行GETでの二重claim | 防止機構なし | `FOR UPDATE SKIP LOCKED`＋`status`再確認で、同じ行が複数の`GET`に同時に返らないことをDBレベルで保証 |
| migrationと既存重複の関係 | 考慮なし（重複があればmigration自体が失敗しうる） | migration内でhouseholdごとに最新1件を残し重複を整理してからindexを作成する |
| 未ACKのまま残ったclaimed行 | 永久に配送されない（回収機構なし） | 30分のlease超過で、`GET /readygo-pending`が自動的に回収する（新pending無し→再claim・再配信、新pending有り→supersede済みとして削除） |
| ACKの対象 | `delivered`以外なら無条件に受理 | `claimed`の行のみ受理（`pending`のまま・既に`delivered`の行はACKされない） |
| GAS停止時のキュー滞留 | 毎晩積まれ続け、復旧時に最大20通が一度に流れる | 常に最新1件へ置き換わるため積み上がらない |
| 配信済み(`delivered`)行の保持 | 無制限に残る | 30日を超えた行を削除（cron実行は全世帯、手動実行は当該世帯のみ） |
| 滞留の可視化 | 無し | `job_end`へ`readygo_pending`・`readygo_pending_oldest_age_h`・`readygo_superseded`・`readygo_cleaned`を追加 |
| stale claimedのlease回収とdaily_batch並行insertの競合 | 全household分をまとめて1回の`updateMany`で回収しており、daily_batchの並行insertと競合すると未処理のP2002でリクエスト全体が失敗する | household単位で個別の楽観的`updateMany`を試み、P2002を捕捉したら`deleteMany`へフォールバック。他householdの回収を巻き込まない |
| ACK不達後の再配信（GAS側） | 防御なし。ACKが届かず lease回収後に同じ行が再取得されると、ReadyGo Inboxへ同じ内容が再度投入され二重配信になりうる | ReadyGo Inbox行のE列へoutbox idを本文と同じ`appendRow`呼び出しで同時書き込みし、既存idの再投入をスキップする（投入と記録が単一操作のため中間状態が無い）。配信処理全体を`LockService`で排他し並行実行による二重投入も防ぐ |

## 影響対象

- service/container: `stockhome-api-prod`（`apps/api/src/services/batch.ts`・`routes/bridge.ts`・`routes/dashboard.ts`・`lib/logger.ts`の変更。route追加・削除は無し、`POST /api/dashboard/run-batch`のレスポンスは既存fieldを維持したままfieldを追加）。
  加えてGAS側`apps/gas/src/ApiBridge.js`（`deliverStockHomeNotifications`へ
  `LockService`排他を追加、S014-B07）・`apps/gas/src/ReadyGoBotService.js`
  （`appendToInbox`がoutbox idを受け取り、ReadyGo Inboxシートの新規E列
  `stockhome_outbox_id`へ本文と同時書き込みするよう変更、S014-B07）・
  `apps/gas/src/BatchController.js`（旧`runDailyBatch`・
  `createDailyBatchTrigger`を削除、第5回対応）・
  `apps/gas/src/NotificationService.js`（旧`processAllNotifications`等の
  通知投入pipelineを削除、`getNotificationLogs`等は維持、第5回対応）。
  新規Script Propertyは無い（配信済み記録はReadyGo Inboxシート自体に
  持たせる設計としたため）。反映にはプロジェクト規約どおり
  `apps/gas/push.bat`→`apps/gas/deploy.bat`（clasp）が必要（production
  承認後にユーザーが手動実行。`apps/gas/CLAUDE.md`参照）
- URL/port/health: 変更なし
- cron/timer/worker: schedule（19:55 JST / 20:10 JST）は変更なし。`daily_batch`の処理内容のみ変更
- dependency: 変更なし（新規パッケージ追加なし）
- data/DB/volume: **schema変更あり**。`readygo_outbox`へ`claimed_at`列（nullable DateTime）を追加し、`(household_id) WHERE status = 'pending'`のpartial unique indexを追加する（migration
  `20260920222509_readygo_outbox_claim`）。既存列の型・意味は変更なし
- log/monitoring: `job_end`へ4field追加、新規イベント`readygo_queue_superseded`・`readygo_outbox_cleaned`。既存イベントの意味・形式は変更なし

## production変更

- 必要性: あり
- 想定作業: 通常のAPI deployで反映される。deploy時に`prisma migrate deploy`で
  migration `20260920222509_readygo_outbox_claim`（既存pending重複の整理・
  `claimed_at`列追加・partial unique index追加）が適用される。deploy直後の初回
  `daily_batch`（19:55 JST）で、既存の`delivered`行のうち30日を超えたものが
  一度にまとめて削除される可能性がある（削除件数は`readygo_outbox_cleaned`
  イベントに出る）。
- downtime: 既存と同じ（brief-restart）
- maintenance window: 不要
- GAS側（S014-B07対応、`apps/gas/src/ApiBridge.js`・`ReadyGoBotService.js`）:
  production承認後、ユーザーが手動で`apps/gas/push.bat`→`apps/gas/deploy.bat`
  （`apps/gas/CLAUDE.md`参照）を実行する。ReadyGo側Inboxシートへ列Eを追加する
  （`stockhome_outbox_id`）。既存のA〜D列の意味・順序は変更しない

### GAS→APIの反映順

**API（`stockhome-api-prod`のdeploy）を先に反映し、その後にGAS
（`push.bat`→`deploy.bat`）を反映することを推奨する。** 理由:
`GET /api/bridge/readygo-pending`・`POST /api/bridge/readygo-ack`の
wire contract（`{pending:[{id,body}]}`・`{ids:[...]}`）はnotice 014の
一連の変更（S014-B01〜B07）を通じて一切変更していない（DB側の内部実装
（claim状態・lease・atomicity）とGAS側の冪等化（Inbox列E）だけが変わる）。
そのため:
- API先行の場合: 旧GASコード（冪等化無し）は新APIへ問題なく接続でき、
  サーバ側の重複防止（partial unique index・claim・lease回収）が
  即座に有効化される。GAS未反映の間はGAS側の冪等化層（S014-B07）だけが
  未適用だが、サーバ側の防止機構により実害は限定的
- GAS先行の場合: 新GASコード（Inbox列Eでの冪等化）は旧APIへも問題なく
  接続できるが、サーバ側の重複防止（S014-B01〜B06）が未反映のまま、
  より弱い（旧baselineの）重複防止状態が長く続く
- いずれの順序でも接続不能・contract不整合は起きないが、より強い防御
  （サーバ側）を早く有効化するため上記の順序を推奨する

### GAS versionの確認

`push.bat`実行はGASプロジェクトのHEAD（最新保存）を更新し、時間主導型
installable trigger（`deliverStockHomeNotifications`）は次回発火時から
HEADの内容で実行される（Web アプリ`/exec`URLの反映には別途`deploy.bat`
が必要だが、ReadyGo配信trigger自体はpush.batの時点で新コードに切り替わる）。
反映確認は、次回のtrigger実行（20時台）後、Apps Scriptエディタの実行数
（Executions）ログで以下を確認する:
- 新コード固有のログ文言`[ReadyGoBotService] Inbox に投入しました
  (...文字, outboxId=...)`が出ている（旧コードは`outboxId=`を含まない
  文言だった）
- lockが競合した場合のログ`[Deliver] 他の配信処理が実行中のため終了します。`
  が出現しうる（新規追加のLockService対応）
`deploy.bat`実行後は`clasp deployments`（または Apps Script エディタの
デプロイ履歴）で新しいデプロイバージョン番号を確認し、反映記録として
残すことを推奨する

### rollback（GAS側）

`apps/gas/src/ApiBridge.js`・`ReadyGoBotService.js`を本notice反映前の
commit（`9c20a5d`。この2fileが本notice（S014-B07）で初めて変更される前に
最後に触られたcommit。`git log --oneline -- apps/gas/src/ApiBridge.js
apps/gas/src/ReadyGoBotService.js`で確認済み）へ戻し、
`push.bat`→`deploy.bat`を再実行する（installable triggerはHEADへ即座に
追従するため、`push.bat`の
再実行だけで挙動は旧版へ戻る。`deploy.bat`はWeb アプリURLとの整合のため
念のため実行する）。ReadyGo側Inboxシートへ追加した列E
（`stockhome_outbox_id`）のデータはrollback後も残存するが、無害な列である
ため削除は不要（新規DBテーブルがrollback後も残存して無害な場合と同様の
扱い）。API側にDB schema変更を伴うrollbackは無い（本notice内で新規に
追加したmigrationは無く、S014-B01時点のmigrationのまま）。

`production_change: required`のため、`deployment_status: not_started`のままVPS管理側へ引き継ぐ。

## 利用者への影響

- user_maintenance_impact: possible
- 対象利用者・機能: 全利用者（家庭内メンバー全員）。通常の夜間配信は従来どおり1日1通で変化なし。
  **設定画面の「夜間バッチを今すぐ実行」を押したときの挙動が変わる**（従来は押すたびに
  LINE配信キューが増えていたが、以後は最新1件へ置き換わる＝二重配信されない）。
  これは不具合修正であり、利用者にとっては意図した動作。
- 通知方法: 不要

## env・secret contract

- 変更: なし
- 変数名・secret種類のみ: 該当なし
- provisioning/rotation: 不要

secret値は記載していない。

## Data・migration・backup

- schema/format変更: **あり**。`readygo_outbox`へ`claimed_at`列（nullable、既定値なし）と
  partial unique index（`readygo_outbox_pending_household_unique`、`household_id`に対し
  `status = 'pending'`の行のみ）を追加。既存列の削除・型変更は無い
- migration: `20260920222509_readygo_outbox_claim`（既存pending重複の整理
  `DELETE`・`ALTER TABLE ADD COLUMN`・`CREATE UNIQUE INDEX`）。Claudeがローカル
  開発DBで生成・適用し、重複するpending insertが実際に拒否されること
  （`duplicate key value violates unique constraint`）を確認済み。さらに、
  一時DBでhousehold当たり3件の重複pendingを作った状態からこのmigrationを
  適用し、最新1件だけが残りindexが正常に作成されることも確認済み（S014-B04対応）
- backup対象: なし（削除対象・追加対象とも配信キューの運用状態であり、購入履歴等の
  業務データではない）
- restore確認: 該当なし
- backward compatibility: あり（`BatchResult`はfield追加のみで既存fieldを維持。mobile側は
  `alerts`・`queued`しか参照していないため改修不要。旧clientからの`POST /run-batch`も
  そのまま動作する。`status`列の値が増える（`claimed`追加）が、既存コードが`status`を
  文字列として扱う箇所は本notice対応で全て更新済み）

## Deploy・rollback

- deploy前提: API側は`prisma migrate deploy`でmigration
  `20260920222509_readygo_outbox_claim`（既存pending重複の整理・
  `claimed_at`列追加・partial unique index追加）が正常に適用されること。
  GAS側はReadyGo Inboxシートへ列E（`stockhome_outbox_id`）を追加できる
  こと（ReadyGo Bot側が許容するかは未確認。下記「未解決事項」参照）
- deploy手順の変更: **あり**。従来のAPI単体deploy（`docker compose up -d
  --build api`）に加え、GAS側の反映（`apps/gas/push.bat`→
  `apps/gas/deploy.bat`）が新たに必要になった。反映順・version確認の
  詳細は上記「production変更」内の「GAS→APIの反映順」「GAS versionの
  確認」を参照
- rollback方法: API側は旧image tagへの切り替え（従来手順、またはnotice
  010のrollback機構）。GAS側は上記「production変更」内の
  「rollback（GAS側）」を参照（対象commit`9c20a5d`へ戻し
  `push.bat`→`deploy.bat`を再実行）
- rollback不能条件: 特になし。ただし**rollback前に削除された`readygo_outbox`行は戻らない**
  （image rollbackで削除ロジックは無効化されるが、既に削除済みの行はDB restoreしない限り
  復元されない）。削除対象は上記のとおり再生成可能な通知キューのため、実害は無いと判断する。
  なお、migration自体（`claimed_at`列・partial unique index追加、既存重複の整理DELETE）は
  API imageのrollbackだけでは戻らない（通常のimage rollback手順にschema rollbackは含まない）。
  新規列・indexが残存しても既存機能への実害は無く、DB restoreを要する事態ではないと判断する。

## Health・テスト

- health contract変更: なし
- 実施テスト:

  **(A) Codex実施分（第1回提出）**

  - `npm run build --workspace=@stockhome/shared` / `npm run build --workspace=@stockhome/api` / `npx tsc --noEmit -p apps/mobile/tsconfig.json`: passed
  - `npx tsx --test apps/api/src/services/batch.groupTargets.test.ts apps/api/src/services/notifyTarget.test.ts`: passed (9 tests)
  - `batch.readygoQueue.test.ts` was not run by Codex because it requires a real PostgreSQL database; Claude will run it.

  **(A') Codex実施分（第1回再対応S014-B01・B02、task `20260920-015`）**

  - `npm run build --workspace=@stockhome/shared` / `--workspace=@stockhome/api`
    （内部で`prisma generate`）: passed
  - `npx tsc --noEmit -p apps/mobile/tsconfig.json`: passed

  **(A'') Codex実施分（第2回再対応S014-B03・B04・B05、task `20260921-001`）**

  - `npm run build --workspace=@stockhome/shared` / `--workspace=@stockhome/api`
    （内部で`prisma generate`）: passed
  - `npx tsc --noEmit -p apps/mobile/tsconfig.json`: passed

  **(A''') Codex実施分（第3回再対応S014-B06、task `20260921-003`）**

  - `npm run build --workspace=@stockhome/shared` / `--workspace=@stockhome/api`
    （内部で`prisma generate`）: passed
  - `npx tsc --noEmit -p apps/mobile/tsconfig.json`: passed

  **(A'''') Codex実施分（第3回再対応S014-B07、task `20260921-004`。GAS側）**

  - `node --check apps/gas/src/ApiBridge.js`: passed
  - `node apps/gas/test/readygoDelivery.gas.test.cjs`: **7件すべて成功**
    （新規。通常配信・ACK不達後の再取得での再投入スキップとACK再試行・
    Inbox投入失敗時は記録しない・混在batch・pending無し・TTL prune・
    壊れた記録の扱い）
  - `node apps/gas/test/reparseHistoricalCandidates.gas.test.cjs`: **34件
    すべて成功**（既存。回帰なし）
  - **（第4回レビューで部分対応の指摘を受け、`readygoDelivery.gas.test.cjs`は
    下記(A''''')で全面書き換えている）**

  **(A''''') Codex実施分（第4回再対応S014-B07、task `20260921-005`。GAS側）**

  - `node --check apps/gas/src/ApiBridge.js`: passed
  - `node --check apps/gas/src/ReadyGoBotService.js`: passed
  - `node apps/gas/test/readygoDelivery.gas.test.cjs`: **9件すべて成功**
    （全面書き換え。Inbox単体5件: 通常投入でE列にid記録・重複idは
    再投入せずtrue・id欠落は投入せずfalse・spreadsheet未設定はfalse・
    sheet不在はfalse／配信統合4件: 通常配信でid付き1行投入しACK・
    ACK不達後の再取得でInbox再投入せずACKのみ再試行・lock保持中は
    Inbox・ACKとも一切触れない・lock解放後は次回実行が取得可能）
  - `node apps/gas/test/reparseHistoricalCandidates.gas.test.cjs`: **34件
    すべて成功**（既存。回帰なし）

  **(A'''''') Codex実施分（第5回再対応、旧経路完全廃止、task `20260921-006`。GAS側）**

  - `node --check apps/gas/src/BatchController.js`: passed
  - `node --check apps/gas/src/NotificationService.js`: passed
  - `node apps/gas/test/legacyBatchRetirement.gas.test.cjs`: **8件すべて成功**
    （新規。削除確認5件（`runDailyBatch`・`createDailyBatchTrigger`が
    存在しない、`deleteDailyBatchTrigger`等は残存、`processAllNotifications`
    が存在しない、`NotificationService`の他exportは残存）＋
    `appendToInbox`呼び出し元の静的ソーススキャン2件（`ApiBridge.js`・
    `ReadyGoBotService.js`以外に呼び出しが無い、`ApiBridge.js`の呼び出しは
    2引数）＋引数数確認1件）
  - `node apps/gas/test/readygoDelivery.gas.test.cjs`: **9件すべて成功**
    （既存。回帰なし）
  - `node apps/gas/test/reparseHistoricalCandidates.gas.test.cjs`: **34件
    すべて成功**（既存。回帰なし）

  **(B) 実DBテスト（ローカルPostgres、Claude実施）**

  - migration検証（第1回）: `prisma migrate diff`で差分SQLを生成（`ADD COLUMN`のみ。
    partial unique indexは手書き追加）、ローカル開発DBへ適用し、`INSERT`2件で
    2件目が一意制約違反になることを確認
  - migration検証（第2回、S014-B04）: 一時DB（`stockhome_migration_test`）で
    household当たり3件のpending重複を作成し、重複整理DELETE込みのmigrationを
    適用。householdごとに最新1件だけが残り、indexも正常に作成されることを確認
  - 並行claim検証（S014-B03）: 修正前後のSQLをそれぞれ5回、実際に2並行実行で
    比較。修正前は5回中4回で同一行の二重claimを検出、修正後は5回中5回とも
    正しく1回だけclaimされることを確認
  - reclaim検証（S014-B05）: 3シナリオ（新pendingなし・新pendingあり・
    lease内）を一時household上で直接確認。reclaim直後に同一呼び出しの
    claim処理で即座に再claimされる（pendingのまま残る中間状態は無い）ことを
    含めて確認
  - reclaim原子性検証（S014-B06）: 2つの独立したPrismaClient接続で、
    reclaim処理とdaily_batchの並行insertを実際に競合させて検証。修正前の
    コード（全household分をまとめて1回の`updateMany`）は10回中9回で
    未処理のP2002をthrow（500エラーの再現）。修正後（household単位の
    個別update＋P2002捕捉時のフォールバックdelete）は同じ並行実行を20回
    行い20/20でクラッシュなし・household当たりpending件数は常に1件以下
    であることを確認
  - `npx tsx --test --test-concurrency=1 apps/api/src/services/batch.readygoQueue.test.ts
    apps/api/src/routes/bridge.readygoRace.test.ts
    apps/api/src/routes/bridge.readygoReclaim.test.ts`: **13件すべて成功**
    （既存4シナリオ＋並行batch実行1シナリオ＋claim/ACK関連3シナリオ＋
    並行GET二重claim防止1シナリオ＋reclaim3シナリオ＋daily_batchとの
    実並行reclaimテスト1シナリオ（5反復））
  - `npm test --workspace=@stockhome/api`: **175件すべて成功**（notice 015・
    016〜019分を含む最新状態）

  **(C) テスト分離の修正経緯（task `20260920-008`、`20260920-018`）**

  task `20260920-007`時点の実装では、世帯を指定した実行でも
  `updateCountedInInventory()`・`recalculateAllStocks()`を引数なし（全世帯対象）で
  呼んでいた。この状態では新規テストを単体実行すると成功する一方、フルスイートでは
  4件が失敗した（node:testがテストfileを並列実行するため、全世帯再計算の最中に
  他のテストfileが自分のhouseholdを削除し、`stock_snapshots_household_id_fkey`の
  FK違反になる）。`updateCountedInInventory`・`recalculateAllStocks`はいずれも
  既に`householdId?`のoptional引数を持っていた（`routes/stocks.ts`が使用済み）ため、
  引数を渡すだけで「世帯を指定した実行はその世帯のデータにしか触らない」という
  一貫した挙動になり、テスト分離の問題も解消した。**production側の不具合ではなく、
  task 007の実装が世帯スコープを一部にしか適用していなかったことが原因。**

  S014-B01・B02再対応（task `20260920-015`）で追加した
  `bridge.readygoRace.test.ts`は、実DB実行で1件失敗した。原因は
  `GET /readygo-pending`が全世帯分のpending行をまとめて返す仕様（正しい挙動）に
  対し、testが配列の先頭要素を無条件に自世帯の行と仮定していたため、ローカル
  開発DBに残っていた他世帯の残留行（それまでの検証作業で作られたもの）を
  誤って掴んでいたことだった。DBを`householdId`＋`status`で直接検索する方式へ
  修正した（task `20260920-017`、commit `7032b6a`）。**本番実装
  （`batch.ts`・`bridge.ts`）に問題は無い。**

  さらに、notice 015再対応で追加したcron相当テストが、並行実行中の他test file
  のhousehold削除と競合する問題が見つかった。個別のtest file対応を繰り返すのではなく、
  `apps/api/package.json`の`test`scriptへ`--test-concurrency=1`を追加する恒久対策を
  適用した（task `20260920-018`、commit `d282137`。notice 015と共通の対応、詳細は
  notice 015参照）。

- 結果: すべて成功
- 未実施テストと理由: production VPS上での実バッチ実行確認は未実施（production環境への
  接続はVPS管理側の個別承認後に限られるため）。deploy後の初回`daily_batch`で
  `readygo_outbox_cleaned`・`readygo_pending`の値を確認いただくのが実機確認になる。

## Log・監視

- log量/形式/保存先変更: `job_end`へ4field追加、新規イベント2種を追加。1行1JSONの形式は維持
- 新しいalert条件: なし（ただし`readygo_pending_oldest_age_h`が大きい値を取り続ける場合、
  GAS側の夜間トリガー停止を示す。監視条件として使えるが、本noticeでは条件設定までは行わない）
- secret/個人情報対策: 変更なし（通知本文・メールアドレス等はログへ出力しない。追加した4fieldは
  いずれも件数と経過時間の数値のみ）

## 提出前セルフチェック

正本: `C:\work\PRG\Sakura\Dev\vps-server-management\docs\templates\server_change_notice_pre_submission_checklist.md`

- [x] production baselineとrelease全commit・build入力差分を確認した（baseline`ec6e541`から`e3aa95b`までのcommitを実際の時系列順で確認。上記release_commits参照）
- [x] source commitとnoticeをremoteの対象branchへpushした（`e3aa95b`はpush済み、local/origin一致確認済み。本noticeの確定分はこれからcommit・pushする）
- [x] data更新のtransaction・同時実行・途中失敗を確認した（キューの置き換え削除→insertは
  同一バッチ内の連続操作。途中失敗時はpendingが0件になり得るが、翌日の実行で最新内容が
  再度積まれるため復旧する。購入履歴等の業務データは一切変更しない）
- [x] image rollbackとdata rollback、backup/restore条件を分けた（上記「Deploy・rollback」参照）
- [x] job/log/retention、runtime/dependency、client配信の該当有無を確認した（job: daily_batchの
  処理内容変更。log: field追加・新規イベント2種。retention: `readygo_outbox`のdelivered 30日。
  runtime/dependency: 変更なし。client配信（mobile EAS Update）: mobile側の変更を含まない
  ため該当なし。**GAS側の反映（`push.bat`→`deploy.bat`）は別途必要**。「client配信」とは
  区別される運用手順であり、詳細は上記「production変更」「Deploy・rollback」参照）
- [ ] app owner、VPS review、production承認、client配信承認を分離した — いずれも未実施。下記Approval参照
- [x] secret非混入とtracked working tree cleanを確認した（`git status --short`で確認。既知の無関係な未追跡ファイルのみ残存）

## 未解決事項

- `readygo_outbox`の`delivered`保持期間（30日）はClaudeの提案値であり、VPS管理側・app ownerからの
  指定値ではない。運用開始後に長すぎる／短すぎると判断された場合は調整が必要。
- 滞留検知（`readygo_pending_oldest_age_h`）はログへ出すところまで。閾値超過時の
  アプリ内表示は所見C-3（notice `20260920-STOCKHOME-015`）で別途対応済み
  （夜間バッチ自体の成否表示であり、ReadyGoキュー滞留そのものの専用表示ではない点に
  留意）。
- 未ACK claimedのlease回収（30分）はS014-B05対応で解消済み、daily_batchとの
  並行insert時の原子性はS014-B06対応で解消済み。lease値（30分）はGAS単体
  実行の上限（6分）を踏まえたClaudeの提案値であり、VPS管理側・app owner
  からの指定値ではない。運用開始後に調整が必要な場合がある。
- GAS側の冪等化（S014-B07、第4回対応）は、ReadyGo Inboxシートに追加した
  E列（`stockhome_outbox_id`）を突き合わせる方式のため、以下2点はStockHome
  側のtestでは検証できない既知の限界: (1) ReadyGo Bot側の実装がInbox行の
  列数を厳密に検証する場合、E列追加が影響しうる。(2) ReadyGo Bot側が
  処理済み行を投入後すぐに削除・アーカイブする実装だった場合、次回リトライ
  時にはE列のidが既に無く、重複投入を防げない可能性がある。いずれも
  ReadyGo Bot側の挙動次第であり、production反映前に運用者による実地確認を
  推奨する。

## 希望時期

特に指定なし。notice 010〜013・015〜019と同じ計画にまとめてproduction反映する想定。

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: これから実施
- VPS管理チャットへ渡すローカル絶対path: `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260920-STOCKHOME-014-summary.md`

## Approval

- app owner: 未実施
- VPS management review: 未実施
- production approval: 未実施
- related task_id: 20260920-007（初回実装）、20260920-008（テスト分離の修正）、
  20260920-015（S014-B01・B02対応）、20260920-017（testの不具合修正）、
  20260920-018（並行実行の恒久対策、notice 015と共通）、
  20260921-001（S014-B03・B04・B05対応）、20260921-003（S014-B06対応）、
  20260921-004（S014-B07初回対応、GAS側）、
  20260921-005（S014-B07再対応、Inbox側での冪等化、GAS側）、
  20260921-006（旧・日次バッチ経路の完全廃止、GAS側）
