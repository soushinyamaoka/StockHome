# Server Change Notice

notice_id: 20260904-STOCKHOME-005

app: stockhome

source_branch: main

source_commit: 2d8aad0b3fea00d4956701d8b0bc2f0887aed005

impact_level: L3

status: ready_for_review

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 改訂履歴

- 2026-09-04（初版、source `278822d`）: L2として提出。
- 2026-09-04〜05（本改訂、source `9b687d3` → `2d8aad0`）: VPS管理側レビュー
  （`C:\work\PRG\Sakura\Dev\vps-server-management\docs\operations\stockhome_purchase_accumulation_review_20260904.md`、
  `blocked`、B01〜B06）を受け、下記のとおり全項目に対応した。VPS管理側判定に従い
  impact_levelをL2からL3へ訂正した。B02のtest追加中に、本機能とは別の既存不具合
  （JST早朝の基準日ズレ）を発見・修正した（`2d8aad0`、下記「B02対応中に発見した
  既存不具合の修正」参照）。

## 変更概要

利用者からの要望（3件）に対応した。いずれもDBスキーマ変更・新規APIエンドポイント・
env/secret変更を伴わないが、**既存テーブル（item_runtime_states）の永続カラムの
書き込み意味を変える**ため、VPS管理側判定によりL3として扱う。

1. **買い足し累積**（`apps/api/src/services/stockCalc.ts` 他）: 従来、購入登録のたびに
   「最新購入の数量のみ」を基準に在庫推定値を上書きしていたのを、「直前の推定残数＋今回の
   購入数」を `item_runtime_state.manual_override_qty` として積み上げる方式に変更。
   手動購入登録・Gmail取込確定・夜間バッチのcounted化（配送バッファ設定により確定時点では
   まだcountedでなかった購入）のすべての経路で同じ積み上げロジックを適用する。
   購入取消（削除）時は、積み上げ由来の補正値であれば同量を差し引いて取消す。
2. **消費ペースの実績提案**（`apps/api/src/routes/purchases.ts`）: 既存の
   `GET /api/items/:itemId/purchases` レスポンスに `suggestedDaysPerUnit`
   （直近の購入間隔から算出した1単位あたり消費日数の目安）を追加。既存フィールドは不変。
3. **価格推移の表示**（mobile側のみ、API変更なし）: 既存の価格統計（最新/平均/最安/最高）に
   加え、購入履歴画面へ時系列の簡易スパークラインを追加。外部チャートライブラリは使用しない。

## production基準からの累積差分（B04対応）

直前のproduction反映は notice `20260902-STOCKHOME-004`、source commit `5cd6c66`
（task `20260903-001`で反映・`verified`）。それ以降、本リリースまでに`main`へ入った
commitは次の2件のみで、他の未反映変更は無い。

| commit | 内容 | API/DBへの影響 |
|---|---|---|
| `460f7d0` | mobile Expo SDKを54→57へアップグレード | `apps/mobile`のみ変更。API/shared workspaceの`package.json`は無変更 |
| `278822d` → `9b687d3`（本改訂で修正済み） | 買い足し累積・消費ペース実績提案・価格推移表示 | 本notice記載のとおり |

**API runtime dependencyへの影響確認**（B04で指摘された、mobile SDK更新がAPI Docker
buildへ影響しないかの確認）: `apps/api/Dockerfile`が実行する
`npm ci --workspace=@stockhome/shared --workspace=@stockhome/api --include-workspace-root --ignore-scripts`
を、production baseline（`5cd6c66`）と本改訂source（`9b687d3`）の両方でgit worktreeを使い
独立に実行し、解決された全パッケージ（106件）のname@versionを比較した。

- 両者とも106パッケージ、一致は105件
- 差分は**1件のみ**: `content-type` `2.0.0` → `2.1.0`（`type-is`経由の間接依存、
  Fastifyのcontent-type判定に使われる小さいユーティリティ）。semver上のminor更新で、
  mobile側の変更を経由した依存ではなく、lockfile再生成時の通常のドリフトと判断する
- **結論**: mobile SDK更新はAPI runtime dependencyへ実質的な影響を与えない
  （`content-type`のminor差分1件を除き完全一致）

