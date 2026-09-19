# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20260919-STOCKHOME-010

app: stockhome

source_branch: main

source_commit: b0c15353f7c002217bd3ee8520d4e268e1d3d744

production_baseline_commit: ec6e541b8bf88654baa68c3dd3b1c2fcbdb9d6ad

release_commits:（baseline以降、実際のcommit時系列順。2回目レビュー以降の分のみ再掲）

- `ec6e541`（baseline。notice `20260918-STOCKHOME-009`でproduction反映・`verified`済み）
- （中略。`20260919-STOCKHOME-010`初回提出時のrelease_commits参照）
- `ad432fb`（notice `20260919-STOCKHOME-011`。所見A-1/A-3/B-5対応。**本noticeの対象外**、011で`accepted`済み）
- `dcccd40`（**本noticeの前回source**。1回目レビューでblocked）
- `274a7b6`（notice 010の1回目再提出。`ops/**`のみ）
- `b0c1535`（**本notice対象・source**。2回目レビューblocker2点対応。`scripts/vps-bootstrap.sh`新規、`scripts/vps-deploy-runner.sh`全面改訂、`scripts/deploy.ps1`全面改訂）

**本noticeが対象とするのはdeploy/rollback機構（`scripts/deploy.ps1`・
`scripts/vps-bootstrap.sh`・`scripts/vps-deploy-runner.sh`・`docker-compose.prod.yml`・
`.gitattributes`）のみ。notice 011（mobile UI・push payload）は内容的に無関係な
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
2026-09-19の2回目VPS管理レビューでblockedとなった2点（転送・展開のlock範囲、
previous image保全失敗時の扱い）へ対応したもの。

**前回（`dcccd40`）からの構成変更:** deploy本体を `scripts/vps-bootstrap.sh`
（新規、lock取得と展開のみを担当）と `scripts/vps-deploy-runner.sh`
（lock取得・展開ロジックを除去し、build・切替・health確認・cleanupに専念）の
2つへ再分離した。`scripts/deploy.ps1` は、対象commitの `vps-bootstrap.sh` を
固定pathへ転送したうえで、tarball本体を **stdin 経由で** bootstrap script へ
渡し、**1回のssh呼び出し**で実行する役に整理した。

### 転送・展開もlock対象にし、空の一時領域からbuildする（今回対応）

- **転送方式を変更した。** 従来は `scp` でtarballを転送してから別のssh呼び出しで
  展開していたため、展開がlock取得より前に行われていた。今回、tarball本体は
  **stdin経由**で `bash vps-bootstrap.sh ... < deploy.tgz` として1回のssh呼び出しに
  統合し、bootstrap script内で**flock取得後に初めて`tar -xzf -`で展開する**
  ようにした。転送されたペイロードの受信・展開・build・切替・health確認・cleanupは
  すべて同一のlock保持区間に入る。
- **展開先を`releases/<tag>`とし、展開前に必ず`rm -rf`してから使う。**
  以前の展開内容・削除されたはずのファイル・中断した展開の残骸を残さない。
  ローカル検証で、意図的に配置した残骸ファイルが同一tagの再展開で確実に消える
  ことを確認した。
- **並行deployは、lockを取得できなかった側が展開すら始めずに即座に安全停止する。**
  30秒かかるbuildを実行中の別プロセスへ向けて競合するdeployを試み、
  `lock_failed`で拒否され、release directoryも作られず、稼働中containerも
  無変更であることを実時刻付きで確認した。
- **`docker compose`の呼び出しへproject名を明示固定した**（`-p stockhome`）。
  `releases/<tag>`という毎回異なるdirectoryからbuildすることになったため、
  project名をdirectory名由来の既定値に任せると、deployのたびにproject/network
  identityが変わり、同一compose file内のpostgres serviceとの内部DNS解決が
  壊れる懸念があった。既存運用のproject名（`~/stockhome`由来の`stockhome`）へ
  明示的に固定することで、build元のdirectoryが変わってもnetwork/連携は不変に保つ。
- `-RollbackTo`（明示ロールバック）も同じ経路（transfer+lock+展開）を通るよう
  統一した。対象commitを`git archive`で取り直し、runnerには`--no-build`を渡して
  既存imageへの切替のみを行う。以前の軽量な`--rollback-only`（lockのみ・展開なし）
  は廃止した。

### previous imageを保全できない場合は、build・切替前に停止する（今回対応）

- 現行containerが存在するのに、その参照するimageを安全に保全（`docker tag`で
  immutable tagを付与）できなかった場合、または保全したtagが実在確認できな
  かった場合は、`previous_image_preserve_failed`で**build・切替のどちらも行わずに
  停止する**ようにした。前回実装は、この場合でも`ROLLBACK_TAG`が空のまま
  素通りしてbuildへ進んでいた。
- **ローカル検証で実際にこの状況を再現した**: `docker rmi -f`で稼働中containerが
  参照するimage tagだけを削除し（container自体は稼働継続、`docker inspect`の
  `Config.Image`は古い文字列を返したままになる）、その状態で新規deployを試み、
  `previous_image_preserve_failed`でbuildが一切実行されず、稼働中containerも
  無変更であることを確認した。
