# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20260915-STOCKHOME-008

app: stockhome

source_branch: main

source_commit: 038e173199ad8daee3ed3fd268673c8642976eb7

production_baseline_commit: 117e41d3c12153f9594f0d8bc8cd78098ba9b4bf

release_commits: `117e41d`（baseline）→ `52c5a7c`/`d909c9f`/`f14b97f`/`b0007b4`（notice
`20260907-STOCKHOME-006`の事後記録4件。`ops/**`のみ）→ `40c7947`（task `20260915-001`、
notice `007`対象の通知先修正。**build inputに影響**）→ `1122158`/`5f36e55`/`cb7e194`
（notice `007`の作成・改訂3件。`ops/**`のみ）→ `4105725`（task `20260915-002`、
本notice当初対象の取り消し・復元機能追加。**build inputに影響**）→ `c4954ee`/`d7a1f7d`
（本notice自体の作成・改訂2件。`ops/**`のみ）→ `5699b30`（task `20260915-003`、
notice `007`のS007-B01修正。**build inputに影響**）→ `038e173`（task `20260915-004`、
本notice対象のS008-B02〜B04修正（transaction統合・HTTP認可テスト）。
**build inputに影響**）。

**S008-B01対応（解消済み）**: 初版source`4105725`にはnotice`007`のS007-B01
（household境界の欠落）が未解消のまま含まれており、VPS管理側は単独でのdeploy対象外と
判定していた。`5699b30`でS007-B01を解消し、続く`038e173`でS008-B02〜B04を解消した結果、
**本notice`008`とnotice`007`は同一の最終source commit`038e173`を共有する**。
両noticeを分けてdeployすることはなく、`038e173`から作る1つのAPI artifactとして
review・承認・deployする（下記「production変更」参照）。

impact_level: L3

status: ready_for_review

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 変更概要

2026-09-03の全体点検所見B-3（優先度「中」）「取り消せない操作が3つある」への対応。
以下3つの新規APIエンドポイントと対応するmobile UIを追加した。

1. **`POST /api/import-candidates/:id/unconfirm`**: 取込候補の確定（`confirmed` /
   `auto_confirmed`）を取り消す。紐づく`purchase_log`を削除し、`counted_in_inventory`
   だった場合は既存の`reverseAccumulatedPurchase`（notice `20260904-STOCKHOME-005`で
   導入済み）で積み上げ分を近似的に差し戻し、`candidateStatus`を`detected`へ戻す。
2. **`POST /api/import-candidates/:id/unignore`**: 候補の無視（`ignored`）を取り消し、
   `detected`へ戻す（副作用なし、単純なステータス更新）。
3. **`POST /api/items/:id/restore`**: 論理削除された品目を復元する
   （`isActive: true`、`deletedAt`/`deletedBy`を`null`に戻し、stock snapshotを再計算）。

mobile側は、確定済み/無視済みの取込候補カードへ「確定を取り消す」「無視を取り消す」
ボタンを、非アクティブ品目カードへ「元に戻す」ボタンをそれぞれ追加した
（いずれも既存の削除確認と同じ`Alert.alert`確認ダイアログを経由する）。

`packages/shared` / `apps/gas` / DBスキーマの変更はない。設計はClaude、実装はCodex
（ai-watch経由、task `20260915-002`）が行い、Claudeがコードレビューと
DB依存回帰テスト5件の実行確認を行った。

**S008-B02〜B04対応（VPS管理レビュー、2026-09-15、task `20260915-004`）**: 初版の
`unconfirmImportCandidate`は購入削除・積み上げ差し戻しだけがtransaction内で、候補
ステータス更新・snapshot再計算が別処理だったため、途中失敗で中途半端な状態が残りうる
欠陥（S008-B02）、`restore`も品目更新とsnapshot再計算が別処理で同様の欠陥（S008-B03）、
3新規write APIにHTTPレベルの認可・境界テストが無い欠陥（S008-B04）をVPS管理側が指摘した。
`unconfirmImportCandidate`は候補行ロック（`import_order_candidates`への
`SELECT ... FOR UPDATE`、新設）→再取得・状態再確認→購入削除→積み上げ差し戻し→
snapshot再計算→候補更新までを単一transactionへ統合し、同時取消（二重クリック等）を
安全に直列化した。`restore`も既存の`lockItemForAccumulation`で品目行をロックしたうえで
単一transaction化した。JWT認証を実際に通すHTTPレベルテストを新規作成し、他household・
他ownerの操作拒否、404/409とDB不変更、成功時の変更範囲、再実行時の冪等性を検証した
（詳細は下記「現在と変更後」表・「Health・テスト」参照）。

