# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20260920-STOCKHOME-013

app: stockhome

source_branch: main

source_commit: 0f27da3bbcd9a33935675321ee2fa7c0e3ac56b0

production_baseline_commit: ec6e541b8bf88654baa68c3dd3b1c2fcbdb9d6ad

release_commits:（baseline以降、実際のcommit時系列順。notice 012以降の分のみ再掲。
それ以前の全commit列はnotice 012・010の提出内容を参照）

- `ec6e541`（baseline。notice `20260918-STOCKHOME-009`でproduction反映・`verified`済み）
- （中略。notice 010・011・012までの全commitは各noticeのrelease_commits参照）
- `b8c0e71`（notice `20260920-STOCKHOME-012`のsource。所見A-2/A-7対応、JWT有効期限延長）
- `b33dcb4`（notice 012の新規作成。`ops/**`のみ）
- `dbff6c9`（所見A-8対応、rate limit導入。`apps/api`のみ）
- `96864a6`（本noticeの新規作成。`ops/**`のみ）
- `a3468cd`（notice `20260920-STOCKHOME-012`第1回レビュー対応のテスト追加。
  `apps/api/src/entrypoint.env.test.ts`・`apps/api/src/plugins/auth.test.ts`のみ。
  **本noticeの対象外**）
- `ade5825`（**Claude直接反映**。`docker-compose.prod.yml`・
  `.env.production.example`へVPS管理側実測値`TRUSTED_PROXY_IPS=172.19.0.1`の
  受け渡しを追加、`ops/runtime-contract.yaml`へ同値とnginxのXFF上書き挙動を記載。
  コード変更なし）
- `0f27da3`（**本notice対象・最終source**。第1回VPS管理レビューの指摘対応。
  `accountRateLimit.ts`を上限付きTTL store化＋非string email型検査を追加、
  `resolveTrustedProxies`を`lib/trustedProxies.ts`へ抽出しtrusted proxy／
  詐称XFFのテストを追加。task `20260920-004`）

**本noticeが対象とするのはrate limit導入一式（`dbff6c9`の実装＋`ade5825`の
Compose/runtime-contract反映＋`0f27da3`の再提出分修正）。notice 010
（deploy/rollback機構）・011（mobile UI・push payload）・012（A-2/A-7・
JWT期限）は別変更のため分離したままとする。**

impact_level: L2

status: ready_for_review（第1回VPS管理レビューでblocked。指摘5点のうち
TRUSTED_PROXY_IPS配線・runtime-contract記載はClaudeが直接反映、残り3点
（TTL store化・型検査・trusted proxy/詐称XFFテスト）はtask `20260920-004`で
対応し再提出。下記「VPS管理レビュー結果への対応」参照）

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 変更概要

2026-09-03の全体点検所見A-8（優先度「中」）「ログイン・新規登録に回数制限がない」
への対応（task `20260920-002`、Codexが実装）。`@fastify/rate-limit`は未導入で、
`/api/auth/login`は無制限に試行でき、`/api/auth/register`も無制限に叩けた。

本taskは事前にVPS管理側へnginxの設定を確認したうえで設計している:

- nginxは`X-Real-IP`を接続元IPで上書き、`X-Forwarded-For`は受信値へ接続元IPを
  追記する設定（クライアントが詐称した値の後ろに、nginxが見た本当の接続元IPが
  追記される）。
- **VPS管理側の明示指示により`trustProxy: true`は使用していない。** 直前proxy
  （nginx）のみを信頼する設計にした。
- **VPS管理側の推奨により、IP単独ではなく短時間のIP単位＋アカウント単位を
  併用している。**

## VPS管理レビュー結果への対応（第1回blocked→再提出）

第1回VPS管理レビューでblockedとなり、以下5点の指摘を受けた。VPS管理側が
nginx→APIコンテナ間の直前proxy IPを実測し、`172.19.0.1`と判明した。

1. **ComposeからTRUSTED_PROXY_IPSを渡し、runtime-contractにも追加**
   → Claudeが直接対応（commit `ade5825`）。`docker-compose.prod.yml`の
   `api.environment`へ`TRUSTED_PROXY_IPS: ${TRUSTED_PROXY_IPS}`を追加、
   `.env.production.example`へ実測値`172.19.0.1`を追加（Docker bridge
   networkの実装詳細に依存するため、ネットワーク再作成等で値が変わり得る
   旨を注記）、`ops/runtime-contract.yaml`のconfig.env_varsとnetwork.public
   へ同値・nginxのXFF挙動を記載した。
