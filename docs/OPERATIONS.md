# StockHome 運用ガイド（VPS 仕様・デプロイ・リリース）

StockHome の本番環境の構成と、変更を本番・利用者端末へ届ける手順をまとめる。
詳細な値や経緯は「正本」の欄に挙げた文書が正しく、本書はその地図として使う。

最終更新: 2026-10-07

---

## 1. 全体像

```
[家族のスマホ]
  iOS     : Expo Go ──┐
  Android : 内部配布APK ┤  EAS Update（Expo cloud）で JS を配信
                       │
                       ▼ HTTPS
  https://stockhome.homehub-tools.dedyn.io
                       │ nginx（TLS: Let's Encrypt）
                       ▼ 127.0.0.1:4002
[さくらVPS  ~/stockhome]
  stockhome-api-prod      (image: stockhome-api:git-<40桁commit>)
  stockhome-postgres-prod (postgres:16-alpine, volume: stockhome_stockhome_pgdata)
                       ▲
                       │ HTTPS（X-Bridge-Token）※ 通信は常に GAS → API の向き
[Google Apps Script]  apps/gas/
  Gmail 取込（6時間ごと） / ReadyGo 通知の受け渡し（20時台）→ LINE 21:00
```

## 2. VPS 環境の仕様

| 項目 | 値 | 正本 |
|---|---|---|
| 接続 | `ssh vps`（ssh エイリアス。IP 等は各 PC の ssh config に置き、リポジトリに書かない） | — |
| 配置先 | `~/stockhome`（HomeAsset の `~/homeasset` と並列） | `scripts/deploy.ps1` |
| 構成 | Docker Compose（`docker-compose.prod.yml`、project 名 `stockhome` 固定） | `docker-compose.prod.yml` |
| API コンテナ | `stockhome-api-prod`、Node 20、`restart: unless-stopped` | `apps/api/Dockerfile` |
| API イメージ | `stockhome-api:git-<40桁commit>`（commit ごとの固定タグ、直近3世代を保持） | `scripts/vps-deploy-runner.sh` |
| DB コンテナ | `stockhome-postgres-prod`（PostgreSQL 16、ホスト・外部には公開しない） | `docker-compose.prod.yml` |
| DB データ | named volume `stockhome_stockhome_pgdata`（**削除・初期化禁止**） | `ops/runtime-contract.yaml` data |
| ポート | `127.0.0.1:4002` のみ（外部から 4002 へは直接到達できない。外部公開は 22/80/443 のみ） | `docker-compose.prod.yml` |
| 公開 URL | `https://stockhome.homehub-tools.dedyn.io`（nginx → `127.0.0.1:4002`） | `ops/runtime-contract.yaml` network |
| 本番の環境変数 | `~/stockhome/.env`（手動設定、git 管理外。項目は `.env.production.example`） | `.env.production.example` |
| リリース展開先 | `~/stockhome/releases/git-<commit>/`（deploy ごとに展開、古い世代は自動削除） | `scripts/vps-bootstrap.sh` |
| 排他制御 | `~/stockhome/.deploy.lock`（flock。同時に2つの deploy は走らない） | `scripts/vps-bootstrap.sh` |
| ヘルスチェック | internal/public の `/health` = 200、`/api/bridge/health` = 401（未認証）の4点 | `scripts/vps-deploy-runner.sh` |
| 定期処理 | API プロセス内の node-cron。19:55 夜間バッチ、20:10 プッシュ通知の結果確認・掃除（JST） | `ops/runtime-contract.yaml` jobs |
| ログ | stdout に1行1JSON（Docker が収集）。個人情報・トークンは出さない | `ops/runtime-contract.yaml` logging |
| バックアップ | VPS 管理側が担当。毎日 03:00 pg_dump（14世代）→ 03:30 NAS へ取得 → NAS snapshot | `ops/runtime-contract.yaml` backup_policy |
| Migration | API コンテナ起動時に `prisma migrate deploy` を自動適用 | `apps/api/src/entrypoint.ts` |

本番の環境変数のうち、必須で忘れやすいもの:

- `JWT_SECRET`（未設定だと API が起動しない）
- `TRUSTED_PROXY_IPS`（2026-09-20 の実測値は `172.19.0.1`。Docker ネットワークを作り直すと変わる。変わった場合は VPS 管理側が測り直す）
- `BRIDGE_TOKEN`（GAS のスクリプトプロパティ `STOCKHOME_BRIDGE_TOKEN` と同じ値）

