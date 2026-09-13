/**
 * ApiBridge.gs
 * StockHome React 版（VPS 上の API）との連携ブリッジ
 *
 * 役割:
 *   1. Gmail 取込候補の API 投入
 *      - GmailImportService が解析した候補を、シート保存の代わりに
 *        新 API (POST /api/bridge/import-candidates) へバッチ送信する
 *      - 重複排除・自動確定・purchase_log 反映はすべて API 側で行う
 *   2. ReadyGo 通知の配信（夜間トリガー）
 *      - API の夜間バッチ(19:55 JST)が配信待ちキューに積んだ集約メッセージを
 *        GET /api/bridge/readygo-pending で取得し、ReadyGo スプレッドシートの
 *        Inbox に行追加 → POST /api/bridge/readygo-ack で完了報告する
 *      - API 側は ACK を受けて notification_log を記録する
 *      ※ GAS Web アプリは「アクセスユーザーとして実行」のため外部からの匿名 POST を
 *        受けられない。そのため通知も GAS からのアウトバウンド（ポーリング）方式とする。
 *
 * 必要なスクリプトプロパティ:
 *   - STOCKHOME_API_URL      例: http://219.94.251.235:4002
 *   - STOCKHOME_BRIDGE_TOKEN API 側の BRIDGE_TOKEN と同じ値（手動で設定する）
 *
 * セットアップ: setupStockHomeBridge() を1回実行（トークンのみ手動設定）
 * STOCKHOME_API_URL 未設定の間、Gmail 取込は従来どおりシート保存で動作する。
 */