2. **account rate limitを上限付きTTL storeへ変更**
   → `apps/api/src/lib/accountRateLimit.ts`に`maxEntries`（既定5000）を
   導入。新規key追加時のみ期限切れ削除→なお上限超過なら挿入順で
   evictionする（task `20260920-004`、commit `0f27da3`）。
3. **非文字列emailの型検査を追加**
   → 同ファイルの`extractEmail`結果に`typeof rawEmail !== 'string'`の
   ガードを追加し、数値・配列・オブジェクト等が渡っても`.trim()`で
   例外を投げず素通りするよう修正（同commit）。
4. **trusted proxy／詐称XFFのテストを追加**
   → `resolveTrustedProxies`を副作用の無い`apps/api/src/lib/trustedProxies.ts`
   へ抽出し（ロジック変更なし）、`Fastify({trustProxy: ['172.19.0.1']})`＋
   `app.inject({remoteAddress, headers})`で、(a) 信頼済みproxyがXFF末尾へ
   追記した実IPが正しく採用され、クライアントの詐称prefixが無視されること、
   (b) 信頼されていない接続元からのXFFは完全に無視され生の接続元IPが
   使われること、の2シナリオを検証するテストを追加した（同commit）。
5. **NginxのXFF上書きをproduction前提へ記載**
   → Claudeが直接対応（commit `ade5825`）。`ops/runtime-contract.yaml`の
   `network.public`へ、nginxが`X-Real-IP`を接続元IPで上書き・
   `X-Forwarded-For`は受信値の末尾へ接続元IPを追記する設定であること、
   Fastify(proxy-addr)が右から左へ走査し最初の非信頼値を採用するため
   詐称prefixが信頼されないことを記載した。

## 変更理由

2026-09-03の全体点検所見への対応（優先度「中」1件）。詳細は
`stockhome-review-findings-20260903.md`（点検報告書）を参照。

## server_impact判定

server_impact: notify

判定理由: 認証routeの応答（429の新設）、Fastifyの`trustProxy`設定、新規依存
（`@fastify/rate-limit`）を追加するため。特に、初回production利用時に
Docker経由でnginxからAPIコンテナへ接続した際の実際の接続元IPを確認する
必要があり（下記「未解決事項」参照）、deploy前の実測確認が要る。
port/bind/domain/health endpoint/起動command/DB schema/migration/volume/cron/
既存API contract（既存エンドポイントの追加削除）は変更していない。

## 現在と変更後

| 項目 | 現在 | 変更後 |
|---|---|---|
| `/api/auth/login`の試行回数制限 | 無し（無制限に総当たり可能） | IPベース20回/分＋アカウントベース5回/15分（併用、両方とも超過で429） |
| `/api/auth/register`の試行回数制限 | 無し（第三者が無制限に世帯を作成可能） | 同上（IPベース20回/分＋アカウントベース、emailごとに別namespace） |
| Fastifyのtrust proxy設定 | 未設定（`req.ip`は直接のTCP接続元をそのまま使用） | `TRUSTED_PROXY_IPS`環境変数（既定`127.0.0.1,::1`）で指定した直前proxyのみを信頼し、そこからの`X-Forwarded-For`を`req.ip`として使う |
| 429応答 | 該当なし | 日本語メッセージ、`Retry-After`ヘッダ付き |

## 影響対象

- service/container: `stockhome-api-prod`（`apps/api/src/routes/auth.ts`・`server.ts`の変更、`apps/api/src/lib/accountRateLimit.ts`新規。route追加・削除は無し、`login`・`register`のハンドラ本体（DB操作）は無変更）
- URL/port/health: 変更なし
- cron/timer/worker: 変更なし
- dependency: `@fastify/rate-limit@^11.2.0`を新規追加（Fastify 5系対応、`package-lock.json`更新済み）
- data/DB/volume: 変更なし（rate limitのstateはin-memory、DBへは保存しない）
- log/monitoring: 変更なし（429応答自体はログに新規イベントとして出さない。既存のHTTPアクセスログの範囲内）

## production変更

- 必要性: あり
- 想定作業: 通常のAPI deployで反映される。**deploy前に、VPS管理側でnginxからAPIコンテナへの実際の接続がどのIPとして観測されるかを確認する必要がある**（下記「未解決事項」参照）。誤っていた場合の失敗モードは「安全側」（`trustProxy`が接続元IPにマッチしなければ、Fastifyは`X-Forwarded-For`を一切信頼せず生の接続元IPをそのまま使う＝Docker bridge gatewayの1つのIPに全リクエストが集約されるだけで、詐称されたIPを信頼する方向には倒れない。ただしこの場合、実質的に全利用者が同一IPとして扱われ、IPベースのrate limitが家庭全体で共有されてしまう）。
- downtime: 既存と同じ（brief-restart）
- maintenance window: 不要