デプロイ対象commitは`9b687d3`に固定し、`main`と`origin/main`を一致させたうえで再レビューへ戻す
（下記「変更後の状態」参照）。

## 変更理由

利用者からの要望。①は「買い足したのに残数が減って見える」という実態との乖離を解消するため。
②は `days_per_unit`（品目ごとの消費ペース）の初期入力・見直しが勘に頼っていたため、
実績を参考にできるようにするため。③は価格の推移を一目で把握できるようにするため。

## server_impact判定

server_impact: approval_required

判定理由（VPS管理側判定を採用。初版のL2/notifyから訂正）:
- DBスキーマ変更・migration・新規env var・新規外部依存・新規cron・port/bind/URL変更は
  いずれも無い
- 一方で、既存テーブル（`item_runtime_states`）の永続カラム（`manual_override_qty`等）の
  **書き込み意味・更新方法そのもの**を変える。手動購入、Gmail取込確定、19:55 JSTの
  既存batchが同じ永続値を更新し、在庫表示とalert時期へ直接影響する
  （B01/B03対応、下記「Data・migration・backup」節参照）
- 以上により、VPS管理側判定どおりL3（data影響）とする

## 現在と変更後

| 項目 | 現在 | 変更後 |
|---|---|---|
| 購入登録時の残数計算 | 新しい購入のqtyのみを基準に上書き（既存の推定残数は破棄） | 「直前の推定残数＋今回の購入数」を積み上げ |
| Gmail取込確定時の残数計算 | 同上（counted済みなら購入時に上書き） | 同様に積み上げ |
| 夜間バッチのcounted化（`updateCountedInInventory`） | 対象行を一括UPDATE（`updateMany`）するのみ、残数計算には関与しない | 品目ごとに1トランザクションで、購入日の古い順に処理し、積み上げを適用したうえでcounted化する（B01対応）。対象規模は家庭単位のため性能への影響は軽微 |
| 購入登録・Gmail確定・batchでの書き込み原子性 | （新機能のため該当なし） | 購入行の作成/counted化と積み上げ書き込みを同一トランザクションに統合。品目行（`items`）を`SELECT ... FOR UPDATE`でロックしてから読み書きし、同一品目への同時更新を直列化する（B01対応） |
| 購入取消（削除） | 対象行を削除するのみ | 削除対象が積み上げ由来の補正値に寄与していた場合、同量を差し引いて取消（完全な巻き戻しではなく、直近の誤登録取り消しを想定した簡易補正）。差し戻しも品目ロックのもとで実行 |
| `GET /api/items/:itemId/purchases` レスポンス | `purchases`, `priceStats` | `suggestedDaysPerUnit`（消費ペース実績提案。値がない場合は`null`）を追加。既存フィールドは不変・後方互換 |
| モバイルUI | 購入履歴画面: 価格統計のみ。品目編集画面: 消費ペース提案なし | 購入履歴画面に価格推移スパークライン追加。品目編集画面に消費ペース実績提案＋採用ボタン追加（別途client release `20260904-STOCKHOME-002`で管理、B05対応） |

## 影響対象

- service/container: `stockhome-api-prod`（次回のDocker build/deployで反映）
- URL/port/health/bind: 変更なし
- cron/timer/worker: 既存の夜間バッチ（19:55 JST）のスケジュールは不変。内部処理
  （counted化ロジック）のみ変更（一括UPDATEから品目単位トランザクションでの逐次処理へ、B01対応）
- dependency: API/shared workspaceの直接・間接依存に実質的な変更なし
  （`content-type` 2.0.0→2.1.0のminor差分のみ。B04対応、上記参照）
- data/DB/volume: スキーマ変更なし。既存テーブル（`item_runtime_states`）の既存カラムの
  書き込み内容・意味が変わる（詳細は`ops/runtime-contract.yaml`の`data.field_semantics`、
  B05対応で追記済み）
- log/monitoring: 変更なし（新規event追加なし。既存の`job_end`集計項目も不変）

## production変更

- 必要性: あり（コンテナ再ビルド・入れ替えのみ。migration不要）
- 想定作業: `scripts/deploy.ps1`（`npm run deploy`）による通常のcontainer rebuild・入れ替え
- downtime: brief-restart（apiコンテナのみ再起動。postgresコンテナ・DBデータは変更しない）
- maintenance window: 未定（VPS管理側の承認後に確定）

