# GAS側: 過去候補の単価再解析バッチ 設計メモ（第6回VPS管理レビュー反映版）

notice: `20260907-STOCKHOME-006`のB08対応。GAS側の実装は今回のセッションでは行わず、
app ownerが別途手動でCodexセッションを`C:\work\PRG\ZZ_Other\GAS\StockHome`にて起動し、
本メモを指示書として実装する想定。API側（対応するGET/POST）はtask `20260907-002`
（第1回実装）・`20260907-004`（第2回レビュー対応）・`20260907-005`（第3回レビュー対応）・
`20260907-006`（第4回レビュー対応）・`20260907-007`（第5回レビュー対応）・
`20260907-008`（第6回レビュー対応）として通常のStockHome-ClaudeToCodexパイプラインで
実装済み（別ファイル参照）。

**2026-09-07 第2回VPS管理レビューを受けて全面改訂**: API側の認可方式が
自己申告emailから事前発行済み`runToken`へ変更されたため、本メモの該当箇所を
書き換えた。また`detectedPrice: null`送信がAPI schemaで拒否される問題と、
`push.bat`実行に関する誤った記載を修正した。

**2026-09-07 第3回VPS管理レビューを受けて再改訂**: 実DBへのprobeにより、
`runToken`をGETのquery stringへ載せるとaccess logへ残り得る問題、同一runでも
dry-runとwriteで価格判定が食い違う問題等が新たに確認され、API側で修正された。
本メモも次の点を書き換えた: `runToken`はquery stringではなく専用header
（`X-Reparse-Run-Token`）で送る。GET/POSTともAPI側がrunのhousehold・cutoff時刻も
照合するようになった（cutoff以降に新規取込された候補は今回のrunでは扱われない）。
write再送は保存済み結果がそのまま返る（再判定されない）ため、GAS側は同じ結果を
安全に再送してよい。

**2026-09-08 第4回VPS管理レビューを受けて再改訂**: POSTがinfrastructure障害
（DB接続断等）とrow単位の業務判断としての失敗を区別するようAPI側が修正され、
前者はHTTPレベルの失敗（5xx）としてchunk全体に返るようになった（以前は
すべて200で返り、GAS側からは区別できなかった）。また、運用者向けに
`createReparseRun`のsingle active run制約（同一household向けの有効runは同時に
1つまで）と、DBだけからrunの進捗を確認できる`getReparseRunProgress`関数が
追加された（いずれもGAS自体は呼び出さないが、運用手順に関わるため記載する）。

**2026-09-08 第5回VPS管理レビューを受けて再改訂**: matched itemがrunと別household
だった場合、以前はcandidateの価格だけ更新が確定してしまう実装漏れがあったが、
API側でcandidate更新前に検知し候補・購入とも一切変更しないよう修正された
（GAS側の呼び出し方は変わらない）。`createReparseRun`のsingle active run制約は
DB transactionレベルの真の排他制御へ強化された（運用者が同時に2つのrunを
発行しようとした場合、片方が確実に失敗するようになった）。また、運用者が
GASのlocal state（cursor）を失った場合や、runが期限切れした後でも進捗を
確認できるよう、新規`GET /api/bridge/reparse-progress`（`X-Reparse-Run-Token`
header必須。GET/POSTと同じ認可方式）が追加された。GAS側の呼び出し手順自体に
変更はないが、運用者が手動でこのendpointを叩いて進捗確認・reconcileに使える。

**2026-09-08 第6回VPS管理レビューを受けて再改訂**: `price_reparse_targets`
manifestが、進捗計算だけでなくGET/POST双方の正本になった。GAS側の呼び出し方
（GETでcursor/limitを渡す、POSTでcandidateId・結果を渡す）自体は変わらないが、
以下の点を運用者向けに明記する。
- GETは、run作成時点で対象だった候補のうち、まだ処理が完了していないものだけを
  返す。run作成後に候補が別経路（通常のGmail確定フロー等）で価格確定した場合も、
  そのGET結果には引き続き含まれる（以前は動的条件で除外されGASから見えなく
  なっていたが、これも修正された）。GAS側がその候補を再取得できず`skipReason`を
  返せない場合でも、価格を検出できなかった扱いとしてそのままPOSTすれば、API側が
  `already_has_price`として監査付きで処理済みに確定してくれる
- run作成後に新規追加された候補（cutoff以降の取込）はmanifestに含まれないため、
  GETに出てこない。誤って別経路でcandidateIdを送っても`candidate_not_in_manifest`
  として拒否され、data・監査とも変更されない
- 運用者は、期限切れ・失効したrunを`extendReparseRun`関数（HTTP非公開、直接実行）で
  延長できる。延長すると同じmanifest・既存の監査履歴を維持したまま、同じrunTokenで
  GET/POSTを再開できる（新しいrunを発行する必要はなく、対象集合の取り直しも
  発生しない）。ただし同一household向けに他の有効runが既にある場合は延長できない

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