`production_change: required`のため、`deployment_status: not_started`のままVPS管理側へ引き継ぐ。

## 利用者への影響

- user_maintenance_impact: possible
- 対象利用者・機能: 全利用者（家庭内メンバー全員）。通常利用では影響なし（1分間に20回・15分間に5回を超えるログイン試行は通常操作では起こらない）。同一Wi-Fiから短時間に複数人が繰り返しログイン操作をした場合、IPベースの上限（20回/分）に触れる可能性は理論上あるが、家庭利用の規模では起こりにくいと判断した。
- 通知方法: 不要

## env・secret contract

- 変更: あり
- 変数名・secret種類のみ: `TRUSTED_PROXY_IPS`（新規、secretではない。カンマ区切りのIPリスト。`docker-compose.prod.yml`から明示的に渡すようになった。VPS管理側の実測値は`172.19.0.1`。未設定時はコード側の既定値`127.0.0.1,::1`にfallbackするが、production運用では`.env`への明示設定が前提）
- provisioning/rotation: `.env`へ`TRUSTED_PROXY_IPS=172.19.0.1`を設定（`.env.production.example`に記載済み）。Docker bridge networkの再作成等でgateway IPが変わった場合はVPS管理側で再測定・再設定が必要

secret値は記載していない。

## Data・migration・backup

- schema/format変更: なし
- migration: なし
- backup対象: なし
- restore確認: 該当なし
- backward compatibility: あり（rate limitのstateはin-memoryのため、deploy時のcontainer再作成で自然にリセットされる。外部store・永続化なし）

## Deploy・rollback

- deploy前提: なし（`TRUSTED_PROXY_IPS`は既定値で動作するため、未設定でもdeploy自体は可能。ただし実測確認前は、Docker経由の接続元IPが既定値と一致しない場合、IPベースのrate limitが家庭全体で共有される状態になる）
- deploy手順の変更: なし
- rollback方法: 旧image tagへの切り替え（従来手順、またはnotice 010のrollback機構が承認され次第そちらを利用可）
- rollback不能条件: 特になし（DBデータを変更しないため、image rollbackのみで完全に戻せる）

## Health・テスト

