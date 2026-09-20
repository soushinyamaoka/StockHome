# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20260919-STOCKHOME-010

app: stockhome

source_branch: main

source_commit: 3a7c9fb966f19d98880f3beccf2b697c12e1602b

production_baseline_commit: ec6e541b8bf88654baa68c3dd3b1c2fcbdb9d6ad

release_commits:（baseline以降、実際のcommit時系列順。3回目レビュー以降の分のみ再掲。
それ以前の全commit列は初回・1回目・2回目再提出時のnotice本文を参照）

- `ec6e541`（baseline。notice `20260918-STOCKHOME-009`でproduction反映・`verified`済み）
- （中略。1〜2回目レビューまでの全commitは前回提出のrelease_commits参照）
- `b0c1535`（2回目レビューblocker対応source）
- `e5ac6f8`（notice 010の2回目再提出。`ops/**`のみ）
- `3a7c9fb`（**本notice対象・source**。3回目レビューblocker5点対応。
  `scripts/vps-deploy-runner.sh`・`scripts/deploy.ps1`・`docker-compose.prod.yml`）

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
2026-09-19の3回目VPS管理レビューでblockedとなった5点へ対応したもの。

### 1. Composeへproduction .envを明示指定する（今回対応、重大）

前回（2回目レビュー対応）で`--project-directory`を`releases/<tag>`（deployのたびに
作り直す一時領域）へ変更したことに伴う**副作用のバグ**。`.env`の実体は
`$HOME/stockhome/.env`という永続的な場所にあり、`releases/<tag>`には含まれない
（`.env`はgit追跡外でtarballにも含まれない）。Composeの既定の`.env`探索先は
`--project-directory`基準のため、`releases/<tag>`に`.env`が無いことになり、
**`POSTGRES_PASSWORD`・`JWT_SECRET`・`BRIDGE_TOKEN`等が空文字列で解決される**
状態になっていた（**新方式でのdeployは実質的にすべて機能しない状態だった**）。

- `vps-deploy-runner.sh`の`dc()`呼び出しへ`--env-file "$ENV_FILE"`
  （既定`$HOME/stockhome/.env`、`SH_ENV_FILE`で上書き可）を追加して修正した。
- **ローカル検証で実際にバグを再現した**: `--env-file`を除いた（修正前相当の）
  runnerで偽APIをdeployし、環境変数として渡した秘密値相当（`SECRET_VALUE`）が
  空になることを確認した。その後、修正版のrunnerで同じdeployを行い、値が
  正しく伝わることを確認した。

### 2. bootstrapをPowerShell 5.1でもUTF-8/LFで生成する（今回対応）

`git show commit:path > file`というPowerShellの`>`（`Out-File`相当）は、
Windows PowerShell 5.1の既定でUTF-16LEへ再エンコードする。これにより
`scripts/vps-bootstrap.sh`（UTF-8/LF、日本語コメント含む）がVPSへ転送される前に
文字化け・UTF-16化し、bashが解釈できない壊れたscriptになっていた。

- `cmd /c "git show ... > file"`へ変更した。cmd.exeの`>`はネイティブプロセス
  （git.exe）の標準出力を一切再解釈せずバイト列のまま書き出すため、commit内の
  実バイトがそのまま保存される。
- 転送直後に、生成したファイルが (a) UTF-8 BOM無し、(b) `#!/bin/bash`で始まる、
  (c) CRLFを含まない、の3点を検証するチェックを追加した。いずれかに違反する
  場合はdeployを開始せず例外にする。
- **ローカル検証で、生成物が元のgit blobとバイト単位で完全一致することを確認した**
  （`[System.Linq.Enumerable]::SequenceEqual`で比較）。

### 3. local/remote一時fileを実行ごとの固有名にする（今回対応）

従来、ローカルのtarball（`deploy.tgz`）・bootstrap一時コピー
（`vps-bootstrap.local.sh`）、およびVPS上のbootstrap配置先
（`~/stockhome/vps-bootstrap.sh`）はいずれも固定名だった。並行して複数の
deploy/rollbackが実行された場合、互いのfileを上書きし合い、意図しない内容
（別commitのbootstrap等）を実行してしまう懸念があった。

- 実行ごとに`[guid]::NewGuid()`由来の12桁tokenを生成し、ローカルtarball・
  ローカルbootstrapコピー・VPS上のbootstrap配置先のいずれにも付与するよう
  変更した（例: `deploy-<token>.tgz`、`~/stockhome/.vps-bootstrap-<token>.sh`）。
- VPS上のbootstrap一時fileは、実行完了後（成功・失敗いずれも）に
  ベストエフォートで削除するようにした（削除失敗はdeploy自体の結果に影響しない）。
- **ローカル検証で、連続2回のDryRun実行が異なるtarball名
  （`deploy-23c6a6f1de79.tgz`・`deploy-2535f3d05b51.tgz`）を生成することを確認した。**

### 4. 自動rollback時はdeploy失敗として非0終了する（今回対応）

