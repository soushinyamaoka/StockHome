# mobileクライアント配信計画

client_release_id: 20260918-STOCKHOME-006

record_type: client_release

app: stockhome

status: draft（配信の承認ではない。計画のみ）

created_by: Claude

related_notice_id: none（本plan自体の対象機能はserver_impact: noneの内部フィルタ
表示のみでnotice不要。ただし下記「他の未配信変更との関係」のとおり、実際の配信は
notice `20260918-STOCKHOME-009`のAPI変更と切り離せない）

## 対象

- **source commit**: `0a6e781df13e1ecf85b77d5e1eba7decaedf361f`（task `20260918-003`。
  本plan作成時点の`origin/main`最新）
- **配信対象機能**（mobileのUI変更のみ。所見B-7対応、task `20260918-003`の
  commit `0a6e781`由来）:
  1. `apps/mobile/src/lib/itemFilter.ts`（新規）: カテゴリ集約・検索/カテゴリ一致判定
  2. `apps/mobile/src/components/ItemSearchBar.tsx`（新規）: 検索欄＋カテゴリチップ
  3. `ItemListScreen`（品目一覧）: 名前検索・カテゴリ絞り込みを追加。既存の
     「外したものも見る」とAND条件
  4. `StockListScreen`（在庫一覧）: 同上。既存の「きれそうだけ」とAND条件。
     `highlightItemId`受信時は検索語・カテゴリ選択をクリア
- **API側の対応する変更**: なし。取得済みデータに対するclient側フィルタのみで、
  APIエンドポイント・レスポンス形式とも変更していない（`server_impact: none`、
  task `20260918-001`のresult参照）
- **native変更の有無**: なし。JS/UIのみの変更（新規native module・permission・
  config plugin追加なし）
- **配信先 branch**（前回client release `20260915-STOCKHOME-004`と同じ2branch）:
  - `default`（iOS、Expo Go向け）
  - `android-internal`（Android、内部配布APK向け）
- **runtime version**: `exposdk:57.0.0`（変更なし。JSのみのためruntime変更なし）
- **対象platform**: iOS・Android両方

## 他の未配信変更との関係（重要）

`source_commit`（`0a6e781`）は、直前のclient release計画
`ops/client-releases/20260918-STOCKHOME-005-plan.md`（notice `20260918-STOCKHOME-009`
対象、購入履歴編集UI、未配信のまま）の内容を**linear historyとして含む**。
EAS Updateは対象branchのJSバンドル全体を配信するため、**本機能だけを選んで
配信することはできない**。したがって、本plan実施時は`20260918-STOCKHOME-005`の
購入履歴編集UIも同時に配信される。

このため、本plan単独は`related_notice_id: none`（API変更が無い）だが、
**実際の配信可否は`20260918-STOCKHOME-005`と同じ制約（notice
`20260918-STOCKHOME-009`のAPI反映が`verified`になっていること）を引き継ぐ**。
理由は`20260918-STOCKHOME-005-plan.md`の「server/APIとの互換性・実施順序」節と
同じ: 購入履歴編集UIの新しい編集ボタンは、対応する`PATCH /api/purchases/:id`が
production未反映のままclientだけ先行すると404エラーになるため。

品目検索・絞り込み自体の機能はAPI変更が無いため、単独であれば`20260918-STOCKHOME-005`
を待たずに配信できる**機能上の制約は無い**が、**JSバンドルが同一である以上、
実務上は分離できない**。`20260918-STOCKHOME-005-plan.md`は本plan策定時点で
`status: draft`のまま据え置き、**実際の配信は本plan（`20260918-STOCKHOME-006`）へ
一本化する**（005の対象機能もあわせて本plan実施時に配信される）。

## 直前の安定版（rollback先）

`ops/client-releases/20260915-STOCKHOME-004-plan.md`の「実施結果」節より
（本plan作成時点で最新の配信実績、2026-09-15に`verified`済み。`005`は未配信のため
まだ「直前の安定版」ではない）。

- `default` branch: update group `66a49f60-3998-48b2-9979-4efc8469ff67`
  （runtime `exposdk:57.0.0`）
- `android-internal` branch: update group `12baf554-2fd1-4a9e-83b3-f90332ce477f`
  （runtime `exposdk:57.0.0`）
- 本changeはJSのみでruntime変更が無いため、両branchとも
  `eas update:republish --group <上記group ID>`で直前groupへ戻せる。
- 配信直前に`npx eas-cli update:list --branch default`（`android-internal`も同様）で
  上記group IDが依然として最新であることを再確認すること。

## Approval

- app owner: 未実施（配信そのものの承認はこれから）
- 配信実施条件: notice `20260918-STOCKHOME-009`のproduction反映が`verified`になった後、
  対象branch・update groupを特定したapp ownerの明示承認を得てから`eas update`を
  実行する（`20260918-STOCKHOME-005`の購入履歴編集UIも同時配信されることを含めて
  承認を得ること）。`ops/client-releases/README.md`記載の配信前チェックリスト・
  環境変数対応表（`--environment preview`を使用し`production`は使わない）に従う。

## 実施結果

未実施。
