# mobileクライアント配信計画

client_release_id: 20260918-STOCKHOME-005

record_type: client_release

app: stockhome

status: draft（配信の承認ではない。計画のみ）

created_by: Claude

related_notice_id: 20260918-STOCKHOME-009

## 対象

- **source commit**: `ec6e541b8bf88654baa68c3dd3b1c2fcbdb9d6ad`（notice
  `20260918-STOCKHOME-009`の最終source。VPS管理レビューで2回指摘された
  lock順序不一致（1回目: `PATCH`/`DELETE`間、2回目: `unconfirmImportCandidate`と
  `PATCH`/`DELETE`間）をいずれも解消した後のcommit。詳細はnoticeの`release_commits`
  参照。**mobileファイル自体はlock順序修正2回（commit`e903e81`・`ec6e541`）では
  変更していない**（いずれもAPI側`apps/api/src/`配下のみの修正）ため、下記の
  配信対象機能は変わらない）
- **配信対象機能**（mobileのUI変更のみ。すべてnotice`20260918-STOCKHOME-009`対象、
  task `20260918-001`のcommit `7c1c347`由来）:
  1. `PurchaseHistoryScreen`: 各行への編集ボタン（鉛筆アイコン）追加
  2. `PurchaseFormScreen`: `purchaseId`パラメータによる編集モード追加
     （品目・購入日・購入元は読み取り専用表示、数量・単価・備考のみ編集可）
  3. `apps/mobile/src/api/items.ts`: `updatePurchase`呼び出しを追加
  4. `apps/mobile/src/navigation/types.ts`: `PurchaseForm`パラメータに`purchaseId`追加
- **API側の対応する変更**: notice`20260918-STOCKHOME-009`（`PATCH /api/purchases/:id`
  新設）。`server_impact: approval_required`で、production反映にはVPS管理側の承認が
  必要（下記「server/APIとの互換性・実施順序」参照）
- **native変更の有無**: なし。JS/UIのみの変更（新規native module・permission・
  config plugin追加なし）
- **配信先 branch**（前回client release `20260915-STOCKHOME-004`と同じ2branch）:
  - `default`（iOS、Expo Go向け）
  - `android-internal`（Android、内部配布APK向け）
- **runtime version**: `exposdk:57.0.0`（変更なし。JSのみのためruntime変更なし）
- **対象platform**: iOS・Android両方

## server/APIとの互換性・実施順序

- **実施順序: API先行 → client配信は別承認**。新規`PATCH /api/purchases/:id`と、
  VPS管理レビューで指摘された2件のlock順序修正はAPI側にすでに実装・テスト済み
  （2026-09-18、DB依存テスト計48件全件成功をClaudeが対話セッションで確認済み。
  内訳はnotice`20260918-STOCKHOME-009`の「Health・テスト」参照）だが、
  production未反映（`deployment_status: not_started`）。
  API側のproduction反映（VPS管理側の`approval_required`承認・deploy・`verified`確認）が
  完了するまで、本client配信は実施しない。
- **旧client互換性**: 新規`PATCH`は既存の`POST /purchases`・`DELETE /purchases/:id`の
  挙動を一切変更しない**追加のみ**のAPI変更。したがって、
  - client先行時（本UIが先、APIがまだ旧版）: 新しい編集ボタンをタップすると
    存在しないエンドポイントへPATCHし404エラーになる（利用者に「エラー」アラートが出る）。
    **これを避けるため、client配信はAPI反映・`verified`確認後に行う**。
  - API先行時（本changeの想定順序）: 旧mobileは新規エンドポイントの存在を知らないため
    単に呼ばない。新規UIが無いだけで、既存機能（登録・削除）は変わらず動作する。
    **安全な順序はこちらのみ**。
- 上記のとおり、client配信の前提条件は「notice `20260918-STOCKHOME-009`のproduction反映が
  `verified`になっていること」とする。

## 直前の安定版（rollback先）

`ops/client-releases/20260915-STOCKHOME-004-plan.md`の「実施結果」節より
（本計画作成時点で最新の配信実績、2026-09-15に`verified`済み）。

- `default` branch: update group `66a49f60-3998-48b2-9979-4efc8469ff67`
  （runtime `exposdk:57.0.0`）
- `android-internal` branch: update group `12baf554-2fd1-4a9e-83b3-f90332ce477f`
  （runtime `exposdk:57.0.0`）
- 本changeはJSのみでruntime変更が無いため、両branchとも
  `eas update:republish --group <上記group ID>`で直前groupへ戻せる。
- 配信直前に`npx eas-cli update:list --branch default`（`android-internal`も同様）で
  上記group IDが依然として最新であることを再確認すること（配信計画作成後に
  別途配信が発生していないか、の最終確認）。

## Approval

- app owner: 未実施（配信そのものの承認はこれから）
- 配信実施条件: notice `20260918-STOCKHOME-009`のproduction反映が`verified`になった後、
  対象branch・update groupを特定したapp ownerの明示承認を得てから`eas update`を
  実行する（`ops/client-releases/README.md`記載の配信前チェックリスト・環境変数対応表
  （`--environment preview`を使用し`production`は使わない）に従うこと）

## 実施結果

未実施。
