/**
 * ReadyGoBotService.gs
 * ReadyGo Bot 連携サービス
 *
 * ReadyGo Bot（家族向け生活自動化Bot）の Inbox シートに通知を投入する。
 * 投入された行は ReadyGo 側の 21:00 夜次通知の末尾に「お知らせ」として配信される。
 *
 * 連携仕様:
 *   - スプレッドシートID: スクリプトプロパティ READYGO_SPREADSHEET_ID
 *   - シート名: Inbox
 *   - 列構成: A=posted_at(Date), B=source(string), C=body(string), D=processed(false),
 *     E=stockhome_outbox_id（notice 20260920-STOCKHOME-014、S014-B07冪等化対応で追加。
 *     ReadyGo側が本列を無視する前提だが、ReadyGo実装がrow長を厳密検証する場合は
 *     影響がありうる。production反映前にReadyGo側での許容を確認すること）
 *   - 配信タイミング: 投入後、次の 21:00 通知に含まれる（即時配信ではない）
 *   - 再送なし: 1度配信されると ReadyGo 側で processed=TRUE になり再配信されない
 *
 * 冪等性（S014-B07対応。第4回VPS管理レビューで、Inbox投入とID記録が別操作だと
 * その間の中断で二重投入しうると指摘され、以下へ設計変更した）:
 *   - E列へStockHome側readygo_outbox行のidを、本文と同じ`appendRow`呼び出しで
 *     同時に書き込む。「Inboxへの投入」と「投入済みの記録」が単一のAPI呼び出しに
 *     なるため、途中で処理が中断しても中間状態（投入済みだが未記録）は発生しない。
 *   - 投入前にE列を読み、同じidが既に存在する場合は投入をスキップしtrueを返す
 *     （呼び出し元はACKだけ再試行すればよい）。
 *   - 並行実行対策: read→appendの間の競合は、呼び出し元
 *     （`ApiBridge.deliverStockHomeNotifications`）がLockServiceで配信処理全体を
 *     排他することで防ぐ。本file自体はロックを取得しない（取得済み前提で呼ばれる）。
 *   - 既知の限界: ReadyGo側が処理済み行を投入後すぐに削除・アーカイブする実装だった
 *     場合、次回リトライ時にはE列のidが既に無くなっており、重複投入を防げない
 *     可能性がある。ReadyGo側の挙動はStockHome側のtestでは検証できない
 *     （外部システムのため）。
 *
 * 失敗時の挙動:
 *   - スプレッドシートID 未設定や権限不足、シート不在等のエラーは Logger.log のみ
 *     呼び出し元のバッチ処理は継続させる（夜の通知側で欠落するだけで良い設計）
 */

var ReadyGoBotService = (function() {

  /** ReadyGo 側で固定の Inbox シート名 */
  var INBOX_SHEET_NAME = 'Inbox';

  /** 投入時の source 名（ReadyGo 側のログ識別用） */
  var SOURCE_NAME = 'StockHome';

  /** E列（stockhome_outbox_id）の列番号（1始まり） */
  var OUTBOX_ID_COLUMN = 5;

  /**
   * Inboxシートに、指定したoutboxIdが既に投入済みかどうかをE列から確認する
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
   * @param {string} outboxId
   * @return {boolean}
   * @private
   */
  function hasAlreadyBeenAppended_(sheet, outboxId) {
    var lastRow = sheet.getLastRow();
    if (lastRow < 1) return false;
    var ids = sheet.getRange(1, OUTBOX_ID_COLUMN, lastRow, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (ids[i][0] === outboxId) return true;
    }
    return false;
  }

  /**
   * ReadyGo の Inbox に、通知本文をoutbox行idとともに1行追加する。
   * 同じoutboxIdが既に存在する場合は投入をスキップし、成功として扱う
   * （呼び出し元はACKだけ再試行できる）。
   *
   * @param {string} body 通知本文（改行可、5000文字以内推奨）
   * @param {string} outboxId StockHome API側readygo_outbox行のid（冪等化キー）
   * @return {boolean} 成功（既に投入済みでスキップした場合を含む）時 true、失敗時 false
   */
  function appendToInbox(body, outboxId) {
    var text = toStr(body);
    if (!text) {
      Logger.log('[ReadyGoBotService] body が空のため投入をスキップ');
      return false;
    }
    var id = toStr(outboxId);
    if (!id) {
      Logger.log('[ReadyGoBotService] outboxId が空のため投入をスキップ');
      return false;
    }

    var spreadsheetId = getReadyGoSpreadsheetId();
    if (!spreadsheetId) {
      Logger.log('[ReadyGoBotService] スクリプトプロパティ READYGO_SPREADSHEET_ID が未設定のためスキップ');
      return false;
    }

    try {
      var ss = SpreadsheetApp.openById(spreadsheetId);
      var sheet = ss.getSheetByName(INBOX_SHEET_NAME);
      if (!sheet) {
        Logger.log('[ReadyGoBotService] Inbox シートが見つかりません: spreadsheetId=' + spreadsheetId);
        return false;
      }

      if (hasAlreadyBeenAppended_(sheet, id)) {
        Logger.log('[ReadyGoBotService] 既に投入済みのため再投入をスキップ: outboxId=' + id);
        return true;
      }

      sheet.appendRow([new Date(), SOURCE_NAME, text, false, id]);

      Logger.log('[ReadyGoBotService] Inbox に投入しました (' + text.length + '文字, outboxId=' + id + ')');
      return true;
    } catch (e) {
      Logger.log('[ReadyGoBotService] Inbox 投入失敗: ' + e.message);
      return false;
    }
  }

  return {
    appendToInbox: appendToInbox
  };

})();