`deploy.ps1`が`rolled_back_to_previous`（health失敗により自動rollbackした結果）を
`success`と同様に緑色の「OK」表示にしていた。これは、依頼された新commitへの
反映自体は失敗しているにもかかわらず、operatorに成功したと誤解させる表示だった。

- `success`のみを成功扱いとし、`rolled_back_to_previous`を含むそれ以外の結果は
  すべて`throw`（PowerShellの非0終了）するよう修正した。メッセージ内容自体は
  「health確認に失敗したため、直前のイメージへ自動ロールバックしました
  （復旧後のhealth matrixは正常）」のまま維持し、systemは安全な状態にある
  ことは伝えつつ、**依頼されたdeploy自体は失敗として扱う**。

### 5. 現行container不在時はbuild前に停止する（今回対応）

従来、現行container（`stockhome-api-prod`）が存在しない場合を「初回deploy」として
扱い、保全対象が無いまま build・切替へ進んでいた。production運用では常に
containerが稼働している前提であり、不在は異常な状態（directory不一致・compose
project名の相違・手動操作の影響等）として扱うべき、との指摘を受けた。

- `PREVIOUS_IMAGE`が空（`docker inspect`が失敗する＝containerが存在しない）の
  場合は`no_previous_container`でbuild・切替のどちらも行わず停止するよう変更した。
- **完全な初回セットアップ（productionにcontainerが一度も存在しない状態）は
  本scriptの対象外**とし、別途手動でのbootstrapが必要である旨をscript内
  コメントへ明記した。
- **ローカル検証で、containerが存在しない状態からのdeployが
  `no_previous_container`でbuild未実行のまま停止することを確認した。**

## 変更理由

VPS管理側の2026-09-19決定（バックアップ方針決定と同時）。3回のVPS管理レビュー
（1回目: S010-B01〜B03・D01、2回目: 転送・展開のlock範囲とprevious image保全
失敗時の扱い、3回目: 上記5点）への対応。

## server_impact判定

server_impact: approval_required

判定理由: 前回・前々回から変更なし。先行するVPS管理側の方針決定
（`stockhome_backup_and_rollback_decision_20260919.md`§4）が本変更を
`approval_required`と指定している。今回の修正1（`.env`明示指定）は、
本deploy機構そのものが機能するために必須の訂正であり、production中核経路の
信頼性に直接関わる。

## 現在と変更後（前回noticeからの差分のみ）

| 項目 | 前回（`b0c1535`） | 今回（`3a7c9fb`） |
|---|---|---|
| Composeの`.env`解決 | `--project-directory`基準の既定探索（`releases/<tag>`には`.env`が無く、秘密値が空文字列になる） | `--env-file`で`$HOME/stockhome/.env`を明示指定 |
| bootstrap転送のencoding | PowerShellの`>`（既定でUTF-16LEへ再エンコード、壊れる） | `cmd /c`の`>`（バイト列そのまま。BOM無し/shebang/CRLF不在を転送直後に検証） |
| 一時fileの命名 | 固定名（`deploy.tgz`・`vps-bootstrap.local.sh`・`~/stockhome/vps-bootstrap.sh`） | 実行ごとに一意（GUID由来token付き）。VPS側は実行後にベストエフォートで削除 |
| 自動rollback時のdeploy.ps1終了コード | `rolled_back_to_previous`もsuccess扱い（0終了、緑色OK） | `success`以外はすべて非0終了（`rolled_back_to_previous`を含む） |
| 現行container不在時 | 初回deployとして許容し、そのままbuildへ進む | `no_previous_container`でbuild・切替とも行わず停止。初回セットアップは対象外・別途手動対応 |

## 影響対象

- service/container: `stockhome-api-prod`（build・切替・image保持/削除・env解決の経路。`stockhome-postgres-prod`・DBデータ・volumeは無関係）
- URL/port/health: 変更なし
- cron/timer/worker: 変更なし
- dependency: 変更なし
- data/DB/volume: 変更なし
- log/monitoring: 変更なし

## production変更

- 必要性: あり
- 想定作業: 次回の通常deployで反映される。**「初回production利用」はVPS管理側の個別承認後に限る。** なお、今回の修正5により、初回利用時に現行containerが（新旧いずれの方式であれ）稼働中であることが前提条件になった点に留意されたい。
- downtime: 既存と同じ
- maintenance window: 不要

`production_change: required`のため、`deployment_status: not_started`のままVPS管理側へ引き継ぐ。

## 利用者への影響

- user_maintenance_impact: none
- 対象利用者・機能: なし
- 通知方法: 不要

## env・secret contract

- 変更: なし
- 変数名・secret種類のみ: `SH_ENV_FILE`（新規、分離環境での検証用。production実行時は未設定、既定値`$HOME/stockhome/.env`が使われる）
- provisioning/rotation: 不要（`.env`自体の配置・更新方法は変更なし）

secret値は記載していない。

## Data・migration・backup

