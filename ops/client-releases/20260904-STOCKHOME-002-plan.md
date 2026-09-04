# mobileクライアント配信計画

client_release_id: 20260904-STOCKHOME-002

app: stockhome

status: draft（配信はまだ実施しない。VPS管理レビューB05対応として作成のみ）

created_by: Claude

related_notice_id: 20260904-STOCKHOME-005

## 対象

- **source commit**: `278822dbf4b9df22d9782ab28ccc3fa25f53ac70`
  （B01〜B06対応後は別途新しいcommitへ更新する）
- **配信対象機能**（mobileのUI変更のみ。API本体は`ops/server-change-notices/20260904-STOCKHOME-005-summary.md`で別管理）:
  1. 品目編集画面（`ItemFormScreen`）: 消費ペースの実績提案表示＋「採用」ボタン
  2. 購入履歴画面（`PurchaseHistoryScreen`）: 価格推移の簡易スパークライン表示
- **native変更の有無**: なし。JS/UIのみの変更（新規native module追加・config plugin変更・
  permission変更は無い）
- **配信先 branch**: 未定（`default`＝iOS Expo Go向け、または`android-internal`＝内部配布APK向け、
  実施時に対象を確定する）
- **runtime version**: `exposdk:57.0.0`（2026-09-04時点で配信済みの最新runtimeと同一。
  本changeはJSのみのためruntime versionは変わらない）
- **対象platform**: 未定（app owner承認時に確定）

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

- app owner（client配信固有の承認）: 未実施。配信対象branch/platform・実施時期を
  特定したうえで、別途チャットで明示承認を得てから実施する
- VPS production承認との混同禁止: 本clientの配信可否は、上記「server/APIとの互換性」により
  server側（20260904-STOCKHOME-005）のVPS承認・production反映を待たずに判断できるが、
  実際の配信実行は本ファイルのapp owner承認を得てから行う

## 未解決事項

- 配信先branch（`default`/`android-internal`いずれか、または両方）と実施時期が未確定
- source commitはB01〜B06対応後のcommitへ更新が必要
