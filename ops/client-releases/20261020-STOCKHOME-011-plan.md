# mobileクライアント配信計画

client_release_id: 20261020-STOCKHOME-011

record_type: client_release

app: stockhome

status: delivered（2026-10-20配信済み。利用者端末での確認待ち）

created_by: Claude

related_notice_id: `20261020-STOCKHOME-022`（保管場所のDB・API。2026-10-20 production反映・`verified`）。
mobile側はこのnoticeで追加された`/api/storage/*`を使うだけで、API・DBの追加変更はなし。

## 対象

- **source commit**: `d7988c2`（`origin/main`最新）。前回client release（`3efe1b7`）以降のmobile・shared変更:
  1. `8ae0986` shared に保管場所のZodスキーマ・上限値・名前正規化を追加（API側は notice 022 で反映済み。mobileはsrc直参照）
  2. `d1feb8e` 段階3: 置き場所タブ（場所を辿る・文字/用途タグ検索）、ホーム「そろそろ切れそう」にストック場所を表示
  3. `09f38ae` 段階4: 物・消耗品の置き場所の追加・移動・メモ・「ここに無かった」・用途タグ編集、物の登録・編集・削除、
     場所の追加・名前変更・移動・統合・削除、用途タグの整理、ホーム「買った」後の「しまう場所」、消耗品一覧の「置き場所」ボタン
- 他のcommitはAPI（notice 022で反映済み）・ops/docs文書のみ。
- **native変更の有無**: なし。`3efe1b7..d7988c2`で`apps/mobile/package.json`・`app.config.js`・`eas.json`・
  `package-lock.json`に差分なし（2026-10-20確認）。使用部品はRN標準と既存依存（`@expo/vector-icons`・React Navigation・TanStack Query）のみ。
- **配信先 branch**: `default`（iOS、Expo Go向け）、`android-internal`（Android、内部配布APK向け）
- **runtime version**: `exposdk:57.0.0`（変更なし）
- **対象platform**: iOS・Android両方
- **EAS環境**: `preview`（`ops/client-releases/README.md`の対応表どおり）。
  2026-10-20に`npx eas-cli env:list preview`で`EXPO_PUBLIC_API_BASE_URL`・
  `EXPO_PUBLIC_NOTICES_FEED_URL`・`GOOGLE_SERVICES_JSON`の存在を確認済み。

## 直前の安定版（rollback先）

2026-10-20に`eas update:list`で確認（`20261007-STOCKHOME-010`の配信分が最新のまま）:

- `default`: `f8934b51-5ef7-46da-b4e2-348e280de4a9`（runtime `exposdk:57.0.0`）
- `android-internal`: `ff7827d8-392a-40f0-bb23-b1872770caa2`（runtime `exposdk:57.0.0`）
- 戻す場合は`eas update:republish --group <上記group ID>`。旧版に戻しても、登録済みの保管場所データはサーバーに残る（表示されなくなるだけ）。

## 配信前の確認事項

- 型チェック成功、mobile単体テスト59件成功（2026-10-20）。
- ローカルAPI＋テスト用世帯でWeb表示を操作して画面確認済み（置き場所タブ、場所画面、物の登録→詳細→2か所目追加、
  取消バーの「しまう場所」、タグ整理・統合先選択）。
- **未確認**: Webでは確認ダイアログ（Alert）が動かないため、「ここに無かった」「削除」「統合」の確認後の動作は実機で確認する
  （API側の動作は notice 022 のテストで確認済み）。実機（iOS Expo Go・Android APK）での表示は未確認。
- 配信後の確認観点:
  - 段階3（閲覧・検索）
    1. 下のタブに「置き場所」が出て、開ける。場所0件のときは案内が出る。
    2. 場所をタップして中へ辿れる。上部の経路（パンくず）で戻れる。
    3. 文字検索・用途タグのチップで絞り込める。
    4. ホーム「そろそろ切れそう」の各品目に、置き場所登録済みなら「ストック: …」が出る（未登録なら何も出ない）。
  - 段階4（登録・編集）
    5. 置き場所タブ右上「＋」で物を登録（名前・置き場所・タグ）→ 詳細画面に移る。
    6. 詳細画面で置き場所の追加・「移動」・「メモ」・「ここに無かった」（確認ダイアログ→その置き場所だけ外れる）。
    7. 用途タグの付け外し、入力中に既存タグが候補に出る。
    8. 場所画面下部: 中に場所を追加・名前/メモ・移動・統合（確認ダイアログ→統合先へ移る）・削除（空のときのみ）。
    9. 置き場所タブ下部「用途タグの整理」で改名・統合・削除。
    10. ホーム「買った」後の取消バーに「しまう場所: …」/「しまう場所を決める」が出て、タップで詳細画面へ。戻った後も「取り消す」が効く。
    11. 消耗品タブの各品目「置き場所」ボタンで詳細画面へ。
- 配信後チェックリスト（bundleに接続先ドメイン文字列が含まれること）は
  `ops/client-releases/README.md`に従う。

## Approval

- app owner: 2026-10-20、このチャットで対象branch（`default`・`android-internal`）・環境（`preview`）・source commit（`d7988c2`）・rollback先を提示したうえで「承認します」の承認を受領。
- 配信実施条件: `ops/client-releases/README.md`記載の配信前チェックリストに従う。

## 実施結果

2026-10-20、明示承認後に`preview`環境から両branchへ`eas update --platform all`を実施した。

- `default` group: `ec011018-dff2-42ea-b7f0-9de210868d44`
- `android-internal` group: `f57b266d-b422-4c62-892f-d3161ab6c9a7`
- 両groupのruntime: `exposdk:57.0.0`、platform: `android, ios`
- message: `置き場所タブ・置き場所の登録編集 (source: d7988c2, client release: 20261020-STOCKHOME-011)`
- EAS記録のgit commit: `f03705a`（本plan追加のみでmobileソースは`d7988c2`と同一。末尾`*`は未追跡の`ops/production-db-operations/`があったため）。
- 配信前チェック: `eas env:list preview`で`EXPO_PUBLIC_API_BASE_URL`・`EXPO_PUBLIC_NOTICES_FEED_URL`・`GOOGLE_SERVICES_JSON`の存在を確認。
- bundle確認: 各`eas update`が出力したローカルbundle（iOS・Androidのhbc）に`stockhome.homehub-tools.dedyn.io`（API）と
  `console.homehub-tools.dedyn.io`（お知らせfeed）が各1件、`10.0.2.2:4002`が0件、新画面`StorageTarget`が含まれることを確認
  （公開済みbundle自体のダウンロード検査ではない）。配信直後に`GET /health` 200。
- 利用者端末での表示確認: 未実施（上記「配信後の確認観点」11点）。
- production API、DB、GAS、VPS設定の変更はなし。