var ApiBridge = (function() {

  /**
   * API の URL を取得する
   * @return {string|null}
   */
  function getApiUrl() {
    return PropertiesService.getScriptProperties().getProperty('STOCKHOME_API_URL');
  }

  /**
   * ブリッジ共有トークンを取得する
   * @return {string|null}
   */
  function getBridgeToken() {
    return PropertiesService.getScriptProperties().getProperty('STOCKHOME_BRIDGE_TOKEN');
  }

  /**
   * API 連携が構成済みかどうか
   * @return {boolean}
   */
  function isConfigured() {
    return !!(getApiUrl() && getBridgeToken());
  }

  /**
   * API を呼び出す共通処理
   * @param {string} path 例: '/api/bridge/readygo-pending'
   * @param {string} method 'get' | 'post'
   * @param {Object} [payload] POST ボディ
   * @return {Object|null} JSON レスポンス、失敗時 null
   * @private
   */
  function callApi_(path, method, payload) {
    if (!isConfigured()) {
      Logger.log('[ApiBridge] STOCKHOME_API_URL / STOCKHOME_BRIDGE_TOKEN 未設定のためスキップ: ' + path);
      return null;
    }

    var url = getApiUrl().replace(/\/+$/, '') + path;
    var options = {
      method: method,
      headers: { 'X-Bridge-Token': getBridgeToken() },
      muteHttpExceptions: true
    };
    if (payload) {
      options.contentType = 'application/json';
      options.payload = JSON.stringify(payload);
    }

    try {
      var res = UrlFetchApp.fetch(url, options);
      var code = res.getResponseCode();
      var body = res.getContentText();

      if (code >= 200 && code < 300) {
        return JSON.parse(body);
      }
      Logger.log('[ApiBridge] API 呼び出し失敗: ' + method + ' ' + path + ' → HTTP ' + code + ' | ' + body);
      return null;
    } catch (e) {
      Logger.log('[ApiBridge] API 呼び出しで例外: ' + path + ' | ' + e.message);
      return null;
    }
  }

  /**
   * 解析済み候補を API へバッチ送信する
   * @param {Object[]} candidates bridgeCandidateSchema 形式（camelCase）の配列
   * @return {Object|null} API レスポンス（{ saved, duplicates, autoConfirmed, ... }）、失敗時 null
   */
  function postCandidatesToApi(candidates) {
    if (!candidates || candidates.length === 0) return null;
    var result = callApi_('/api/bridge/import-candidates', 'post', { candidates: candidates });
    if (result) {
      Logger.log('[ApiBridge] 候補送信成功: ' + JSON.stringify(result));
    }
    return result;
  }

  /**
   * ReadyGo 配信待ちキューを取得する
   * @return {Object[]} [{ id, body }] 失敗時は空配列
   */
  function fetchReadyGoPending() {
    var result = callApi_('/api/bridge/readygo-pending', 'get');
    return (result && result.pending) ? result.pending : [];
  }

  /**
   * ReadyGo Inbox 投入完了を API に ACK する
   * @param {string[]} ids 配信済みキュー ID の配列
   * @return {Object|null}
   */
  function ackReadyGoDelivered(ids) {
    if (!ids || ids.length === 0) return null;
    return callApi_('/api/bridge/readygo-ack', 'post', { ids: ids });
  }

  /**
   * 過去候補の単価再解析API（notice 20260907-STOCKHOME-006）を呼び出す共通処理。
   * X-Reparse-Run-Token（Script Propertiesの REPARSE_RUN_TOKEN）と
   * 既存の X-Bridge-Token の両方を付与する。
   * runToken・candidateの内容はログへ出さない。
   *
   * @param {string} path 例: '/api/bridge/reparse-candidates?cursor=xxx&limit=20'
   * @param {string} method 'get' | 'post'
   * @param {Object} [payload] POSTボディ
   * @return {{status: 'ok'|'not_found'|'error', body: (Object|null)}}
   *   status='not_found': API URL/Bridge Token/runTokenいずれかが未設定、またはHTTP 404。
   *   status='error': リトライを尽くしても成功しなかった、または404以外の非成功status。
   * @private
   */
  function callReparseApiWithRetry_(path, method, payload) {
    var runToken = PropertiesService.getScriptProperties().getProperty('REPARSE_RUN_TOKEN');
    if (!isConfigured() || !runToken) {
      return { status: 'not_found', body: null };
    }

    var url = getApiUrl().replace(/\/+$/, '') + path;
    var options = {
      method: method,
      headers: {
        'X-Bridge-Token': getBridgeToken(),
        'X-Reparse-Run-Token': runToken
      },
      muteHttpExceptions: true
    };
    if (payload) {
      options.contentType = 'application/json';
      options.payload = JSON.stringify(payload);
    }

    var maxAttempts = 3;
    var backoffMs = [1000, 2000];

    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        var res = UrlFetchApp.fetch(url, options);
        var code = res.getResponseCode();

        if (code >= 200 && code < 300) {
          return { status: 'ok', body: JSON.parse(res.getContentText()) };
        }
        if (code === 404) {
          return { status: 'not_found', body: null };
        }
        if (code >= 500 && attempt < maxAttempts) {
          Logger.log('[ReparseHistorical] API呼び出し失敗(HTTP ' + code + ')、retry ' + (attempt + 1) + '/' + maxAttempts);
          Utilities.sleep(backoffMs[attempt - 1]);
          continue;
        }
        Logger.log('[ReparseHistorical] API呼び出し失敗: HTTP ' + code);
        return { status: 'error', body: null };
      } catch (e) {
        if (attempt < maxAttempts) {
          Logger.log('[ReparseHistorical] API呼び出しで例外、retry ' + (attempt + 1) + '/' + maxAttempts + ': ' + e.message);
          Utilities.sleep(backoffMs[attempt - 1]);
          continue;
        }
        Logger.log('[ReparseHistorical] API呼び出しで例外（retry尽き）: ' + e.message);
        return { status: 'error', body: null };
      }
    }
    return { status: 'error', body: null };
  }

  /**
   * 再解析対象候補を取得する
   * @param {string|null} cursor
   * @param {number} limit
   * @return {{status: 'ok'|'not_found'|'error', candidates: Object[]}}
   */
  function fetchReparseCandidates(cursor, limit) {
    var qs = 'limit=' + encodeURIComponent(limit);
    if (cursor) qs += '&cursor=' + encodeURIComponent(cursor);
    var result = callReparseApiWithRetry_('/api/bridge/reparse-candidates?' + qs, 'get');
    return {
      status: result.status,
      candidates: (result.status === 'ok' && result.body && result.body.candidates) ? result.body.candidates : []
    };
  }

  /**
   * 再解析結果を送信する
   * @param {string} mode 'dry_run' | 'write'
   * @param {Object[]} results
   * @return {{status: 'ok'|'not_found'|'error', summary: (Object|null)}}
   */
  function postReparseResults(mode, results) {
    var result = callReparseApiWithRetry_('/api/bridge/reparse-candidates', 'post', { mode: mode, results: results });
    return {
      status: result.status,
      summary: (result.status === 'ok' && result.body) ? result.body.summary : null
    };
  }

  // 公開API
  return {
    isConfigured: isConfigured,
    postCandidatesToApi: postCandidatesToApi,
    fetchReadyGoPending: fetchReadyGoPending,
    ackReadyGoDelivered: ackReadyGoDelivered,
    fetchReparseCandidates: fetchReparseCandidates,
    postReparseResults: postReparseResults,
    getBridgeToken: getBridgeToken
  };

})();

// ============================================================
// ReadyGo 通知配信（夜間トリガーのハンドラ）
// ============================================================

/**
 * API の配信待ちキューを取得し、ReadyGo Inbox に投入して ACK する
 * 毎晩 20 時台の installable trigger から呼ばれる（createStockHomeNotifyTrigger で作成）
 * 実行ユーザーは ReadyGo スプレッドシートの編集権限を持つこと（旧 runDailyBatch と同じ前提）
 */