## 変更理由

ユーザーから、2026-09-03の全体点検所見のうち4件（通知先フィルタ・取り消せない操作・
購入履歴編集・品目検索絞り込み）への対応を依頼された（2026-09-15）。本noticeはそのうち
「取り消せない操作」1件分。押し間違えたときにDBを直接操作するしかない状態を解消する。

## server_impact判定

server_impact: approval_required

判定理由: DBスキーマ変更・migration・新規env var・新規外部依存・新規cron・
port/bind/URL変更・認証境界の変更はいずれも無い。一方、`unconfirm`は既存の
`purchase_log`行を**削除**し、積み上げ補正値（`item_runtime_states.manual_override_qty`）
を**書き換える**新しい書き込み経路である。`restore`も論理削除フラグ・snapshotという
永続データを書き換える。これらは「利用者が明示的に取り消し操作を選んだ結果としての
データ削除・書き換え」であり、notice `20260904-STOCKHOME-005`（買い足し累積機能）が
`item_runtime_states`の書き込み意味を変えたときと同様にL3・`approval_required`と判定する。
新規write系APIエンドポイントの追加でもある。

## 現在と変更後

| 項目 | 現在 | 変更後 |
|---|---|---|
| 取込候補の確定（`confirmed`/`auto_confirmed`） | 戻す手段なし。誤確定はDB直接操作のみ | `POST /:id/unconfirm`で取り消し可能。紐づく購入履歴を削除し、積み上げ分を近似的に差し戻す |
| 取込候補の無視（`ignored`） | 戻す手段なし | `POST /:id/unignore`で`detected`へ戻せる（副作用なし） |
| 品目の論理削除 | 復元手段なし。一覧には残るが操作導線がない | `POST /:id/restore`で`isActive`を復帰しsnapshotを再計算 |
| `purchase_log`の削除経路 | 手動購入の取消（`DELETE /purchases/:id`）のみ | Gmail自動取込確定の取消（`unconfirm`）でも同じ`reverseAccumulatedPurchase`パスを通って削除されるようになる |
| mobile: 候補一覧（確定/無視済み表示時） | ボタンなし | 「確定を取り消す」「無視を取り消す」ボタン（確認ダイアログ付き） |
| mobile: 品目一覧（非アクティブ表示時） | ボタンなし | 「元に戻す」ボタン（確認ダイアログ付き） |
| `unconfirmImportCandidate`のtransaction範囲（S008-B02対応） | 購入削除・積み上げ差し戻しのみtransaction内。候補更新・snapshot再計算は別処理 | 候補行ロック・再取得・状態再確認・購入削除・積み上げ差し戻し・snapshot再計算・候補更新を単一transactionへ統合。同時取消は一方だけが成功し他方は409 |
| `restore`のtransaction範囲（S008-B03対応） | 品目更新とsnapshot再計算が別処理 | 品目行ロック（既存`lockItemForAccumulation`再利用）・状態確認・更新・snapshot再計算を単一transaction化。失敗時は品目もsnapshotも変更されず再試行が安全 |
| 新規write APIのHTTPレベルテスト（S008-B04対応） | 無し（サービス層の正常系テストのみ） | JWT認証込みの`undoActions.http.test.ts`（10シナリオ）を新規作成。他household/他owner拒否、404/409とDB不変更、成功時の変更範囲、再実行時の冪等性を検証 |

## 影響対象

- service/container: `stockhome-api-prod`（新規route3件追加。既存route・起動構成は変更しない）
- URL/port/health/bind: 変更なし
- cron/timer/worker: 変更なし（夜間バッチのロジックには触れていない）
- dependency: 追加・削除なし
- data/DB/volume: スキーマ変更なし。`purchase_log`の削除、`item_runtime_states.manual_override_qty`
  の書き換え、`items.is_active`/`deleted_at`/`deleted_by`の書き換えという、
  いずれも既存カラムへの新しい書き込み経路が増える（新規テーブルは無い）
