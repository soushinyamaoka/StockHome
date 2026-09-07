# GAS側: 過去候補の単価再解析バッチ 設計メモ（第2回VPS管理レビュー反映版）

notice: `20260907-STOCKHOME-006`のB08対応。GAS側の実装は今回のセッションでは行わず、
app ownerが別途手動でCodexセッションを`C:\work\PRG\ZZ_Other\GAS\StockHome`にて起動し、
本メモを指示書として実装する想定。API側（対応するGET/POST）はtask `20260907-002`
（第1回実装）・`20260907-003`（第2回レビュー対応）として通常のStockHome-ClaudeToCodex
パイプラインで実装する（別ファイル参照）。

**2026-09-07 第2回VPS管理レビューを受けて全面改訂**: API側の認可方式が
自己申告emailから事前発行済み`runToken`へ変更されたため、本メモの該当箇所を
書き換えた。また`detectedPrice: null`送信がAPI schemaで拒否される問題と、
`push.bat`実行に関する誤った記載を修正した。

## 対象repository・実装担当

- repository: `C:\work\PRG\ZZ_Other\GAS\StockHome`
- 実装担当: 未定（app ownerが選ぶ。手動起動Codexセッション、またはClaudeへの一時例外）
- レビュー: 実装後、Claudeが差分レビュー＋ローカルでの動作再現確認（実Gmailへは接続しない
  範囲で。実データ確認はGmail接続を伴うため、dry-run実行時にapp owner立ち会いのもと
  Claudeが対話セッションで確認する）
- test: GASにテストランナーが無いため、Node.jsからパーサー関数を直接importして
  実サンプルメールに対する検証を行う（`20260906-001`で実施した方法と同じ）
- **commit/push: `push.bat`・`deploy.bat`のどちらも production承認が必要
  （2026-09-07訂正）。** `push.bat`は`clasp push -f`でApps Scriptのcloud sourceを
  直接書き換える実質的なdeploy操作であり、ローカルのgit commit/pushとは別物。
  本notice全体がVPS管理レビューで`accepted`になり、app ownerのproduction承認を
  得るまで、`push.bat`・`deploy.bat`のいずれも実行しない。

## 前提: runTokenの入手方法（B03対応で変更）

第2回レビューでの指摘により、GAS側は自分のGmailアドレスを自己申告する方式
（`email`パラメータ）を廃止した。代わりに、**production承認後、運用者が
`createReparseRun(importedByEmail, householdId)`関数をVPS上で1回だけ直接実行し、
発行された`runToken`を、GASのScript Properties（`PropertiesService`の
スクリプトプロパティ、Apps Scriptエディタの「プロジェクトの設定」から手動設定）へ
1回だけ登録する**。GASコード自身はこのtokenを生成しない。取得は
`PropertiesService.getScriptProperties().getProperty('REPARSE_RUN_TOKEN')`のみで、
Session情報（`Session.getActiveUser().getEmail()`）は使わない。

## 新設する関数（`GmailImportService.js`へ追加）

### `reparseHistoricalCandidates(mode)`

`mode`は`'dry_run'`または`'write'`。手動でスクリプトエディタから実行する
（既存の6時間cronには一切組み込まない）。

