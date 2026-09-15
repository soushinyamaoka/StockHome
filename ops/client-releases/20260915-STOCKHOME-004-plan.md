# mobileクライアント配信計画

client_release_id: 20260915-STOCKHOME-004

record_type: client_release

app: stockhome

status: verified

created_by: Claude

related_notice_id: 20260915-STOCKHOME-008（結合対象: 20260915-STOCKHOME-007。
API側のproduction反映が先行する）

VPS管理レビュー（`stockhome_undo_actions_review_20260915.md` S008-B05）対応として作成。

## 対象

- **source commit**: `038e173199ad8daee3ed3fd268673c8642976eb7`（notice
  `20260915-STOCKHOME-007`/`008`の最終source。詳細は各noticeの`release_commits`参照）
- **配信対象機能**（mobileのUI変更のみ。すべてnotice`20260915-STOCKHOME-008`対象、
  task `20260915-002`のcommit `4105725`由来）:
  1. `CandidateListScreen`: 確定済み/無視済み候補への「確定を取り消す」
     「無視を取り消す」ボタンと確認ダイアログ
  2. `ItemListScreen`: 非アクティブ品目への「元に戻す」ボタンと確認ダイアログ
  3. `apps/mobile/src/api/misc.ts` / `apps/mobile/src/api/items.ts`:
     対応するAPI呼び出し（`unconfirmCandidate` / `unignoreCandidate` / `restoreItem`）
- **API側の対応する変更**: notice`20260915-STOCKHOME-007`（通知先フィルタ修正・
  household境界修正）・notice`20260915-STOCKHOME-008`（取り消し・復元API追加、
  transaction化）。いずれも`server_impact: notify`/`approval_required`で、
  production反映にはVPS管理側の承認が必要（下記「server/APIとの互換性・実施順序」参照）
- **native変更の有無**: なし。JS/UIのみの変更（新規native module・permission・
  config plugin追加なし）
- **配信先 branch**（notice`20260904-STOCKHOME-005`のclient release
  `20260906-STOCKHOME-003`と同じ2branch）:
  - `default`（iOS、Expo Go向け）
  - `android-internal`（Android、内部配布APK向け）
- **runtime version**: `exposdk:57.0.0`（変更なし。JSのみのためruntime変更なし）
- **対象platform**: iOS・Android両方

## server/APIとの互換性・実施順序（S008-B05対応）

- **実施順序: API先行 → client配信は別承認**。本noticeの新規3エンドポイント
  （`unconfirm`/`unignore`/`restore`）はAPI側にすでに実装・テスト済みだが、
  2026-09-15、VPS task `20260915-002`でproduction反映し、即時検証と19:55/20:10の
  最初の自然実行確認まで正常だったため、VPS管理側で`verified`となった。
  本client配信のAPI前提条件は満たしている。
- **旧client互換性**: 新規3エンドポイントは既存の`confirm`/`ignore`/`DELETE /:id`の
  挙動を一切変更しない**追加のみ**のAPI変更。したがって、
  - client先行時（本UIが先、APIがまだ旧版）: 新しい取り消し/復元ボタンをタップすると
    存在しないエンドポイントへPOSTし404エラーになる（利用者に「エラー」アラートが出る）。
    **これを避けるため、client配信はAPI反映・`verified`確認後に行う**。
  - API先行時（本changeの想定順序）: 旧mobileは新規3エンドポイントの存在を知らないため
    単に呼ばない。新規UIが無いだけで、既存機能（確定・無視・削除）は変わらず動作する。
    **安全な順序はこちらのみ**。
- 上記のとおり、client配信の前提条件は「notice `20260915-STOCKHOME-007`/`008`の
  production反映が`verified`になっていること」とする。2026-09-15 20:18 JSTに確認済み。

## 直前の安定版（rollback先）

