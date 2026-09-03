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
