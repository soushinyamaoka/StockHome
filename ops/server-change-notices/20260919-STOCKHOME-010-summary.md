# Server Change Notice

record_type: server_change

template_type: full

policy_bundle_version: 2026-09-05.1

notice_id: 20260919-STOCKHOME-010

app: stockhome

source_branch: main

source_commit: 084d1d142e8ad93b66767bd569ad4309da74c452

production_baseline_commit: ec6e541b8bf88654baa68c3dd3b1c2fcbdb9d6ad

release_commits: `ec6e541`（baseline。notice `20260918-STOCKHOME-009`でproduction反映・
`verified`済み）→ `2529199`/`813032b`/`e46723c`（notice 009・client release記録の
docs更新4件。`ops/**`・`docs/**`のみでbuild inputに影響しない）→ `0a6e781`
（task `20260918-003`、品目検索・絞り込み機能。**apps/mobileのみ、API build inputに
影響しない**。notice不要と判定済み。B-7対応）→ `3e4be99`（client release 006計画作成。
`ops/**`のみ）→ `c2b6fa9`/`f45db49`/`fdf42a0`/`a2376bb`（CI設定`.github/workflows/ci.yml`の
新設・修正4件。**production runtimeに影響しない**。実施主体はClaude対話セッション）→
`12ac1a5`（`ops/runtime-contract.yaml`のみ、C-2バックアップ方針記録。build inputに
影響しない）→ `ad432fb`（task `20260919-006`、所見A-1/A-3/B-5対応。
**apps/mobile・apps/apiのソース変更あり、API build inputに影響する**。
**本noticeの対象外**。別途notice作成予定）→ `084d1d1`（本notice source。
`scripts/deploy.ps1`・`docker-compose.prod.yml`のみ変更。
**本notice対象**。実施主体はClaude対話セッション）。

**本noticeが対象とするのは`084d1d1`のみ（deploy/rollback機構の追加）。
`ad432fb`（mobile UI・push payload変更、所見A-1/A-3/B-5）は内容的に無関係な
別変更のため、別途独立したnoticeを作成する。次回のVPS反映では両commitが
同一のtarball転送に含まれることになるが、build成果物（`dist/`）に影響するのは
`ad432fb`のみで、`084d1d1`はdeployスクリプト・Compose定義のみの変更である。**

impact_level: L2

status: ready_for_review

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 変更概要

所見C-5（優先度「中」）「ロールバック手順が毎回の手作業のまま」への対応。
2026-09-19にVPS管理側が決定したロールバック方針（commit固定tag
`stockhome-api:git-<40桁commit>`、成功image 3世代保持）を実装した。

- `docker-compose.prod.yml`: `api`サービスに`image: stockhome-api:${API_IMAGE_TAG:-latest}`
  を追加。`API_IMAGE_TAG`未設定時は従来どおり`latest`として動作する（後方互換）。
- `scripts/deploy.ps1`:
  - deploy前にgit working treeのdirty check（未commit変更があれば中断。`-Force`で
    明示的に無視可能）を追加した。「tag = そのcommitのソース」という前提を
    守るため
  - deploy時点のgit commit hash（40桁フル）でイメージをタグ付けするようにした
  - health check成功後のみ、直近3世代を超える古い`git-*`タグを削除する処理を
    追加した（health失敗時は削除しない。rollback先を壊さないため）
  - `-RollbackTo <commit>`パラメータを追加し、VPS上に保持されている既存タグへ
    切り替え、health checkする機能を追加した

## 変更理由

VPS管理側の2026-09-19決定（バックアップ方針決定と同時）。正式なイメージ
バージョン管理・ロールバック手順が未整備という既知課題（`ops/runtime-contract.yaml`の
`known_gaps`に記載済み）への対応。scripts/deploy.ps1・Composeの変更はアプリ側で
行ってよいとVPS管理側から明示許可を得ている。ただし「初回production利用は
別承認が必要」との条件が付いている。

## server_impact判定

server_impact: notify

判定理由: deploy手順・イメージタグ付け方式・古いimageの自動削除という、
production deployの中核スクリプトを変更するため。既存の`docker compose up -d --build`
という起動方式自体は変えておらず（`image:`フィールド追加は後方互換）、
port/bind/domain/health/DB schema/migration/volume/cron/API contractのいずれも
変更していないが、deploy運用の変更としてVPS管理側の確認が必要と判断した。

## 現在と変更後