## 3. 変更の種類ごとの届け方

| 何を変えたか | 本番への届け方 | 事前の手続き | 記録先 |
|---|---|---|---|
| API・shared・Prisma schema・Docker・deploy スクリプト | `npm run deploy`（VPS） | **server change notice → VPS 管理のレビュー受理 → 実行の承認** | `ops/server-change-notices/` |
| mobile の JS・画面だけ | `eas update`（Expo cloud） | app owner（ユーザー）の明示承認 | `ops/client-releases/` |
| mobile の native 部分（native module 追加・`app.config.js` の plugins 等） | `eas build`（APK を作り直して配布）。iOS は Expo Go が対応しているか先に確認する | app owner の明示承認 | `ops/client-releases/` |
| GAS（`apps/gas/`） | `apps/gas/push.bat` → `deploy.bat`（clasp） | notice → VPS 管理の承認 → **ユーザーが手動で実行**（Claude・Codex は実行しない） | `ops/server-change-notices/` |
| 本番 DB を直接読む・書く | 原則しない | 例外手順あり（このアプリのチャットのみ read-only 可、write は条件付き） | `ops/production-db-operations/`（git 管理外） |
| ドキュメントだけ | commit・push のみ | 不要 | — |

迷ったら「VPS 上の何かが変わるか」で判断する。VPS 上で何かが変わるなら notice が要る。
`eas update` は VPS に触れないので VPS 管理の対象外。ただし、対応する API 変更がある場合は、
その notice が本番に反映済みであることを配信の前提条件にする。

## 4. API のリリース手順

1. **実装・テスト**: Codex が ai-watch 経由で実装・commit・push する（`work/ai_handoff/claude_to_codex/`）。
   DB を使う確認は Claude が対話セッションで行う。
2. **notice 作成**: `ops/server-change-notices/YYYYMMDD-STOCKHOME-NNN-summary.md`。
   `production_baseline_commit`（いま本番で動いている commit）、`release_commits`、`impact_level`、
   migration の有無、ロールバック方法、ヘルスチェック、env の追加・変更を書く。
   提出前にセルフチェックを1回行い、結果を notice に残す。
3. **VPS 管理のレビュー**: VPS 管理チャットに notice のパスと commit を渡す。指摘があれば修正して再提出する。
   受理されたら notice の Approval 欄に記録して commit する。
4. **本番反映**: VPS 管理側の実行依頼・承認の範囲で、リポジトリ直下から次を実行する。

   ```powershell
   npm run deploy -- -DryRun   # 送る中身だけ確認（転送・反映はしない）
   npm run deploy              # 既定は HEAD。origin/main に push 済みの commit しか送れない
   npm run deploy -- -Commit <40桁commit>   # commit を指定する場合
   ```

   deploy.ps1 の流れ: push 済みか確認 → `git archive` でその commit だけを固める（未コミットの変更・`.env` は入らない）
   → VPS で lock 取得 → build → 切替 → ヘルスチェック4点 → 成功なら古いイメージを片付ける。
   最後に `DEPLOY_RESULT=success` が出て、終了コードが 0 なら成功。それ以外はすべて失敗扱い。
   ヘルスチェックに失敗した場合は直前のイメージへ自動で戻る（`rolled_back_to_previous`）。
5. **確認・記録**: VPS 管理側が実機で確認したら notice を `verified` に更新する。

> deploy.ps1 の終了コードの扱いは 2026-09-30 に修正した（b137d37）。修正後の版で実際の VPS に
> 通しで流した実績はまだ無い。次回の API リリースで、終了コード 0 と `DEPLOY_RESULT=success` を確認すること。

## 5. API のロールバック

```powershell
npm run deploy -- -RollbackTo <40桁commit>
```

- VPS に残っている `stockhome-api:git-<commit>` に切り替えるだけで、build はしない。
  通常の deploy と同じ lock・ヘルスチェックを通る。
- 残っているのは直近3世代だけ。それより古い commit は `rollback_target_missing` で止まる。
- DB は戻らない。migration を含むリリースを戻すときは、古いコードが新しい schema で動くかを
  notice の段階で確認しておく（列を足すだけなら通常は動く。消す・名前を変える変更は要注意）。
