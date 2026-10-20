# mobileクライアント配信計画

client_release_id: 20261020-STOCKHOME-012

record_type: client_release

app: stockhome

status: delivered（2026-10-20配信済み。利用者端末での確認待ち）

created_by: Claude

related_notice_id: なし（API・shared・DBの変更なし。既存の`GET/POST /api/storage/locations`・`PATCH /api/storage/placements/:id`をそのまま使う）

## 対象

- **source commit**: `30ae176`（`origin/main`最新）。前回client release（`20261020-STOCKHOME-011`、source `d7988c2`）以降のmobile変更:
  1. `30ae176` 置き場所詳細の「ここに無かった」を最後の1か所で押したとき、置き場所を外さずに最上位の「未登録」へ移す
     （無ければ作る）。置き方メモの先頭に「ここに無かった(M/D) 元: <元の場所>」を残す。2か所以上ある場合は従来どおり押した場所だけ外す。
     利用者指摘（最後の1か所を外すと場所から辿れない迷子になる）への対応。
- **native変更の有無**: なし。`d7988c2..30ae176`で`apps/mobile/package.json`・`app.config.js`・`eas.json`・`package-lock.json`に差分なし。
- **配信先 branch**: `default`（iOS、Expo Go向け）、`android-internal`（Android、内部配布APK向け）
- **runtime version**: `exposdk:57.0.0`（変更なし）
- **対象platform**: iOS・Android両方
- **EAS環境**: `preview`（2026-10-20に`env:list preview`で`EXPO_PUBLIC_API_BASE_URL`・`EXPO_PUBLIC_NOTICES_FEED_URL`・`GOOGLE_SERVICES_JSON`の存在を確認済み）

## 直前の安定版（rollback先）

`20261020-STOCKHOME-011`の配信分:

- `default`: `ec011018-dff2-42ea-b7f0-9de210868d44`（runtime `exposdk:57.0.0`）
- `android-internal`: `f57b266d-b422-4c62-892f-d3161ab6c9a7`（runtime `exposdk:57.0.0`）
- 戻す場合は`eas update:republish --group <上記group ID>`。

## 配信前の確認事項

- 型チェック（テスト以外）成功、mobile単体テスト61件成功（新規2件: 受け皿の場所の判定、メモの組み立て）（2026-10-20）。
- **未確認**: 確認ダイアログ（Alert）はWebで動かないため、画面からの動作は実機で確認する。
- 配信後の確認観点:
  1. 置き場所が1か所の物で「ここに無かった」→「最後の置き場所です。『未登録』へ移しますか？」→「移す」で、置き場所が「未登録」になり、
     メモに「ここに無かった(日付) 元: <元の場所>」が出る。置き場所タブの「未登録」の件数が1増える。
  2. 置き場所が2か所以上の物では、従来どおり押した場所だけが外れる。
- 配信後チェックリスト（bundleに接続先ドメイン文字列が含まれること）は`ops/client-releases/README.md`に従う。

## Approval

- app owner: 2026-10-20、このチャットで対象branch（`default`・`android-internal`）・環境（`preview`）・source commit（`30ae176`）・rollback先を提示したうえで「承認します」の承認を受領。

## 実施結果

2026-10-20、明示承認後に`preview`環境から両branchへ`eas update --platform all`を実施した。

- `default` group: `92c78296-1728-4e9f-9723-65745be257a7`
- `android-internal` group: `ba65b36d-0e6b-4d90-9876-e9ea57de3330`
- 両groupのruntime: `exposdk:57.0.0`、platform: `android, ios`
- message: `ここに無かったで最後の置き場所を未登録へ (source: 30ae176, client release: 20261020-STOCKHOME-012)`
- EAS記録のgit commit: `01cc917`（本plan追加のみでmobileソースは`30ae176`と同一）。
- 配信前チェック: `eas env:list preview`で`EXPO_PUBLIC_API_BASE_URL`・`GOOGLE_SERVICES_JSON`の存在を確認。
- bundle確認: 各`eas update`のローカルbundle（iOS・Androidのhbc）に`stockhome.homehub-tools.dedyn.io`・`console.homehub-tools.dedyn.io`が各1件、
  `10.0.2.2:4002`が0件、今回の変更のコード文字列が含まれることを確認（公開済みbundle自体のダウンロード検査ではない）。配信直後に`GET /health` 200。
- 利用者端末での表示確認: 未実施（上記「配信後の確認観点」2点）。
- production API、DB、GAS、VPS設定の変更はなし。
