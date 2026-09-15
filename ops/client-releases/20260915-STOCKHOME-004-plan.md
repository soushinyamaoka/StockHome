# mobileクライアント配信計画

client_release_id: 20260915-STOCKHOME-004

record_type: client_release

app: stockhome

status: draft（配信の承認ではない。計画のみ）

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
  production未反映（`deployment_status: not_started`）。API側のproduction反映
  （VPS管理側の`approval_required`承認・deploy・`verified`確認）が完了するまで、
  本client配信は実施しない。
- **旧client互換性**: 新規3エンドポイントは既存の`confirm`/`ignore`/`DELETE /:id`の
  挙動を一切変更しない**追加のみ**のAPI変更。したがって、
  - client先行時（本UIが先、APIがまだ旧版）: 新しい取り消し/復元ボタンをタップすると
    存在しないエンドポイントへPOSTし404エラーになる（利用者に「エラー」アラートが出る）。
    **これを避けるため、client配信はAPI反映・`verified`確認後に行う**。
  - API先行時（本changeの想定順序）: 旧mobileは新規3エンドポイントの存在を知らないため
    単に呼ばない。新規UIが無いだけで、既存機能（確定・無視・削除）は変わらず動作する。
    **安全な順序はこちらのみ**。
- 上記のとおり、client配信の前提条件は「notice `20260915-STOCKHOME-007`/`008`の
  production反映が`verified`になっていること」とする。

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

- app owner: 未実施（配信そのものの承認はこれから。上記「対象」節の機能内容自体は
  notice `20260915-STOCKHOME-008`のS008-B06としてapp ownerが2026-09-15に承認済みだが、
  それは配信承認ではない）
- 配信実施条件: notice `20260915-STOCKHOME-007`/`008`のproduction反映が`verified`に
  なった後、対象branch・update groupを特定したapp ownerの明示承認を得てから
  `eas update`を実行する（README記載の配信前チェックリスト・環境変数対応表
  （`--environment preview`を使用し`production`は使わない）に従うこと）

## 実施結果

未実施。
