# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20260919-STOCKHOME-010

app: stockhome

source_branch: main

source_commit: dcccd4006d366bbed51d741ff59ba6a058781a2d

production_baseline_commit: ec6e541b8bf88654baa68c3dd3b1c2fcbdb9d6ad

release_commits:（baseline以降、実際のcommit時系列順）

- `ec6e541`（baseline。notice `20260918-STOCKHOME-009`でproduction反映・`verified`済み）
- `2529199`/`813032b`/`e46723c`/`3e4be99`（notice 009・client release記録のdocs更新。`ops/**`のみでbuild inputに影響しない）
- `0a6e781`（task `20260918-003`、品目検索・絞り込み。apps/mobileのみ、notice不要と判定済み）
- `c2b6fa9`/`f45db49`/`fdf42a0`/`a2376bb`（CI設定新設・修正4件。production runtimeに影響しない）
- `12ac1a5`（`ops/runtime-contract.yaml`のみ、C-2バックアップ方針記録）
- `ad432fb`（notice `20260919-STOCKHOME-011`初版。所見A-1/A-3/B-5対応。**本noticeの対象外**）
- `084d1d1`（**本noticeの前回source**。deploy/rollback機構の初版）
- `a9200ee`（notice 010・011の新規作成。`ops/**`のみ）
- `280b101`（commit `12ac1a5`へのVPS管理レビュー訂正反映。`ops/**`のみ）
- `611dbcf`（**notice 011のsource**。VPS管理レビューblocker対応3点。`apps/api`・`apps/mobile`。011で`accepted`済み）
- `71da90f`（notice 011の再提出。`ops/**`のみ）
- `741eeec`（**本notice対象**。S010-B01〜B03対応。`scripts/deploy.ps1`全面改訂、`scripts/vps-deploy-runner.sh`新規、`.gitattributes`新規）
- `dcccd40`（**本notice source**。`scripts/deploy.ps1`のみ。Windows標準tar非対応オプションの除去）

**本noticeが対象とするのは`084d1d1`→`741eeec`→`dcccd40`のdeploy/rollback機構。
`ad432fb`→`611dbcf`（mobile UI・push payload、notice 011）は内容的に無関係な
別変更として分離したままとする（011は2026-09-19に`accepted`済み）。**

**レビュー§5のとおり、本sourceは011のsourceを祖先に含むため、通常deployでは両者が
必ず結合される。production反映は、両noticeが受理済みになった後、両notice IDと
最終full commitを明記した一つのproduction計画・個別承認で扱っていただきたい
（本noticeからは反映を求めない）。**

impact_level: L2

status: ready_for_review

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 変更概要

所見C-5（優先度「中」）「ロールバック手順が毎回の手作業のまま」への対応。
2026-09-19にVPS管理側が決定したロールバック方針（commit固定tag
`stockhome-api:git-<40桁commit>`、成功image 3世代保持）を実装し、
同日のVPS管理レビュー（`stockhome_rollback_mechanism_review_20260919.md`）で
blockedとなった4点（S010-B01〜B03・S010-D01）へ対応したもの。

**初版（`084d1d1`）からの構成変更:** deploy本体をVPS上で動くbash script
`scripts/vps-deploy-runner.sh`（新規）へ切り出し、`scripts/deploy.ps1`は
「固定commitからartifactを作って転送し、runnerを呼ぶ」役に整理した。
lock・build・切替・health確認・cleanup・自動rollbackはすべてVPS側で
一連の処理として完結する。

### S010-B01: 固定commitとbuild入力の同一性

- **`-Force`を廃止した。** `git status`ベースのdirty checkもやめた。
- **`tar`＋excludeパターンをやめ、`git archive <commit>`に変更した。**
  commitに含まれる追跡ファイルだけが出力されるため、working treeの未コミット変更・
  未追跡ファイル・gitignore済みの`.env`は**原理的に混入しない**
  （exclude漏れによる混入の余地が構造的に無くなる）。副次的に、対象外の
  未追跡ファイルでdeployが止まることもなくなった。
