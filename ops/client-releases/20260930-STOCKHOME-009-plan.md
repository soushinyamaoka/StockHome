# mobileクライアント配信計画

client_release_id: 20260930-STOCKHOME-009

record_type: client_release

app: stockhome

status: delivered（2026-09-30配信済み。利用者端末での確認待ち）

created_by: Claude

related_notice_id: 20260929-STOCKHOME-021（改修「ペース見直し」のみ関係。反映順は順不同で安全。
新mobileが旧APIに接続しても`suggestedDaysPerUnit`が無く印が出ないだけ）

## 対象

- **source commit**: `dae77df`（`origin/main`最新）。前回client release（`b0868dd`）以降のmobile変更:
  1. `3673137` ホームのクイック購入登録
  2. `4a7c908` 補正プリセットと「単位で入力」による消費ペース入力
  3. `d249970` 購入履歴に在庫補正を混ぜたタイムライン表示
  4. `dea7c89` 在庫一覧の「ペース見直し?」印（**API側 notice 021 が本番未反映の間は印が出ない**）
  5. `2a0f5d3` Gmail取込候補の「まとめて無視」
  6. `5b09a0a`・`dae77df` 在庫一覧・ホームの端末保存（オフライン表示）と、
     起動時の通信失敗でログアウトしない修正
- **native変更の有無**: なし。追加依存2件（`@tanstack/react-query-persist-client`、
  `@tanstack/query-async-storage-persister`、いずれも5.101.0）はJSのみで、保存先の
  `@react-native-async-storage/async-storage`は配布済みアプリに組み込み済み。
  `app.json`・`eas.json`に差分なし。
- **配信先 branch**: `default`（iOS、Expo Go向け）、`android-internal`（Android、内部配布APK向け）
- **runtime version**: `exposdk:57.0.0`（変更なし）
- **対象platform**: iOS・Android両方
- **EAS環境**: `preview`（`ops/client-releases/README.md`の対応表どおり）。
  2026-09-30に`npx eas-cli env:list preview`で`EXPO_PUBLIC_API_BASE_URL`・
  `EXPO_PUBLIC_NOTICES_FEED_URL`・`GOOGLE_SERVICES_JSON`の存在を確認済み。

## 直前の安定版（rollback先）

2026-09-30に`eas update:list`で確認（`20260928-STOCKHOME-008`の配信分が最新のまま）:

- `default`: `21c3263c-6e58-49a3-85bf-bc4543b858c3`（runtime `exposdk:57.0.0`）
- `android-internal`: `94754314-5886-45ca-ae7d-88b1a3af7640`（runtime `exposdk:57.0.0`）
- 戻す場合は`eas update:republish --group <上記group ID>`。

## 配信前の確認事項

- 実機確認は未実施（改修1・3・4・5・6・7・8とも）。配信後に利用者端末で確認する。
- 配信後の確認観点: 起動・ログイン、ホームのクイック購入、在庫一覧の表示、
  機内モードでの再起動（保存内容と「通信できないため…」の帯が出て、ログアウトされないこと）、
  取込候補の「まとめて選ぶ」→「無視」。
- 配信後チェックリスト（bundleに接続先ドメイン文字列が含まれること）は
  `ops/client-releases/README.md`に従う。

## Approval

- app owner: 2026-09-30、このチャットで対象branch（`default`・`android-internal`）・環境（`preview`）・source commit（`dae77df`）を提示したうえで「進めてください」の承認、および`eas update`実行の許可を受領。
- 配信実施条件: `ops/client-releases/README.md`記載の配信前チェックリストに従う。

## 実施結果

2026-09-30、明示承認後に`preview`環境から両branchへ`eas update --platform all`を実施した。

- `default` group: `da6adefb-410e-4aec-946d-53bc5a9ae08f`
- `android-internal` group: `e7f124d3-639c-4cd2-837b-a094615d739c`
- 両groupのruntime: `exposdk:57.0.0`、platform: `android, ios`
- message: `オフライン表示・クイック購入・まとめて無視ほか (source: dae77df, client release: 20260930-STOCKHOME-009)`
- EAS記録のgit commit: `dae77df12cb238644ecb0e0af50ab7e2fa96dfa1`
- 配信前rollback group: `default`=`21c3263c-6e58-49a3-85bf-bc4543b858c3`、
  `android-internal`=`94754314-5886-45ca-ae7d-88b1a3af7640`（配信直前の最新groupと一致）。
- bundle確認: 配信後に同一commitをローカルで`expo export`し、iOS・Androidのhbcに
  `stockhome.homehub-tools.dedyn.io`（API）と`console.homehub-tools.dedyn.io`（お知らせfeed）が
  含まれることを確認した（公開済みbundle自体のダウンロード検査ではない）。
- 利用者端末での表示確認: 未実施。
- production API、DB、GAS、VPS設定の変更はなし。
