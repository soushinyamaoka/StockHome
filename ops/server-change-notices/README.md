# サーバ変更通知（server-change-notices）

VPS の構成・運用・利用者に影響する変更を行ったときに、通知をここへ作成する。

## ファイル名

`YYYYMMDD-APP-NNN-summary.md`

- `YYYYMMDD` … 作成日
- `APP` … `STOCKHOME`（このリポジトリ固定）
- `NNN` … このディレクトリ内の3桁連番（`001` から）

例: `20260828-STOCKHOME-001-summary.md`

## 運用

- `server_impact` が `notify` / `approval_required` のときに作成する。影響が不明なときは `none` にせず `notify` とする。
- **通知の作成は production 変更の承認ではない。** 通知を書いてもデプロイはしない。
- 雛形と通知ポリシーの正本は VPS管理プロジェクト側にある。所在は `work/ai_handoff/AI_INSTRUCTIONS.md` を参照する（別プロジェクトなので読むだけで編集しない）。
- GAS ブリッジ（Gmail 取込 / ReadyGo 通知）に影響する変更も、GAS 側の運用に波及するため通知対象とする。

判断観点は ai-watch のプロンプトテンプレート（`sections/vps-impact-rules.md`）を正とする。
