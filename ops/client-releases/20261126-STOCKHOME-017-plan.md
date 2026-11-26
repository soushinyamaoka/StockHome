# mobileクライアント配信計画

client_release_id: 20261126-STOCKHOME-017

record_type: client_release

app: stockhome

status: delivered（app owner端末でトークン発行・Muse連携を確認。一部観点は確認待ち）

created_by: Claude

related_notice_id: 20261126-STOCKHOME-028（外部連携用トークンのAPI。2026-11-26に本番反映・アプリ側read-only確認済み）

## 対象

- **source commit**: `ead74a9`（本planのcommit。`apps/mobile/src/lib/clientRelease.ts` を 017 に更新）。前回client release（`20261106-STOCKHOME-016`、source `863c62f`）以降のmobileに入る変更:
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

- app owner: 承認（2026-11-26、チャットで「配信してください」）

## 実施結果

### 2026-11-26

明示承認後に`preview`環境から以下を実施した（native変更なしのためAPK再buildは不要）。実施前に`env:list`で`EXPO_PUBLIC_API_BASE_URL`・`EXPO_PUBLIC_NOTICES_FEED_URL`の設定を確認。

- `eas update --branch default --platform ios`
  - `default` group: `5a2341f4-a54b-4033-8a8a-ba4f8c0835fc`（iOS update `01a216ba-7553-7838-847a-fdba7aa52317`）、runtime `exposdk:58.0.0`
- `eas update --branch android-internal --platform android`
  - `android-internal` group: `390f634a-d0a6-462e-b24f-d84ea8dcb3ef`（Android update `01a216bb-4cfa-7419-97de-cc676c91ce70`）、runtime `exposdk:58.0.0`
- message: `外部連携（Museなど）の設定画面 (source: ead74a9, client release: 20261126-STOCKHOME-017)`
- EAS記録のgit commit: `ead74a9`（`*`は未追跡の`ops/production-db-operations/`によるもの）
- bundle確認: 各配信直後のローカルbundle（iOS・Android hbc）に`stockhome.homehub-tools.dedyn.io`・`console.homehub-tools.dedyn.io`が各1件、
  `10.0.2.2:4002`が0件。両方に「外部連携」の文言と`017`、Androidに再起動のお知らせ文言を確認（公開済みbundle自体のダウンロード検査ではない）。
  配信直後に`GET /health` 200
- 利用者端末での確認: 2026-11-26、app ownerが017の画面からトークンを発行し、Museとの連携完了を報告。
  アプリ側でトークン一覧をread-onlyで確認: app owner の読み取り専用トークン1件（16:23 JST発行、16:26 JST に最終利用）。
  未確認: Androidの再起動ボタンの表示、iPhoneの「アプリの版 017」、家族（2人目）のトークン発行
- production API、DB、GAS、VPS設定の変更はなし