function deliverStockHomeNotifications() {
  Logger.log('=== ReadyGo 配信開始 ===');

  var pending = ApiBridge.fetchReadyGoPending();
  if (pending.length === 0) {
    Logger.log('[Deliver] 配信待ちなし');
    return;
  }

  var deliveredIds = [];
  for (var i = 0; i < pending.length; i++) {
    var ok = ReadyGoBotService.appendToInbox(pending[i].body);
    if (ok) {
      deliveredIds.push(pending[i].id);
    } else {
      Logger.log('[Deliver] Inbox 投入失敗: id=' + pending[i].id);
    }
  }

  if (deliveredIds.length > 0) {
    var ack = ApiBridge.ackReadyGoDelivered(deliveredIds);
    Logger.log('[Deliver] 配信 ' + deliveredIds.length + ' 件 / ACK 結果: ' + JSON.stringify(ack));
  }

  Logger.log('=== ReadyGo 配信完了 ===');
}

/**
 * ReadyGo 配信トリガーを作成する（毎晩 20 時台）
 * API の夜間バッチ(19:55)がキューに積んだ後、ReadyGo の 21:00 配信前に動く
 */
function createStockHomeNotifyTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'deliverStockHomeNotifications') {
      Logger.log('ReadyGo 配信トリガーは既に存在します。');
      return;
    }
  }

  ScriptApp.newTrigger('deliverStockHomeNotifications')
    .timeBased()
    .atHour(20)
    .everyDays(1)
    .create();

  Logger.log('ReadyGo 配信トリガーを作成しました（毎晩 20:00〜21:00）');
}

/**
 * ReadyGo 配信トリガーを削除する
 */
function deleteStockHomeNotifyTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  var deleted = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'deliverStockHomeNotifications') {
      ScriptApp.deleteTrigger(triggers[i]);
      deleted++;
    }
  }
  Logger.log('ReadyGo 配信トリガーを ' + deleted + ' 件削除しました。');
}

// ============================================================
// セットアップ・疎通確認（GAS エディタから手動実行）
// ============================================================

/**
 * 初期セットアップ補助（GAS エディタから1回だけ手動実行する）
 *   1. スクリプトプロパティ STOCKHOME_API_URL を設定
 *   2. 旧・日次バッチトリガー（runDailyBatch）を削除（在庫計算・通知判定は API 側に移転）
 *   3. ReadyGo 配信トリガー（deliverStockHomeNotifications、毎晩20時台）を作成
 *
 * ※ STOCKHOME_BRIDGE_TOKEN（秘密情報）はソースに書かないため、
 *    GAS エディタの「プロジェクトの設定 > スクリプト プロパティ」から手動で追加すること。
 *    値は VPS の ~/stockhome/.env の BRIDGE_TOKEN と同じ。
 */
function setupStockHomeBridge() {
  PropertiesService.getScriptProperties()
    .setProperty('STOCKHOME_API_URL', 'http://219.94.251.235:4002');
  Logger.log('STOCKHOME_API_URL を設定しました');

  deleteDailyBatchTrigger();
  createStockHomeNotifyTrigger();

  if (!ApiBridge.getBridgeToken()) {
    Logger.log('⚠ STOCKHOME_BRIDGE_TOKEN が未設定です。スクリプトプロパティに手動で追加してください。');
  } else {
    Logger.log('セットアップ完了。testStockHomeBridge() で疎通確認できます。');
  }
}

/**
 * Gmail 取込の強制再スキャン（GAS エディタから手動実行。検証用）
 * 前回取込日時をクリアして過去30日分を再スキャンし、API へ送信する。
 * 既に取込済みのメールは API 側で mail_message_id により重複排除されるため、
 * データは二重登録されない（レスポンスの duplicates として報告されるだけ）。
 */
function forceRescanGmailImport() {
  PropertiesService.getUserProperties().deleteProperty('gmail_import_last_run_at');
  Logger.log('前回取込日時をクリアしました。過去30日分を再スキャンします...');
  runMyGmailImport();
}

/**
 * API への疎通確認（GAS エディタから手動実行）
 * GET /api/bridge/health をトークン付きで呼び、結果をログに出す
 */
function testStockHomeBridge() {
  if (!ApiBridge.isConfigured()) {
    Logger.log('NG: スクリプトプロパティ未設定。STOCKHOME_API_URL / STOCKHOME_BRIDGE_TOKEN を確認してください。');
    return;
  }
  var url = PropertiesService.getScriptProperties()
    .getProperty('STOCKHOME_API_URL').replace(/\/+$/, '') + '/api/bridge/health';
  var res = UrlFetchApp.fetch(url, {
    headers: { 'X-Bridge-Token': ApiBridge.getBridgeToken() },
    muteHttpExceptions: true
  });
  Logger.log('HTTP ' + res.getResponseCode() + ' | ' + res.getContentText());
  Logger.log(res.getResponseCode() === 200 ? 'OK: API と疎通できました' : 'NG: 上記レスポンスを確認してください');
}
