# GAS側: 過去候補の単価再解析バッチ 設計メモ

notice: `20260907-STOCKHOME-006`のB08対応。GAS側の実装は今回のセッションでは行わず、
app ownerが別途手動でCodexセッションを`C:\work\PRG\ZZ_Other\GAS\StockHome`にて起動し、
本メモを指示書として実装する想定。API側（対応するGET/POST）は`20260907-002`として
通常のStockHome-ClaudeToCodexパイプラインで実装する（別ファイル参照）。

## 対象repository・実装担当

- repository: `C:\work\PRG\ZZ_Other\GAS\StockHome`
- 実装担当: 未定（app ownerが選ぶ。手動起動Codexセッション、またはClaudeへの一時例外）
- レビュー: 実装後、Claudeが差分レビュー＋ローカルでの動作再現確認（実Gmailへは接続しない
  範囲で。実データ確認はGmail接続を伴うため、dry-run実行時にapp owner立ち会いのもと
  Claudeが対話セッションで確認する）
- test: GASにテストランナーが無いため、Node.jsからパーサー関数を直接importして
  実サンプルメールに対する検証を行う（`20260906-001`で実施した方法と同じ）
- commit/push: 実装完了後、`push.bat`は実行してよいが、**`deploy.bat`（実際のトリガーへの
  反映）は本notice全体がVPS管理レビューで`accepted`になり、app ownerのproduction承認を
  得るまで実行しない**

## 新設する関数（`GmailImportService.js`へ追加）

### `reparseHistoricalCandidates(mode)`

`mode`は`'dry_run'`または`'write'`。手動でスクリプトエディタから実行する
（既存の6時間cronには一切組み込まない）。

```
1. LockService.getScriptLock() で二重起動を防止（取得できなければ即終了）
2. PropertiesService から reparse_run_id・reparse_cursor を読む
   - run_id が無ければ新規発行（Utilities.getUuid()）、cursor は null から開始
   - 既存の run_id がある場合は前回の続きとして再開する
3. 自分の email（Session.getActiveUser().getEmail()）で
   GET /api/bridge/reparse-candidates?email=<自分>&cursor=<cursor>&limit=20 を呼ぶ
   - HISTORICAL_REPARSE_ENABLED が無効な場合、APIは404を返す。その場合は
     「production側の準備が完了していません」としてログに残し終了する
4. 返ってきた候補が0件なら、cursor・run_id をクリアして「完了」ログを出し終了する
5. 各候補について:
   a. try { GmailApp.getMessageById(mailMessageId) } catch → skipReason: 'message_not_found'
   b. vendor に応じたparserで再解析（AmazonMailParser / MatsukiyoMailParser、
      2026-09-06修正済みのもの）
   c. parseResult.items から itemNameRaw と完全一致（cleanItemName_後）する項目を探す
      - 見つからない → skipReason: 'item_not_found_in_reparse'
      - 複数一致（本来起きないはずだが念のため） → skipReason: 'ambiguous_item_match'
   d. 一致した項目の detected_price・price_source を結果に積む
      （見つかっても価格が取れない場合は detectedPrice: null のまま送る。
      これは「再解析したが今回も価格なし」という正常な結果であり、エラーではない）
6. 実行時間が5分を超えたら、残りは次回に回してcursorを保存し終了する
   （Apps Scriptの実行時間制限が6分のため、余裕を持って打ち切る）
7. POST /api/bridge/reparse-candidates へ { runId, mode, results } を送る
   - レスポンスは集計のみ（下記API設計参照）。ログには集計値だけを出し、
     message_id・商品名・価格の値そのものはログへ出さない
8. cursor を最後に処理した候補のIDへ進めて PropertiesService に保存する
9. まだ候補が残っていそうなら、続けて4以降を繰り返す
   （1回の関数呼び出し内でループしてよいが、5分の時間予算は厳守する）
```

### 呼び出し方

- **dry-run**: スクリプトエディタから `reparseHistoricalCandidates('dry_run')` を手動実行。
  何度でも安全に再実行できる（書き込みをしないため）。
- **write**: dry-runの集計をapp ownerが確認し、production承認を得てから
  `reparseHistoricalCandidates('write')` を手動実行する。

## 安全設計のポイント（B04対応）

- **cursorは最適化であって正しさの前提ではない**: APIの対象抽出条件は常に
  `price_source IS NULL` であり、GAS側のcursorがずれていても、既に埋まった候補は
  API側で自然にスキップされる（`updateMany`のWHERE句が`price_source: null`を再確認する）。
  つまり「cursorを失っても実害はない、単に一部を重複チェックするだけ」という設計にする。
- **同時実行防止**: `LockService`でGAS側の二重起動を防ぐ。API側もrow単位の
  条件付き`updateMany`で二重更新を防ぐ（詳細はAPI側task参照）。
- **既存の6時間cron（`runMyGmailImport`）との同時実行**: 通常の新規取込と本バッチが
  同じ候補行を触ることは無い（本バッチは`price_source IS NULL`の**既存**行だけを対象にし、
  新規取込は新しい行を作るだけのため）。ただし理論上、本バッチの対象取得後・書込前に
  ユーザーが手動でその候補を確定した場合はAPI側のWHERE句guardで`conflict`として
  扱われる。

## 個人情報・secret対策

- 再取得したメール本文はこの関数のスコープ内でのみ保持し、価格抽出後は変数を
  再利用せず破棄する（保存しない。既存の取込パイプラインと同じ方針）。
- ログへ出してよいのは: run_id、mode、処理件数、成功/skip/失敗の内訳（理由の種類ごとの件数）。
  message_id・商品名・金額そのものは出さない。

## 未確定・実装時に決める事項

- API疎通失敗時（timeout・5xx）のretry回数・backoff（提案: 3回、指数backoff、
  それでも失敗なら今回のchunkを諦めて次回に回す）
- `HISTORICAL_REPARSE_ENABLED`の実際の切り替え方法（VPS側の`.env`。本メモでは
  「production承認後にVPS管理側が設定する」とし、GAS/API双方の実装には影響しない）
