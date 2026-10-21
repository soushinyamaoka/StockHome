# mobileクライアント配信計画

client_release_id: 20261022-STOCKHOME-013

record_type: client_release

app: stockhome

status: delivered（2026-10-22配信済み。利用者端末での確認待ち）

created_by: Claude

related_notice_id: 20261021-STOCKHOME-023（休止・再開API。2026-10-22 production反映・verified済み）

## 対象

- **source commit**: `e98200e`（mobileソースは`origin/main`最新と同一）。前回client release（`20261020-STOCKHOME-012`、source `30ae176`）以降のmobile変更:
  1. `e98200e` 消耗品タブの各品目に「休止/再開」ボタン（確認ダイアログ付き）。休止中の品目は消耗品タブ・在庫タブで
     「休止中」バッジ、日数カウンターに「休止中」、切れる日に「休止中」と表示。ボタン行は狭い画面で折り返す。
- **前提**: notice 023 の production 反映済み（`POST /api/items/:id/pause`・`/resume`、品目レスポンスの`consumptionPausedAt`）。
- **native変更の有無**: なし。`30ae176..e98200e`で`apps/mobile/package.json`・`app.config.js`・`eas.json`・`package-lock.json`・`packages/shared`に差分なし。
- **配信先 branch**: `default`（iOS、Expo Go向け）、`android-internal`（Android、内部配布APK向け）
- **runtime version**: `exposdk:57.0.0`（変更なし）
- **対象platform**: iOS・Android両方
- **EAS環境**: `preview`（2026-10-22に`env:list preview`で`EXPO_PUBLIC_API_BASE_URL`・`EXPO_PUBLIC_NOTICES_FEED_URL`・`GOOGLE_SERVICES_JSON`の存在を確認済み）

## 直前の安定版（rollback先）

`20261020-STOCKHOME-012`の配信分:

- `default`: `92c78296-1728-4e9f-9723-65745be257a7`（runtime `exposdk:57.0.0`）
- `android-internal`: `ba65b36d-0e6b-4d90-9876-e9ea57de3330`（runtime `exposdk:57.0.0`）
- 戻す場合は`eas update:republish --group <上記group ID>`。旧画面は`consumptionPausedAt`を無視するため、休止中の品目は休止状態のままAPI側で計算される（再開操作だけができなくなる）。

## 配信前の確認事項

- mobile型チェック（テスト以外）成功、mobile単体テスト61件成功（2026-10-22）。API側の休止テストはnotice 023に記録。
- **未確認**: 確認ダイアログ（Alert）はWebで動かないため、画面からの動作は実機で確認する。
- 配信後の確認観点:
  1. 消耗品タブで任意の品目の「休止」→確認→「休止する」で、「休止中」バッジが付き、切れる日が「休止中」になる。ホームの「そろそろ」から外れる。
  2. 翌日以降も残数が減らない。
  3. 「再開」→確認→「再開する」で表示が元に戻り、その日から残数が減り始める。
  4. ボタン行が狭い画面で折り返し、はみ出さない。
- 配信後チェックリスト（bundleに接続先ドメイン文字列が含まれること）は`ops/client-releases/README.md`に従う。

## Approval

- app owner: 2026-10-22、このチャットで対象branch（`default`・`android-internal`）・環境（`preview`）・source commit（`e98200e`）・rollback先を提示したうえで「承認します」の承認を受領。

## 実施結果

2026-10-22、明示承認後に`preview`環境から両branchへ`eas update --platform all`を実施した。

- `default` group: `22b095cf-df85-488b-a80d-456eab1d5426`
- `android-internal` group: `7d4d7c90-6e2b-40ae-88ea-dc30d95a21f9`
- 両groupのruntime: `exposdk:57.0.0`、platform: `android, ios`
- message: `消耗品の消費の休止・再開 (source: e98200e, client release: 20261022-STOCKHOME-013)`
- EAS記録のgit commit: `94531bf`（本plan追加のみでmobileソースは`e98200e`と同一。`*`は未追跡の`ops/production-db-operations/`によるもの）。
- 配信前チェック: `eas env:list preview`で`EXPO_PUBLIC_API_BASE_URL`・`EXPO_PUBLIC_NOTICES_FEED_URL`・`GOOGLE_SERVICES_JSON`の存在を確認。
- bundle確認: 各`eas update`のローカルbundle（iOS・Androidのhbc）に`stockhome.homehub-tools.dedyn.io`・`console.homehub-tools.dedyn.io`が各1件、
  `10.0.2.2:4002`が0件、今回の変更のコード文字列（`consumptionPausedAt`・`pause-circle-outline`・「消費を休止」）が含まれることを確認（公開済みbundle自体のダウンロード検査ではない）。配信直後に`GET /health` 200。
- 利用者端末での表示確認: 未実施（上記「配信後の確認観点」4点）。
- production API、DB、GAS、VPS設定の変更はなし。