| 項目 | 現在 | 変更後 |
|---|---|---|
| APIイメージtag | 暗黙の`latest`相当。`docker compose up -d --build`のたびに上書き、旧imageは自動では残らない | commit固定tag`stockhome-api:git-<40桁commit>`。`API_IMAGE_TAG`未設定時は従来どおり`latest`にfallback（後方互換） |
| 旧image世代管理 | 無し（過去のtask記録では手動で`stockhome-api:rollback-YYYYMMDD-NNN`のようなtagを都度手作業で保全） | health check成功後のみ、直近3世代（現在deploy分含む）の`git-*`タグを自動保持し、それより古いものを削除 |
| rollback手順 | 正式な仕組み未整備。旧source archiveとDB dumpを都度手動保全し、health失敗時に手動でCompose overrideするか、旧sourceを別directoryへ展開して再build（`ops/runtime-contract.yaml`のdeploy.rollback参照） | `scripts/deploy.ps1 -RollbackTo <40桁commit hash>`で、VPS上に保持されている該当タグへ`docker compose up -d api`で切り替え、health check。対象タグが直近3世代を超えて既に削除済みの場合はエラーで停止 |
| deploy前提条件 | 特に無し（working treeの状態は確認しない） | git working treeがdirty（未commit変更あり）だと通常deployを中断する（`-Force`で明示的に無視可能だが、その場合tagの中身とcommit履歴が一致しなくなる） |

## 影響対象

- service/container: `stockhome-api-prod`（イメージのタグ付け方式・世代管理のみ変更。`stockhome-postgres-prod`・DBデータ・volumeは無関係）
- URL/port/health: 変更なし（`127.0.0.1:4002`、`/health`のcontractは既存のまま）
- cron/timer/worker: 変更なし
- dependency: 変更なし（新規パッケージ追加なし）
- data/DB/volume: 変更なし
- log/monitoring: 変更なし（`scripts/deploy.ps1`の`Write-Host`出力はローカル端末表示のみで、productionの構造化ログ（stdout/stderr、1行1JSON）とは無関係）

## production変更

- 必要性: あり（本変更自体をVPSへ反映するには、次回deploy時に`scripts/deploy.ps1`・`docker-compose.prod.yml`の新バージョンがVPS上の`~/stockhome`へ転送される必要がある）
- 想定作業: 次回の通常deploy（別notice対象の`ad432fb`等）時に、あわせて本変更も反映される。**ただし「初回production利用」（新方式でのタグ付きbuild・世代管理・rollback機能の実際の動作）はVPS管理側の個別承認後に限る**（VPS管理側の明示条件）。本notice自体は、まずソースの反映についてのレビューを求めるものであり、新方式を実際に使ってdeployしてよいかは別途確認する。
- downtime: 既存と同じ（brief-restart。`api`コンテナのみ再ビルド・入れ替え、`postgres`コンテナ・DBデータは変更しない）
- maintenance window: 不要（既存運用と同様）

## 利用者への影響

- user_maintenance_impact: none
- 対象利用者・機能: なし（deploy運用のみの変更で、利用者向け機能・APIレスポンスに変更はない）
- 通知方法: 不要

## env・secret contract

- 変更: なし
- 変数名・secret種類のみ: `API_IMAGE_TAG`（新規、`docker-compose.prod.yml`のbuild/run時変数。secretではない。commit hashから機械的に導出される値で、値自体に秘匿情報は含まれない）
- provisioning/rotation: 不要（`scripts/deploy.ps1`がdeploy実行のたびに自動設定する。VPS側`.env`への追加は不要）

secret値は記載していない。

## Data・migration・backup

- schema/format変更: なし
- migration: なし
- backup対象: なし（本変更はイメージのタグ付け方式のみで、DBデータには触れない）
- restore確認: 該当なし
- backward compatibility: あり（`API_IMAGE_TAG`未設定時は従来どおり`latest`を使うため、本変更を反映しただけでは動作は変わらない。新方式が実際に使われるのは、次回`scripts/deploy.ps1`経由でdeployしたときから）

## Deploy・rollback

- deploy前提: 通常の`npm run deploy`実行で自動的に新方式（commit固定tag）が使われる。`git status --porcelain`でdirty検知に引っかかる場合は、事前にcommitするか`-Force`が必要
- deploy手順の変更: あり（上記「現在と変更後」参照）。tarball作成・scp転送・展開の手順自体は変更していない
- rollback方法: `npm run deploy -- -RollbackTo <40桁commit hash>`。ソースの再転送・再ビルドは行わず、VPS上に既に保持されているタグへ`docker compose up -d api`で切り替えてからhealth checkする
- rollback不能条件: 対象commitのタグが直近3世代を超えて既に削除されている場合。この場合はエラーで停止し、代替手段として従来の手動手順（旧source archiveの再展開等）に戻る必要がある

## Health・テスト

