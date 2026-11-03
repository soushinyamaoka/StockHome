# mobileクライアント配信計画

client_release_id: 20261103-STOCKHOME-015

record_type: client_release

app: stockhome

status: planned（承認待ち）

created_by: Claude

related_notice_id: 20261103-STOCKHOME-026（API側の提案値の修正。本配信はAPIの反映を前提にしない）

## 対象

- **source commit**: `1268d4d`。前回client release（`20261023-STOCKHOME-014`、source `923b236`）以降のmobile変更:
  1. `1268d4d` 品目の編集画面を、対象の品目が変わったら作り直す。在庫タブの「ペース見直し?」から開いたとき、表示中の編集画面が再利用され、
     前に開いた品目の入力値（品名・単位・通知設定など）で別の品目を上書き保存してしまう不具合の修正（2026-11-03に本番で1件発生し、データは復元済み）
- **native変更の有無**: なし。`923b236..1268d4d`で`apps/mobile/package.json`・`app.config.js`・`eas.json`・`package-lock.json`・`packages/shared`に差分なし
- **配信先 branch**: `default`（iOS、Expo Go向け）、`android-internal`（Android、内部配布APK向け）
- **runtime version**: `exposdk:58.0.0`（変更なし）
- **対象platform**: iOS・Android両方
- **EAS環境**: `preview`

## 直前の安定版（rollback先）

`20261023-STOCKHOME-014`の配信分:

- `default`: `825d6586-aa8d-43b6-8e14-ca7e2d2974dd`（iOS、runtime `exposdk:58.0.0`）
- `android-internal`: `56355df5-27f9-407a-98b7-e992ef8c700d`（Android、runtime `exposdk:58.0.0`）
- 戻す場合は`eas update:republish --group <上記group ID>`（戻すと上書き不具合も戻る）

## 配信前の確認事項

- mobile型チェック成功、mobile単体テスト61件成功（2026-11-03）
- **未確認**: 画面遷移の再現確認は実機で行う
- 配信後の確認観点:
  1. 在庫タブで「ペース見直し?」の付いた品目Aを押す → 編集画面に品目Aが表示される → 保存せずに在庫タブへ戻る
  2. 別の「ペース見直し?」品目Bを押す → 編集画面に**品目Bの品名・設定**が表示される（品目Aのままにならない）
  3. 品目Bで「採用」→保存すると、在庫タブで品目Bの「ペース見直し?」が消える（同日購入の食い違いはnotice 026の反映後に解消）
- 配信後チェックリスト（bundleに接続先ドメイン文字列が含まれること）は`ops/client-releases/README.md`に従う

## Approval

- app owner: 未

## 実施結果

（未実施）
