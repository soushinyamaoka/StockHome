# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20261103-STOCKHOME-026

app: stockhome

source_branch: main

source_commit: 1268d4df68f960a9877fcedb227f3b9da8db6bef

production_baseline_commit: e6984b0b5fb3a15d4bb75f8c2dc61382ed0e0687

release_commits: e6984b0b5fb3a15d4bb75f8c2dc61382ed0e0687..1268d4df68f960a9877fcedb227f3b9da8db6bef

impact_level: L2

status: ready_for_review

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 変更概要

消費ペースの実績提案（`computeSuggestedDaysPerUnit`、`apps/api/src/routes/purchases.ts`）で、**同じ日の購入を数量合計して1回の購入として扱う**ように修正する（`1fa45f9`）。

- 提案値は `GET /api/stocks` の `suggestedDaysPerUnit` と `GET /api/items/:itemId/purchases` の `suggestedDaysPerUnit` で返している（リクエストごとに計算し、DBには保存しない）
- 単体テスト2件を追加（`stockCalc.accumulation.test.ts`）
- schema・migration・env・Dockerfile・compose・依存packageの変更なし

## 変更理由

同じ日に複数の購入記録がある品目で、どれを「直前の購入」とみなすかが入力の並び順で変わっていた。在庫一覧（並び順指定なしの取得）と
品目の購入履歴（日付・作成日時順）とで提案値が食い違い、利用者が品目画面の提案値を採用しても、在庫一覧の「ペース見直し?」表示が
消えなかった（2026-11-03、app ownerから報告。本番データで2品目の食い違いを確認: 在庫一覧4／品目画面1.7、0.3／8.4）。

## server_impact判定

server_impact: approval_required

判定理由: 本番APIのコード変更のため、image再build・再起動が必要。

impact_level の判断: L2 とした。変わるのは画面表示用の提案値（リクエストごとの計算値で、永続化しない）だけで、在庫計算・stock_snapshot・
アラート・通知対象・保存データの値や意味は変えない。migration・secret/auth・network/公開面・runtime user/権限・backup/restore の変更も無い
（L3候補の各項目を確認済み）。VPS管理側でL3が妥当と判断される場合はそれに従う。

## 現在と変更後

| 項目 | 現在（`e6984b0`） | 変更後（`1268d4d`） |
|---|---|---|
| 同日に複数の購入がある場合 | 入力の並び順で最後に来た1件の数量で割る（API経路により値が変わりうる） | 同日の数量を合計して1回の購入として扱う（並び順に依存しない） |
| 同日の購入しか無い場合 | 提案なし（null） | 提案なし（null。変更なし） |
| 同日の購入が無い品目 | — | 値は変わらない |

## 影響対象

- service/container: `stockhome-api-prod`（image再build・再作成）。`stockhome-postgres-prod` は変更なし
- URL/port/health: 変更なし（`127.0.0.1:4002` bind、`/health` 不変）。API のレスポンス形式も不変（`suggestedDaysPerUnit` の値のみ）
- cron/timer/worker: 変更なし
- dependency: `package.json`（api・shared）の変更なし。release range に mobile の Expo SDK 58 更新（`923b236`）による `package-lock.json` の変更が
  含まれるが、API image の runtime `node_modules` は baseline と同一であることを確認した（下記テスト）
- data/DB/volume: 変更なし
- log/monitoring: 形式・event変更なし

## production変更

- 必要性: あり
- 想定作業: 通常のAPI deploy（`npm run deploy -- -Commit 1268d4df68f960a9877fcedb227f3b9da8db6bef`）
- 適用されるmigration: なし（未適用migrationは無い）
- downtime: 既存と同じ（brief-restart）
- maintenance window: 不要

## 利用者への影響

- user_maintenance_impact: possible
- 対象利用者・機能: 単一世帯。反映時はAPIコンテナの短い再起動（brief-restart）があり、その間はアプリの読み込み・保存が一時的に失敗する可能性がある（再試行で回復）。
  反映後は、同日に複数の購入記録がある品目の「ペース見直し?」表示と品目画面の提案値が一致する
- 通知方法: 不要

## env・secret contract

- 変更: なし
- provisioning/rotation: 不要

secret値は記載していない。検証では使い捨ての値のみを使用した。

## Data・migration・backup

- schema/format変更: なし
- migration: なし
- データ書き込み: なし（本変更による書き込みは無い）
- backup対象: 変更なし
- backward compatibility: レスポンス形式は不変。現行のmobile（client release 014）・GASとも変更不要
- 参考（本noticeの対象外）: 同日（2026-11-03）、app ownerの指示により、提案値の異常の原因だった購入記録の誤り（発送メール転送の重複3件・同日重複1件の削除、
  セット数量の訂正3件）と品目設定3件を、**アプリのAPIを利用者アカウントで呼ぶ通常操作**で修正した。production DBの直接更新は行っていない。
  うち1件は、mobileの編集画面の不具合（別の品目の入力値で上書き保存される）で上書きされた品目を、VPSの日次backup（2026-11-03 03:00）を
  read-onlyで参照して元の設定に戻したもの。mobile側の不具合修正（`1268d4d`）はclient releaseで配信する

## Deploy・rollback