`createReparseRun`は、同一household向けの有効な（未失効・未期限切れ）runが既に
存在する場合はエラーになる（第4回レビューR4-03: single active runの制約、
二重発行による運用混乱を防ぐ）。運用者が新しいrunを発行し直す場合は、
古いrunの`revokedAt`をVPS上で先に設定してから`createReparseRun`を呼ぶ。

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
3. GET /api/bridge/reparse-candidates?cursor=<cursor>&limit=20 を呼ぶ。
   **runTokenはquery stringに含めず、専用header `X-Reparse-Run-Token: <REPARSE_RUN_TOKEN>`
   で送る**（第3回レビューB03対応。query stringに載せるとNginx等のaccess logへ
   URIと一緒に残り得るため）。
   - 404の場合、HISTORICAL_REPARSE_ENABLED未設定・runToken無効/期限切れ/失効済み・
     header未設定のいずれかを区別できない（意図的にAPI側で同一挙動にしている）。
     「対象なし、またはproduction側の準備が完了していません」としてログに残し終了する
   - 返る候補は、runToken発行時点（cutoff_at）以前に作成された候補のみ。
     run発行後に通常の6時間取込で新規追加された候補は、このrunでは一切対象にならない
     （第3回レビューB02/B04対応。対象集合をrun作成時点で固定する設計）
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
7. POST /api/bridge/reparse-candidates へ、header `X-Reparse-Run-Token`
   （GETと同じ値）を付けて { mode, results } を送る（`runToken`はbodyにも
   query stringにも含めない。API側がheaderの値から内部的に対応するrunを特定し、
   監査ログの紐付けに使う）
   - レスポンスは集計のみ（下記API設計参照）。ログには集計値だけを出し、
     message_id・商品名・価格の値そのものはログへ出さない
8. **cursorは、直前のPOSTが正常応答（200）を確認できた後にのみ進めて保存する。**
   タイムアウト・5xx・応答喪失時はcursorを進めず、次回同じ範囲から再送する。
   **write再送は、API側が(runToken, candidateId, mode)の組で既存の監査記録を検出し、
   再判定せず保存済みの結果をそのまま返す**（第3回レビューB02/B04対応）ため、
   同じ候補を含むchunkを重複して送っても安全（二重更新にはならない）。
   **5xxの意味（第4回レビューR4-01対応）**: API側は、DB接続断等の
   infrastructure障害と、row単位の業務判断としての失敗（`invalid_price_rejected`等、
   通常どおり200のsummaryへ集計される）を区別するようになった。5xxが返った場合、
   chunk内の一部候補はまだ監査記録すら作られていない可能性があるため、
   cursorを進めず同じchunkをそのまま再送してよい（既に監査済みの候補は
   再判定されずスキップされるため、二重更新にはならない）。
9. まだ候補が残っていそうなら、続けて4以降を繰り返す
   （1回の関数呼び出し内でループしてよいが、5分の時間予算は厳守する）
```

### 呼び出し方

- **dry-run**: スクリプトエディタから `reparseHistoricalCandidates('dry_run')` を手動実行。
  **業務データ（候補・購入）は変更しないが、監査テーブルへの記録は行われる。
  「何も変更しない」わけではないため、dry-run実行自体もproduction承認の対象とする**
  （2026-09-07訂正。詳細はAPI側notice参照）。同じ候補へdry-runを複数回実行しても、
  監査は候補ごとに1行のまま最新の判定内容で上書きされる（重複して増えない。
  第3回レビューB02/B04対応）ため、GAS側は同じrunで何度dry-runを繰り返しても安全。
- **write**: dry-runの集計をapp ownerが確認し、production承認を得てから
  `reparseHistoricalCandidates('write')` を手動実行する。

## 安全設計のポイント（B04対応、第3回レビューでhousehold/cutoff/価格判定の一貫性を追加強化）

- **cursorは最適化であって正しさの前提ではない**: APIのGET対象抽出条件は、
  run作成時点で固定したmanifest（`price_reparse_targets`）のうち、まだ
  mode='write'監査が付いていない候補である（第6回レビューR6-01対応。以前は
  動的な`price_source IS NULL AND detected_price IS NULL`条件だけに依存していた）。
  GAS側のcursorがずれていても、既に監査済みの候補はGETに出てこないため
  自然にスキップされ、POST側もWHERE句でcandidateの現在値を再確認する。
  つまり「cursorを失っても実害はない、単に一部を重複チェックするだけ」という
  設計は変わらない。
- **household・cutoff境界はAPI側が強制する**: GAS側が誤ったrunTokenを使った場合でも、
  API側がcandidate/purchase/matched itemのhouseholdをrunと照合し、不一致は
  conflictとして拒否する。cutoff（run発行時刻）より後に作成された候補も同様に
  対象から除外される。GAS側はこれらの境界チェックを自前で行う必要はない
  （第3回レビューB03/B02/B04対応）。
- **同一runでのdry-run/write判定は品目ごとに固定される**: API側が品目ごとの
  参照単価をrun内で最初の1回だけ計算・固定するため（`price_reparse_item_snapshots`）、
  GAS側がchunkの分割方法や送信順序を変えても、同じ候補集合に対する判定結果は
  変わらない（第3回レビューB02/B06対応）。GAS側でこの一貫性を保証する工夫は不要。
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
