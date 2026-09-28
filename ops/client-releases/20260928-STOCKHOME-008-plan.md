# mobileクライアント配信計画

client_release_id: 20260928-STOCKHOME-008

record_type: client_release

app: stockhome

status: verified（2026-09-28、app ownerが実機で表示確認済み）

created_by: Claude

related_notice_id: none（server_impact: none。Codex実施結果・Claudeの評価とも一致。
StockHome API・DB・port/bind・cron・deploy・ログ形式・API契約のいずれも変更なし）

## 対象

- **source commit**: `b0868dd`（`origin/main`最新。task `20260928-001`の実施結果）
- **配信対象機能**（mobileのUI変更のみ。ホームからお知らせに気づけるようにする改善）:
  1. `apps/mobile/src/components/NoticeUnreadCard.tsx`（新規）: ホームの未読お知らせカード
     （メンテナンスバナーと重複しないもの、既読を除く）
  2. `apps/mobile/src/components/NoticeBanner.tsx`: `onPress`対応（タップで一覧を開く）
  3. `apps/mobile/src/screens/DashboardScreen.tsx`: 未読カード配置、バナーのタップ対応
  4. `apps/mobile/src/navigation/`（`types.ts`・`index.tsx`）: HomeStackへ
     「運営からのお知らせ」を登録、せっていタブへ未読時の朱色ドット表示
  5. `apps/mobile/src/lib/noticesLogic.ts`: `selectHomeUnreadNotices`追加（純粋関数、
     単体テスト2件追加）
- **API側の対応する変更**: なし
- **native変更の有無**: なし。JS/UIのみ
- **配信先 branch**（前回client release `20260926-STOCKHOME-007`と同じ2branch）:
  - `default`（iOS、Expo Go向け）
  - `android-internal`（Android、内部配布APK向け）
- **runtime version**: `exposdk:57.0.0`（変更なし）
- **対象platform**: iOS・Android両方
- **EAS環境変数**: 変更なし（`20260926-STOCKHOME-007`で登録済みの
  `EXPO_PUBLIC_NOTICES_FEED_URL`をそのまま使う）

## 直前の安定版（rollback先）

`npx eas-cli update:list --branch <name>`で本plan作成時点に確認した最新group
（`20260926-STOCKHOME-007`の配信分がまだ最新のまま、2026-09-28確認）:

- `default` branch: update group `112a8aa8-85ba-471d-950d-e2dbd6670df9`
  （runtime `exposdk:57.0.0`）
- `android-internal` branch: update group `66b5d419-87c6-4ea5-aebc-702557f9a9e3`
  （runtime `exposdk:57.0.0`）
- 本changeはJSのみでruntime変更が無いため、両branchとも
  `eas update:republish --group <上記group ID>`で直前groupへ戻せる。

## Approval

- app owner: 2026-09-28、このチャットで「実機確認後にEAS配信」を提示し、
  「はい、進めてください」の明示承認を受領（task `20260928-001`のレビュー完了後）。
  対象branch（`default`・`android-internal`両方、前回と同じ）・環境（`preview`、
  `ops/client-releases/README.md`の対応表どおり）を明示したうえでの承認。
- 配信実施条件: `ops/client-releases/README.md`記載の配信前チェックリストに従う。

## 実施結果

2026-09-28、明示承認後に`preview`環境から両branchへ`eas update --platform all`を実施した。

- `default` group: `21c3263c-6e58-49a3-85bf-bc4543b858c3`
- `android-internal` group: `94754314-5886-45ca-ae7d-88b1a3af7640`
- 両groupのruntime: `exposdk:57.0.0`
- 両groupのplatform: `android, ios`
- message: `ホームにお知らせの入口を追加 (source: b0868dd, client release: 20260928-STOCKHOME-008)`
- EAS記録のgit commit: `b0868dd94a09b2c53f47e797ae6248e934e4fdb1`
- 配信前rollback group: `default`=`112a8aa8-85ba-471d-950d-e2dbd6670df9`、
  `android-internal`=`66b5d419-87c6-4ea5-aebc-702557f9a9e3`。配信直前の最新groupと
  一致し、どちらもruntime `exposdk:57.0.0`であることを確認済み。
- 両branchのiOS・Android bundle（4ファイルとも）に`console.homehub-tools.dedyn.io`
  （お知らせfeed）と`stockhome.homehub-tools.dedyn.io`（既存API）の両方が含まれる
  ことを確認した。
- 利用者端末でのiOS・Android表示確認: 2026-09-28、app ownerがこのチャットで確認済み。
- production API、DB、GAS、VPS設定の変更はなし。
