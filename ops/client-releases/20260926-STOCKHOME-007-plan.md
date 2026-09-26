# mobileクライアント配信計画

client_release_id: 20260926-STOCKHOME-007

record_type: client_release

app: stockhome

status: published（2026-09-26、両branch・両platformへ配信済み。利用者端末での確認待ち）

created_by: Claude

related_notice_id: none（server_impact: none。Codex実施結果・Claudeの評価とも一致。
StockHome API・DB・port/bind・cron・deploy・ログ形式・API契約のいずれにも変更なし）

## 対象

- **source commit**: `0f3def9`（`origin/main`最新。VPS2お知らせfeed機能の実装
  commit `dfc5c21`＋`.env.example`プレースホルダ追記commit `0f3def9`を含む）
- **配信対象機能**（mobileのUI変更のみ。task `20260926-001`由来）:
  1. `apps/mobile/src/api/notices.ts`（新規）: VPS2公開feed（`/notices/v1/feed.json`）
     の取得・スキーマ検証
  2. `apps/mobile/src/lib/noticesLogic.ts`・`noticesStorage.ts`（新規）: 表示期間・
     鮮度判定の純粋関数、端末内キャッシュ・既読状態（AsyncStorage）
  3. `apps/mobile/src/hooks/useNoticesFeed.tsx`（新規）: 起動時・フォアグラウンド
     復帰時・5分間隔での取得制御（`App.tsx`へ`NoticesProvider`を追加）
  4. `apps/mobile/src/components/NoticeBanner.tsx`（新規）: メンテナンス中バナー。
     `DashboardScreen`・`LoginScreen`の両方に配置
  5. `apps/mobile/src/screens/settings/OperatorNoticesScreen.tsx`（新規）: 「運営から
     のお知らせ」一覧。`SettingsScreen`に未読バッジ付き導線を追加
- **API側の対応する変更**: なし。VPS2の公開feedへ端末から直接GETするのみで、
  StockHome APIのエンドポイント・レスポンス形式とも変更していない
- **native変更の有無**: なし。JS/UIのみの変更。`@react-native-async-storage/async-storage`
  は既存依存（新規native module・permission・config plugin追加なし）
- **配信先 branch**（前回client release `20260918-STOCKHOME-006`と同じ2branch）:
  - `default`（iOS、Expo Go向け）
  - `android-internal`（Android、内部配布APK向け）
- **runtime version**: `exposdk:57.0.0`（変更なし。JSのみのためruntime変更なし）
- **対象platform**: iOS・Android両方
- **EAS環境変数**: `EXPO_PUBLIC_NOTICES_FEED_URL`を`preview`環境へ新規登録済み
  （2026-09-26、Claude実施。`--visibility sensitive`、既存の
  `EXPO_PUBLIC_API_BASE_URL`と同様の扱い）。`.env.example`にはプレースホルダのみ。

## 直前の安定版（rollback先）

`npx eas-cli update:list --branch <name>`で本plan作成時点に確認した最新group
（2026-09-26時点、`20260918-STOCKHOME-006`の配信分がまだ最新のまま）:

- `default` branch: update group `f71148a1-d3e6-4f43-a8a4-8283a2da73d0`
  （runtime `exposdk:57.0.0`）
- `android-internal` branch: update group `ac93a404-e98f-432d-9209-71c6c222880d`
  （runtime `exposdk:57.0.0`）
- 本changeはJSのみでruntime変更が無いため、両branchとも
  `eas update:republish --group <上記group ID>`で直前groupへ戻せる。
- 配信直前に`npx eas-cli update:list --branch default`（`android-internal`も同様）で
  上記group IDが依然として最新であることを再確認する。

## Approval

- app owner: 2026-09-26、このチャットで「.env.exampleのcommit／EASへの環境変数登録／
  `eas update`配信／実機確認」の一連を提示し、「進めてください」の明示承認を受領
  （task `20260926-001`のレビュー完了後）。対象branch（`default`・`android-internal`
  両方、前回と同じ）・環境（`preview`、`ops/client-releases/README.md`の対応表どおり）
  を明示したうえでの承認。
- 配信実施条件: `ops/client-releases/README.md`記載の配信前チェックリスト
  （`--environment preview`を使用し`production`は使わない。事前に
  `EXPO_PUBLIC_NOTICES_FEED_URL`・`EXPO_PUBLIC_API_BASE_URL`が`preview`環境に
  存在することを確認済み）に従う。

## 実施結果

2026-09-26、明示承認後に`preview`環境から両branchへ`eas update --platform all`を実施した。

- `default` group: `112a8aa8-85ba-471d-950d-e2dbd6670df9`
- `android-internal` group: `66b5d419-87c6-4ea5-aebc-702557f9a9e3`
- 両groupのruntime: `exposdk:57.0.0`
- 両groupのplatform: `android, ios`
- message: `運営お知らせfeed機能を追加 (source: 0f3def9, client release: 20260926-STOCKHOME-007)`
- EAS記録のgit commit: `0f3def99bbdc68a2d9c20444b454a570fd635c25`
- 配信前rollback group: `default`=`f71148a1-d3e6-4f43-a8a4-8283a2da73d0`、
  `android-internal`=`ac93a404-e98f-432d-9209-71c6c222880d`。配信直前の最新groupと
  一致し、どちらもruntime `exposdk:57.0.0`であることを確認済み。
- `preview`環境から`EXPO_OWNER`・`EXPO_PUBLIC_API_BASE_URL`・
  `EXPO_PUBLIC_NOTICES_FEED_URL`が読み込まれたことをeas updateの出力で確認
  （値は表示せず、変数名のみ）。
- 両branchのiOS・Android bundle（4ファイルとも）に`console.homehub-tools.dedyn.io`
  （お知らせfeed）と`stockhome.homehub-tools.dedyn.io`（既存API）の両方が含まれる
  ことを確認した。
- 利用者端末でのiOS・Android表示確認: 未実施、本人確認報告待ち。報告受領後に
  `verified`へ更新する。
- production API、DB、GAS、VPS設定の変更はなし。production business dataの編集・
  削除・候補取消もなし。
