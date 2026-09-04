# mobileクライアント配信計画

client_release_id: 20260904-STOCKHOME-001

app: stockhome

status: iOS配信 verified（EAS Update公開まで完了、実機確認は未実施）。
  Android内部配布APKビルドは成功（実機へのインストール・起動確認は未実施）

created_by: Claude

related_notice_id: なし（本配信はAPI側の変更を伴わないmobile専用のSDKアップグレード）

deployment_status: partial（iOS: EAS Update公開完了・実機確認待ち / Android: build完了・
  インストール&実機確認待ち）

## 対象

- **source commit**: `460f7d0c116e03a6e7844e06052299eb4ae80cb8`
  （`chore(mobile): Expo SDKを54から57へ段階的にアップグレード`。API・DBへの変更は含まない）
- **変更内容**: `apps/mobile` の Expo SDK を 54 → 55 → 56 → 57（アップグレード時点の最新安定版。
  58はcanaryのみ）へ1段階ずつ移行。expo/react/react-native/各expo-\*パッケージ・typescriptを
  SDK57準拠へ更新。`newArchEnabled`設定削除（New Architecture必須化により無意味化）、
  `expo-font`/`expo-status-bar`のconfig plugin登録追加（SDK56要件）、
  `StatusBar`の`backgroundColor` prop削除（Android edge-to-edge必須化・SDK56で型定義から削除）。
  EAS Project ID・`eas.json`・iOS/Android の Bundle Identifier・package名は変更なし。
- 各段階で `npx expo-doctor` / `npx tsc --noEmit` / `npx expo export --platform android` を実施し、
  健全性を確認済み（実機/エミュレータでの起動確認は開発環境にAndroid toolingが無いため未実施）

## 配信経路ごとの計画

### iOS（`default` branch、Expo Go経由）

- **配信先 branch**: `default`
- **実行コマンド**: `eas update --branch default --environment production --message "..." --non-interactive`
- **重要な注意**: `runtimeVersion: { policy: "sdkVersion" }` のため、本配信で
  `runtime version` が `exposdk:54.0.0` → `exposdk:57.0.0` に変わる。これは既存配信の
  「置き換え」ではなく「追加」であり、**Expo Goが既にSDK57系に対応済みの端末のみ**が
  新しいバンドルを受け取る。旧SDK54対応のままのExpo Goを使っている端末は、引き続き
  旧`exposdk:54.0.0`のupdate group（直前group ID `8820a4ae-1321-4703-841f-28ea117a91f2`）
  を参照し続け、影響を受けない。

### Android（内部配布APK、`android-internal` channel）

- **実行コマンド**: `eas build --profile android-internal --platform android --non-interactive --no-wait`
- OTA(`eas update`)では native差分（RN 0.81→0.86等）を反映できないため、新規ネイティブビルドが必須。
- ビルド完了後、**利用者が端末へ手動で再インストールする必要がある**（内部配布のため自動更新されない）。

## 直前のupdate group（rollback先、iOS/`default` branch）

- **branch**: `default`
- **update group ID**: `8820a4ae-1321-4703-841f-28ea117a91f2`
- **runtime version**: `exposdk:54.0.0`
- 対応するgit commit: `af77280`（メッセージ: "反映記録ログ・Gmail取込価格の手動確認UI・
  プッシュ通知端末登録を追加 (source: 5cd6c66)"）
- 直前のAndroidビルド: `5030dbb2-4eae-41c3-895d-41521579c64a`（commit `38ae8b2`、
  2026-09-02、channel `android-internal`、SDK 54.0.0）

## Approval gate

ユーザーが対話セッション内で「アプリの配布をお願いします」と依頼し、AskUserQuestionで
「Android内部配布APKの再ビルド」「iOS向けEAS Update公開（defaultチャンネル）」の2点を明示選択。
Claudeが実行内容（コミット→push→iOS update→Android build）を提示し、ユーザーが
「良いです」と明示承認した。

