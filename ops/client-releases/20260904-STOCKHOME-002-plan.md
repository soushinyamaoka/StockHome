# mobileクライアント配信計画

client_release_id: 20260904-STOCKHOME-002

record_type: client_release

app: stockhome

status: approved（2026-09-05、app ownerが対象branch/platformを特定して明示承認。配信実施へ）

created_by: Claude

related_notice_id: 20260904-STOCKHOME-005

## 対象

- **source commit**: `c231f76bb8543e462ba78ecc55d0e72a88bf3311`
  （2026-09-05、VPS管理側第2回レビューB09対応でnoticeと同一commitへ更新。
  以降serverと同じsourceを追うのではなく、実際にmobile UIへ含める変更が固まった時点の
  commitへ改めて固定する）
- **配信対象機能**（mobileのUI変更のみ。API本体は`ops/server-change-notices/20260904-STOCKHOME-005-summary.md`で別管理）:
  1. 品目編集画面（`ItemFormScreen`）: 消費ペースの実績提案表示＋「採用」ボタン
  2. 購入履歴画面（`PurchaseHistoryScreen`）: 価格推移の簡易スパークライン表示
- **native変更の有無**: なし。JS/UIのみの変更（新規native module追加・config plugin変更・
  permission変更は無い）
- **配信先 branch**: 両方を配信する（2026-09-05、app ownerが確定）
  - `default`（iOS、Expo Go向け）
  - `android-internal`（Android、内部配布APK向け。APKの再ビルドは不要、既存APKへのJS-only update）
- **runtime version**: `exposdk:57.0.0`（2026-09-04時点で配信済みの最新runtimeと同一。
  本changeはJSのみのためruntime versionは変わらない）
- **対象platform**: iOS・Android両方（2026-09-05、app owner確定）

## server/APIとの互換性・実施順序

- **client先行時（本UIを先に配信し、APIが旧のまま）**: `GET /api/items/:itemId/purchases`は
  `suggestedDaysPerUnit`フィールドを返さない（`undefined`）。mobile側は
  `purchasesData?.suggestedDaysPerUnit ?? null`で受けるため、提案が表示されないだけで
  クラッシュしない。価格推移スパークラインは既存の`purchases`/`price`フィールドのみを使う
  （API変更に依存しない）ため、旧APIでも正常に動作する。
  **→ client先行配信は安全**（server側の反映を待つ必要はない）
- **server先行時（APIだけ先に反映し、mobileが旧のまま）**: 旧mobileは
  `suggestedDaysPerUnit`フィールドを単に無視する（未使用の追加フィールドを読まないため）。
  **→ server先行反映も安全**
- 上記により、本clientとAPI（20260904-STOCKHOME-005）の反映順序に依存関係はない。
  どちらを先に配信してもよい

## 直前の安定版（rollback先）

- iOS `default` branch: update group `6a42120c-2bec-429d-bc53-1d4fa3ae820c`
  （`20260904-STOCKHOME-001`で配信・実機確認済み、runtime `exposdk:57.0.0`）
- Android `android-internal`: build `8a6417e7-9cd0-49b5-84fc-3c8b3412aeba`
  （`20260904-STOCKHOME-001`で配信・実機確認済み、SDK 57.0.0）
- 本changeはJSのみのため、iOS側はrollbackする場合`eas update:republish`で直前groupへ戻せる。
  Android側は内部配布APKの再ビルド無しに、同じruntimeへのJS-only updateとしてrollback可能
  （native変更が無いため）

## 実機確認

- 未実施（配信自体が未実施のため）

## Approval

- app owner（client配信固有の承認）: **2026-09-05、明示承認**。対象branch
  （`default`＝iOS、`android-internal`＝Android）を特定したうえで、両方の配信を承認
- VPS production承認との混同禁止: server側notice `20260904-STOCKHOME-005`のVPS承認・
  production反映（task `20260905-001`、`verified`待ち）とは別枠の承認として扱った

## 実施結果

