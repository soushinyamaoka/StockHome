# mobileクライアント配信計画

client_release_id: 20261106-STOCKHOME-016

record_type: client_release

app: stockhome

status: planned（配信前）

created_by: Claude

related_notice_id: なし（API・サーバーの変更なし）

## 対象

- **source commit**: `863c62f`。前回client release（`20261103-STOCKHOME-015`、source `1268d4d`）以降のmobileに入る変更:
  1. `18f6e03` 別タブから消耗品タブの編集画面・購入記録画面を開いたとき、消耗品タブを未表示だと編集画面だけのstackになり、
     戻るボタンが出ず保存後も戻れなかった不具合の修正（`initial: false`。2026-11-06、app ownerから「時々この画面から戻れなくなります」と報告）
  2. `863c62f` 設定画面に「アプリの版」（client release番号・配信日）を表示。expo-updatesが有効な端末（Android内部配布APK）では、
     新しい版のダウンロード後にタブバーの上へ「再起動」ボタンを出し、アプリに戻ってきたとき（5分以上空けて）にも新しい版を確認する。
     Expo Go（iPhone）と開発時はexpo-updatesを読み込まない
  3. `378bf05`（notice 027）でshared側の依存がzod 4.6.7になったため、mobileのbundleに含まれるzodも4になる。
     mobileのコードはzodを直接使っていない
- **native変更の有無**: なし。`1268d4d..863c62f`で`apps/mobile/package.json`・`app.config.js`・`eas.json`に差分なし
  （`package-lock.json`・`packages/shared/package.json`の差分はzod・fastify等のJS依存のみ）。expo-updatesはAPKに組み込み済み
- **配信先 branch**: `default`（iOS、Expo Go向け）、`android-internal`（Android、内部配布APK向け）
- **runtime version**: `exposdk:58.0.0`（変更なし）
- **対象platform**: iOS・Android両方
- **EAS環境**: `preview`（2026-11-06に`env:list`で`EXPO_PUBLIC_API_BASE_URL`・`EXPO_PUBLIC_NOTICES_FEED_URL`の設定を確認）

## 直前の安定版（rollback先）

`20261103-STOCKHOME-015`の配信分:

- `default`: `04c73a9c-9627-499d-8652-9429115ef67a`（iOS）
- `android-internal`: `960d861f-0a23-463e-aa74-d7cb6c430c2b`（Android）
- 戻す場合は`eas update:republish --group <上記group ID>`

## 配信前の確認事項

- mobile型チェック（テスト以外）成功、mobile単体テスト62件成功（新規1件: アプリの版の表示）（2026-11-06）
- `npx expo export`（iOS・Android）成功。Android bundleに「再起動」のお知らせ文言・「アプリの版」・`016`を確認
- **未確認**: 実機での画面遷移と再起動ボタン。再起動ボタンは、016が動いている端末に次の版（017以降）が届いたときに初めて出る
- 配信後の確認観点:
  1. アプリを2回開き直したあと、設定画面の下に「アプリの版 016（11/6配信）」と出る
  2. 消耗品タブを開かずに、在庫タブの「ペース見直し?」を押す → 編集画面の左上に戻るボタンがあり、消耗品の一覧へ戻れる
  3. ホームの「買ったよ！を記録する」「消耗品を追加」でも同様に戻れる

## Approval

- app owner: 未（2026-11-06に戻れない不具合の修正の配信は承認済みだったが、その後「まって」で保留。版表示・再起動ボタンを追加して内容が変わったため改めて承認を得る）

## 実施結果

（未実施）
