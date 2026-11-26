# mobileクライアント配信計画

client_release_id: 20261126-STOCKHOME-017

record_type: client_release

app: stockhome

status: planned（配信前）

created_by: Claude

related_notice_id: 20261126-STOCKHOME-028（外部連携用トークンのAPI。2026-11-26に本番反映・アプリ側read-only確認済み）

## 対象

- **source commit**: 本planのcommit（`apps/mobile/src/lib/clientRelease.ts` を 017 に更新）。前回client release（`20261106-STOCKHOME-016`、source `863c62f`）以降のmobileに入る変更:
  1. `b33b0cf` 設定画面に「外部連携（Museなど）」を追加。外部連携用トークンの発行（1度だけ表示・コピー）、一覧（最後に使われた日時）、
     書き込み許可の切り替え（ONにするとき確認あり）、取り消し。管理者は家族全員の分を表示・操作できる
  2. 設定画面の「アプリの版」を 017 に更新
- **native変更の有無**: なし。`863c62f..`で`apps/mobile/package.json`・`app.config.js`・`eas.json`・`package-lock.json`に差分なし。
  コピーに使う`expo-clipboard`は2026-07から依存に含まれており、現行のAndroid APK・Expo Goとも組み込み済み
- **配信先 branch**: `default`（iOS、Expo Go向け）、`android-internal`（Android、内部配布APK向け）
- **runtime version**: `exposdk:58.0.0`（変更なし）
- **対象platform**: iOS・Android両方
- **EAS環境**: `preview`

## 実施前提条件

- notice 028 の本番反映（2026-11-26完了、`deployment_status` はVPS管理側の更新待ち）。新画面は`/api/api-tokens`を呼ぶため、APIの反映後に配信する

## 直前の安定版（rollback先）

`20261106-STOCKHOME-016`の配信分:

- `default`: `48d21a6e-e5f3-4706-a5b1-33911c9a8328`（iOS）
- `android-internal`: `65c1e96f-e7ee-4acd-9cd5-9459e4b51b99`（Android）
- 戻す場合は`eas update:republish --group <上記group ID>`（戻しても発行済みのトークンはAPI側で有効なまま）

## 配信前の確認事項

- mobile型チェック（テスト以外）成功、mobile単体テスト62件成功（2026-11-26）
- **未確認**: 実機での画面操作
- 配信後の確認観点:
  1. **Android**: 016が動いている端末で、タブバーの上に「アプリの新しい版を受け取りました［再起動］」が出て、押すと017に切り替わる（016で入れた仕組みの初回確認）
  2. iPhone: 2回開き直して、設定画面の下に「アプリの版 017（11/26配信）」と出る
  3. せってい → 外部連携（Museなど）→ トークンを発行 → 表示されたトークンをコピーできる → 閉じると一覧に「読み取りだけ」で出る
  4. 管理者の端末で、家族の分のトークンも一覧に出る

## Approval

- app owner: 未

## 実施結果

（未実施）