- health contract変更: なし
- 実施テスト:

  **(A) 静的検証**
  - `npm run build --workspace=@stockhome/shared` / `--workspace=@stockhome/api`: passed
  - `npx tsc --noEmit -p apps/mobile/tsconfig.json`: passed

  **(B) DB不要テスト（Codex実施、第1回レビュー分）**
  - `apps/api/src/lib/accountRateLimit.test.ts`（5件）: 同一namespace・同一email
    への試行が上限超過で429、異なるemailは別バケット、異なるnamespace
    （login/register）は同じemailでも別バケット、大文字小文字違いのemailは
    同一バケット、windowMs経過後のリセット、`Retry-After`ヘッダの存在を検証。全件成功

  **(B') DB不要テスト（Codex実施、再提出分。task `20260920-004`）**
  - `npx tsx --test apps/api/src/lib/accountRateLimit.test.ts
    apps/api/src/lib/trustedProxies.test.ts`: passed（12 tests）
    - `accountRateLimit.test.ts`追加分: 容量上限（`setMaxEntriesForTest`で
      小さい上限を設定し、上限超過時にstoreサイズが増え続けないことを確認）、
      非string email（数値・配列を送っても500にならず素通りすることを確認）
    - `trustedProxies.test.ts`（新規）: `resolveTrustedProxies()`の未設定/
      空白/カンマ区切りparseの単体テスト3件、`Fastify({trustProxy:
      ['172.19.0.1']})`での信頼済みproxy経由の詐称XFF prefix無視テスト、
      信頼されていない接続元からのXFF完全無視テストの計5件

  **(C) フルテストスイート（ローカルPostgres、Claude実施。第1回・再提出分とも実施）**
  - 第1回: `npm test --workspace=@stockhome/api`: 133件すべて成功（既存128件＋
    新規5件）。既存テスト（無効化ユーザーテスト等）が新しいrate limitの
    カウンタと衝突しないことも確認済み（各テストが一意なemailを使用するため）
  - 再提出分: `npm test --workspace=@stockhome/api`: **143件すべて成功**
    （notice 012のJWT/entrypointテスト等を含む最新状態での全件再確認。
    リグレッション無し）

  **(D) 実route・実DBを使ったend-to-end確認（Claude実施。スクラッチ環境、
  commit対象外。第1回レビュー時点で実施）**
  - 実際のFastifyアプリ（`authPlugin`＋`authRoutes`を実際にmountしたインスタンス）
    と実PostgreSQLに対し、同一emailで6回連続ログインを試行:
    5回目まで200、6回目で429・`Retry-After: 900`（15分）を確認
  - 別emailでのログインが上記の影響を受けず200のままであることを確認
  - 同一IPから21回連続でregisterを試行し、21回目でIPベース上限
    （20回/分）に到達して429になることを確認（1〜20回目は正常に
    新規登録が完了することも確認）
  - 検証で作成したテストデータ（household・user）はすべて削除済み

- 結果: すべて成功
- 未実施テストと理由: **VPS上での実接続テストは未実施**（他のnoticeと同様、
  production環境への接続はVPS管理側の個別承認後に限られるため）。特に
  「nginxからDocker経由でAPIコンテナへ接続した際の実際の接続元IP」は
  実機でしか確認できない（下記「未解決事項」参照）。

## Log・監視

- log量/形式/保存先変更: なし
- 新しいalert条件: なし
- secret/個人情報対策: 変更なし。rate limitのキーに使うメールアドレスはログへ出力しない（`accountRateLimit.ts`は`req.body`からemailを読むのみで、ログ出力は行わない）

## 提出前セルフチェック

正本: `C:\work\PRG\Sakura\Dev\vps-server-management\docs\templates\server_change_notice_pre_submission_checklist.md`

- [x] production baselineとrelease全commit・build入力差分を確認した（baseline`ec6e541`から`0f27da3`までのcommitを実際の時系列順で確認。上記release_commits参照）
- [x] source commitとnoticeをremoteの対象branchへpushした（`0f27da3`はpush済み、local/origin一致確認済み。本notice fileはこれからcommit・pushする）
- [ ] data更新のtransaction・同時実行・途中失敗・再実行を確認した — 該当なし（DBデータ更新を伴わない変更のため。rate limitのstateはin-memory）
- [x] image rollbackとdata rollback、backup/restore条件を分けた（本変更はimage rollbackのみで完全に戻せる。data rollbackは不要）
- [x] job/log/retention、runtime/dependency、client配信の該当有無を確認した（job/log/retention: 該当なし。runtime/dependency: `@fastify/rate-limit`追加のみ。client配信: mobile側の変更を含まないため該当なし）
- [ ] app owner、VPS review、production承認、client配信承認を分離した — いずれも未実施。下記Approval参照
- [x] secret非混入とtracked working tree cleanを確認した（`git status --short`で確認。既知の無関係な未追跡ファイルのみ残存）

未確認・該当なしの理由: 「data更新のtransaction」項目はDBデータを一切扱わない変更のため該当なし。app owner・VPS review・production承認は本notice提出時点で未実施のまま記録する。

## 未解決事項

- ~~nginxからDocker経由でAPIコンテナへ接続した際の実際の接続元IPが未確認~~
  → **解決済み**。VPS管理側が実測し`172.19.0.1`と判明。
  `docker-compose.prod.yml`・`.env.production.example`へ配線し、
  `ops/runtime-contract.yaml`へ記録した（上記「VPS管理レビュー結果への対応」
  参照）。Docker bridge networkの実装詳細に依存する値のため、ネットワーク
  再作成等で変わり得る点は注記済み（再測定が必要になった場合はVPS管理側で
  対応）。
- rate limitの具体的な上限値（IPベース20回/分、アカウントベース5回/15分）は
  Claudeの提案値であり、VPS管理側・app ownerからの指定値ではない。運用開始後に
  厳しすぎる／緩すぎると判断された場合は調整が必要。
- account rate limitの上限付きTTL storeの容量（`maxEntries=5000`）も
  Claudeの提案値。単一世帯・低頻度利用の通常運用では到達しない想定だが、
  運用開始後に不足・過剰と判断された場合は調整が必要。

## 希望時期

特に指定なし。

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: これから実施
- VPS管理チャットへ渡すローカル絶対path: `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260920-STOCKHOME-013-summary.md`

## Approval

- app owner: 未実施
- VPS management review: 未実施
- production approval: 未実施
- related task_id: 20260920-002（実装）、20260920-004（第1回レビュー指摘への対応）