- ロールバックも本番操作なので、VPS 管理側の承認を経て行う。

## 6. mobile のリリース手順（EAS Update）

配布の構成:

- **iOS**: Expo Go で `default` branch を読む（専用ビルドは無い）。
- **Android**: 内部配布 APK（`eas build --profile android-internal`）で `android-internal` channel を読む。
- runtime version は `exposdk:57.0.0`。

手順:

1. 前回のリリース以降の mobile の変更と、native 部分の変更が無いことを確認する
   （`package.json` の expo 系、`app.config.js`、`eas.json`）。native の変更がある場合は OTA では届かない。
2. `ops/client-releases/YYYYMMDD-STOCKHOME-NNN-plan.md` を作る（source commit、配信先、
   ロールバック先の update group、前提条件）。**計画を書いただけでは配信しない。**
3. **配信前チェック**: `npx eas-cli env:list preview` で `EXPO_PUBLIC_API_BASE_URL` があることを確認する。
   **`--environment production` は使わない**（中身が空。2026-09-05 に全員ログインできなくなった）。
4. app owner の承認後に配信する: `default` と `android-internal` の両方へ、`--environment preview` で `eas update`。
5. **配信後チェック**: 書き出された bundle（`apps/mobile/dist/_expo/static/js/<platform>/*.hbc`）に
   本番ドメインの文字列が入っていることを grep で確認する。
6. 実機で確認できたら、plan の結果欄に update group ID・時刻・確認結果を書いて commit する。

ロールバックは、plan に控えた直前の update group を `eas update:republish` で配信し直す。

詳細・環境名の対応表は `ops/client-releases/README.md` を正とする。

## 7. GAS のリリース

- 手順・注意は `apps/gas/CLAUDE.md` と `apps/gas/SETUP_GUIDE.md` を正とする。
- `push.bat`（clasp push）・`deploy.bat`（clasp deploy）は本番へのデプロイにあたる。
  notice と VPS 管理の承認を経たうえで、**ユーザーが手動で実行する**。
- `.clasp.json` と `deploy.bat` には個別環境の ID が入るので git 管理外（`*.example` からコピーする）。

## 8. 守ること（本番の約束）

- API は `127.0.0.1:4002` に bind したままにする（`0.0.0.0` に戻さない）。
- DB の volume を消す操作（`docker compose down -v` 等）をしない。deploy でも DB には触れない。
- `.env`・トークン・パスワードを artifact・リポジトリ・ログに入れない。
- `/opt/apps/deploy.sh` は古い経路なので使わない。StockHome の正規の経路は `npm run deploy` だけ。
- 本番・外部サービス（GAS 等）の状態を変える操作は、ユーザーの承認に加えて VPS 管理側の実行依頼が必要
  （DB の読み取りの例外を除く）。
- `package-lock.json` は Windows で作られるため `@esbuild/linux-x64` が抜けやすい。`apps/api/Dockerfile` の回避策を消さない。

## 9. 正本の所在

| 内容 | 場所 |
|---|---|
| 本番の構成・ジョブ・依存・ログ・バックアップの契約 | `ops/runtime-contract.yaml`（VPS 管理が照合する。変えるときは notice が要る） |
| API の変更の申請と承認の記録 | `ops/server-change-notices/` |
| mobile 配信の記録 | `ops/client-releases/` |
| いま本番で動いている commit | VPS 管理 repo の `docs/runtime-state/production_deployments.yaml` |
| バックアップ・復元試験の記録 | VPS 管理 repo の `docs/operations/stockhome_backup_and_rollback_decision_20260919.md` ほか |
| Codex への実装依頼の流れ | `work/ai_handoff/BIDIRECTIONAL_WORKFLOW.md` |

### 既知の食い違い（未対応）

`ops/runtime-contract.yaml` の `deploy` 欄と `known_gaps` は古いまま。「tar 化 → `up -d --build`」
「正式なロールバック手順が未整備」と書かれているが、現在の deploy.ps1 には commit 固定タグ・
自動ロールバック・`-RollbackTo` が入っている（本書 4・5 章）。
runtime-contract は VPS 管理が照合する文書なので、次の API リリースの notice で一緒に更新を申請する。