- health contract変更: なし（既存の`/health`、200判定のロジックはそのまま）
- 実施テスト:
  1. PowerShellの`[System.Management.Automation.Language.Parser]::ParseFile`で構文検証（初回、BOM無しUTF-8で保存されたため日本語コメント部分でWindows PowerShell 5.1が構文解析に失敗する問題を発見・修正。元ファイルと同じUTF-8 BOM付きへ修正後、構文エラー解消を確認）
  2. `-DryRun -Force`でtarball作成・commit hash取得・タグ計算までの実行確認（VPS接続なし。`.env`・`node_modules`が送信対象に含まれないことを確認）
  3. `docker-compose.prod.yml`のYAML構文確認（`yaml`パッケージで解析）
  4. 世代管理ロジック（`Remove-OldImages`関数が生成するbashスクリプト）のローカルDocker検証: ダミーイメージ5世代を2秒間隔で作成し、生成された実際のbashスクリプト文字列をそのまま実行。直近3世代（新しい方から3件）が正しく残り、古い2件が削除されることをエンドツーエンドで確認した
  5. 上記4の過程で、`docker images --format '{{.CreatedAt}}'`はスペース区切りの複合値（日付・時刻・TZオフセット・TZ名）であり単純な`sort -k2`では日付部分しか比較されず同日中の複数世代を正しく順序付けできないこと、およびBuildKitでビルドしたイメージは`docker inspect`の`.Created`が空になることの2点を発見し、tag付け時刻を保持する`.Metadata.LastTagTime`（BuildKitでも設定される）を使う実装へ修正した
  6. 固定検証3コマンド（shared/apiビルド、mobile型チェック）がすべて成功することを確認
- 結果: すべて成功
- 未実施テストと理由: VPS上での実接続テスト（scp/ssh経由の実際のdeploy・rollback実行、複数世代にわたる実運用でのタグ削除）は未実施。理由: production環境への接続はVPS管理側の個別承認後に限られるため（VPS管理側の明示条件）。ローカルDockerでのダミーイメージ検証で代替した。

## Log・監視

- log量/形式/保存先変更: なし
- 新しいalert条件: なし
- secret/個人情報対策: 変更なし（commit hash・イメージタグに秘匿情報は含まれない）

## 提出前セルフチェック

正本: `C:\work\PRG\Sakura\Dev\vps-server-management\docs\templates\server_change_notice_pre_submission_checklist.md`

- [x] production baselineとrelease全commit・build入力差分を確認した（`production_deployments.yaml`のbaseline`ec6e541`を基準に、`git log ec6e541..HEAD`と`git diff --stat`で確認。上記release_commits参照）
- [x] source commitとnoticeをremoteの対象branchへpushした（`084d1d1`はpush済み、local/origin一致確認済み。本notice file自体はこれからcommit・pushする）
- [ ] data更新のtransaction・同時実行・途中失敗・再実行を確認した — 該当なし（DBデータ更新を伴わない変更のため）
- [x] image rollbackとdata rollback、backup/restore条件を分けた（本変更はimage rollbackのみを対象とし、data rollbackは扱わない。DBデータのbackup/restoreは別途notice `20260919-*`（C-2、`ops/runtime-contract.yaml`のbackup_policy）で扱う）
- [x] job/log/retention、runtime/dependency、client配信の該当有無を確認した（job/log/retention: 該当なし。runtime/dependency: `docker-compose.prod.yml`のimageタグ付け方式のみ変更、他は無変更。client配信: 該当なし）
- [ ] app owner、VPS review、production承認、client配信承認を分離した — app owner承認（方針決定自体）・VPS review・production承認はいずれも未実施。下記Approval参照
- [x] secret非混入とtracked working tree cleanを確認した（`git status --short`で本notice作成前に確認。既知の無関係な未追跡ファイル`ops/investigations/`・`ops/production-db-operations/`のみ残存、これらは本notice対象外・本commitには含めない）

未確認・該当なしの理由: 上記チェックリストのうち「data更新のtransaction」項目はDBデータを一切扱わない変更のため該当なし。「app owner/VPS review/production承認の分離」は、方針決定自体（commit固定tag・3世代保持）はVPS管理側から得ているが、本notice・本実装そのものへの個別承認はまだ得ていないため未実施のまま記録する。

## 未解決事項

- NAS側snapshot設定の実機確認（所見C-2、VPS管理側で別途実施予定。本noticeの対象外）
- commit tag方式の初回production検証（VPS管理側の個別承認後に実施予定。本notice未反映の間は、従来の手動rollback手順が引き続き唯一の手段）
- `ad432fb`（所見A-1/A-3/B-5、mobile UI・push payload変更）は本noticeの対象外。別途独立したnoticeを作成する。

## 希望時期

特に指定なし。VPS管理側の都合の良いタイミングでレビューいただきたい。次回の通常deploy（`ad432fb`分の反映）と合わせて検討いただいてよい。

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: これから実施
- VPS管理チャットへ渡すローカル絶対path: `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260919-STOCKHOME-010-summary.md`

## Approval

- app owner: 方針決定（commit固定tag・3世代保持、scripts/deploy.ps1とComposeの変更許可）は得ている。本notice・本実装そのものへの個別承認は未実施
- VPS management review: 未実施
- production approval: 未実施（「初回production利用は別承認が必要」との条件あり）
- related task_id: なし（ai-watch task経由ではなく、Claude対話セッションで直接実装した）