`ops/client-releases/20260906-STOCKHOME-003-plan.md`の「実施結果」節より
（本次配信時点で最新の配信実績。2026-09-06以降、追加のclient配信は無い）。

- `default` branch: update group `e3be66fb-c24a-4e9f-8ea9-b8641f4b78d8`
  （runtime `exposdk:57.0.0`）
- `android-internal` branch: update group `287eb475-8535-4287-b34d-f05fe5076a64`
  （runtime `exposdk:57.0.0`）
- 本changeはJSのみでruntime変更が無いため、両branchとも
  `eas update:republish --group <上記group ID>`で直前groupへ戻せる。
- 配信直前に`npx eas-cli update:list --branch default`（`android-internal`も同様）で
  上記group IDが依然として最新であることを再確認すること（配信計画作成後に
  別途配信が発生していないか、の最終確認）。

## Approval

- app owner: **2026-09-15、client release `20260915-STOCKHOME-004`、固定source `038e173`、
  `default` / `android-internal`、EAS `preview`環境を特定して配信を明示承認。実データの
  取消・復元操作は承認対象外**
- 配信実施条件: notice `20260915-STOCKHOME-007`/`008`のproduction反映が`verified`に
  なった後、対象branch・update groupを特定したapp ownerの明示承認を得てから
  `eas update`を実行する（README記載の配信前チェックリスト・環境変数対応表
  （`--environment preview`を使用し`production`は使わない）に従うこと）

## 配信前確認（VPS管理側、2026-09-15）

- notice 007・008の結合API releaseはVPS task `20260915-002`で`verified`
- app repositoryのHEADと`origin/main`は`f59ec4754ab45c05356772756e6d8eb3b9e6355b`で一致
- 固定source `038e173`以降、mobile/shared build入力のcommit差分はなく、未commitのsource差分もない
- mobile TypeScript検査はexit 0
- EAS `preview`環境に`EXPO_PUBLIC_API_BASE_URL`と`GOOGLE_SERVICES_JSON`が存在することを、値を表示せず確認
- `default`の現latest groupは`e3be66fb-c24a-4e9f-8ea9-b8641f4b78d8`、
  `android-internal`は`287eb475-8535-4287-b34d-f05fe5076a64`。いずれもruntime `exposdk:57.0.0`で計画記載と一致
- 配信対象は2branch、environmentは両方`preview`、messageにはsource `038e173`を記録する
- ここまでの確認は配信承認ではなく、EAS Updateは未実施

## 実施結果

2026-09-15、承認範囲どおりEAS Updateを実施した。

- `default`最新group: `66a49f60-3998-48b2-9979-4efc8469ff67`
- `default`同一内容の先行group: `b29b6dda-4df6-464d-8d62-6a033bbe90b4`
- `android-internal` group: `12baf554-2fd1-4a9e-83b3-f90332ce477f`
- message: `取消・復元UIを追加 (source: 038e173, client_release: 20260915-STOCKHOME-004)`
- runtime: 全group `exposdk:57.0.0`
- platform: 全group `android, ios`
- environment: 両branchとも`preview`
- 配信後bundleの2fileで`stockhome.homehub-tools.dedyn.io`を確認し、公開healthは200
- VPS操作、API再deploy、DB/GAS変更、実データの取消・復元は実施していない

`default`は最初のEASコマンドがbundle開始までしか端末出力されず、直後の`update:list`にも
新groupが現れなかったため未成立と判断して再実行した。しかしEAS一覧の反映が遅れていただけで、
結果として同一source・message・environment・runtimeのgroupが2件作成された。最新group
`66a49f60-3998-48b2-9979-4efc8469ff67`が有効で、内容差・rollback・利用者影響はない。

2026-09-15 21:09 JST、ユーザー本人からiOS・Androidとも確認OKの報告を受領した。
更新取得後の既存画面と取消・復元UIは正常。確認目的の実データ操作は行っていない。
これによりclient release `20260915-STOCKHOME-004`を`verified`とする。