- deploy前提: なし
- deploy手順の変更: なし
- rollback方法: `npm run deploy -- -RollbackTo e6984b0b5fb3a15d4bb75f8c2dc61382ed0e0687`（image rollback）
- image rollbackとdata rollbackの区別: data変更が無いため、image rollbackのみで完全に戻る
- rollback不能条件: なし

## Health・テスト

- health contract変更: なし
- 実施テスト（Claude、2026-11-03、アプリ側PCのDocker。本番への接続なし）:
  - **Docker build**: `1268d4d` と baseline `e6984b0` をそれぞれ `git archive` で取り出したbuild contextから build。成功
  - **runtime依存の比較**: 両imageの runtime `/app/node_modules` のpackage（2階層、107件）の name@version が完全一致
  - **既存テスト**: builder image（Node v24.22.1）内で、CIと同じ条件（`TZ=Asia/Tokyo`、使い捨てのPostgreSQL 16、`prisma migrate deploy` 後に
    `npm test --workspace=@stockhome/api`）で **211件すべて成功**（fail 0、cancelled 0。追加した提案値テスト2件を含む）
  - **コンテナ起動**: runtime image を使い捨ての空DBに接続して起動。`migration_end status=success` → `startup`、
    `GET /health` 200、`GET /api/items`（認証なし）401、`GET /api/bridge/readygo-pending`（bridge token付き）200
  - 検証用のコンテナ・ネットワーク・image・DBはすべて削除済み
  - 本番データでの期待値（2026-11-03、データ修正後の購入履歴をread-onlyで取得し、新しい関数で計算）: 提案値のある14品目すべてで、
    入力の並び順を逆にしても同じ値になり、現在の在庫一覧・品目画面の値と一致した（データ修正で同日重複が解消済みのため、現時点の値は変わらない。
    今後同日に複数の購入が登録されても食い違わなくなる）
- 未実施テストと理由:
  - production相当データでの起動（本番接続は行わない方針のため）。反映後にVPS管理側のhealth確認とアプリ側のread-only確認で補う

## Log・監視

- log量/形式/保存先変更: なし
- 新しいalert条件: なし

## 提出前セルフチェック

正本: `C:\work\PRG\Sakura\Dev\vps-server-management\docs\templates\server_change_notice_pre_submission_checklist.md`

- [x] production baselineとrelease全commit・build入力差分を確認した（`e6984b0..1268d4d` のAPI build入力差分は `apps/api/src/routes/purchases.ts`・
  テスト1ファイル・`package-lock.json`。他は mobile・CLAUDE.md・ops記録で artifact 外。lockfile は runtime node_modules 不変を確認）
- [x] source commitをremoteの対象branchへpushした（通知書のcommitも引き継ぎ時にremote一致を伝える）
- [x] Dockerfile、Compose、runtime user、OS package、起動commandの差分なし
- [x] lockfileと全workspace manifestを含む実際のbuild contextでbuildした
- [x] port、bind、domain、health、認証不要endpointの差分なし
- [x] data変更なしのため、image rollbackのみで戻せることを確認した
- [x] app owner、VPS review、production承認を分離した。mobileの修正は別途client releaseで配信する
- [x] `deployment_status: not_started` であることを確認した
- [x] secret非混入とtracked working tree cleanを確認した（未追跡は `ops/production-db-operations/` のみで、git管理外・artifact対象外）

未確認・該当なしの理由:
- `docs/runtime-state/production_deployments.yaml` のstockhome行は `85c5f8f` のままだった。baselineはVPS管理側の反映報告（notice 025、2026-10-22）と
  アプリ側のread-only確認（2026-11-03、稼働image `stockhome-api:git-e6984b0b5fb3a15d4bb75f8c2dc61382ed0e0687`）に基づく
- `tools/review_notice_preflight.ps1`: 未実行（アプリ側PCにPowerShell 7が無いため）。VPS管理側での実行をお願いしたい

## 未解決事項

なし

## 希望時期

特に指定なし。

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- VPS管理チャットへ渡すローカル絶対path:
  `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20261103-STOCKHOME-026-summary.md`

## Approval

- app owner: 承認（2026-11-03、app ownerがVPS管理チャットへ引き継ぎ済み）
- VPS management review: 技術レビュー受理（2026-11-03。preflight blocker 0件、local/cached origin/実remoteのmainが`4eb71f5`で一致、L2判定妥当。production反映の承認ではない）
- production approval: 承認（2026-11-03、app owner）。VPS管理側で反映済み（稼働source `1268d4d`、DEPLOY_RESULT=success、health matrix 4点成功、状態applied）
- related task_id: なし（app ownerの指示によりClaudeが直接修正）

## 反映後のアプリ側確認（read-only、2026-11-03）

- `GET /health` 200、`GET /api/items`（認証なし）401
- 利用者アカウントでの `GET /api/stocks` と `GET /api/items/:itemId/purchases`: 提案値のある14品目（全27品目中）すべてで、
  `suggestedDaysPerUnit`（値・件数）が両経路で一致（食い違い0件）
- 「ペース見直し?」対象は事前の想定どおり3品目（実際の消費ペースのずれによるもので、本変更とは無関係）
- 書き込み操作は行っていない
- 参考: VPS管理側のbuildログにnpm auditの指摘（runtime high 1件、builder high 2件）あり。本noticeは依存変更を含まず、別途確認する
