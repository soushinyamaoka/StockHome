# Server Change Notice

notice_id: 20260904-STOCKHOME-005

app: stockhome

source_branch: main

source_commit: 278822dbf4b9df22d9782ab28ccc3fa25f53ac70

impact_level: L2

status: ready_for_review

created_by: Claude

production_change: required

vps_management_handoff: required

deployment_status: not_started

## 変更概要

利用者からの要望（3件）に対応した。いずれもDBスキーマ変更・新規APIエンドポイント・
env/secret変更を伴わない、既存の在庫計算ロジックとAPIレスポンスの拡張。

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

## 変更理由

利用者からの要望。①は「買い足したのに残数が減って見える」という実態との乖離を解消するため。
②は `days_per_unit`（品目ごとの消費ペース）の初期入力・見直しが勘に頼っていたため、
実績を参考にできるようにするため。③は価格の推移を一目で把握できるようにするため。

## server_impact判定

server_impact: notify

判定理由:
- DBスキーマ変更・migration・新規env var・新規外部依存・新規cron・port/bind/URL変更は
  いずれも無い（L3の要件に該当しない）
- 一方で、既存の在庫推定計算という**利用者の可視結果に直結するロジック**を変更しており、
  デプロイ後は既存品目の推定残数の「増え方」が変わる（買い足しが上書きでなく積み上がる）。
  在庫アラート・通知の発生タイミングにも影響しうる（残数が多く出る方向のため、閾値到達が
  従来より遅くなる傾向）
- production変更（コンテナ再ビルド・入れ替え）が必要
- 以上により、L2「production変更または利用者影響の可能性」と判定した

## 現在と変更後

| 項目 | 現在 | 変更後 |
|---|---|---|
| 購入登録時の残数計算 | 新しい購入のqtyのみを基準に上書き（既存の推定残数は破棄） | 「直前の推定残数＋今回の購入数」を積み上げ |
| Gmail取込確定時の残数計算 | 同上（counted済みなら購入時に上書き） | 同様に積み上げ |
| 夜間バッチのcounted化（`updateCountedInInventory`） | 対象行を一括UPDATE（`updateMany`）するのみ、残数計算には関与しない | 品目ごとに購入日の古い順で1件ずつ処理し、積み上げを適用したうえでcounted化する。対象規模は家庭単位のため性能への影響は軽微 |
| 購入取消（削除） | 対象行を削除するのみ | 削除対象が積み上げ由来の補正値に寄与していた場合、同量を差し引いて取消（完全な巻き戻しではなく、直近の誤登録取り消しを想定した簡易補正） |
| `GET /api/items/:itemId/purchases` レスポンス | `purchases`, `priceStats` | `suggestedDaysPerUnit`（消費ペース実績提案。値がない場合は`null`）を追加。既存フィールドは不変・後方互換 |
| モバイルUI | 購入履歴画面: 価格統計のみ。品目編集画面: 消費ペース提案なし | 購入履歴画面に価格推移スパークライン追加。品目編集画面に消費ペース実績提案＋採用ボタン追加 |

## 影響対象

- service/container: `stockhome-api-prod`（次回のDocker build/deployで反映）
- URL/port/health/bind: 変更なし
- cron/timer/worker: 既存の夜間バッチ（19:55 JST）のスケジュールは不変。内部処理
  （counted化ロジック）のみ変更（一括UPDATEから品目ごとの逐次処理へ）
- dependency: 追加・削除なし
- data/DB/volume: スキーマ変更なし。既存テーブル（`item_runtime_state`）の既存カラム
  （`manual_override_qty`/`manual_override_at`/`manual_override_reason`）の書き込み内容が
  変わる（算出方法の変更、`manual_override_reason`に新しい文字列値
  `purchase_accumulated` / `purchase_accumulated_gmail` / `purchase_accumulated_batch`
  を使用開始。DBスキーマ上は既存の自由文字列カラムのため型変更は無い）
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

## env・secret contract

- 変更: なし
- 変数名・secret種類: 追加・削除・意味変更なし
- provisioning/rotation: 不要

secret値は記載しない。

## Data・migration・backup

- schema/format変更: なし（既存カラムの意味・書き込みロジックのみ変更。新規テーブル・
  新規カラムは無い）
