# mobileクライアント配信計画

client_release_id: 20260906-STOCKHOME-003

record_type: client_release

app: stockhome

status: verified（2026-09-06、配信・bundle確認まで完了）

created_by: Claude

related_notice_id: none（server_impact: none の内部ロジック拡張・表示改善のため notice なし）

## 対象

- **source commit**: `9f5fa864327e5d16b263250ce9e0348966b37f4f`
- **配信対象機能**（mobileのUI変更のみ）:
  1. 取込候補一覧画面（`CandidateListScreen`）: 確定成功時のアラートに実際の
     保存単価を表示。`priceSource='本体価格'`（数量に関わらず単価確定可能）な候補は
     一覧でも検出額をprefillし、保留時のhelper文言を見込み有無で出し分け
- **API側の対応する変更**: `20260906-001`（3層判定ロジック）・`20260906-002`
  （`priceLikelyUnitPrice`フィールド追加）。いずれもnotice不要（server_impact: none）
  としてVPSへ反映済み
- **native変更の有無**: なし。JS/UIのみの変更
- **配信先 branch**: 両方（app owner「全て行って欲しい」の指示により、Phase 2の
  UI機能配信時と同様に両方を配信）
  - `default`（iOS、Expo Go向け）
  - `android-internal`（Android、内部配布APK向け）
- **runtime version**: `exposdk:57.0.0`（変更なし。JSのみのためruntime変更なし）
- **対象platform**: iOS・Android両方

## server/APIとの互換性・実施順序

- API側（`priceLikelyUnitPrice`フィールド追加）はAPI側が先行反映済み（2026-09-06）。
  旧mobileは未知フィールドを単に無視するため無害
- client先行時（本UIが先、APIが旧のまま）: `priceLikelyUnitPrice`が`undefined`になるが、
  mobile側は`c.priceLikelyUnitPrice && ...`という真偽判定のみで使うため、
  `undefined`は falsy として安全に扱われる
- 今回はAPI・client双方とも反映済みのため、上記の順序依存は実際には発生していない

## 直前の安定版（rollback先）

- iOS `default` branch: update group `eb93101b-077f-4b84-ae8b-493e854da132`
  （`20260904-STOCKHOME-002`のインシデント修正後の版。前回の安定配信）
- Android `android-internal` branch: update group `411b16b8-5b11-4b61-91b3-c2de7e162af2`
  （同上）
- 本changeはJSのみのため、両branchとも`eas update:republish`で直前groupへ戻せる

## Approval

- app owner: 2026-09-06、「全て行って欲しい」と明示指示。API deploy・mobile配信を
  含む一連の作業を承認

## 実施結果

- **実行コマンド**:
  - iOS: `eas update --branch default --environment preview --message "候補確認画面の単価表示改善 (source: 9f5fa86)" --non-interactive`
  - Android: `eas update --branch android-internal --environment preview --message "..." --non-interactive`（メッセージはiOSと同一）
  - **`--environment preview`を使用**（2026-09-05インシデントの教訓どおり、
    `ops/client-releases/README.md`の対応表に従い`production`は使用していない）
- **`default` branch（iOS/Android両方に配信される）**:
  - update group ID: `e3be66fb-c24a-4e9f-8ea9-b8641f4b78d8`
  - Android update ID: `01a076fc-ed90-7795-ba10-2d348388b9f9`
  - iOS update ID: `01a076fc-ed90-7364-882d-d50d12278b83`
  - runtime version: `exposdk:57.0.0`（変更なし）
  - bundle確認: 書き出し済み`.hbc`（iOS/Android）に接続先ドメイン
    `stockhome.homehub-tools.dedyn.io`が含まれることを確認済み
- **`android-internal` branch**:
  - update group ID: `287eb475-8535-4287-b34d-f05fe5076a64`
  - Android update ID: `01a076fd-eba9-7ead-83f6-df3dde7c972a`
  - iOS update ID: `01a076fd-eba9-794a-888b-b0be18ac4d44`
  - runtime version: `exposdk:57.0.0`（変更なし）
  - bundle確認: 同上、ドメイン文字列を確認済み

## 実機確認

- 未実施（開発コンテナの制約により、Claude側では実機・シミュレータでの目視確認ができない）
- app ownerによるお手元の端末での確認待ち

## 未解決事項

- 実機での見た目確認（`priceLikelyUnitPrice`が実際にtrueになるケースは、次回のGmail
  自動取込サイクルで新しい注文確認メールが届いてから確認可能。既存候補239件は
  いずれも`price_source`が空のため、現時点では全件`false`が正しい状態）