- log/monitoring: 新規ログeventの追加なし。既存の`job_start`/`job_end`等のバッチログには
  影響しない（本変更は同期的なユーザー操作APIであり、バッチ処理には関与しない）

## production変更

- 必要性: あり（コンテナ再ビルド・入れ替えのみ。migration不要）
- 想定作業: 既存の`scripts/deploy.ps1`（`npm run deploy`）による通常のcontainer rebuild・入れ替え
- **前提条件**: 上記のとおり、本source（`038e173`）はnotice `20260915-STOCKHOME-007`の
  全内容（S007-B01修正込み）を不可分に含む。両notice分を1回のdeployとしてまとめて
  承認・実施する（S007-B01・S008-B02〜B04いずれも解消済み。下記「Health・テスト」参照）
- client配信の順序: API先行→別承認でclient配信（`ops/client-releases/
  20260915-STOCKHOME-004-plan.md`参照。新規3エンドポイントは追加のみのため旧clientは
  影響を受けない。新UIは新APIが無いとエラーになるため、client配信はAPI反映
  `verified`後に限る）
- downtime: brief-restart（apiコンテナのみ再起動。postgresコンテナ・DBデータは変更しない）
- maintenance window: 未定。VPS管理側レビュー後に判断

`production_change: required`のため、`deployment_status: not_started`のままVPS管理側へ引き継ぐ。

## 利用者への影響

- user_maintenance_impact: possible
- 対象利用者・機能: 取込候補の確定・無視、品目の削除操作を行う利用者全員
  （誤操作時の回復手段が増えるため、基本的には利用者に有利な変更）
- 機能面: デプロイ後、確定済み/無視済みの候補、削除済みの品目それぞれに取り消し・復元の
  ボタンが表示されるようになる。既存の確定・無視・削除操作自体の挙動は変更しない
- 注意点1（S008-B06承認済み）: `unconfirm`による積み上げ差し戻しは、
  `reverseAccumulatedPurchase`の既知の制約（その後の別の積み上げ・補正で上書き済みの
  場合は完全には一致しない、近似的な巻き戻し）を引き継ぐ。これはnotice
  `20260904-STOCKHOME-005`で既にapp owner承認済みの制約と同じもの
- 注意点2（S008-B03/B06、利用者影響の明記）: `restore`は削除前の`notificationEnabled`
  （通知ON/OFF）・snooze状態等をそのまま維持する（初期化しない）。したがって復元した
  品目が既に在庫アラート条件を満たしていれば、次回19:55の`daily_batch`で通知対象に
  なり得る。復元操作自体が即座に通知を送るわけではない
- 通知方法: 機能追加であり、利用者（家族）への事前告知は本noticeでは必須としない

## env・secret contract

- 変更: なし
- 変数名・secret種類: 追加・削除・意味変更なし
- provisioning/rotation: 不要

secret値は記載しない。

## Data・migration・backup

- schema/format変更: なし
- migration: なし
- backup対象: 通常のdeploy時運用を超える追加backupは不要と判断する。ただし`unconfirm`は
  `purchase_log`行を実際に削除する新しい経路であるため、deploy直前の通常dumpに加え、
  deploy直後の初回利用状況（`unconfirm`/`restore`の呼び出し有無）をVPS管理側で
  把握できるようにしておくことが望ましい
- restore確認: 追加のrestore試験は不要（スキーマ変更が無いため、通常のdeploy手順の
  範囲で足りる）
- backward compatibility: 旧API imageへ戻しても、新規3エンドポイントが消えるだけで
  既存機能に影響しない。ただし、**`unconfirm`によって削除された`purchase_log`行や、
  差し戻された`manual_override_qty`、`restore`によって復帰した`items.is_active`等は、
  image rollbackでは元に戻らない**（データの削除・書き換えを伴う操作のため）。
  これらの補正が必要な場合は別のDB変更承認で扱う

## Deploy・rollback

- deploy前提: 本notice`ready_for_review`後、VPS管理側レビュー・production承認。
  上記のとおりnotice`20260915-STOCKHOME-007`の再レビュー完了とあわせて1回のdeployとする