- **対象commitが実remote `origin/main`に含まれることを検証する。**
  `git fetch origin main`の後、`git merge-base --is-ancestor`で確認し、
  含まれない場合はartifactを作らず停止する。
- 転送前に、runner scriptがartifactへ含まれること（＝対象commitにコミット済みで
  あること）と、`.env`系・`node_modules`が混入していないことを検査する。
- `-Commit <sha>`でbuild対象commitを明示指定できる（既定はHEAD）。

### S010-B02: health失敗時のprevious imageへの自動復旧

- **切替前に、現行containerのimageへimmutable tagを確定・保全する。**
  現行imageが`stockhome-api:<tag>`形式ならそのtagをrollback先とする。
  旧方式でbuildされたimage（Compose自動命名で`repo:tag`形式にならない）の場合は、
  image IDから`pre-v2-<timestamp>`というimmutable tagを**一度だけ**付与して保全する
  （可変tagをrollback根拠にしない、という方針に沿う）。
  保全先が実在することを切替前に必ず確認する。
- **health matrix失敗時・`up`失敗時は、同一処理内でそのtagへ自動rollbackし、
  health matrixを再確認する。**
- **rollback後の確認にも失敗した場合は明確に異常終了し、image cleanupを行わない。**
- 失敗した新imageは調査のため削除しない（cleanupはhealth成功時のみ実行）。

### S010-B03: 確認項目と排他

- **health matrixを4点へ拡張した**（従来はローカル端末からのinternal `/health`のみ）:
  - internal `http://127.0.0.1:4002/health` → 200
  - internal `http://127.0.0.1:4002/api/bridge/health` → 401
  - public `https://stockhome.homehub-tools.dedyn.io/health` → 200
  - public `https://stockhome.homehub-tools.dedyn.io/api/bridge/health` → 401
  - **deploy成功時とrollback後の双方で確認する。**
- **`flock`による同一service単位の非blocking lockを取得する。**
  競合時はbuildも切替もcleanupも行わず`lock_failed`で即停止する。
  `flock`自体が無い環境は、lock競合と区別して`flock_unavailable`として
  明示的に停止する（「他のdeploy進行中」と誤報告しないため）。
- cleanupはrunning（今回deploy分）とprevious（rollback先）を、世代数に関係なく
  必ず除外する。

### S010-D01: server_impactの訂正

`notify`→**`approval_required`**へ訂正した（下記「server_impact判定」参照）。

### その他

`.gitattributes`を新規追加し、`*.sh`を`text eol=lf`に固定した。CRLFが混入すると
VPS上でbash起動が`\r: command not found`等で失敗するため。

## 変更理由

VPS管理側の2026-09-19決定（バックアップ方針決定と同時）。正式なイメージ
バージョン管理・ロールバック手順が未整備という既知課題（`ops/runtime-contract.yaml`の
`known_gaps`に記載済み）への対応。`scripts/deploy.ps1`・Composeの変更はアプリ側で
行ってよいとVPS管理側から明示許可を得ている。ただし「初回production利用は
別承認が必要」との条件が付いている。

## server_impact判定

server_impact: approval_required

判定理由: **先行するVPS管理側の方針決定
（`stockhome_backup_and_rollback_decision_20260919.md` §4）が本変更を
`approval_required`と指定しているため、前回noticeの`notify`から訂正した（S010-D01）。**
実体としても、API containerのbuild・切替・自動rollbackとDocker image保持/削除という
production中核経路を変更するものであり、`approval_required`が妥当である。
port/bind/domain/health endpoint/DB schema/migration/volume/cron/API contract/
env変数名・secret種類は変更していない。

## 現在と変更後

