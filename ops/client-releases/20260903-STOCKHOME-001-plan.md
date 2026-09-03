# mobileクライアント配信計画

client_release_id: 20260903-STOCKHOME-001

app: stockhome

status: ready_for_review

created_by: Claude

related_notice_id: 20260902-STOCKHOME-004

related_vps_task_id: 20260903-001

deployment_status: not_started

## 対象

- **source commit**: `5cd6c66a57085f081c078616eee9ede2dfc63e70`
  （notice `20260902-STOCKHOME-004` の固定実装commitと同一。
  VPS task `20260903-001` でproductionへ反映済み）
- **配信先 branch/channel**: `default`
- **runtime version**: `exposdk:54.0.0`
- **対象platform**: `android`、`ios`
  - iOS: Expo Go経由（`default` channelを直接読み込む運用）
  - Android: `default` channelを読み込む端末のみが対象。内部配布APK
    （`android-internal` channel、`eas build`で別途配布済み）は対象外
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

## 後方互換性の確認結果（2026-09-03時点で確認済み）

- 反映記録ログ画面: production APIに`GET /api/reflections`が反映済みのため、
  配信後は正常にデータが表示される
  （API未反映の間に配信した場合は空表示になっていたが、上記前提条件1により
  API反映確認後にのみ配信するため、この問題は発生しない）
- 候補確定の単価フィールド: 既存クライアントは送らない任意フィールドのため、
  新旧クライアントいずれもproduction APIと問題なく通信できる
- プッシュ通知登録: production APIに`POST /api/push-devices`が反映済みのため、
  配信後はAndroid端末（`default` channel使用分）でトークン登録が機能する。
  iOS Expo Goでは引き続き登録できず失敗するが、既存の設計どおり無害に握りつぶされる

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

本計画の作成・提示は配信の承認ではない。実施する場合は、VPS task `20260903-001`が
`verified`になったことを確認したうえで、次のように対象branchとcommitを特定した
承認を受領する。

```text
VPS task 20260903-001の検証が完了しました。client_release_id 20260903-STOCKHOME-001を、
default branchへ今すぐeas update配信することを承認します。
```

承認前は`eas update`コマンドを実行しない。

## 実施結果

（配信後にここへ記録する: update group ID、配信時刻、対象端末での反映確認結果）
