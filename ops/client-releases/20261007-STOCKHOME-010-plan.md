# mobileクライアント配信計画

client_release_id: 20261007-STOCKHOME-010

record_type: client_release

app: stockhome

status: delivered（2026-10-08配信済み。利用者端末での確認待ち）

created_by: Claude

related_notice_id: なし（API・shared・DBの変更なし。既存の`POST /api/items`・`POST /api/corrections`・
`PATCH /api/purchases/:id`をそのまま使う）

## 対象

- **source commit**: `3efe1b7`（`origin/main`最新）。前回client release（`dae77df`）以降のmobile変更:
  1. `cf6b92c` 新規登録で「いま手元にある数」を入力（任意。入力時は登録直後に在庫補正として保存）と、
     取込候補から新規品目を作ったら取込便へ戻り、元の候補で品目を選んだ状態にする（task 20261007-001）
  2. `3efe1b7` ホーム「買った」の取消バーに「個数を変える」（−/＋で購入数を訂正、task 20261007-002）
- 他のcommit（`6104efe`）は文書のみ。
- **native変更の有無**: なし。`dae77df..3efe1b7`で`apps/mobile/package.json`・`app.config.js`・`eas.json`・
  `package-lock.json`に差分なし（2026-10-07確認）。使用部品はRN標準の`Modal`のみ。
- **配信先 branch**: `default`（iOS、Expo Go向け）、`android-internal`（Android、内部配布APK向け）
- **runtime version**: `exposdk:57.0.0`（変更なし）
- **対象platform**: iOS・Android両方
- **EAS環境**: `preview`（`ops/client-releases/README.md`の対応表どおり）。
  2026-10-07に`npx eas-cli env:list preview`で`EXPO_PUBLIC_API_BASE_URL`・
  `EXPO_PUBLIC_NOTICES_FEED_URL`・`GOOGLE_SERVICES_JSON`の存在を確認済み。

## 直前の安定版（rollback先）

2026-10-07に`eas update:list`で確認（`20260930-STOCKHOME-009`の配信分が最新のまま）:

- `default`: `da6adefb-410e-4aec-946d-53bc5a9ae08f`（runtime `exposdk:57.0.0`）
- `android-internal`: `e7f124d3-639c-4cd2-837b-a094615d739c`（runtime `exposdk:57.0.0`）
- 戻す場合は`eas update:republish --group <上記group ID>`。

## 配信前の確認事項

- 実機確認は未実施（Codexの環境では不可）。型チェック・単体テスト47件は成功（2026-10-07、Claude再実行）。
- 配信後の確認観点:
  1. 消耗品登録で「いま手元にある数」を入れて登録 → 在庫一覧でその数から予測が出ること。空欄なら従来どおり「在庫不明」。
  2. 取込便の候補 →「新しい消耗品として登録する」→ 登録 → OK で取込便へ戻り、その候補の「紐付ける品目」に
     作った品目が選ばれていること。消耗品タブを開くと一覧に戻っていること（登録フォームが残っていない）。
  3. ホーム「そろそろ切れそう」の「買った」→ 下部バー「個数を変える」→ −/＋ → 決定で、メッセージの個数が変わり、
     購入履歴の数量も変わっていること。その後「取り消す」も効くこと。
- 配信後チェックリスト（bundleに接続先ドメイン文字列が含まれること）は
  `ops/client-releases/README.md`に従う。

## Approval

- app owner: 2026-10-08、このチャットで対象branch（`default`・`android-internal`）・環境（`preview`）・source commit（`3efe1b7`）・rollback先を提示したうえで「では進めてください」の承認を受領（承認は2026-10-07〜08の会話内）。
- 配信実施条件: `ops/client-releases/README.md`記載の配信前チェックリストに従う。

## 実施結果

2026-10-08、明示承認後に`preview`環境から両branchへ`eas update --platform all`を実施した。

- `default` group: `f8934b51-5ef7-46da-b4e2-348e280de4a9`
- `android-internal` group: `ff7827d8-392a-40f0-bb23-b1872770caa2`
- 両groupのruntime: `exposdk:57.0.0`、platform: `android, ios`
- message: `手元の数・取込候補へ戻る・買った個数変更 (source: 3efe1b7, client release: 20261007-STOCKHOME-010)`
- EAS記録のgit commit: `3efe1b7008c665eb081e11b615841bdb751cb3bb`（末尾`*`は、配信時に未追跡の
  `ops/production-db-operations/`と本planファイルがあったため。追跡対象のソースに未コミット変更は無い）。
- 配信前チェック: `eas env:list preview`で`EXPO_PUBLIC_API_BASE_URL`・`EXPO_PUBLIC_NOTICES_FEED_URL`・
  `GOOGLE_SERVICES_JSON`の存在を確認。
- bundle確認: 配信後に同一commitを`eas env:exec preview`配下でローカル`expo export`し、iOS・Androidのhbcに
  `stockhome.homehub-tools.dedyn.io`（API）と`console.homehub-tools.dedyn.io`（お知らせfeed）が各1件
  含まれ、`10.0.2.2:4002`（emulator fallback）が0件であることを確認した
  （公開済みbundle自体のダウンロード検査ではない）。
- 利用者端末での表示確認: 未実施（上記「配信後の確認観点」3点）。
- production API、DB、GAS、VPS設定の変更はなし。
