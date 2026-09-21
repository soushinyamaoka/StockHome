/**
 * BatchController.gs
 * ユーザー別 Gmail 取込のエントリーポイント / 在庫再計算（手動実行用）
 *
 * 仕様書 Section 18, 19 (BatchController) 準拠
 *
 * 旧・日次バッチ（在庫計算→通知判定→ReadyGo Inbox投入）はAPI側
 * daily_batch（apps/api/src/services/batch.ts）へ移行済みのため
 * 2026-09-21に完全に削除した（旧`runDailyBatch`・`createDailyBatchTrigger`。
 * notice 20260920-STOCKHOME-014、第5回VPS管理レビュー対応。
 * `ReadyGoBotService.appendToInbox`がoutboxId必須化(S014-B07)されて
 * 以降、この旧経路は呼び出しても必ず失敗する状態だった。ReadyGo通知の
 * 配信は現在`ApiBridge.deliverStockHomeNotifications`のみが担う）。
 * `deleteDailyBatchTrigger()`は、未移行環境に残る可能性のある旧trigger
 * を`setupStockHomeBridge()`が一括削除するために残置している。
 *
 * ユーザー別 Gmail 取込: runMyGmailImport()
 *   各ユーザーの trigger が実行。GmailImportService に委譲。
 */

// ============================================================
// ユーザー別 Gmail 取込バッチ
// ============================================================

// ============================================================
// ユーザー別 Gmail 取込バッチ
// ============================================================

/**
 * ユーザー別 Gmail 取込のメイン関数
 * 各ユーザーの installable trigger から呼ばれる
 *
 * 処理順序（Section 18.2）:
 *   1. 実行ユーザーの Gmail を検索
 *   2. 未処理メール抽出
 *   3. vendor 判定
 *   4. parser 実行
 *   5. import_order_candidates に保存
 *   6. User Properties に最終取込日時保存
 *
 * 実装本体は GmailImportService に委譲する。
 */
function runMyGmailImport() {
  Logger.log('=== Gmail 取込バッチ開始 ===');
  var startTime = new Date();

  try {
    // 現在の実行ユーザーを特定
    var email = '';
    try {
      email = Session.getActiveUser().getEmail();
    } catch (e) {
      Logger.log('[GmailBatch] メールアドレス取得失敗: ' + e.message);
    }
    Logger.log('[GmailBatch] 実行ユーザー: ' + (email || '不明'));

    // GmailImportService に委譲
    // Phase 3 で実装予定。ここでは存在チェックのみ。
    if (typeof GmailImportService !== 'undefined' && GmailImportService.runMyGmailImport) {
      var result = GmailImportService.runMyGmailImport();
      Logger.log('[GmailBatch] 取込結果: ' + JSON.stringify(result));
    } else {
      Logger.log('[GmailBatch] GmailImportService が未実装のためスキップ');
    }

    var elapsed = (new Date().getTime() - startTime.getTime()) / 1000;
    Logger.log('=== Gmail 取込バッチ完了 (' + elapsed + '秒) ===');

  } catch (e) {
    Logger.log('[GmailBatch] エラー発生: ' + e.message);
    Logger.log(e.stack);
  }
}

// ============================================================
// 在庫再計算（手動実行用）
// ============================================================

/**
 * 在庫の再計算のみ実行する（通知なし）
 * 管理画面やデバッグで使う
 */
function runStockRecalculation() {
  Logger.log('=== 在庫再計算開始 ===');

  try {
    // counted_in_inventory の更新
    PurchaseService.updateCountedInInventory();

    // 在庫計算 & snapshot 保存
    var stocks = StockService.calculateAndSaveAllStocks();
    Logger.log('[Recalc] ' + stocks.length + ' 件の在庫を再計算しました');

  } catch (e) {
    Logger.log('[Recalc] エラー: ' + e.message);
  }

  Logger.log('=== 在庫再計算完了 ===');
}

// ============================================================
// 旧・日次バッチ trigger の削除（移行用に残置。作成側は廃止済み）
// ============================================================

/**
 * 旧・日次バッチ用の trigger（ハンドラ関数`runDailyBatch`。本file上には
 * 既に存在しない）が残っていれば削除する。`ApiBridge.setupStockHomeBridge()`
 * が移行時に呼ぶ
 */

/**
 * 日次バッチ用の trigger を削除する
 */
function deleteDailyBatchTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  var deleted = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'runDailyBatch') {
      ScriptApp.deleteTrigger(triggers[i]);
      deleted++;
    }
  }
  Logger.log('日次バッチ trigger を ' + deleted + ' 件削除しました。');
}

/**
 * 配送バッファ日数を app_config に設定する（GAS エディタから手動実行用）
 * @param {number} days
 */
function setDeliveryBufferDays(days) {
  var n = parseInt(days, 10);
  if (isNaN(n) || n < 0) {
    throw new Error('days は 0 以上の整数で指定してください。');
  }
  setAppConfigValue('default_delivery_buffer_days', String(n));
  Logger.log('配送バッファ日数を ' + n + ' に更新しました。');
}

/**
 * 配送バッファを 0 にする（ワンショット用）
 */
function setDeliveryBufferDaysToZero() {
  setDeliveryBufferDays(0);
}