iOS向け`eas update`実行はClaude Code側の自動モード分類器に一度拒否されたため、
その旨をユーザーへ報告し判断を仰いだところ、ユーザーが「iOS向けEAS Updateはあなたの方で
行って良い操作です」と明示承認し、再実行して成功した。

## 実施結果

### iOS EAS Update（`default` branch）

- **実施日時**: 2026-09-04（EAS記録は実行時に確認）
- **実行コマンド**: `eas update --branch default --environment production --message
  "Expo SDKを54から57へアップグレード (source: 460f7d0)" --non-interactive`
- **update group ID**: `6a42120c-2bec-429d-bc53-1d4fa3ae820c`
- **Android update ID**: `01a06b24-8242-72b4-a32e-c25f936b2484`
- **iOS update ID**: `01a06b24-8242-7acb-99b6-3b1ea72eac67`
- **branch**: `default`
- **runtime version**: `exposdk:57.0.0`（54.0.0から変更。上記「重要な注意」参照）
- **platform**: android, ios（実際の読者はiOS Expo Goのみ。過去の`20260903-STOCKHOME-001`計画で
  Android内部配布APKは`default`を読まないことを確認済み）
- **commit紐付け**: `460f7d0c116e03a6e7844e06052299eb4ae80cb8`
- **iOS Expo Goでの実機反映確認**: 未実施（ユーザー確認待ち）

### Android内部配布APKビルド

- **build ID**: `8a6417e7-9cd0-49b5-84fc-3c8b3412aeba`
- **実行コマンド**: `eas build --profile android-internal --platform android --non-interactive --no-wait`
- **commit紐付け**: `460f7d0c116e03a6e7844e06052299eb4ae80cb8`
- **sdkVersion / runtimeVersion**: `57.0.0` / `exposdk:57.0.0`
- **channel**: `android-internal`
- **状態**: `FINISHED`（成功）
- **所要時間**: 06:32:59 UTC 開始 → 06:57:30 UTC 完了（約24分。過去実績12〜38分の範囲内）
- **ビルドページ（QRコード/インストール導線あり）**:
  https://expo.dev/accounts/soushin.yamaoka/projects/stockhome/builds/8a6417e7-9cd0-49b5-84fc-3c8b3412aeba
- **APK直接URL**: https://expo.dev/artifacts/eas/eR0S15EeP9A15cJunhy5B33RB0ARUwc-CUB4u8jNdAU.apk
- **fingerprint**: `39f0046a1748ecd29c398f2384bcb887c83f4e1e`
- **実機インストール・起動確認**: **完了・正常動作を確認**（ユーザー本人、2026-09-04）

## Rollback方針

- **iOS**: 直前のupdate group（`8820a4ae-1321-4703-841f-28ea117a91f2`、runtime `exposdk:54.0.0`）は
  そのまま残っているため、SDK57未対応のExpo Goを使う端末には影響がない。今回配信した
  `exposdk:57.0.0`側に問題が判明した場合は、
  `eas update:republish --group <直前のexposdk:57.0.0系group> --branch default` で戻す
  （初回配信のため「直前のexposdk:57.0.0系group」は存在しない＝ロールバック先はビルド前の状態と同義）。
- **Android**: 内部配布APKは手動インストール運用のため、新APKに問題があれば旧APK
  （`5030dbb2-...`、SDK54）を再配布すればよい。既存端末は明示的に更新しない限り旧APKのまま動作する。
- DBやAPI側のrollbackは伴わない（本配信はmobileクライアントのみで、API・DBへは変更を加えていない）。

## 完了状態（更新予定）

- iOS: 配信（`eas update`公開）は成功。実機での起動・表示確認はユーザー側で実施予定
- Android: ビルド（`FINISHED`）は成功。APKの手動インストール・実機起動確認はユーザー側で実施予定
- 両方の実機確認が取れ次第、`status`/`deployment_status`を`verified`へ更新する