`production_change: required`のため、`deployment_status: not_started`のままVPS管理側へ引き継ぐ。

## 利用者への影響

- user_maintenance_impact: possible
- 対象利用者・機能: 家庭内利用者が使用するStockHome mobileの在庫予測・購入登録・
  Gmail取込確定・在庫アラート通知の判定基準
- 機能面: デプロイ後、既存品目の推定残数の「増え方」が変わる（買い足し分が上書きでなく
  積み上がるため、これまでより残数が多く表示される場面が出る）。アラート・通知のタイミングも
  やや遅くなる方向に影響しうる（残数が多く出る分、閾値到達までの日数が延びるため）。
  積み上げ自体は「登録時点を起点」に行われる（購入日をさかのぼって当時の残数から
  計算し直すわけではない）
- 通知方法: 実施時期にあわせてVPS管理側・app ownerで判断する
- **app owner承認事項（B06対応、下記「Approval」節参照）**: 上記の残数増加・alert遅延、
  過去日付購入の積み上げ挙動、購入取消の差し戻し限界、mobile配信の対象・時期について、
  release全体の承認としてapp ownerへ個別に確認する

## env・secret contract

- 変更: なし
- 変数名・secret種類: 追加・削除・意味変更なし
- provisioning/rotation: 不要

secret値は記載しない。

## Data・migration・backup（B03対応で全面訂正）

- schema/format変更: なし（既存カラムの意味・書き込みロジックのみ変更。新規テーブル・
  新規カラムは無い）
- migration: なし

### rollback条件の分離（B03指摘対応）

初版noticeの「旧API imageへ戻すのみ」「追加backup不要」はdata rollbackを正しく
説明できていなかった。旧imageは新ロジックが書いた`manual_override_qty`を数値カラムとして
問題なく読める（クラッシュ・データ破損はない）が、**その値を変更前の状態へ戻すものではない**。
条件を次のとおり分離する。

- **image rollbackだけで継続できる条件**: deploy後、新方式による実際の書き込み
  （手動購入登録・Gmail確定・batchのcounted化）が**一件も発生していない**場合。
  この場合、image rollbackにより以降の計算が旧方式（上書き）へ戻り、データの不整合は残らない
- **DB restoreまたは個別データ補正が必要な条件**: deploy後、新方式による書き込みが
  一件でも発生した後に問題が判明した場合。`manual_override_qty`が積み上げ値で
  上書きされているため、image rollbackだけでは元の値へ戻らない。この場合は
  deploy直前のdumpからのDB restore、または対象品目を特定した個別データ補正
  （在庫補正画面から実数を再設定する等）のいずれかが必要

### backup（B03対応）

- **deploy直前に、production PostgreSQLの論理dump（`pg_dump`）を取得する**。取得後、
  サイズ・gzip整合・SHA-256を確認し、隔離環境（使い捨てPostgreSQL）へrestoreして
  整合性を確認する
- 2026-09-04構築の日次dumpは運用上の保険として別途存在するが、**本リリース反映の
  直前状態を一意に特定するbackupとしては扱わない**（日次dumpのタイミングとdeploy実施時刻は
  一致しない可能性があるため、release直前dumpを別途取得する）

### 未counted購入のpreflight確認（B03対応）

次回19:55 batchの`updateCountedInInventory`が対象とする、現時点で`counted_in_inventory=false`
かつ`inventory_effective_at`到来済みの購入件数を、production反映前にread-onlyで確認する
（影響規模の把握のため）。以下のSQLはSELECTのみで、データを変更しない。

```sql
SELECT item_id, count(*), sum(qty)
FROM purchase_logs
WHERE counted_in_inventory = false
  AND inventory_effective_at IS NOT NULL
  AND inventory_effective_at <= CURRENT_DATE
GROUP BY item_id;
```

このクエリの実行はproduction DBへの接続を要するため、VPS管理側で実施することを想定する
（アプリ側チャットからはproduction接続を行っていない）。

### restore確認・backward compatibility

