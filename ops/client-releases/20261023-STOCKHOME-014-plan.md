# mobileクライアント配信計画

client_release_id: 20261023-STOCKHOME-014

record_type: client_release

app: stockhome

status: planned（段階1 承認待ち）

created_by: Claude

related_notice_id: なし（mobileのみ。API・VPSの変更なし）

## 背景

App StoreのExpo GoがSDK 58対応版に更新され（Expo GoはSDK 1世代のみ対応）、SDK 57の配信分（`default` branch、runtime `exposdk:57.0.0`）を
iPhoneで開けなくなった（2026-10-23、app ownerから報告）。SDK 58でbuildした更新を配信して復旧する。

## 対象

- **source commit**: `923b236`（Expo SDK 57→58）。前回client release（`20261022-STOCKHOME-013`、source `e98200e`）以降のmobile変更はこのcommitのみ:
  - expo 58.0.17、react-native 0.88.0、react 19.3.0、react-native-gesture-handler 3.3.0 ほか expo系を `expo install --fix` で揃えた
  - `@expo/config-plugins` 直接依存の削除（datetimepicker 9.2.1 が `expo/config-plugins` を使うため）
  - React Native 0.88 の厳格な型への対応9か所（型のみ。挙動変更なし）
- **native変更の有無**: あり（SDK・React Native本体の更新）。runtime version が `exposdk:58.0.0` に変わる
- **EAS環境**: `preview`（2026-10-23に`env:list preview`で`EXPO_PUBLIC_API_BASE_URL`・`EXPO_PUBLIC_NOTICES_FEED_URL`・`GOOGLE_SERVICES_JSON`の存在を確認済み）

### 段階1: iOS（今回承認をお願いするもの）

- 配信先 branch: `default`（iOS、Expo Go向け）
- 対象platform: iOSのみ（`eas update --branch default --environment preview --platform ios`）。Androidは`default`を読まないため対象外
- runtime: `exposdk:58.0.0`

### 段階2: Android（別承認）

- 現行の内部配布APKはSDK 57のbuildで、runtime `exposdk:58.0.0` の更新を受け取れない。
  `eas build --profile android-internal --platform android` でAPKを作り直し、端末へ入れ直したうえで `android-internal` へ配信する
- SDK 58からAndroid release buildでR8（minify）が既定で有効になる。build後に起動・主要画面を確認し、問題があれば
  `expo-build-properties` の `android.enableMinifyInReleaseBuilds: false` で無効化を検討する
- それまでAndroidは現行APK＋SDK 57の配信分（`7d4d7c90-…`）のまま使える

## 直前の安定版（rollback先）

- SDK 58としての配信はこれが初回で、戻せる SDK 58 の版は無い。SDK 57 のgroup（`22b095cf-df85-488b-a80d-456eab1d5426`）は
  SDK 58 のExpo Goでは開けないため、rollback先にならない
- 不具合時は修正版を再配信する（SDK 57の配信分は`default` branchに残るが、Expo Go 58は runtime `exposdk:58.0.0` の更新だけを読む）

## 配信前の確認事項（2026-10-23、Claude）

- `npx expo-doctor`: 20/20 合格
- `tsc --noEmit`（mobile）: エラー0
- mobile単体テスト: 61件成功
- `npx expo export --platform android --platform ios`: 両方生成成功
- API build成功、API runtime依存（fastify・prisma・fast-jwt等）はlockfile上不変
- 移行ガイドの破壊的変更でコード該当なし（InteractionManager・StatusBar backgroundColor・deep import無し。通知の表示はhandlerで明示済み）
- **未確認**: 実機での動作（gesture-handler 3系へのメジャー更新を含む）。配信後に確認する
- 配信後の確認観点（iPhone、Expo Go）:
  1. Expo Goでアプリが開き、ログイン状態が保たれている
  2. ホーム・消耗品・在庫・保管場所・設定の各タブが表示され、スクロール・引っ張って更新ができる
  3. 品目の編集・購入登録の日付ピッカー、下部シート/モーダルの開閉ができる
- 配信後チェックリスト（bundleに接続先ドメイン文字列が含まれること）は`ops/client-releases/README.md`に従う

## Approval

- app owner（段階1）: 未
- app owner（段階2）: 未

## 実施結果

（未実施）
