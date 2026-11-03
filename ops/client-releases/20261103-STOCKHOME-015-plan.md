# mobileクライアント配信計画

client_release_id: 20261103-STOCKHOME-015

record_type: client_release

app: stockhome

status: delivered（利用者端末で確認済み）

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

- app owner: 承認（2026-11-03、チャットで「アプリ配信はしてokです」）

## 実施結果

### 2026-11-03

明示承認後に`preview`環境から以下を実施した（native変更なしのためAPK再buildは不要）。

- `eas update --branch default --platform ios`
  - `default` group: `04c73a9c-9627-499d-8652-9429115ef67a`（iOS update `01a1a0a4-1a88-7e25-aafa-5c1a7228a992`）、runtime `exposdk:58.0.0`
- `eas update --branch android-internal --platform android`
  - `android-internal` group: `960d861f-0a23-463e-aa74-d7cb6c430c2b`（Android update `01a1a0a4-d408-7f69-bab5-23314436611f`）、runtime `exposdk:58.0.0`
- message: `品目編集画面の上書き不具合を修正 (source: 1268d4d, client release: 20261103-STOCKHOME-015)`
- EAS記録のgit commit: `f427b2b`（ops記録の追加のみでmobileソースは`1268d4d`と同一。`*`は未追跡の`ops/production-db-operations/`によるもの）
- bundle確認: ローカルbundle（Android hbc）に`stockhome.homehub-tools.dedyn.io`・`console.homehub-tools.dedyn.io`が各1件、`10.0.2.2:4002`が0件、
  sourcemapに修正後の`ItemFormContent`を確認（公開済みbundle自体のダウンロード検査ではない。iOS bundleはAndroidの書き出しで上書きされたため個別には未確認）。
  配信直後に`GET /health` 200
- 利用者端末での確認: 2026-11-03、app ownerから「アプリの動作確認できました」との報告を受領
- production API、DB、GAS、VPS設定の変更はなし

### 配信後の事象（2026-11-03 20:48 JST）

- 「ペース見直し?」から続けて開いた2品目（さらさ・スコッティ ボックス）が、キュレル フェイスクリームの品名・設定で上書きされた（本planで修正した不具合と同じ症状）
- 配信（同日夕方）後、アプリを完全に終了せず使っていたため旧bundleのまま動いていた可能性が高い（EAS Updateは起動時に取得し、次回の起動で反映される）。
  端末で実行中のbundleは確認できていないため、修正が効いていない可能性も否定はできない。app ownerにアプリの再起動と、症状が再発しないかの確認を依頼
- データは同日、アプリのAPIを利用者アカウントで呼ぶ通常操作で復元した（品名・設定は同日朝の取得値に戻し、消費ペースのみ推定値）