- restore確認: 上記「backup」節のとおり、隔離環境でのrestore確認をdeploy直前に実施する
- backward compatibility: 旧バージョンAPIへrollbackしても、新ロジックが書き込んだ
  `manual_override_qty`は旧ロジックでも同じ形式（数値カラム）として問題なく読める
  （旧ロジックは`manual_override_reason`の値を判定に使わないため）。ただし上記のとおり
  「値そのものが変更前の状態に戻る」ことは保証しない

## Deploy・rollback

- deploy前提: 本notice作成時点ではdeployしない。production反映はVPS管理側の個別承認を
  経てから実施する
- deploy手順の変更: なし（既存の`scripts/deploy.ps1`をそのまま使う）
- rollback方法: 上記「Data・migration・backup」節の条件分岐に従う
  （image rollbackのみで足りる場合と、DB restore/個別補正が必要な場合を区別する）
- rollback不能条件: なし（DB restoreまで実施すれば復旧可能）

## Health・テスト（B02対応で全面訂正）

- health contract変更: なし

### 静的確認

- shared/api/mobileの全ワークスペースで `npm run build` / `npx tsc --noEmit` が成功
- `npx expo export --platform android` によるJSバンドル生成が成功

### 自動テスト（B02対応、新規追加）

`apps/api/src/services/stockCalc.accumulation.test.ts`（Node組み込みtest runner、
`npm test --workspace=@stockhome/api`で実行、ローカルDocker Postgres使用）。
全12件通過。VPS管理レビューB02で要求された5シナリオすべてを含む。

1. **同一品目への同時購入**: `Promise.all`による2件の並行トランザクションが、両方とも
   失われず加算されることを確認（`SELECT ... FOR UPDATE`による直列化の検証）
2. **積み上げ書き込み後の後続失敗**: トランザクション内で購入作成・積み上げの後に
   意図的に例外を発生させ、購入行・積み上げの両方がロールバックされ部分確定しないことを確認
3. **夜間バッチ処理中の部分失敗**: 品目内の複数pending購入のうち1件が存在しないIDで
   失敗する状況を再現し、同一品目の他の購入もcounted化・積み上げされずロールバックされることを確認
4. **失敗後の再実行**: 上記3の失敗後、正しい内容で再実行すると二重加算せず正常完了することを確認
5. **購入取消の差し戻し**: 積み上げに実際に含まれた購入だけが一度だけ差し戻されること、
   0未満にならないこと、積み上げ由来でない手動補正は差し戻されないことを確認

正常系の回帰（手動購入の積み上げ、購入取消、消費ペース実績提案の計算、夜間バッチ相当の
遅延積み上げ、Gmail取込確定相当の積み上げ）も同ファイルに含めて維持している。

**test作成中に見つかった不具合**: 当初の実装は「購入行を先に作成→その後で積み上げを計算」
という順序だったため、積み上げの残数計算が今作成したばかりの購入自身を「直前の購入」として
拾ってしまい、二重加算するバグがあった（例: qty=2の購入で残数2を期待したが実際は4になった）。
上記test 1の実行で発覚し、「積み上げは必ず購入行の作成より先に行う」順序へ修正して解消した
（`purchases.ts`・`candidateIntake.ts`とも）。**この不具合は初版notice提出時点の
手動確認（curlによる逐次的な動作確認）では検出できなかった**。B02で要求された同時実行・
障害再現testが実際に不具合を捕捉した実例であり、本reviewの要求が有効であったことの
裏付けとして記録する。

### B02対応中に発見した既存不具合の修正（本リリース範囲外だが同梱、commit `2d8aad0`）

上記test群を実際にJST早朝（06時台）に実行したところ、非決定的に失敗するテストが発生した
（例: 期待値3に対し実際は2.9）。原因は`calculateStock()`内の補正基準日（`manual_override_at`
から日付だけを取り出す処理）が、`todayDateOnly()`とは異なり**UTCのgetter**でカレンダー日付を
切り出していたこと。本番・開発環境とも`TZ=Asia/Tokyo`のため、JST 0時〜9時台（UTC換算では
前日）に書き込まれた補正値は、`todayDateOnly()`（JST基準の「今日」）との間で1日分の
ズレが生じ、直後に読み直すだけで1日分の消費（`1/days_per_unit`）が即座に減衰していた。