- 現行containerが存在しない（初回deploy）場合は保全対象が無いため、そのまま進む
  （この場合の挙動は前回から変更なし）。

## 変更理由

VPS管理側の2026-09-19決定（バックアップ方針決定と同時）。2回のVPS管理レビュー
（1回目: `stockhome_rollback_mechanism_review_20260919.md`、2回目: 転送・展開の
lock範囲とprevious image保全失敗時の扱いを指摘）への対応。

## server_impact判定

server_impact: approval_required

判定理由: 先行するVPS管理側の方針決定（`stockhome_backup_and_rollback_decision_20260919.md`
§4）が本変更を`approval_required`と指定しており、1回目レビューのS010-D01で訂正済み
（今回も維持）。API containerのbuild・切替・自動rollbackとDocker image保持/削除、
および今回追加したtarball受信・展開の実行順序という、production中核経路の
信頼性に関わる変更であるため。port/bind/domain/health endpoint/DB schema/
migration/volume/cron/API contract/env変数名・secret種類は変更していない。

## 現在と変更後（前回noticeからの差分のみ。全体の現在/変更後は前回提出内容も参照）

| 項目 | 前回（`dcccd40`） | 今回（`b0c1535`） |
|---|---|---|
| tarball転送 | `scp`で転送後、別のssh呼び出しで展開（lock取得前に展開が完了する） | stdin経由で1回のssh呼び出しに統合。bootstrap scriptがflock取得後に初めて展開する |
| 展開先 | `$RemoteDir`（`~/stockhome`）直下に展開（前回展開の残骸が残りうる） | `releases/<tag>`を毎回`rm -rf`してから展開（残骸が残らない） |
| docker composeのproject名 | 暗黙（directory名由来。`releases/<tag>`ごとに変わりうる） | `-p stockhome`で明示固定 |
| previous image保全失敗時 | `ROLLBACK_TAG`が空のまま素通りしてbuildへ進む | `previous_image_preserve_failed`でbuild・切替とも行わず停止 |
| 明示rollback（`-RollbackTo`） | `--rollback-only`（lockのみ、展開なし、既存release dirに依存しない） | 対象commitを`git archive`で取り直し、通常deployと同じlock+展開経路を`--no-build`で通る |

## 影響対象

- service/container: `stockhome-api-prod`（build・切替・image保持/削除の経路。`stockhome-postgres-prod`・DBデータ・volumeは無関係）
- URL/port/health: 変更なし
- cron/timer/worker: 変更なし
- dependency: 変更なし。VPS側は`flock`（util-linux）・`curl`・`bash`・`docker compose`を使用（既存環境に存在することをVPS管理側がread-onlyで確認済み）
- data/DB/volume: 変更なし
- log/monitoring: 変更なし

## production変更

- 必要性: あり（次回deploy時に`scripts/deploy.ps1`・`scripts/vps-bootstrap.sh`・`scripts/vps-deploy-runner.sh`・`docker-compose.prod.yml`がVPS上の`~/stockhome`へ反映される）
- 想定作業: 次回の通常deployで反映される。**「初回production利用」（新方式でのtag付きbuild・世代管理・自動rollback・明示rollbackの実動作）はVPS管理側の個別承認後に限る。**
- downtime: 既存と同じ（brief-restart）
- maintenance window: 不要

`production_change: required`のため、`deployment_status: not_started`のままVPS管理側へ引き継ぐ。

## 利用者への影響

- user_maintenance_impact: none
- 対象利用者・機能: なし
- 通知方法: 不要

## env・secret contract

- 変更: なし
- 変数名・secret種類のみ: `API_IMAGE_TAG`（既存）。`SH_*`環境変数群（分離環境での検証用、production実行時は未設定）
- provisioning/rotation: 不要

secret値は記載していない。

## Data・migration・backup

- schema/format変更: なし
- migration: なし
- backup対象: なし
- restore確認: 該当なし
- backward compatibility: あり
- data rollbackは扱わない（image rollbackのみ）

## Deploy・rollback

- deploy前提: 対象commitが`origin/main`にpush済みであること
- deploy手順の変更: あり（上記「現在と変更後」参照）
- rollback方法:
  - **自動**: health matrix失敗時、切替前に保全したprevious tagへ同一処理内で戻し、health matrixを再確認する
  - **明示**: `npm run deploy -- -RollbackTo <40桁commit hash>`。対象commitを`git archive`で取り直し、`--no-build`で既存imageへ切替
- rollback不能条件:
  - previous imageを保全できなかった場合（今回追加。build・切替前に停止するため、この場合は新規deploy自体が実行されない）
  - 対象commitのtagが直近3世代を超えて既に削除されている場合
  - 自動rollback後のhealth確認にも失敗した場合

## Health・テスト