```
1. LockService.getScriptLock() で二重起動を防止（取得できなければ即終了）
2. PropertiesService から REPARSE_RUN_TOKEN・reparse_cursor を読む
   - REPARSE_RUN_TOKEN が無ければ「未設定」としてログに残し終了する
     （運用者がまだrunTokenを発行・登録していない状態）
   - cursor は無ければ null から開始する（前回の続きがあれば再開する）
3. GET /api/bridge/reparse-candidates?runToken=<REPARSE_RUN_TOKEN>&cursor=<cursor>&limit=20 を呼ぶ
   - 404の場合、HISTORICAL_REPARSE_ENABLED未設定・runToken無効/期限切れ/失効済みの
     いずれかを区別できない（意図的にAPI側で同一挙動にしている）。
     「対象なし、またはproduction側の準備が完了していません」としてログに残し終了する
4. 返ってきた候補が0件なら、cursorをクリアして「完了」ログを出し終了する
5. 各候補について:
   a. try { GmailApp.getMessageById(mailMessageId) } catch → skipReason: 'message_not_found'
   b. vendor に応じたparserで再解析（AmazonMailParser / MatsukiyoMailParser、
      2026-09-06修正済みのもの）
   c. parseResult.items から itemNameRaw と完全一致（cleanItemName_後）する項目を探す
      - 見つからない → skipReason: 'item_not_found_in_reparse'
      - 複数一致（本来起きないはずだが念のため） → skipReason: 'ambiguous_item_match'
      （skipReasonの値は上記3種類の固定文字列のみ。API側が固定enumで検証するため、
      これ以外の文字列を送らない）
   d. 一致した項目にdetected_priceがあれば結果へ積む。
      **価格が取れなかった場合、detectedPrice/priceSourceのキー自体を省略する
      （`null`を明示的に送らない）。** API側のZodスキーマは`number | string`の
      unionであり、literal `null`はparseエラーになる。「省略」と「価格なし」は
      同じ意味として扱われる。
6. 実行時間が5分を超えたら、残りは次回に回してcursorを保存し終了する
   （Apps Scriptの実行時間制限が6分のため、余裕を持って打ち切る）
7. POST /api/bridge/reparse-candidates へ { runToken, mode, results } を送る
   （`runId`は送らない。API側がrunTokenから内部的に対応するrunを特定し、
   監査ログの紐付けに使う）
   - レスポンスは集計のみ（下記API設計参照）。ログには集計値だけを出し、
     message_id・商品名・価格の値そのものはログへ出さない
8. **cursorは、直前のPOSTが正常応答（200）を確認できた後にのみ進めて保存する。**
   タイムアウト・5xx・応答喪失時はcursorを進めず、次回同じ範囲から再送する
   （API側はrunToken+候補IDの組で冪等に判定するため、同じ候補の再送は安全）。
9. まだ候補が残っていそうなら、続けて4以降を繰り返す
   （1回の関数呼び出し内でループしてよいが、5分の時間予算は厳守する）
```

### 呼び出し方

- **dry-run**: スクリプトエディタから `reparseHistoricalCandidates('dry_run')` を手動実行。
  **業務データ（候補・購入）は変更しないが、監査テーブルへの記録は行われる。
  「何も変更しない」わけではないため、dry-run実行自体もproduction承認の対象とする**
  （2026-09-07訂正。詳細はAPI側notice参照）。
- **write**: dry-runの集計をapp ownerが確認し、production承認を得てから
  `reparseHistoricalCandidates('write')` を手動実行する。

## 安全設計のポイント（B04対応）

- **cursorは最適化であって正しさの前提ではない**: APIの対象抽出条件は常に
  `price_source IS NULL AND detected_price IS NULL`であり、GAS側のcursorがずれていても、
  既に埋まった候補はAPI側で自然にスキップされる（`updateMany`のWHERE句が
  両方のNULL条件を再確認する）。つまり「cursorを失っても実害はない、単に一部を
  重複チェックするだけ」という設計にする。
- **同時実行防止**: `LockService`でGAS側の二重起動を防ぐ。API側もrow単位の
  条件付き`updateMany`で二重更新を防ぐ（詳細はAPI側task参照）。
- **既存の6時間cron（`runMyGmailImport`）との同時実行**: 通常の新規取込と本バッチが
  同じ候補行を触ることは無い（本バッチは既存行だけを対象にし、新規取込は新しい行を
  作るだけのため）。ただし理論上、本バッチの対象取得後・書込前にユーザーが手動で
  その候補を確定した場合はAPI側のWHERE句guardで`conflict`として扱われる。

## 個人情報・secret対策

- 再取得したメール本文はこの関数のスコープ内でのみ保持し、価格抽出後は変数を
  再利用せず破棄する（保存しない。既存の取込パイプラインと同じ方針）。
- ログへ出してよいのは: mode、処理件数、成功/skip/失敗の内訳（理由の種類ごとの件数）。
  runToken・message_id・商品名・金額そのものは出さない。
- `REPARSE_RUN_TOKEN`はBRIDGE_TOKEN等と同様の認可情報として扱い、コードへ
  ハードコードせずScript Propertiesのみに保持する。

## 未確定・実装時に決める事項

- API疎通失敗時（timeout・5xx）のretry回数・backoff（提案: 3回、指数backoff、
  それでも失敗なら今回のchunkを諦めて次回に回す。cursorは進めない）
- `HISTORICAL_REPARSE_ENABLED`の実際の切り替え方法（VPS側の`.env`＋
  `docker-compose.prod.yml`。production承認後にVPS管理側が設定する）
- `REPARSE_RUN_TOKEN`の実際の発行・Script Propertiesへの登録手順
  （production承認後、運用者が`createReparseRun`を直接実行して確定する）