- migration: なし
- backup対象: 通常のDB backup運用のまま（本変更単体での追加backup要否なし）
- restore確認: 不要（schema変更が無いため）
- backward compatibility: 旧バージョンAPIへrollbackしても、新ロジックが書き込んだ
  `manual_override_qty`は旧ロジックでも同じ形式（数値カラム）として問題なく読める
  （旧ロジックは`manual_override_reason`の値を判定に使わないため）。rollback後は
  新規購入が再び「上書き」方式に戻るだけで、データ破損やクラッシュは発生しない

## Deploy・rollback

- deploy前提: 本notice作成時点ではdeployしない。production反映はVPS管理側の個別承認を
  経てから実施する
- deploy手順の変更: なし（既存の`scripts/deploy.ps1`をそのまま使う）
- rollback方法: 旧API image tagへ戻すのみでよい（DBスキーマ変更が無いため、DB rollbackは不要）
- rollback不能条件: なし

## Health・テスト

- health contract変更: なし

### 静的確認

- shared/api/mobileの全ワークスペースで `npm run build` / `npx tsc --noEmit` が成功
  （`console.*`呼び出しの新規追加なし）
- `npx expo export --platform android` によるJSバンドル生成が成功（モバイル側の
  変更を含めた1200個超のモジュール解決を確認）

### 動的確認（ローカルDocker DB、検証用household 1件を作成し全シナリオ確認後に削除済み）

`POST /api/auth/register` で作成した検証用household・品目（`daysPerUnit=10`）に対し、
実際にローカルAPIサーバー（`npm run api:dev`）を起動して以下を確認した。

1. **同日の買い足し**: 購入①（qty=2）で推定残数2 → 購入②（qty=3、同日）で
   推定残数5（上書きされず積み上がることを確認）
2. **購入取消の差し戻し**: 購入②を削除 → 推定残数が5から2へ正しく差し戻ることを確認
3. **消費ペース実績提案**: 過去日付（20日前・12日前・5日前、各qty=1）の購入を追加し、
   `suggestedDaysPerUnit`が手計算どおりの値（区間 5日/7日/8日の平均6.7日、sampleCount=3）と
   一致することを確認。同時に取得される`priceStats`も既存ロジックのまま正しく動作することを確認
4. **Gmail取込確定時の積み上げ**: `POST /api/bridge/import-candidates`
   （品名部分一致による自動確定）経由でも、購入登録と同じ積み上げ（5→6）が適用されることを確認
5. **配送バッファ等で確定時に未countedだった購入の遅延積み上げ**: `countedInInventory=false`・
   `inventoryEffectiveAt`が過去、という行を直接作成し（配送バッファ設定により確定時点では
   まだcounted化されていなかった状態を模擬）、`POST /api/stocks/recalculate`
   （夜間バッチの`updateCountedInInventory`と同一コードパス）を実行したところ、
   counted化と同時に正しく積み上がる（6→13、`countedUpdated:1`）ことを確認

### 未実施テストと理由

- production同等環境（Docker build後のコンテナ）での動作確認は次回production反映時に実施
- 実データ（既存の家庭の購入履歴）を使った検証は行っていない（検証用の独立householdのみ使用）
- モバイルUI（消費ペース提案の「採用」ボタン、価格推移スパークラインの表示）は
  Expo Goやビルド済みAPK実機での見た目確認をまだ行っていない（API側のデータ形状は
  上記4で確認済み）

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
  意図的な仕様として扱う
- モバイルUIの実機（Expo Go / 内部配布APK）での見た目確認は未実施

## 希望時期

未定

## VPS管理チャットへの引き継ぎ

- 引き継ぎ要否: 必要
- ユーザーへの案内: 実施済み（本タスク応答）
- VPS管理チャットへ渡すローカル絶対path:
  `C:\work\PRG\HomeTools\StockHome\StockHome\ops\server-change-notices\20260904-STOCKHOME-005-summary.md`

## Approval

- app owner: 未実施（本notice作成時点では機能内容の対話合意のみ。productionへの反映範囲・
  利用者影響の明示承認は別途必要）
- VPS management review: 未実施
- production approval: 未実施
- related task_id: なし