| 項目 | 現在 | 変更後 |
|---|---|---|
| APIイメージtag | 暗黙の`latest`相当。`up -d --build`のたびに上書きされ、旧imageは自動では残らない | commit固定tag`stockhome-api:git-<40桁commit>`。`API_IMAGE_TAG`未設定時は従来どおり`latest`にfallback（後方互換） |
| artifactの作り方 | `tar`＋excludeパターンでworking treeを固める（未コミット変更が混入しうる） | `git archive <commit>`。commitの追跡ファイルのみ。未コミット変更・`.env`は原理的に混入しない |
| deploy対象commitの保証 | 無し（`-Force`で未コミット状態でもdeploy可能だった） | `origin/main`に含まれることを検証。未pushのcommitはdeployできない。`-Force`は廃止 |
| deploy排他 | 無し | `flock`による非blocking lock。競合時は何も変更せず停止 |
| 確認項目 | ローカル端末からinternal `/health` 200のみ | internal/public の`/health`(200)・`/api/bridge/health`(401) の4点。deploy成功時とrollback後の双方 |
| health失敗時 | 例外を投げて手動rollback commandを表示するだけ。**異常な新containerが稼働したまま残る** | 保全したprevious tagへ**自動rollback**し、health matrixを再確認。復旧できなければ異常終了しcleanupしない |
| 旧image世代管理 | 無し（都度手動で`rollback-YYYYMMDD-NNN`等を保全） | health成功後のみ、直近3世代の`git-*`を保持。running/previousは世代数に関係なく除外 |
| rollback手順 | 手動でCompose override、または旧sourceを別directoryへ展開して再build | `npm run deploy -- -RollbackTo <40桁commit>`。`--no-build`で固定tagを起動しhealth matrix確認 |

## 影響対象

- service/container: `stockhome-api-prod`（build・切替・image保持/削除の経路。`stockhome-postgres-prod`・DBデータ・volumeは無関係）
- URL/port/health: 変更なし（`127.0.0.1:4002`、`/health`のcontractは既存のまま。**確認する項目を増やしただけでendpoint自体は不変**）
- cron/timer/worker: 変更なし
- dependency: 変更なし（新規パッケージ追加なし。VPS側は`flock`（util-linux）・`curl`・`bash`・`docker compose`を使用。いずれも既存環境に存在することをVPS管理側がread-onlyで確認済み）
- data/DB/volume: 変更なし
- log/monitoring: 変更なし（runnerの標準出力はdeploy実行時の端末表示のみで、productionの構造化ログとは無関係）

## production変更

- 必要性: あり（次回deploy時に`scripts/deploy.ps1`・`scripts/vps-deploy-runner.sh`・`docker-compose.prod.yml`がVPS上の`~/stockhome`へ転送される）
- 想定作業: 次回の通常deployで反映される。**ただし「初回production利用」（新方式でのtag付きbuild・世代管理・自動rollback・明示rollbackの実動作）はVPS管理側の個別承認後に限る**。本noticeはソース反映についてのレビューを求めるものであり、新方式を実際に使ってdeployしてよいかは別途確認する。
- downtime: 既存と同じ（brief-restart。`api`コンテナのみ再ビルド・入れ替え、`postgres`コンテナ・DBデータは変更しない）
- maintenance window: 不要

`production_change: required`のため、`deployment_status: not_started`のままVPS管理側へ引き継ぐ。

## 利用者への影響

- user_maintenance_impact: none
- 対象利用者・機能: なし（deploy運用のみの変更で、利用者向け機能・APIレスポンスに変更はない）。むしろhealth失敗時に自動復旧するようになるため、失敗deployが利用者へ影響する時間は短くなる
- 通知方法: 不要

## env・secret contract

- 変更: なし
- 変数名・secret種類のみ: `API_IMAGE_TAG`（`docker-compose.prod.yml`のbuild/run時変数。secretではなく、commit hashから機械的に導出される値）。runnerの動作を上書きする`SH_*`環境変数群はproduction実行時には設定されない（分離環境での検証用。既定値がproduction値）
- provisioning/rotation: 不要（VPS側`.env`への追加は不要）

secret値は記載していない。

## Data・migration・backup

