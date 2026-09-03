# mobileクライアント配信計画

client_release_id: 20260903-STOCKHOME-001

app: stockhome

status: deployed（2026-09-03 先行配信の例外承認により配信済み。下記「実施結果」参照）

created_by: Claude

related_notice_id: 20260902-STOCKHOME-004

related_vps_task_id: 20260903-001

deployment_status: deployed

## 対象

- **source commit**: `5cd6c66a57085f081c078616eee9ede2dfc63e70`
  （notice `20260902-STOCKHOME-004` の固定実装commitと同一。
  VPS task `20260903-001` でproductionへ反映済み）
- **配信先 branch**: `default`（**channelではなくbranch**。同名のchannelオブジェクトは
  存在しない。`eas channel:view default`は"Could not find channel with the name default"を
  返す。EASビルド済みネイティブバイナリでこのbranchを参照する設定を使ったものは無い）
- **runtime version**: `exposdk:54.0.0`
- **対象platform**: `android`、`ios`（branchの登録上は両方だが、実際に読んでいるのは下記の
  実機確認により**iOSのみ**）
  - iOS: 実機確認済み。Expo Goアプリで、`eas update`後にQRコードを読み込んで開く運用
  - Android: **`default`は読んでいない**。2026-09-02以降、内部配布APK
    （`android-internal` channel、`eas build`で別途配布・`expo-notifications`/FCM
    組み込み済み）に完全移行済み（実機確認済み、2026-09-03）
- **含まれる変更**（source commit `5cd6c66` までの、前回client配信以降の全変更）:
  1. 反映記録ログ画面（`GET /api/reflections`、設定タブ「購入の反映きろく」）
  2. Gmail取込候補確定時の単価入力・確認UI（候補一覧画面）
  3. プッシュ通知の端末登録処理（ログイン後に許可要求・トークン登録を試みる。
     iOS Expo Goでは登録できず失敗するが、既存の設計どおり無害に握りつぶす）

## 直前のupdate group（rollback先）

- **branch**: `default`
- **update group ID**: `3d9f121f-7f47-47ae-b384-c0f32d3af43f`
- **message**: `switch API base to HTTPS`
- **publish時期**: 2026-09-03時点で確認した時点の「2週間前」
- 対応するgit commit: `084656f`（モバイルAPI接続先をHTTPS入口へ移行）

## 実施前提条件

次をすべて満たすまで配信しない。

1. VPS task `20260903-001`が`verified`へ進んでいること
   （2026-09-03 19:55 JSTの`daily_batch`、20:10 JSTの`push_receipt_check_and_cleanup`の
   両方で`job_start`/`job_end`（同一`run_id`、`status: success`）を実時刻で確認できること。
   `stockhome_push_notification_deployment_plan_20260903.md` §13「残る確認」を正本とする）
2. `main`と`origin/main`が一致し、追跡fileがcleanであること
3. 配信直前に`eas branch:list`で`default`branchの現在のupdate groupを再確認し、
   本計画記載の直前group ID（`3d9f121f-...`）から変化していないこと
   （他経路での配信が割り込んでいないことの確認）

## native互換性の確認（VPS管理レビュー指摘対応、2026-09-03）

VPS管理側から、前回client配信後に`expo-notifications`（native library）と
`googleServicesFile`によるAndroid FCM設定が追加されており、`runtimeVersion`が
`policy: sdkVersion`のままではnative差分を区別できないため、`default`を読む
既存binaryがこれらを組み込み済みか確認するよう指摘を受けた
（`stockhome_push_notification_deployment_plan_20260903.md` §14参照）。

### 確認手順と結果

1. **`eas build:list`で全ビルド履歴を確認**（過去分含め2件のみ、すべてAndroid）:
   - `ad8c5eb1`（commit `084656f`、2026-08-14、channel: `android-internal`）
   - `5030dbb2`（commit `38ae8b2`、2026-09-02、channel: `android-internal`、
     `expo-notifications`/FCM組み込み済み）
   - **channel `default`を指定してビルドされたネイティブバイナリは過去含めて存在しない**
2. **`eas channel:view default`を実行 → `default`という名前のchannelオブジェクトは
   存在しない**（"Could not find channel with the name default"）。存在するのは
   `default`という名前のbranch（ID `019fff36-...`）のみ
3. 上記1・2により、独自ビルドしたネイティブバイナリがこのbranchを参照する設定
   （build時の`channel: "default"`指定）は一度も使われていないことを確認した
4. **Expo公式ドキュメントでExpo Goのnative module互換性を確認**: ローカル通知用の
   `expo-notifications` native moduleはExpo Goクライアント自体に標準搭載されている
   （リモートプッシュのみAndroid SDK53以降Expo Go非対応。これは既に前提として
   了承済みの制約であり、native moduleの不在によるクラッシュとは別の話）
5. **実機の使用実態をユーザー本人に確認**（2026-09-03）:
   - **iOS**: Expo Goアプリで、`eas update`後にQRコードを読み込んで開く運用と確認。
     ＝genuine Expo Goクライアント。手順4によりnative moduleクラッシュのリスクなし
   - **Android**: 2026-09-02にインストールした内部配布APK（`android-internal`、
     `expo-notifications`/FCM組み込み済み）を使用中と確認。**`default`branchは
     もう読んでいない**ため、本配信の影響を受けない

### 結論