- deploy手順の変更: なし（既存の`scripts/deploy.ps1`をそのまま使う）
- rollback方法: 旧API imageへ戻すことで、以後の新規エンドポイントは404になる。
  ただし取り消し・復元操作によって**既に行われたデータの削除・書き換え**
  （削除済み`purchase_log`、差し戻し済み`manual_override_qty`、復帰済み`items`行）は
  image rollbackでは戻らない。これらの補正が必要な場合は別のDB変更承認で扱う
- rollback不能条件: 取り消し・復元操作によるデータ変更そのものは、image rollbackでは
  取り消せない（上記のとおり）。したがって、誤操作が疑われる場合はDB dumpからの
  個別データ復元、または対象品目の在庫補正画面からの手動修正で対応する

## Health・テスト

- health contract変更: なし
- 実施テスト:
  - `npm run build --workspace=@stockhome/shared`: 成功（Codexが実施）
  - `npm run build --workspace=@stockhome/api`: 成功（新規DB依存テストファイルを含む
    `src/**/*`の型検査も含めて成功。Codexが実施）
  - `npx tsc --noEmit -p apps/mobile/tsconfig.json`: 成功（Codexが実施）
  - `apps/api/src/services/candidateIntake.reversal.test.ts`（`unconfirmImportCandidate`の
    DB依存回帰テスト）当初5件: 全件成功。Claudeが対話セッションでローカル開発用Postgres
    （`localhost:5434`）に対して実行し確認した（2026-09-15）。内容: counted確定の取り消し
    （積み上げ差し戻し確認）、未counted確定の取り消し（積み上げ不変確認）、`legacyId`経由の
    紐付け、購入履歴が見つからない場合の非エラー処理、取り消し後の再確定（回帰防止）
- **S008-B02〜B04対応の追加テスト（2026-09-15、task `20260915-004`）**:
  - `candidateIntake.reversal.test.ts`へ2シナリオ追加（既存5件は呼び出しシグネチャ更新の
    み、検証内容は不変）: 同一候補への同時取消（一方だけが成功し他方はnullを返す。
    購入・積み上げとも二重処理にならないこと）、既に取消済みの候補への再取消（nullを返し
    DB状態が変化しないこと）。計7件
  - `undoActions.http.test.ts`（JWT認証を実際に通すHTTPレベル境界テスト、新規）10件:
    `unconfirm`（他household拒否・他owner拒否・対象なし404・状態不一致409・成功時の
    変更範囲限定の5件）、`unignore`（他household拒否・成功後再実行409の2件）、
    `restore`（他household拒否・404/409・成功後再実行409の3件）
  - 結果: 上記7件＋10件＝**17件すべて成功**（失敗0件）。Claudeが対話セッションで
    ローカル開発用Postgres（`localhost:5434`）に対して実行し確認した（2026-09-15）
- 未実施テストと理由: mobile UIの実機（Expo Go/内部配布APK）での見た目・操作確認は未実施

## Log・監視

- log量/形式/保存先変更: なし（本変更は同期的なユーザー操作APIであり、新規ログeventは
  追加していない。既存の`job_start`/`job_end`等バッチ関連ログには影響しない）
- 新しいalert条件: なし
- secret/個人情報対策: 変更なし。新規ログ出力は無い

## 提出前セルフチェック

正本: `C:\work\PRG\Sakura\Dev\vps-server-management\docs\templates\server_change_notice_pre_submission_checklist.md`

- [x] production baselineとrelease全commit・build入力差分を確認した（baseline`117e41d`から
      最終source`038e173`までの全11commitをbuild input該当有無で区別した。上記
      `release_commits`参照。notice`20260915-STOCKHOME-007`と同一の最終sourceを共有する
      点を明記した）
- [x] source commitとnoticeをremoteの対象branchへpushした（`4105725`・`5699b30`・
      `038e173`はいずれもCodexが`git push origin main`済み・確認済み。本notice文書の
      改訂commitはこの後に作成する）
- [x] data更新のtransaction・同時実行・途中失敗・再実行を確認した（S008-B02対応により、
      `unconfirmImportCandidate`は候補行ロック・再取得・状態再確認を含めて購入削除・
      積み上げ差し戻し・snapshot再計算・候補更新のすべてを単一`$transaction`内で実行する
      よう修正した。同一候補への同時取消が安全に直列化されることをtestで確認済み
      （上記「Health・テスト」参照）。`restore`も同様にS008-B03対応で単一transaction化した）
