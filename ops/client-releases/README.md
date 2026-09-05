# mobileクライアント配信記録（client-releases）

`eas update`（EAS Update、Expoのクラウドサービス）による mobile JS/UI の利用者端末への
配信を行うときに、計画・結果をここへ作成する。

**VPS管理対象外**: EAS Updateは Expo cloud → 利用者端末の配信であり、VPSの配置・設定・
container再起動を一切伴わない。そのためVPS管理側の server-change-notices・
runtime-contract の対象には含めず、StockHomeアプリ側でこのディレクトリに記録する
（2026-09-03、VPS管理側との取り決め）。

## ファイル名

`YYYYMMDD-APP-NNN-plan.md`

- `YYYYMMDD` … 作成日
- `APP` … `STOCKHOME`（このリポジトリ固定）
- `NNN` … このディレクトリ内の3桁連番（`001` から）

例: `20260903-STOCKHOME-001-plan.md`

## 記録する項目

- source commit（固定するAPI/mobile実装のcommit）
- 配信先 branch/channel（例: `default`）
- runtime version（例: `exposdk:54.0.0`）
- 対象platform（`android`/`ios`）
- 直前のupdate group（rollback先として使う）
- rollback先・rollback方法
- 実施主体（誰がいつ`eas update`コマンドを実行するか）
- 実施前提条件・承認ゲート

## 運用

- **計画の作成は配信の承認ではない。** 計画を書いても配信はしない。
- 対応するAPI側のserver change noticeがある場合は、そのnotice_id・production反映状態
  （`verified`等）を実施前提条件として明記する。
- 配信は、対象branch/channel・update groupを特定したapp ownerの明示承認を得てから
  実施する。
- 配信後は同じfileに実施結果（update group ID、配信時刻、対象端末での反映確認結果）を
  追記する。

## EAS環境変数の対応表（重要・2026-09-05インシデントで判明）

`eas update`/`eas build`は`--environment <名前>`を要求するが、**本プロジェクトでは
"production"という名前のEAS環境に変数が一切設定されていない**。実際の接続先URL
（`EXPO_PUBLIC_API_BASE_URL`）は"preview"という名前の環境に設定されている
（`android-internal` build profileが`environment: preview`を使っているのはこのため）。

名前の意味と実態が一致していないため、**必ずこの表に従うこと。「production」という
文字面から推測して選ばない**。

| 用途 | 指定する`--environment` | 備考 |
|---|---|---|
| 利用者向けEAS Update（`default`・`android-internal`branchとも） | `preview` | `EXPO_PUBLIC_API_BASE_URL`が設定されているのはここだけ |
| Android内部配布APKのbuild（`android-internal` profile） | `preview`（eas.json記載のまま） | `GOOGLE_SERVICES_JSON`もここに設定済み |
| "production"環境 | 使わない | 変数が空。指定すると`EXPO_PUBLIC_API_BASE_URL`がbundleへ
  埋め込まれず、client側が`http://10.0.2.2:4002`（Android）や`http://localhost:4002`
  （iOS）へfallbackし、実機からAPIへ到達できなくなる（2026-09-05に実際発生） |

この対応表と実態が食い違う変更（EAS環境変数の追加・移動等）を行った場合は、この表も
同時に更新すること。

## 配信前チェックリスト（2026-09-05インシデント後に追加）

`eas update`/`eas build`を実行する**前**に必ず行う。

1. `npx eas-cli env:list <指定する環境名>` を実行し、`EXPO_PUBLIC_API_BASE_URL`
   （native buildの場合は`GOOGLE_SERVICES_JSON`も）が実際に表示されることを確認する。
   「No variables found」と出た場合はその環境を使わない。
2. 上記「EAS環境変数の対応表」と一致しているか確認する。

## 配信後チェックリスト（2026-09-05インシデント後に追加）

`eas update`実行後、ユーザーへ「配信完了」と伝える**前**に必ず行う。

1. `eas update`が出力したローカルのbundle出力（`dist/_expo/static/js/<platform>/*.hbc`）に対し、
   実際の接続先ドメイン文字列（例: `stockhome.homehub-tools.dedyn.io`）が含まれることを
   `grep`等で確認する。含まれていなければ、環境変数が正しく解決されなかった可能性が高い。
2. 可能であれば、配信直後に自分でその環境向けのAPIへ疎通確認する
   （例: 該当URLへの`curl`等）。

## 2026-09-05 インシデント記録

`eas update --environment production`で配信した初回のclient release
`20260904-STOCKHOME-002`が、上記の環境名の実態不一致によりiOS/Android両方で
ログイン不能（`AxiosError: Network Error`）になった。詳細・修正内容は
`ops/client-releases/20260904-STOCKHOME-002-plan.md`の「インシデント」節を参照。
