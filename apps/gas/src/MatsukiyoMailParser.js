/**
 * MatsukiyoMailParser.gs
 * マツキヨオンラインのメールを解析して取込候補を生成する
 *
 * 仕様書 Section 10.2, 10.4 準拠
 *
 * 対象:
 *   - 注文確認メール
 *   - 商品発送のお知らせ系メール
 *
 * 設計方針:
 *   - AmazonMailParser と同じインタフェース（parse 関数）
 *   - 正規表現を配列で管理し、後から追加・調整しやすくする
 *   - マツキヨのメール形式はシンプルな傾向なので Amazon より取りやすい想定
 *   - 取れない情報があっても候補は生成する
 *
 * 対象メール送信元:
 *   - *@matsukiyococokara.com （マツキヨココカラオンライン、現行）
 *   - *@matsukiyo.co.jp （旧ドメイン）
 */

var MatsukiyoMailParser = (function() {

  // ============================================================
  // 件名パターン定義
  // ============================================================

  /** 注文確認メールの件名パターン */
  var ORDER_SUBJECT_PATTERNS = [
    /ご注文.*確認/i,
    /ご注文.*ありがとう/i,
    /ご注文.*受付/i,
    /マツモトキヨシ.*注文/i,
    /matsukiyo.*注文/i,
    /ご注文内容/i,
    // 2026-09確認: 「ご注文完了のご連絡」件名も注文確認メールとして扱う。
    // この明細（[本体価格]表記）だけが単価を含み、発送通知メールには価格情報が
    // 一切無いため、この件名を対象外にすると単価を取得する手段が失われる
    /ご注文完了/i
  ];

  /** 発送通知メールの件名パターン */
  var SHIPMENT_SUBJECT_PATTERNS = [
    /発送.*お知らせ/i,
    /商品.*発送/i,
    /出荷.*お知らせ/i,
    /配送.*お知らせ/i,
    /お届け.*お知らせ/i,
    /マツモトキヨシ.*発送/i,
    /マツキヨココカラ.*発送/i
  ];

  // ============================================================
  // 本文パターン定義
  // ============================================================

  /** 注文番号の抽出パターン */
  var ORDER_ID_PATTERNS = [
    /注文番号[:\s#：]*([A-Za-z0-9\-]+)/,
    /受注番号[:\s#：]*([A-Za-z0-9\-]+)/,
    /オーダー番号[:\s#：]*([A-Za-z0-9\-]+)/,
    /ご注文番号[:\s#：]*([A-Za-z0-9\-]+)/,
    // 2026-09確認: 「【注文番号】1003044274」のように全角の【】でラベルを
    // 囲む形式（ご注文完了メール）。上記パターンは「】」の直後に値が続く場合を
    // 拾えないため別途追加する
    /【注文番号】\s*([A-Za-z0-9\-]+)/
  ];

  /** 商品名の抽出パターン */
  var ITEM_NAME_PATTERNS = [
    // 「商品名：○○○」形式
    /(?:商品名|品名)[:\s：]+(.+?)(?:\n|$)/,
    // 「商品[:\s]○○○」形式
    /商品[:\s：]+(.+?)(?:\n|$)/,
    // テーブル行風: 「○○○  数量 N」
    /^(.{3,100})\s{2,}(?:数量|個数)[:\s：]*\d+/m
  ];

  /** 数量の抽出パターン */
  var QTY_PATTERNS = [
    /数量[:\s：]*(\d+)/,
    /個数[:\s：]*(\d+)/,
    /(\d+)\s*[点個個数]/,
    /×\s*(\d+)/
  ];

  /** 金額の抽出パターン */
  var PRICE_PATTERNS = [
    /[￥¥]\s*([0-9,]+)/,
    /(\d{1,3}(?:,\d{3})*)\s*円/,
    /税込[:\s：]*[￥¥]?\s*([0-9,]+)/,
    /小計[:\s：]*[￥¥]?\s*([0-9,]+)/
  ];

  // ============================================================
  // メイン: parse 関数
  // ============================================================

  /**
   * メールを解析して候補情報を返す
   *
   * GmailImportService から呼ばれる統一インタフェース。
   * AmazonMailParser.parse と同じ戻り値構造。
   *
   * @param {string} subject メール件名
   * @param {string} body メール本文（プレーンテキスト）
   * @param {Date} mailDate メール日付
   * @return {Object|null} パース結果
   *   - mail_type {string}
   *   - mail_phase {string}
   *   - items {Object[]}
   */
  function parse(subject, body, mailDate) {
    // 1. mail_type 判定
    var mailType = detectMailType_(subject);
    if (mailType === ENUMS.MAIL_TYPE.OTHER) {
      return null;
    }

    // 2. mail_phase 判定
    var mailPhase;
    if (mailType === ENUMS.MAIL_TYPE.ORDER_CONFIRM) {
      mailPhase = ENUMS.MAIL_PHASE.ORDERED;
    } else if (mailType === ENUMS.MAIL_TYPE.SHIPMENT) {
      mailPhase = ENUMS.MAIL_PHASE.SHIPPED;
    } else {
      mailPhase = ENUMS.MAIL_PHASE.OTHER;
    }

    // 3. 注文番号を抽出
    var orderId = extractFirst_(body, ORDER_ID_PATTERNS) || '';

    // 4. 商品情報を抽出
    var items = extractItems_(body, orderId);

    // 商品が1つも取れなかった場合、件名をフォールバックにする。
    // このとき金額は取らない: 商品が特定できていない以上、本文全体の先頭金額は
    // 注文合計や別商品の値であり「1セットの単価」として意味を成さないため
    // （実データで item_name_raw が配送先ブロックになった候補に注文合計とみられる
    //   5207 円・547 円が入る事例を確認）
    if (items.length === 0) {
      items.push({
        order_id: orderId,
        item_name_raw: subject,
        detected_qty: 1,
        detected_price: '',
        price_context: '',
        price_source: 'なし(商品未特定)',
        parse_note: '商品名を本文から抽出できず件名を使用／価格:なし(商品未特定)'
      });
    }

    return {
      mail_type: mailType,
      mail_phase: mailPhase,
      items: items
    };
  }

  // ============================================================
  // 内部ヘルパー
  // ============================================================

  /**
   * 件名から mail_type を判定する
   * @param {string} subject
   * @return {string}
   * @private
   */
  function detectMailType_(subject) {
    for (var i = 0; i < SHIPMENT_SUBJECT_PATTERNS.length; i++) {
      if (SHIPMENT_SUBJECT_PATTERNS[i].test(subject)) {
        return ENUMS.MAIL_TYPE.SHIPMENT;
      }
    }
    for (var j = 0; j < ORDER_SUBJECT_PATTERNS.length; j++) {
      if (ORDER_SUBJECT_PATTERNS[j].test(subject)) {
        return ENUMS.MAIL_TYPE.ORDER_CONFIRM;
      }
    }
    return ENUMS.MAIL_TYPE.OTHER;
  }

  /** PRICE_PATTERNS と同順の抽出元ラベル（どの経路で拾った金額かを候補に残す） */
  var PRICE_SOURCE_LABELS = ['￥表記', '円表記', '税込', '小計'];

  /**
   * 金額を抽出し、どのパターンで拾ったかと周辺テキストも併せて返す
   *
   * 「1セットの単価」なのか明細小計なのかは金額単体では判別できない。
   * とくに小計にマッチした金額は単価ではないため、抽出元ラベルと前後の文脈を
   * 候補に残して後から検証・改修できるようにする。
   *
   * @param {string} text 探索対象
   * @return {{value: string, source: string, context: string}}
   * @private
   */
  function extractPriceWithContext_(text) {
    for (var i = 0; i < PRICE_PATTERNS.length; i++) {
      var m = text.match(PRICE_PATTERNS[i]);
      if (m && m[1]) {
        return {
          value: m[1].trim(),
          source: priceSourceLabel_(text, m.index, PRICE_SOURCE_LABELS[i]),
          context: priceContext_(text, m.index)
        };
      }
    }
    return { value: '', source: 'なし', context: '' };
  }

  /**
   * 金額の直前にあるラベルから抽出元の種別を判定する
   *
   * PRICE_PATTERNS は汎用パターン（￥表記・円表記）が先に並ぶため、
   * 「小計：1,200円」のような明細合計も汎用パターンで先にマッチしてしまう。
   * パターンの並び替えは抽出値自体を悪化させる（単価と小計が併記されたブロックで
   * 小計を優先して拾ってしまう）ため、値は変えずにラベルだけ直前の文言で補正する。
   *
   * @param {string} text 探索対象
   * @param {number} matchIdx 金額のマッチ開始位置
   * @param {string} fallbackLabel パターン由来の既定ラベル
   * @return {string} 抽出元ラベル
   * @private
   */
  function priceSourceLabel_(text, matchIdx, fallbackLabel) {
    var before = text.substring(Math.max(0, matchIdx - 12), matchIdx);
    if (/小計/.test(before)) return '小計';
    if (/合計|総額|ご請求/.test(before)) return '合計';
    if (/送料/.test(before)) return '送料';
    if (/税込/.test(before)) return '税込';
    return fallbackLabel || 'その他';
  }

  /**
   * 金額を検出した位置の周辺テキストを抜き出す
   * @param {string} text 金額を検出した対象テキスト
   * @param {number} matchIdx 金額のマッチ開始位置
   * @return {string} 前後を切り出した文脈（改行・連続空白は圧縮）
   * @private
   */
  function priceContext_(text, matchIdx) {
    var BEFORE = 80;
    var AFTER = 60;
    var start = Math.max(0, matchIdx - BEFORE);
    var end = Math.min(text.length, matchIdx + AFTER);
    return text.substring(start, end).replace(/\s+/g, ' ').trim();
  }

  /**
   * パターン配列から最初にマッチしたグループ1を返す
   * @param {string} text
   * @param {RegExp[]} patterns
   * @return {string|null}
   * @private
   */
  function extractFirst_(text, patterns) {
    for (var i = 0; i < patterns.length; i++) {
      var m = text.match(patterns[i]);
      if (m && m[1]) {
        return m[1].trim();
      }
    }
    return null;
  }

  /**
   * 本文から商品情報を抽出する
   *
   * マツキヨのメールは Amazon ほど複雑でないことが多い。
   * 複数商品を含む場合にも対応する。
   *
   * @param {string} body
   * @param {string} orderId
   * @return {Object[]}
   * @private
   */
  function extractItems_(body, orderId) {
    var items = [];

    // 方式0: 「JANコード：商品名 / [本体価格]：￥N / [数量]：N」ブロック抽出
    // 2026-09、「ご注文完了のご連絡」メールの明細形式で確認。[本体価格] は
    // 数量に関わらず1個あたりの単価そのもの（[合計] とは別に明記されている）。
    // 発送通知メールにはこの価格情報が一切存在しないため、単価を取得できる
    // 唯一の経路がこの注文確認メールになる
    items = extractJanBlockItems_(body, orderId);
    if (items.length > 0) {
      return items;
    }

    // 方式1: 「商品名：X」「数量：N個」のペア抽出
    // マツキヨのメールは商品ごとに商品名行と数量行が交互に並ぶ。
    items = extractPairedItems_(body, orderId);
    if (items.length > 0) {
      return items;
    }

    // 方式2: 区切り線ベースのヒューリスティクス
    // マツキヨのメールは「---」「===」「■」で商品ブロックを区切ることがある
    var blocks = body.split(/[-=]{3,}|■/);
    for (var b = 0; b < blocks.length; b++) {
      var block = blocks[b].trim();
      if (block.length < 5 || block.length > 500) continue;

      // ブロック内に「数量」「個」があれば商品ブロックとみなす
      if (/数量|個数|[×x]\s*\d/.test(block)) {
        var blockName = extractItemNameFromBlock_(block);
        if (blockName) {
          var blockQty = parseInt(extractFirst_(block, QTY_PATTERNS) || '1', 10) || 1;
          var blockPrice = extractPriceWithContext_(block);
          items.push({
            order_id: orderId,
            item_name_raw: cleanItemName_(blockName),
            detected_qty: blockQty,
            detected_price: blockPrice.value,
            price_context: blockPrice.context,
            price_source: blockPrice.source,
            parse_note: 'ブロック抽出／価格:' + blockPrice.source
          });
        }
      }
    }

    // 重複除去
    var seen = {};
    var unique = [];
    for (var j = 0; j < items.length; j++) {
      var key = items[j].item_name_raw;
      if (!seen[key]) {
        seen[key] = true;
        unique.push(items[j]);
      }
    }

    return unique;
  }

  /**
   * 「JANコード：商品名」行を起点に、直後の「[本体価格]：￥N」「[数量]：N」を
   * 拾ってブロックを抽出する
   *
   * 実データ形式（2026-09確認、ご注文完了メール）:
   *   4901750140045：スコッティフラワーパック ３倍長持ち ４Ｒ Ｓ
   *   [本体価格]：￥470
   *   [税率]：10%
   *   [数量]：2
   *   [合計]：￥940
   * [本体価格] は１個あたりの単価そのものであり、[合計]（小計）とは別に明記
   * されているため、数量が2以上でも単価か小計かを判別する必要がない。
   *
   * @param {string} body
   * @param {string} orderId
   * @return {Object[]}
   * @private
   */
  function extractJanBlockItems_(body, orderId) {
    var lines = body.split(/\r?\n/);
    var itemLines = [];
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(/^\s*\d{8,14}[：:]\s*(.+?)\s*$/);
      if (m) itemLines.push({ idx: i, name: m[1] });
    }
    if (itemLines.length === 0) return [];

    var items = [];
    for (var k = 0; k < itemLines.length; k++) {
      var start = itemLines[k].idx + 1;
      var end = Math.min(
        k + 1 < itemLines.length ? itemLines[k + 1].idx : lines.length,
        start + 8
      );
      var qty = null;
      var price = null;

      for (var j = start; j < end; j++) {
        var line = lines[j];
        var pm = line.match(/\[本体価格\][：:]\s*[￥¥]?\s*([0-9,]+)/);
        if (pm) price = pm[1];
        var qm = line.match(/\[数量\][：:]\s*(\d+)/);
        if (qm) qty = parseInt(qm[1], 10) || 1;
      }

      // JANコードに似た数字列（電話番号等）を誤って商品行と扱わないためのガード:
      // このテンプレートの商品行には必ず [本体価格] か [数量] が続く
      if (qty === null && price === null) continue;

      items.push({
        order_id: orderId,
        item_name_raw: cleanItemName_(itemLines[k].name),
        detected_qty: qty || 1,
        detected_price: price || '',
        price_context: price ? ('本体価格：￥' + price) : '',
        price_source: price ? '本体価格' : 'なし',
        parse_note: 'JANブロック抽出／価格:' + (price ? '本体価格(単価確定)' : 'なし')
      });
    }
    return items;
  }

  /**
   * 「商品名：X」行と「数量：N」行のペアを走査して商品配列を作る
   *
   * マツキヨのメールは商品ごとに
   *   商品名：XXX
   *   数量：N個
   * が繰り返される形式が多い。行単位で歩くことで
   * 複数商品それぞれの数量を正しく対応付ける。
   *
   * @param {string} body
   * @param {string} orderId
   * @return {Object[]}
   * @private
   */
  function extractPairedItems_(body, orderId) {
    var lines = body.split(/\r?\n/);
    var items = [];
    var pendingName = null;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var nameMatch = line.match(/^\s*(?:商品名|品名)[:\s：]+(.+?)\s*$/);
      if (nameMatch && nameMatch[1]) {
        // 直前に数量未検出の商品名が残っていれば数量1で確定する
        if (pendingName) {
          items.push({
            order_id: orderId,
            item_name_raw: cleanItemName_(pendingName),
            detected_qty: 1,
            detected_price: '',
            price_context: '',
            price_source: 'なし',
            parse_note: 'ペア抽出(数量未検出)／価格:なし'
          });
        }
        pendingName = nameMatch[1].trim();
        continue;
      }
      var qtyMatch = line.match(/^\s*(?:数量|個数)[:\s：]+(\d+)/);
      if (qtyMatch && pendingName) {
        items.push({
          order_id: orderId,
          item_name_raw: cleanItemName_(pendingName),
          detected_qty: parseInt(qtyMatch[1], 10) || 1,
          detected_price: '',
          price_context: '',
          price_source: 'なし',
          parse_note: 'ペア抽出／価格:なし'
        });
        pendingName = null;
      }
    }

    // 最後まで残った商品名は数量1で確定する
    if (pendingName) {
      items.push({
        order_id: orderId,
        item_name_raw: cleanItemName_(pendingName),
        detected_qty: 1,
        detected_price: '',
        price_context: '',
        price_source: 'なし',
        parse_note: 'ペア抽出(数量未検出)／価格:なし'
      });
    }

    return items;
  }

  /**
   * テキストブロックから商品名を推定する
   * @param {string} block
   * @return {string|null}
   * @private
   */
  function extractItemNameFromBlock_(block) {
    // 最初の非空白行で、ラベルっぽくないものを商品名とする
    var lines = block.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.length < 3) continue;
      // ラベル行（「注文番号」「小計」「合計」など）はスキップ
      if (/^(注文|受注|小計|合計|送料|税|お届け|配送|支払|数量|個数|金額|価格)/.test(line)) continue;
      // 数値だけの行はスキップ
      if (/^[0-9,￥¥\s]+$/.test(line)) continue;
      return line;
    }
    return null;
  }

  /**
   * パターン配列でマッチした全結果（グループ1）を返す
   * @param {string} text
   * @param {RegExp[]} patterns
   * @return {string[]}
   * @private
   */
  function extractAllMatches_(text, patterns) {
    var results = [];
    for (var i = 0; i < patterns.length; i++) {
      // グローバルフラグを追加して全マッチ
      var globalPattern = new RegExp(patterns[i].source, 'gm');
      var m;
      while ((m = globalPattern.exec(text)) !== null) {
        if (m[1]) {
          results.push(m[1].trim());
        }
      }
      if (results.length > 0) break; // 最初にマッチしたパターンで十分
    }
    return results;
  }

  /**
   * 商品名のクリーンアップ
   * @param {string} name
   * @return {string}
   * @private
   */
  function cleanItemName_(name) {
    if (!name) return '';
    return name
      .replace(/^\s*[・\-\*]\s*/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 200);
  }

  // 公開API
  return {
    parse: parse
  };

})();