- schema/format変更: なし
- migration: なし
- backup対象: なし（imageのtag付け方式のみで、DBデータには触れない）
- restore確認: 該当なし
- backward compatibility: あり（`API_IMAGE_TAG`未設定時は従来どおり`latest`。本変更を反映しただけでは動作は変わらず、新方式が使われるのは次回`npm run deploy`実行時から）
- **data rollbackは扱わない**（image rollbackのみ。DB restoreはdeploy scriptから自動実行しない）

## Deploy・rollback

- deploy前提: 対象commitが`origin/main`にpush済みであること。未pushならartifactを作らず停止する
- deploy手順の変更: あり（上記「現在と変更後」参照）。tarball転送・展開の流れ自体は不変
- rollback方法:
  - **自動**: health matrix失敗時、切替前に保全したprevious tagへ同一処理内で戻し、health matrixを再確認する
  - **明示**: `npm run deploy -- -RollbackTo <40桁commit hash>`。`--no-build`で固定tagを起動しhealth matrix確認
- rollback不能条件:
  - 対象commitのtagが直近3世代を超えて既に削除されている場合（`rollback_target_missing`で無変更停止）
  - 自動rollback後のhealth確認にも失敗した場合（`rollback_health_failed_manual_intervention_required`で異常終了。cleanupは行わない）

## Health・テスト

- health contract変更: なし（確認する項目を4点へ増やしただけで、endpointと期待値は既存のproduction標準どおり）
- 実施テスト:

  **(A) 静的検証**
  - `bash -n scripts/vps-deploy-runner.sh`: passed
  - PowerShell構文解析（`Parser::ParseFile`）: passed
  - `docker-compose.prod.yml`のYAML解析: passed（`api.image`が`stockhome-api:${API_IMAGE_TAG:-latest}`）
  - 固定検証3コマンド（shared/apiビルド、mobile型チェック）: passed

  **(B) 分離環境での動的検証**（レビュー再レビュー条件2への対応。
  productionと分離したローカルDocker環境。偽APIコンテナで`/health`・
  `/api/bridge/health`を模擬し、health応答を制御できるようにした。
  **VPSへは一切接続していない**）
  - 正常deploy 5世代連続: いずれも`DEPLOY_RESULT=success`、health matrix 4点とも期待値
  - 3世代保持: 5世代deploy後に直近3件のみ残存、古い2件を削除。`keeping`除外も動作
  - **health失敗からの自動復旧**: 新imageが`internal_health=500`/`public_health=500`を
    返す状況を作り、`health_failed_attempting_rollback`→previous imageへ自動rollback→
    `rolled_back_to_previous`（4点とも期待値）を確認。**稼働中の偽APIが正常世代へ
    戻っていること**と、失敗imageが削除されずに残ることも確認
  - **旧方式image（タグ無し）からの初回deploy**（＝本番で最初に起きるケース）:
    Compose自動命名imageを`pre-v2-<timestamp>`として保全し、health失敗時に
    そこへ自動rollbackできることを確認。正常系（旧→新への初回deploy成功）も確認
  - 明示rollback: `rollback_success`（4点とも期待値）。存在しないtag指定時は
    `rollback_target_missing`で**無変更のまま停止**することを確認
  - lock競合: lockを保持した別プロセスがある状態でdeployを試み、`lock_failed`で
    即停止。**buildも切替も実行されず、稼働中containerが無変更**であることを確認
  - 終了コード: `rollback_target_missing`=22、tag未指定=2、rollback health失敗=34、
    正常rollback=0 を確認
  - 検証に使ったcontainer・image・compose projectはすべて削除済み（残存0を確認）

  **(C) deploy.ps1の実地検証**（VPS非接続）
  - `-DryRun`: commit解決→`origin/main`包含検証→`git archive`→内容検査まで成功。
    artifactにrunner scriptが含まれ、`.env`系・`node_modules`が含まれないことを確認。
    実行後にartifactが削除されることも確認
  - **未pushのcommitでの拒否**: ローカルのみに存在するcommitを対象にしたところ、
    「`origin/main`に含まれていません。push してから再実行してください」で
    artifactを作らず停止することを実地で確認（S010-B01の中核）
  - runnerが対象commitに未コミットの場合、artifact検査で停止することを確認