`default`branchの実際の読者はiOSのExpo Goのみであり、Expo Go自体が
`expo-notifications`のnative moduleを標準搭載しているため、**native module不在に
よるクラッシュのリスクは無い**と判断する。Android側は内部配布APKへ完全移行済みで
`default`を読まないため、そもそも本配信の影響範囲外である。

### 念のための代替案（今回は不要と判断したが、将来的にnative非互換が疑われる場合の参考）

- **案A: 新binaryを別runtimeで配布** — `default`を読む独自ビルドバイナリが存在し、
  かつnative moduleを含まないことが判明した場合、そのプラットフォーム向けに
  `expo-notifications`/FCM組み込み済みの新規ビルドを別channel/runtimeで作成し、
  移行が完了するまで`default`へはPush関連JSを含まないbundleのみを配信する
- **案B: Push処理を除外してUI変更だけを配信** — Push関連の`import`・呼び出しを
  一時的に取り除いた別sourceを`default`専用に用意し、反映記録ログ画面・価格確認UIの
  改善だけを先行配信する。Push関連コードは、対象binaryの互換性が確認できてから
  改めて配信する

## 後方互換性の確認結果（2026-09-03時点で確認済み）

- 反映記録ログ画面: production APIに`GET /api/reflections`が反映済みのため、
  配信後は正常にデータが表示される
  （API未反映の間に配信した場合は空表示になっていたが、上記前提条件1により
  API反映確認後にのみ配信するため、この問題は発生しない）
- 候補確定の単価フィールド: 既存クライアントは送らない任意フィールドのため、
  新旧クライアントいずれもproduction APIと問題なく通信できる
- プッシュ通知登録: `default`branchの実際の読者はiOS Expo Goのみ（上記「native互換性の
  確認」参照）。iOS Expo Goではリモートプッシュ非対応のため登録は失敗するが、
  既存の設計どおり無害に握りつぶされる（クラッシュしない）。Android内部配布APKは
  既に`expo-notifications`/FCM組み込み済みで、本配信とは独立して既に機能している

## 実施主体

Claudeが対話セッション内で`eas update --branch default --message "<説明>"`を実行する。
実行は下記「Approval gate」の明示承認を得てからのみ行う。

## Rollback方針

配信後に問題が判明した場合、直前のupdate group（`3d9f121f-7f47-47ae-b384-c0f32d3af43f`）を
`default` branchへ再publishすることで、利用者端末を配信前の状態へ戻す
（`eas update:republish --group 3d9f121f-7f47-47ae-b384-c0f32d3af43f --branch default`。
具体的なコマンドは実施時点のEAS CLIバージョンに合わせて確認する）。

DBやAPI側のrollbackは伴わない（本配信はmobileクライアントのJS/UI変更のみで、
API・DBへは一切変更を加えない）。

## Approval gate

本計画の作成・提示は配信の承認ではない。当初の条件はVPS task `20260903-001`の
`verified`到達だったが、下記「先行配信の例外承認」により先行実施した。

### 先行配信の例外承認（2026-09-03）

VPS task `20260903-001`が19:55/20:10の初回定期job確認前（`applied`）の段階で、
ユーザーからその事実を承知したうえで、client release `20260903-STOCKHOME-001`・
source commit `5cd6c66`・`default` branchを特定した即時配信の明示承認を受領した
（`stockhome_push_notification_deployment_plan_20260903.md`
「Client release先行配信の例外承認」セクションにVPS管理側の記録あり）。
この承認はclient配信のみを対象とし、追加のVPS変更・API再deploy・DB変更は含まない。

## 実施結果

- **実施日時**: 2026-09-03 08:09 JST
- **実行コマンド**: `eas update --branch default --message "反映記録ログ・Gmail取込価格の
  手動確認UI・プッシュ通知端末登録を追加 (source: 5cd6c66)"`
- **実行直前確認**: `main`/`origin/main`が`af77280`で一致・追跡fileがclean、
  `5cd6c66`〜`af77280`間に`apps/mobile`・`packages/shared`・`package.json`・
  `package-lock.json`の差分がないこと（＝バンドル内容が固定source commitと同一である
  こと）、`default`branchの直前update group ID（`3d9f121f-...`）が計画記載値から
  変化していないこと、をいずれも配信直前に再確認した
- **update group ID**: `8820a4ae-1321-4703-841f-28ea117a91f2`
- **Android update ID**: `01a06650-a5a0-746b-a11f-0277d22711e6`
- **iOS update ID**: `01a06650-a5a0-7a3c-87da-17c9e7d700d9`
- **branch**: `default`
- **runtime version**: `exposdk:54.0.0`（変更なし。runtimeVersionを変えるnative変更を
  含まないため、既存binaryとの互換性は「native互換性の確認」節の判断どおり）
- **platform**: android, ios（実際の読者はiOS Expo Goのみ。上記参照）
- **commit紐付け**: `af772803d6f42687b4a1543adfd2976e7bbe1cf0`（EAS上の表示。
  実バンドル内容は固定source `5cd6c66`と同一であることを確認済み）
- **iOS Expo Goでの反映確認**: **未実施**。実機でのアプリ再起動・アップデート取得後の
  画面表示・push token取得可否の確認はユーザーによる実機操作が必要なため、
  本記録時点では未確認。確認後にこのセクションへ追記する
- **rollback実施**: なし

## 未実施・today's残作業

- iOS Expo Goでの実機反映確認（画面表示、push token取得の成功/安全な失敗）
- VPS task `20260903-001`の19:55/20:10定期job確認（VPS側で継続中、本配信とは独立）
