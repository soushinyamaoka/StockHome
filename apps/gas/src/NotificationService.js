/**
 * NotificationService.gs
 * 通知理由判定 / 通知ログ記録
 *
 * 仕様書 Section 15, 17, 20 (NotificationService) 準拠
 *
 * 2026-09-21、ReadyGo Inboxへの通知投入（旧`processAllNotifications`・
 * `evaluateAlertTarget_`・`buildBroadcastMessage_`・`buildItemSummaryLine_`）
 * は完全に削除した。在庫計算・通知判定・ReadyGo投入はAPI側daily_batch
 * （apps/api/src/services/batch.ts）へ移行済みで、GAS側は
 * `ApiBridge.deliverStockHomeNotifications`経由の配信ブリッジのみを担当
 * する（notice 20260920-STOCKHOME-014、第5回VPS管理レビュー対応。
 * `ReadyGoBotService.appendToInbox`がoutboxId必須化(S014-B07)されて以降、
 * この旧経路は呼び出しても必ず失敗する状態だった）。
 * このfileに残るのは、通知理由の解決（`resolveNotificationReason`。API側
 * batch.tsの通知判定とは独立し呼ばれていないが、他の判定ロジックからの
 * 参照可能性を考慮し残置）と、通知履歴の記録・取得
 * （`createNotificationRecord`・`getNotificationLogs`。`getNotificationLogs`
 * は`WebController.js`の管理画面が使用）のみ。
 *
 * 重複防止:
 *   - 現在は実施しない
 *   - 将来再導入する場合は hasRecentNotification と notification_log を流用する想定
 */

var NotificationService = (function() {

  // ----------------------------------------------------------
  // 通知理由
  // ----------------------------------------------------------

  /**
   * 在庫計算結果から通知理由を解決する
   *
   * @param {Object} stockData
   * @return {string} ENUMS.NOTIFICATION_REASON のいずれか
   */
  function resolveNotificationReason(stockData) {
    var days = toBool(stockData.days_alert_needed);
    var qty = toBool(stockData.qty_alert_needed);

    if (days && qty) return ENUMS.NOTIFICATION_REASON.BOTH;
    if (days) return ENUMS.NOTIFICATION_REASON.DAYS;
    if (qty) return ENUMS.NOTIFICATION_REASON.QTY;
    return ENUMS.NOTIFICATION_REASON.DAYS; // フォールバック
  }

  // ----------------------------------------------------------
  // 重複チェック（将来再導入時用に残置。現フローでは呼ばない）
  // ----------------------------------------------------------

  /**
   * 指定期間内に同じ通知が送られていないか確認する
   *
   * @param {string} itemId
   * @param {string} notificationType 通知理由
   * @param {string} targetUserId 通知先ユーザー
   * @param {number} days チェック日数
   * @return {boolean} 直近に通知済みなら true
   */
  function hasRecentNotification(itemId, notificationType, targetUserId, days) {
    var cutoff = addDays(new Date(), -days);

    var recent = SheetRepository.findRows(SHEET_NAMES.NOTIFICATION_LOG, function(row) {
      if (String(row.item_id) !== String(itemId)) return false;
      if (String(row.notification_reason) !== String(notificationType)) return false;
      if (String(row.target_user_id) !== String(targetUserId)) return false;
      var createdAt = parseDate(row.created_at);
      return createdAt && createdAt >= cutoff;
    });

    return recent.length > 0;
  }

  // ----------------------------------------------------------
  // 通知レコード生成
  // ----------------------------------------------------------

  /**
   * notification_log にレコードを作成する
   *
   * @param {string} itemId
   * @param {Object} notificationData
   *   - notification_type {string}
   *   - notification_reason {string}
   *   - target_user_id {string}
   *   - outbox_id {string}
   *   - message {string}
   * @return {Object} 作成された通知ログ
   */
  function createNotificationRecord(itemId, notificationData) {
    var now = nowIso();
    var record = {
      notification_id: generatePrefixedId('NOTIF'),
      item_id: itemId,
      notification_type: toStr(notificationData.notification_type) || 'stock_alert',
      notification_reason: toStr(notificationData.notification_reason),
      target_user_id: toStr(notificationData.target_user_id),
      outbox_id: toStr(notificationData.outbox_id),
      message: toStr(notificationData.message),
      created_at: now
    };

    SheetRepository.appendRow(SHEET_NAMES.NOTIFICATION_LOG, record);
    return record;
  }

  // ----------------------------------------------------------
  // 通知履歴取得
  // ----------------------------------------------------------

  /**
   * 通知履歴一覧を取得する（新しい順）
   * @param {number} [limit] 取得件数上限
   * @return {Object[]}
   */
  function getNotificationLogs(limit) {
    var rows = SheetRepository.getAllRows(SHEET_NAMES.NOTIFICATION_LOG);

    // 作成日時の降順
    rows.sort(function(a, b) {
      var da = parseDate(a.created_at);
      var db = parseDate(b.created_at);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return db.getTime() - da.getTime();
    });

    if (limit && limit > 0) {
      return rows.slice(0, limit);
    }
    return rows;
  }

  // 公開API
  return {
    resolveNotificationReason: resolveNotificationReason,
    hasRecentNotification: hasRecentNotification,
    createNotificationRecord: createNotificationRecord,
    getNotificationLogs: getNotificationLogs
  };

})();