- health contract変更: なし
- 実施テスト:

  **(A) 静的検証**
  - `bash -n scripts/vps-bootstrap.sh` / `bash -n scripts/vps-deploy-runner.sh`: passed
  - PowerShell構文解析: passed
  - `docker-compose.prod.yml`のYAML解析: passed
  - 固定検証3コマンド: passed

  **(B) 分離環境での動的検証**（productionと分離したローカルDocker環境。
  偽APIコンテナで`/health`・`/api/bridge/health`を模擬。**VPSへは一切接続していない**）

  - **空の一時領域からの展開**: `releases/<tag>`へ前回展開の残骸ファイル
    （`should_not_survive.txt`）を事前に配置し、同一tagで再展開。残骸ファイルが
    消えていることを確認
  - **並行deploy**: 30秒かかるbuild（`RUN sleep 30`）を実行中の別プロセスへ、
    3秒後に競合するdeployを試行。実時刻ログで競合window内であることを確認した
    うえで`lock_failed`即時拒否、release directory未作成、稼働中container無変更を
    確認。先行プロセスは30秒後に正常完了することも確認
  - **previous image保全失敗時の停止**: `docker rmi -f`で稼働中containerが
    参照するimage tagのみを削除（container自体は稼働継続、`Config.Image`は
    古いtag文字列を返したまま＝実際にVPS上で起こりうる状態を再現）。この状態で
    新規deployを試み、`previous_image_preserve_failed`（exit 12）でbuildが
    一切実行されず、稼働中containerが無変更であることを確認
  - 正常deploy5世代連続＋3世代保持: image・releaseディレクトリとも直近3件のみ
    残存することを確認（今回の再分離後も既存の保持ロジックは維持されている
    ことを再確認）
  - health失敗からの自動復旧、旧方式image（タグ無し）からの初回deploy
    （`Config.Image`が`repo:tag`形式でない場合の`pre-v2-<timestamp>`保全、
    health失敗時にそこへ自動rollback、正常系での新方式移行）、明示rollback
    （`--no-build`）、存在しないtagへのrollback試行の安全停止を、新しい経路で
    すべて再確認
  - 検証に使ったcontainer・image・compose projectはすべて削除済み（残存0を確認）

  **(C) deploy.ps1の実地検証**（VPS非接続）
  - `-DryRun`: commit解決→`origin/main`包含検証→`git archive`→内容検査まで成功。
    `scripts/vps-bootstrap.sh`がartifactに含まれることを確認。実行後にtarball・
    ローカルbootstrapコピーが削除されることも確認

- 結果: すべて成功
- 未実施テストと理由: **VPS上での実接続テストは未実施**（前回同様）。理由:
  production環境への接続はVPS管理側の個別承認後に限られるため。上記(B)(C)で
  代替した。実環境固有の差分（nginx経由のpublic health応答、VPS上の
  `flock`/`curl`/`docker compose`のバージョン差、`~/stockhome`の実際の
  project名が想定どおり`stockhome`であることの確認）は初回production利用時に
  確認が必要（前回から変更なし）。

## Log・監視

- log量/形式/保存先変更: なし
- 新しいalert条件: なし
- secret/個人情報対策: 変更なし

## 提出前セルフチェック

正本: `C:\work\PRG\Sakura\Dev\vps-server-management\docs\templates\server_change_notice_pre_submission_checklist.md`

- [x] production baselineとrelease全commit・build入力差分を確認した
- [x] source commitとnoticeをremoteの対象branchへpushした（`b0c1535`はpush済み、local/origin一致確認済み）
- [ ] data更新のtransaction・同時実行・途中失敗・再実行を確認した — 該当なし（DBデータ更新を伴わない変更のため）。ただしdeploy自体の同時実行は`flock`で排他し、分離環境で競合時の安全停止を実時刻ログ付きで確認済み
- [x] image rollbackとdata rollback、backup/restore条件を分けた
- [x] job/log/retention、runtime/dependency、client配信の該当有無を確認した
- [ ] app owner、VPS review、production承認、client配信承認を分離した — 方針決定はVPS管理側から得ているが、本実装への個別承認・production承認は未実施
- [x] secret非混入とtracked working tree cleanを確認した

未確認・該当なしの理由: 「data更新のtransaction」項目はDBデータを一切扱わない変更のため該当なし。app owner・VPS review・production承認は本notice提出時点で未実施のまま記録する。

## 未解決事項

- **VPS上での実接続検証が未実施**（前回・今回とも同様）。初回production利用時に確認する。
- 本sourceはnotice 011のsourceを祖先に含むため、通常deployでは両者が結合される（レビュー§5）。production反映は両notice IDと最終full commitを明記した一つの計画で扱っていただきたい。
- NAS側snapshot設定の実機確認（所見C-2、VPS管理側で別途実施予定。本noticeの対象外）

## 希望時期

特に指定なし。

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: これから実施
- VPS管理チャットへ渡すローカル絶対path: `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260919-STOCKHOME-010-summary.md`

## Approval

- app owner: 方針決定は得ている。本実装への個別承認は未実施
- VPS management review: 1回目blocked（S010-B01〜B03・D01、`274a7b6`で対応）、2回目blocked（転送・展開のlock範囲、previous image保全失敗時の扱い、本改訂で対応）
- production approval: 未実施（「初回production利用は別承認が必要」との条件あり）
- related task_id: なし（Claude対話セッションで直接実装・検証した）