- [x] image rollbackとdata rollback、backup/restore条件を分けた（上記「Deploy・rollback」参照。
      データの削除・書き換えを伴うためimage rollbackだけでは戻らない点を明記した）
- [x] job/log/retention、runtime/dependency、client配信の該当有無を確認した（job/logは
      該当なし。runtime/dependencyは該当なし。client配信は`ops/client-releases/
      20260915-STOCKHOME-004-plan.md`（S008-B05対応）として計画を作成した。
      配信自体はAPI反映`verified`後、別承認で実施する）
- [ ] app owner、VPS review、production承認、client配信承認を分離した（**app owner承認・
      VPS review・production承認はいずれも未実施**。client配信も未確定）
- [x] secret非混入とtracked working tree cleanを確認した（`git status`で未追跡fileは
      本notice作成前から存在する無関係な2件（`ops/investigations/OPS-P1-08-npm-audit-findings.md`、
      `ops/production-db-operations/`）のみで、本commitには含まれていないことを確認した）

未確認・該当なしの理由: app owner承認・VPS management review・production承認は、
本notice提出後にVPS管理チャットへ引き継いで初めて得られるものであり、本セルフチェック
時点では未実施が正しい状態。

## 未解決事項

- mobile UIの実機（Expo Go/内部配布APK）確認は未実施。`ops/client-releases/
  20260915-STOCKHOME-004-plan.md`に記載のとおり、client配信はAPI反映`verified`後の
  別承認で実施し、配信後にapp ownerが実機で確認する
- 2026-09-15時点で確定済み/無視済み候補、削除済み品目が実際に何件あるかは未確認
  （production DBを確認していない）

## 希望時期

指定なし。VPS管理側レビューの結果を踏まえて判断する。

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: 本notice作成後にチャットで案内する
- VPS管理チャットへ渡すローカル絶対path:
  `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260915-STOCKHOME-008-summary.md`

## Approval

- app owner: **2026-09-15、ユーザー（app owner）がS008-B06記載の5点を明示承認**
  （VPS管理レビュー正本
  `C:\work\PRG\Sakura\Dev\vps-server-management\docs\operations\stockhome_undo_actions_review_20260915.md`
  §3 S008-B06）。承認範囲は次の5点。
  1. 確定取消は紐づく購入履歴を削除し、積み上げは既知仕様（`reverseAccumulatedPurchase`）に
     より近似的に差し戻す
  2. 紐づく購入履歴が見つからない場合でも候補だけを`detected`へ戻す
  3. 取消後の再確定は新しい購入履歴を作る
  4. 品目復元は削除前の`notificationEnabled`・snooze等を維持し、条件次第で次回batchの
     通知対象になる
  5. image rollbackでは、利用者操作後の削除・補正・復元データは戻らない
  - **production反映の承認・S008-B02〜B04修正内容の承認は、上記5点とは別に必要**。
    上記は取り消し・復元機能の設計そのものへの承認であり、production deployの
    実施承認ではない
- VPS management review: 初回2026-09-15実施・`blocked`（S008-B01〜B06、正本上記参照）。
  **S008-B01（007のS007-B01解消と最終source確定）はcommit `5699b30`・`038e173`で解消**
  （両notice`007`/`008`が最終source`038e173`を共有）。**S008-B02〜B04（transaction化・
  同時実行対応・HTTP認可テスト）はtask `20260915-004`（commit `038e173`）で解消**し、
  追加テスト17件（上記「Health・テスト」参照）すべて成功を確認済み。**S008-B05
  （client配信計画）は`ops/client-releases/20260915-STOCKHOME-004-plan.md`として作成済み**
  （計画のみ、配信は未実施）。S008-B06は上記のとおりapp owner承認済み。
  **本改訂により007/008とも全blocker解消、最終source`038e173`で再レビューへ回す**
- production approval: 未実施
- source task_id（app/ai-watch）: 20260915-002（初版）, 20260915-004（S008-B02〜B04修正）
- related VPS task_id: 未採番