- **実行コマンド**:
  - iOS: `eas update --branch default --environment production --message "消費ペース実績提案・価格推移スパークライン表示を追加 (source: c231f76)" --non-interactive`
  - Android: `eas update --branch android-internal --environment production --message "..." --non-interactive`（メッセージはiOSと同一）
- **iOS（`default` branch）**:
  - update group ID: `a4919c88-f1cd-4857-a604-bac23b1c334d`
  - iOS update ID: `01a06f94-59ed-7427-afb0-86786bbf5e43`
  - runtime version: `exposdk:57.0.0`（変更なし）
  - commit紐付け: `cfe03ffca7e84f16385ce5ae9645e9249e9206a9`（EAS上の表示。実バンドル内容は
    固定source `c231f76`と同一であることを確認済み。以降mobile側の差分なし）
- **Android（`android-internal` branch）**:
  - update group ID: `fb6ee011-08b3-47ef-8f42-674f0c7b8e18`
  - Android update ID: `01a06f95-2725-7b3f-997b-3b3e0bfdf557`
  - runtime version: `exposdk:57.0.0`（変更なし）
  - commit紐付け: `cfe03ffca7e84f16385ce5ae9645e9249e9206a9`（同上）
  - **注記**: `android-internal` branchはこれが初のEAS Update（従来はbuild
    `8a6417e7-...`に埋め込まれたJSバンドルのみで運用）。そのため本branchに関しては
    「直前のupdate group」への再publishというrollback手段はまだ存在しない。
    問題が生じた場合のrollbackは、本branchへのOTA配信自体を行わない状態
    （embedded bundleへ戻す）とする

## インシデント: 接続先URLが埋め込まれず全platformでログイン不能（同日中に修正）

- **事象**: 上記の初回配信後、ユーザーがAndroidでログインを試みると
  `AxiosError: Network Error`。VPS管理側で確認したところAPI側にログが一切残っておらず、
  リクエストがサーバーへ到達していなかった
- **原因**: `eas update`実行時に指定した`--environment production`は、本プロジェクトの
  EAS上で**変数が一切設定されていない空の環境**だった。実際の接続先URL
  （`EXPO_PUBLIC_API_BASE_URL`）は`preview`という名前の環境の方に設定されており
  （Android内部配布APKのbuild profile`android-internal`が`environment: preview`を
  使っているのはこのため）、`production`環境を指定したことでURLが一切バンドルへ
  埋め込まれず、`apps/mobile/src/api/client.ts`の`resolveBaseUrl()`が実機到達不能な
  fallback値（Android: `http://10.0.2.2:4002`というエミュレータ専用ループバック、
  iOS: `http://localhost:4002`）へ落ちていた。**iOS・Android両方の初回配信
  （update group `a4919c88-...`・`fb6ee011-...`）が同じ原因で影響を受けていた**
- **対応**: 両branchへ、`--environment preview`を指定して再度`eas update`を実行し修正した
  - iOS（`default`）: update group `eb93101b-077f-4b84-ae8b-493e854da132`
  - Android（`android-internal`）: update group `411b16b8-5b11-4b61-91b3-c2de7e162af2`
  - 修正後、書き出し済みbundle（`.hbc`）に実際のドメイン文字列
    （`stockhome.homehub-tools.dedyn.io`）が含まれることを直接確認した
- **今後の再発防止**: `eas update`／`eas build`で`--environment`を指定する際は、
  実行前に`eas env:list <environment名>`で対象環境に必要な変数が実在することを
  確認してから実行する。EAS環境変数が`production`という名前の環境ではなく`preview`に
  設定されている現状の構成自体が紛らわしく、将来的に変数を`production`環境へ
  揃えるか、名称と実態を一致させる整理が望ましい（本ファイルでは実施せず、
  今後の検討事項として記録する）
- **iOS Expo Go / Android内部配布APKでの実機反映確認**: 未実施（ユーザー確認待ち。
  修正後のupdate groupで再確認が必要）

## 未解決事項

- 配信後（修正版）の実機確認（iOS Expo Go / Android内部配布APK）が未実施
- EAS環境変数の`production`/`preview`の名称と実態の不一致は未整理（上記インシデント参照）