- schema/format変更: なし
- migration: なし
- backup対象: なし
- restore確認: 該当なし
- backward compatibility: あり
- data rollbackは扱わない（image rollbackのみ）

## Deploy・rollback

- deploy前提: 対象commitが`origin/main`にpush済みであること。**現行containerが稼働中であること**（今回追加）
- deploy手順の変更: あり（上記「現在と変更後」参照）
- rollback方法:
  - **自動**: health matrix失敗時、切替前に保全したprevious tagへ同一処理内で戻し、health matrixを再確認する。**この場合deploy.ps1は非0終了する（今回修正）**
  - **明示**: `npm run deploy -- -RollbackTo <40桁commit hash>`
- rollback不能条件:
  - 現行containerが存在しない場合（今回追加。build・切替前に停止するため、rollback以前に通常deploy自体が実行されない）
  - previous imageを保全できなかった場合
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
  偽APIコンテナ使用。**VPSへは一切接続していない**）

  - **`.env`明示指定（修正1）**: `$HOME/stockhome/.env`相当の場所へ
    `SECRET_VALUE=correctsecret123`を配置。修正版runnerでdeployし、
    起動したcontainerの環境変数として正しく`correctsecret123`が渡ることを
    確認。**さらに`--env-file`を除いた修正前相当のrunnerで同じ操作を行い、
    値が`MISSING`（空・伝達されない）になることを直接確認し、修正の必要性を
    実証した**
  - **bootstrap転送のencoding（修正2）**: `cmd /c "git show ... > file"`で
    生成したファイルが、BOM無し・`#!/bin/bash`で開始・CRLF不在であること、
    および元のgit blobとバイト単位で完全一致することを確認
  - **一時fileの一意性（修正3）**: 連続2回の`-DryRun`実行で、生成される
    tarball名が毎回異なることを確認。実行後にすべての一時file
    （ローカルtarball・ローカルbootstrapコピー）が削除されていることを確認
  - **自動rollback時の非0終了（修正4）**: `deploy.ps1`の判定ロジックを
    抽出し、`rolled_back_to_previous`がPowerShellの例外（非0終了）として
    捕捉されることを確認
  - **現行container不在時の停止（修正5）**: containerが一切存在しない状態で
    deployを試み、`no_previous_container`でbuildが実行されないことを確認
  - 検証に使ったcontainer・image・compose projectはすべて削除済み（残存0を確認）

- 結果: すべて成功
- 未実施テストと理由: **VPS上での実接続テストは未実施**（前回・前々回と同様）。
  理由: production環境への接続はVPS管理側の個別承認後に限られるため。
  実環境固有の差分（nginx経由のpublic health応答、VPS上の`flock`/`curl`/
  `docker compose`のバージョン差、`~/stockhome/.env`の実際の内容との整合、
  `~/stockhome`の実際のproject名が想定どおり`stockhome`であることの確認）は
  初回production利用時に確認が必要。

## Log・監視

- log量/形式/保存先変更: なし
- 新しいalert条件: なし
- secret/個人情報対策: 変更なし。`--env-file`の指定はfile pathのみで、secret値そのものはnotice・commit・logに一切含めていない

## 提出前セルフチェック

正本: `C:\work\PRG\Sakura\Dev\vps-server-management\docs\templates\server_change_notice_pre_submission_checklist.md`

- [x] production baselineとrelease全commit・build入力差分を確認した
- [x] source commitとnoticeをremoteの対象branchへpushした（`3a7c9fb`はpush済み、local/origin一致確認済み）
- [ ] data更新のtransaction・同時実行・途中失敗・再実行を確認した — 該当なし（DBデータ更新を伴わない変更のため）
- [x] image rollbackとdata rollback、backup/restore条件を分けた
- [x] job/log/retention、runtime/dependency、client配信の該当有無を確認した
- [ ] app owner、VPS review、production承認、client配信承認を分離した — 方針決定はVPS管理側から得ているが、本実装への個別承認・production承認は未実施
- [x] secret非混入とtracked working tree cleanを確認した

未確認・該当なしの理由: 「data更新のtransaction」項目はDBデータを一切扱わない変更のため該当なし。app owner・VPS review・production承認は本notice提出時点で未実施のまま記録する。

## 未解決事項

- **VPS上での実接続検証が未実施**（前回・前々回・今回とも同様）。初回production利用時に確認する。特に`~/stockhome/.env`の実在と内容の整合を確認する必要がある（今回の修正1により、この`.env`ファイルの存在が新方式deployの前提条件になった）。
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
- VPS management review: 1回目blocked（S010-B01〜B03・D01、対応済み）、2回目blocked（転送・展開のlock範囲、previous image保全失敗時の扱い、対応済み）、3回目blocked（.env明示指定・bootstrap encoding・一時file一意性・自動rollback時の終了コード・現行container不在時の停止、本改訂で対応）
- production approval: 未実施（「初回production利用は別承認が必要」との条件あり）
- related task_id: なし（Claude対話セッションで直接実装・検証した）