- 結果: すべて成功
- 未実施テストと理由: **VPS上での実接続テスト（実際のscp/ssh経由のdeploy・rollback、
  実nginx経由のpublic health、複数世代にわたる実運用でのtag削除）は未実施。**
  理由: production環境への接続はVPS管理側の個別承認後に限られるため。
  上記(B)(C)で代替した。実環境固有の差分（nginx経由のpublic health応答、
  VPS上の`flock`・`curl`・`docker compose`のバージョン差、`~/stockhome`の
  Compose project名）は初回production利用時に確認が必要。

## Log・監視

- log量/形式/保存先変更: なし
- 新しいalert条件: なし
- secret/個人情報対策: 変更なし（commit hash・image tagに秘匿情報は含まれない。runnerは`.env`を読まない）

## 提出前セルフチェック

正本: `C:\work\PRG\Sakura\Dev\vps-server-management\docs\templates\server_change_notice_pre_submission_checklist.md`

- [x] production baselineとrelease全commit・build入力差分を確認した（baseline`ec6e541`から`dcccd40`までの全commitを実際の時系列順で記載。上記release_commits参照）
- [x] source commitとnoticeをremoteの対象branchへpushした（`dcccd40`はpush済み、local/origin一致確認済み。本notice fileはこれからcommit・pushする）
- [ ] data更新のtransaction・同時実行・途中失敗・再実行を確認した — 該当なし（DBデータ更新を伴わない変更のため）。ただしdeploy自体の同時実行は`flock`で排他し、分離環境で競合時の安全停止を確認済み
- [x] image rollbackとdata rollback、backup/restore条件を分けた（本変更はimage rollbackのみ。data rollbackは扱わず、DB restoreをdeploy scriptから自動実行しない）
- [x] job/log/retention、runtime/dependency、client配信の該当有無を確認した（job/log/retention: 該当なし。runtime/dependency: Compose定義の`image:`追加のみ。client配信: 該当なし）
- [ ] app owner、VPS review、production承認、client配信承認を分離した — 方針決定（commit固定tag・3世代保持・script変更許可）はVPS管理側から得ているが、本実装への個別承認・production承認はいずれも未実施。下記Approval参照
- [x] secret非混入とtracked working tree cleanを確認した（`git status --short`で確認。既知の無関係な未追跡ファイル`ops/investigations/`・`ops/production-db-operations/`のみ残存、本commitには含めない）

未確認・該当なしの理由: 「data更新のtransaction」項目はDBデータを一切扱わない変更のため該当なし。app owner・VPS review・production承認は本notice提出時点で未実施のまま記録する。

## 未解決事項

- **VPS上での実接続検証が未実施**（上記「Health・テスト」参照）。初回production利用時に、
  実nginx経由のpublic health応答、VPS上の`flock`/`curl`/`docker compose`の挙動、
  `~/stockhome`のCompose project名との整合を確認する必要がある。
- 本sourceはnotice 011のsourceを祖先に含むため、通常deployでは両者が結合される
  （レビュー§5）。production反映は両notice IDと最終full commitを明記した一つの
  production計画で扱っていただきたい。
- NAS側snapshot設定の実機確認（所見C-2、VPS管理側で別途実施予定。本noticeの対象外）

## 希望時期

特に指定なし。notice 011が`accepted`済みのため、両noticeを合わせたproduction計画を
VPS管理側の都合の良いタイミングで検討いただきたい。

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: これから実施
- VPS管理チャットへ渡すローカル絶対path: `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260919-STOCKHOME-010-summary.md`

## Approval

- app owner: 方針決定（commit固定tag・3世代保持、`scripts/deploy.ps1`とComposeの変更許可）は得ている。本実装への個別承認は未実施
- VPS management review: 1回目blocked（2026-09-19、S010-B01〜B03・S010-D01の4点。本改訂ですべて対応）
- production approval: 未実施（「初回production利用は別承認が必要」との条件あり）
- related task_id: なし（ai-watch task経由ではなく、Claude対話セッションで直接実装・検証した）