`todayDateOnly()`と同じロジック（ローカルgetterでカレンダー日付を切り出す）に統一する
`dateOnlyLocal()`へ切り出し、補正基準日の計算をこれに揃えて修正した。

**この不具合は今回の買い足し累積機能に限らず、既存の在庫補正機能
（`POST /api/corrections`、production稼働中）にも同様に影響していた**。
JST 0時〜9時台に在庫補正を行った利用者は、補正直後の残数表示が本来より
`1/days_per_unit`だけ少なく見えていた可能性がある（数量への影響は品目のdays_per_unitに
依存する小さな値だが、日付が変わる境界で不整合が生じる性質のバグのため、
気づかれにくい）。本リリースはこの既存不具合の修正も同梱する。

### HTTPルート層でのスモークテスト（ローカルDB、検証データ削除済み）

自動テストに加え、実際にローカルAPIサーバーを起動し、HTTP経由でも同様の結果になることを
確認した。同日2件の逐次購入（2→5への積み上げ）、取消時の差し戻し（5→2）、
**2件の並行HTTPリクエスト**（qty=10とqty=20を同時送信、結果が正しく合算される
lost updateが発生しない）ことを確認済み。

### 未実施テストと理由

- production同等環境（Docker build後のコンテナ）での動作確認は次回production反映時に実施
- 実データ（既存の家庭の購入履歴）を使った検証は行っていない（検証用の独立householdのみ使用）
- モバイルUI（消費ペース提案の「採用」ボタン、価格推移スパークラインの表示）は
  Expo Goやビルド済みAPK実機での見た目確認をまだ行っていない（API側のデータ形状は
  上記で確認済み）
- 上記「Data・migration・backup」節のpreflightクエリはproduction DBへの接続を要するため
  未実施（VPS管理側での実施を想定）

## Log・監視

- log量/形式/保存先変更: なし
- 新規event: なし（既存の`job_end`集計項目・イベント名は不変）
- 新しいalert条件: なし
- secret/個人情報対策: 変更なし（本変更で新たにログへ出力する値は無い）

## 未解決事項

- 積み上げは常に「登録・確定処理を行った時点」を起点に計算する（購入日をさかのぼって
  その時点の残数から計算し直すわけではない）。過去日付での購入登録（実績の後入力等）が
  多い利用シーンでは、厳密には登録タイミングによって積み上げ結果がわずかに変わり得るが、
  現行の在庫計算モデル自体が「今日」を唯一の基準にしている設計と整合的であり、
  意図的な仕様として扱う（B06でapp owner確認事項に含める）
- モバイルUIの実機（Expo Go / 内部配布APK）での見た目確認は未実施
- 購入取消の差し戻しは「最新の積み上げ値からの単純減算」であり、完全な会計的巻き戻しではない
  （B06でapp owner確認事項に含める）

## 希望時期

未定

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: 実施済み（本タスク応答）
- VPS管理チャットへ渡すローカル絶対path:
  `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260904-STOCKHOME-005-summary.md`

## Approval

- app owner: 未実施。B06対応として、release全体（残数増加・alert遅延の可能性、過去日付購入の
  積み上げ仕様、購入取消の差し戻し限界、mobile配信の対象・時期）についてapp ownerの
  明示承認を別途チャットで得たうえで本節を更新する
- VPS management review: 初回2026-09-04実施・`blocked`（B01〜B06）。本改訂は
  その対応版であり、再レビュー待ち
- production approval: 未実施
- related task_id: なし

## 変更後の状態（本改訂時点）

- source commit: `2d8aad0b3fea00d4956701d8b0bc2f0887aed005`（`main`, `origin/main`と一致）
- notice commit: 本ファイルのcommit後に確定（`git log`で本ファイルの最新commitを参照）
- 自動テスト: `npm test --workspace=@stockhome/api`で12件全通過（JST早朝の既存バグ修正後、
  非決定的失敗が無いことを再確認済み）
- 静的確認: shared/api/mobileとも`tsc --noEmit`成功
- production/EAS配信: 未実施（本改訂作業でも接続・変更を一切行っていない）
