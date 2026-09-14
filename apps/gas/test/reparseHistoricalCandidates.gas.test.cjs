/**
 * このfileはGASへdeployされない。ローカル検証専用。
 *
 * ApiBridge.js と GmailImportService.js を node:vm へ読み込み、Apps Script APIを
 * 合成mockへ置き換えて、過去候補再解析の回帰シナリオを検証する。
 */
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC_DIR = path.resolve(__dirname, '..', 'src');
const apiBridgeSource = fs.readFileSync(path.join(SRC_DIR, 'ApiBridge.js'), 'utf8');
const gmailImportSource = fs.readFileSync(path.join(SRC_DIR, 'GmailImportService.js'), 'utf8');
const amazonParserSource = fs.readFileSync(path.join(SRC_DIR, 'AmazonMailParser.js'), 'utf8');
const matsukiyoParserSource = fs.readFileSync(path.join(SRC_DIR, 'MatsukiyoMailParser.js'), 'utf8');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function httpResponse(code, body) {
  return {
    getResponseCode: () => code,
    getContentText: () => JSON.stringify(body),
  };
}

function cursorKey(runToken, mode) {
  return `REPARSE_CURSOR_${mode}_${crypto.createHash('sha256').update(runToken).digest('hex').slice(0, 16)}`;
}

function candidate(id, overrides = {}) {
  return {
    id,
    mailMessageId: `message-${id}`,
    itemNameRaw: `item-${id}`,
    vendor: 'amazon',
    mailPhase: 'ordered',
    ...overrides,
  };
}

function message(subject = 'subject', body = 'body') {
  return {
    getSubject: () => subject,
    getPlainBody: () => body,
    getDate: () => new Date('2026-09-01T00:00:00.000Z'),
  };
}

function createHarness(options = {}) {
  const initialProperties = {
    STOCKHOME_API_URL: 'https://stockhome.invalid',
    STOCKHOME_BRIDGE_TOKEN: 'synthetic-bridge-credential',
    REPARSE_RUN_TOKEN: 'synthetic-run-credential',
    ...(options.properties || {}),
  };
  const properties = new Map(Object.entries(initialProperties).filter(([, value]) => value != null));
  const logs = [];
  const fetchCalls = [];
  const sleepCalls = [];
  const lockState = { released: 0 };
  const propertyApi = {
    getProperty: (key) => properties.get(key) ?? null,
    setProperty: (key, value) => {
      properties.set(key, String(value));
      return propertyApi;
    },
    deleteProperty: (key) => {
      properties.delete(key);
      return propertyApi;
    },
  };

  const context = {
    console,
    PropertiesService: { getScriptProperties: () => propertyApi },
    UrlFetchApp: {
      fetch: (url, requestOptions) => {
        fetchCalls.push({ url, options: requestOptions });
        if (!options.fetch) throw new Error('unexpected UrlFetchApp.fetch call');
        return options.fetch(url, requestOptions, fetchCalls.length);
      },
    },
    GmailApp: {
      getMessageById: (id) => {
        if (options.getMessageById) return options.getMessageById(id);
        return message(id, 'body');
      },
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => options.lockAcquired !== false,
        releaseLock: () => { lockState.released += 1; },
      }),
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      computeDigest: (_algorithm, value) => Array.from(
        crypto.createHash('sha256').update(String(value)).digest(),
        (byte) => (byte > 127 ? byte - 256 : byte)
      ),
      sleep: (ms) => { sleepCalls.push(ms); },
    },
    Logger: { log: (...args) => { logs.push(args.map(String).join(' ')); } },
    ENUMS: {
      EXTERNAL_VENDOR: { AMAZON: 'amazon', MATSUKIYO: 'matsukiyo' },
      MAIL_TYPE: { ORDER_CONFIRM: 'order_confirm', SHIPMENT: 'shipment', OTHER: 'other' },
      MAIL_PHASE: { ORDERED: 'ordered', SHIPPED: 'shipped', OTHER: 'other' },
    },
    AmazonMailParser: {
      parse: options.amazonParse || ((_subject, _body) => ({
        items: [{ item_name_raw: 'item-c1', detected_price: '500', price_source: '本体価格' }],
      })),
    },
    MatsukiyoMailParser: {
      parse: options.matsukiyoParse || ((_subject, _body) => ({ items: [] })),
    },
    toStr: (value) => (value == null ? '' : String(value).trim()),
  };

  vm.createContext(context);
  if (options.realParsers) {
    vm.runInContext(amazonParserSource, context, { filename: 'AmazonMailParser.js' });
    vm.runInContext(matsukiyoParserSource, context, { filename: 'MatsukiyoMailParser.js' });
  }
  vm.runInContext(apiBridgeSource, context, { filename: 'ApiBridge.js' });
  vm.runInContext(gmailImportSource, context, { filename: 'GmailImportService.js' });

  return { context, properties, propertyApi, logs, fetchCalls, sleepCalls, lockState };
}

function installServiceApi(harness, options = {}) {
  const fetchInputs = [];
  const posts = [];
  let progressCalls = 0;
  const pages = [...(options.pages || [])];
  const api = {
    fetchReparseCandidates: (cursor, limit) => {
      fetchInputs.push({ cursor, limit });
      return pages.length ? pages.shift() : { status: 'not_found', candidates: [] };
    },
    postReparseResults: (mode, results) => {
      posts.push({ mode, results });
      return options.postResult || { status: 'ok', summary: { total: results.length } };
    },
    fetchReparseProgress: () => {
      progressCalls += 1;
      return options.progressResult || {
        status: 'ok',
        progress: { totalTargets: 0, processedCount: 0, remainingCount: 0, complete: true },
      };
    },
  };
  harness.context.ApiBridge = api;
  return { api, fetchInputs, posts, get progressCalls() { return progressCalls; } };
}

test('01 write wrapper sends mode=write', () => {
  const h = createHarness({ amazonParse: () => ({ items: [{ item_name_raw: 'item-c1', detected_price: '500' }] }) });
  const calls = installServiceApi(h, {
    pages: [{ status: 'ok', candidates: [candidate('c1')] }, { status: 'ok', candidates: [] }],
  });
  const result = h.context.reparseHistoricalCandidatesWrite();
  assert.equal(result.stoppedReason, 'complete');
  assert.equal(calls.posts.length, 1);
  assert.equal(calls.posts[0].mode, 'write');
});

test('02 dry-run and write cursors are isolated', () => {
  const h = createHarness({ amazonParse: () => ({ items: [{ item_name_raw: 'item-c1' }] }) });
  const dryCalls = installServiceApi(h, {
    pages: [{ status: 'ok', candidates: [candidate('c1')] }, { status: 'not_found', candidates: [] }],
  });
  assert.equal(h.context.reparseHistoricalCandidatesDryRun().stoppedReason, 'not_found');
  assert.equal(dryCalls.fetchInputs[0].cursor, null);
  const writeCalls = installServiceApi(h, { pages: [{ status: 'not_found', candidates: [] }] });
  assert.equal(h.context.reparseHistoricalCandidatesWrite().stoppedReason, 'not_found');
  assert.equal(writeCalls.fetchInputs[0].cursor, null);
  assert.equal(h.properties.get(cursorKey('synthetic-run-credential', 'dry_run')), 'c1');
  assert.equal(h.properties.has(cursorKey('synthetic-run-credential', 'write')), false);
});

test('03 different run tokens use different cursor keys', () => {
  const h = createHarness({ amazonParse: () => ({ items: [{ item_name_raw: 'item-c1' }] }) });
  installServiceApi(h, {
    pages: [{ status: 'ok', candidates: [candidate('c1')] }, { status: 'not_found', candidates: [] }],
  });
  h.context.reparseHistoricalCandidatesDryRun();
  h.propertyApi.setProperty('REPARSE_RUN_TOKEN', 'second-synthetic-run');
  const second = installServiceApi(h, {
    pages: [{ status: 'ok', candidates: [candidate('c2', { itemNameRaw: 'item-c1' })] }, { status: 'not_found', candidates: [] }],
  });
  h.context.reparseHistoricalCandidatesDryRun();
  assert.equal(second.fetchInputs[0].cursor, null);
  assert.equal(h.properties.get(cursorKey('synthetic-run-credential', 'dry_run')), 'c1');
  assert.equal(h.properties.get(cursorKey('second-synthetic-run', 'dry_run')), 'c2');
});

test('04 write completion deletes cursor after complete progress', () => {
  const token = 'write-complete-run';
  const key = cursorKey(token, 'write');
  const h = createHarness({ properties: { REPARSE_RUN_TOKEN: token, [key]: 'saved-cursor' } });
  const calls = installServiceApi(h, { pages: [{ status: 'ok', candidates: [] }] });
  const result = h.context.reparseHistoricalCandidatesWrite();
  assert.equal(result.stoppedReason, 'complete');
  assert.equal(calls.progressCalls, 1);
  assert.equal(h.properties.has(key), false);
});

test('05 write progress mismatch or failure preserves cursor', () => {
  for (const progressResult of [
    { status: 'ok', progress: { totalTargets: 1, processedCount: 0, remainingCount: 1, complete: false } },
    { status: 'error', progress: null },
  ]) {
    const token = `write-mismatch-${progressResult.status}`;
    const key = cursorKey(token, 'write');
    const h = createHarness({ properties: { REPARSE_RUN_TOKEN: token, [key]: 'saved-cursor' } });
    installServiceApi(h, { pages: [{ status: 'ok', candidates: [] }], progressResult });
    assert.equal(h.context.reparseHistoricalCandidatesWrite().stoppedReason, 'progress_mismatch');
    assert.equal(h.properties.get(key), 'saved-cursor');
  }
});

test('06 dry-run completion skips progress lookup', () => {
  const token = 'dry-complete-run';
  const key = cursorKey(token, 'dry_run');
  const h = createHarness({ properties: { REPARSE_RUN_TOKEN: token, [key]: 'saved-cursor' } });
  const calls = installServiceApi(h, { pages: [{ status: 'ok', candidates: [] }] });
  assert.equal(h.context.reparseHistoricalCandidatesDryRun().stoppedReason, 'complete');
  assert.equal(calls.progressCalls, 0);
  assert.equal(h.properties.has(key), false);
});

test('07 fetch exception message is excluded from GAS logs', () => {
  const marker = 'SENSITIVE_FETCH_EXCEPTION_MARKER';
  const h = createHarness({ fetch: () => { throw new Error(`temporary failure ${marker}`); } });
  assert.equal(h.context.ApiBridge.fetchReparseCandidates(null, 20).status, 'error');
  assert.equal(h.fetchCalls.length, 3);
  assert.equal(h.logs.join('\n').includes(marker), false);
});

test('08 malformed candidate response is an error', () => {
  const h = createHarness({ fetch: () => httpResponse(200, { unexpected: true }) });
  const result = h.context.ApiBridge.fetchReparseCandidates(null, 20);
  assert.equal(result.status, 'error');
  assert.equal(result.candidates.length, 0);
});

test('09 malformed result response is an error', () => {
  for (const body of [{ unexpected: true }, { summary: 'not-an-object' }]) {
    const h = createHarness({ fetch: () => httpResponse(200, body) });
    assert.equal(h.context.ApiBridge.postReparseResults('dry_run', []).status, 'error');
  }
});

test('10 malformed progress response is an error', () => {
  const h = createHarness({
    fetch: () => httpResponse(200, { totalTargets: '1', processedCount: 0, remainingCount: 1, complete: false }),
  });
  assert.equal(h.context.ApiBridge.fetchReparseProgress().status, 'error');
});

test('11 transient Gmail failure aborts the chunk without POST', () => {
  const h = createHarness({ getMessageById: () => { throw new Error('synthetic temporary service failure'); } });
  const calls = installServiceApi(h, { pages: [{ status: 'ok', candidates: [candidate('c1')] }] });
  const result = h.context.reparseHistoricalCandidatesDryRun();
  assert.equal(result.stoppedReason, 'chunk_aborted');
  assert.equal(calls.posts.length, 0);
});

test('12 invalid message id remains a permanent skip', () => {
  const h = createHarness({ getMessageById: () => { throw new Error('Invalid argument: id'); } });
  const calls = installServiceApi(h, {
    pages: [{ status: 'ok', candidates: [candidate('c1')] }, { status: 'ok', candidates: [] }],
  });
  assert.equal(h.context.reparseHistoricalCandidatesDryRun().stoppedReason, 'complete');
  assert.equal(calls.posts.length, 1);
  assert.equal(calls.posts[0].results[0].skipReason, 'message_not_found');
});

test('13 parser exception aborts the chunk without POST', () => {
  const h = createHarness({ amazonParse: () => { throw new Error('synthetic parser failure'); } });
  const calls = installServiceApi(h, { pages: [{ status: 'ok', candidates: [candidate('c1')] }] });
  assert.equal(h.context.reparseHistoricalCandidatesDryRun().stoppedReason, 'chunk_aborted');
  assert.equal(calls.posts.length, 0);
});

test('14 deterministic zero and multiple matches remain permanent skips', () => {
  const h = createHarness({
    getMessageById: (id) => message(id, 'body'),
    amazonParse: (subject) => subject === 'message-zero'
      ? { items: [] }
      : { items: [
          { item_name_raw: 'duplicate-name', detected_price: '100' },
          { item_name_raw: 'duplicate-name', detected_price: '200' },
        ] },
  });
  const calls = installServiceApi(h, {
    pages: [{ status: 'ok', candidates: [
      candidate('zero', { mailMessageId: 'message-zero' }),
      candidate('many', { mailMessageId: 'message-many', itemNameRaw: 'duplicate-name' }),
    ] }, { status: 'ok', candidates: [] }],
  });
  h.context.reparseHistoricalCandidatesDryRun();
  assert.equal(calls.posts[0].results[0].skipReason, 'item_not_found_in_reparse');
  assert.equal(calls.posts[0].results[1].skipReason, 'ambiguous_item_match');
});

test('15 later indeterminate candidate prevents partial POST', () => {
  const h = createHarness({
    getMessageById: (id) => {
      if (id === 'message-c2') throw new Error('temporary quota failure');
      return message(id, 'body');
    },
    amazonParse: () => ({ items: [{ item_name_raw: 'item-c1', detected_price: '500' }] }),
  });
  const calls = installServiceApi(h, {
    pages: [{ status: 'ok', candidates: [candidate('c1'), candidate('c2')] }],
  });
  assert.equal(h.context.reparseHistoricalCandidatesDryRun().stoppedReason, 'chunk_aborted');
  assert.equal(calls.posts.length, 0);
});

test('16 normal multi-page processing advances cursor', () => {
  const h = createHarness({
    amazonParse: (_subject, body) => ({ items: [{ item_name_raw: body, detected_price: '500' }] }),
    getMessageById: (id) => message(id, id === 'message-c1' ? 'item-c1' : 'item-c2'),
  });
  const calls = installServiceApi(h, {
    pages: [
      { status: 'ok', candidates: [candidate('c1')] },
      { status: 'ok', candidates: [candidate('c2')] },
      { status: 'ok', candidates: [] },
    ],
  });
  const result = h.context.reparseHistoricalCandidatesDryRun();
  assert.equal(result.stoppedReason, 'complete');
  assert.equal(result.pagesProcessed, 2);
  assert.equal(calls.fetchInputs[0].cursor, null);
  assert.equal(calls.fetchInputs[1].cursor, 'c1');
  assert.equal(calls.fetchInputs[2].cursor, 'c2');
});

test('17 HTTP 404 stops immediately without changing cursor', () => {
  const token = 'not-found-run';
  const key = cursorKey(token, 'dry_run');
  const h = createHarness({ properties: { REPARSE_RUN_TOKEN: token, [key]: 'saved-cursor' } });
  const calls = installServiceApi(h, { pages: [{ status: 'not_found', candidates: [] }] });
  assert.equal(h.context.reparseHistoricalCandidatesDryRun().stoppedReason, 'not_found');
  assert.equal(calls.posts.length, 0);
  assert.equal(h.properties.get(key), 'saved-cursor');
});

test('18 HTTP 5xx retries recover or exhaust safely', () => {
  const recovered = createHarness({
    fetch: (_url, _options, callNumber) => callNumber < 3
      ? httpResponse(503, { message: 'unavailable' })
      : httpResponse(200, { candidates: [] }),
  });
  assert.equal(recovered.context.ApiBridge.fetchReparseCandidates(null, 20).status, 'ok');
  assert.equal(recovered.fetchCalls.length, 3);
  assert.deepEqual(recovered.sleepCalls, [1000, 2000]);

  const exhausted = createHarness({ fetch: () => httpResponse(503, { message: 'unavailable' }) });
  assert.equal(exhausted.context.ApiBridge.fetchReparseCandidates(null, 20).status, 'error');
  assert.equal(exhausted.fetchCalls.length, 3);
  assert.deepEqual(exhausted.sleepCalls, [1000, 2000]);
});

test('19 POST failure leaves cursor unchanged', () => {
  const token = 'post-failure-run';
  const key = cursorKey(token, 'dry_run');
  const h = createHarness({
    properties: { REPARSE_RUN_TOKEN: token, [key]: 'saved-cursor' },
    amazonParse: () => ({ items: [{ item_name_raw: 'item-c1' }] }),
  });
  installServiceApi(h, {
    pages: [{ status: 'ok', candidates: [candidate('c1')] }],
    postResult: { status: 'error', summary: null },
  });
  assert.equal(h.context.reparseHistoricalCandidatesDryRun().stoppedReason, 'post_error');
  assert.equal(h.properties.get(key), 'saved-cursor');
});

test('20 missing run token and lock contention make no external calls', () => {
  const noToken = createHarness({ properties: { REPARSE_RUN_TOKEN: null } });
  const noTokenCalls = installServiceApi(noToken, { pages: [{ status: 'ok', candidates: [candidate('c1')] }] });
  assert.equal(noToken.context.reparseHistoricalCandidatesDryRun().stoppedReason, 'no_run_token');
  assert.equal(noTokenCalls.fetchInputs.length, 0);
  assert.equal(noTokenCalls.posts.length, 0);

  const locked = createHarness({ lockAcquired: false });
  const lockedCalls = installServiceApi(locked, { pages: [{ status: 'ok', candidates: [candidate('c1')] }] });
  assert.equal(locked.context.reparseHistoricalCandidatesDryRun().stoppedReason, 'locked');
  assert.equal(lockedCalls.fetchInputs.length, 0);
  assert.equal(lockedCalls.posts.length, 0);
});

test('21 ambiguous, detected-price, and no-price branches are preserved', () => {
  const h = createHarness({
    getMessageById: (id) => message(id, id),
    amazonParse: (_subject, body) => {
      if (body === 'message-ambiguous') {
        return { items: [
          { item_name_raw: 'same', detected_price: '100' },
          { item_name_raw: 'same', detected_price: '100' },
        ] };
      }
      if (body === 'message-price') {
        return { items: [{ item_name_raw: 'priced', detected_price: '470', price_source: '本体価格' }] };
      }
      return { items: [{ item_name_raw: 'no-price', detected_price: '', price_source: 'なし' }] };
    },
  });
  const calls = installServiceApi(h, {
    pages: [{ status: 'ok', candidates: [
      candidate('ambiguous', { itemNameRaw: 'same' }),
      candidate('price', { itemNameRaw: 'priced' }),
      candidate('no-price', { itemNameRaw: 'no-price' }),
    ] }, { status: 'ok', candidates: [] }],
  });
  h.context.reparseHistoricalCandidatesDryRun();
  const results = calls.posts[0].results;
  assert.equal(results[0].skipReason, 'ambiguous_item_match');
  assert.equal(results[1].detectedPrice, '470');
  assert.equal(results[1].priceSource, '本体価格');
  assert.equal(Object.hasOwn(results[2], 'detectedPrice'), false);
  assert.equal(Object.hasOwn(results[2], 'skipReason'), false);
});

test('22 20260906-001 production-format sample is reparsed by the real parser', () => {
  const itemName = 'スコッティフラワーパック ３倍長持ち ４Ｒ Ｓ';
  const body = [
    '【注文番号】1003044274',
    `4901750140045：${itemName}`,
    '[本体価格]：￥470',
    '[税率]：10%',
    '[数量]：2',
    '[合計]：￥940',
  ].join('\n');
  const h = createHarness({
    realParsers: true,
    getMessageById: () => message('ご注文完了のご連絡', body),
  });
  const calls = installServiceApi(h, {
    pages: [{ status: 'ok', candidates: [candidate('sample', { vendor: 'matsukiyo', itemNameRaw: itemName })] },
      { status: 'ok', candidates: [] }],
  });
  assert.equal(h.context.reparseHistoricalCandidatesDryRun().stoppedReason, 'complete');
  assert.equal(calls.posts[0].results[0].detectedPrice, '470');
  assert.equal(calls.posts[0].results[0].priceSource, '本体価格');
});

test('23 logs omit run token, message id, item name, and price including progress flow', () => {
  const runToken = 'SENSITIVE_RUN_TOKEN_MARKER';
  const messageId = 'SENSITIVE_MESSAGE_ID_MARKER';
  const itemName = 'SENSITIVE_ITEM_NAME_MARKER';
  const price = '987654';
  let candidateGetCount = 0;
  let progressCalls = 0;
  const h = createHarness({
    properties: { REPARSE_RUN_TOKEN: runToken },
    getMessageById: () => message('subject', 'body'),
    amazonParse: () => ({ items: [{ item_name_raw: itemName, detected_price: price, price_source: '本体価格' }] }),
    fetch: (url, options) => {
      if (url.includes('/api/bridge/reparse-progress')) {
        progressCalls += 1;
        return httpResponse(200, { totalTargets: 1, processedCount: 1, remainingCount: 0, complete: true });
      }
      if (options.method === 'post') {
        return httpResponse(200, {
          mode: 'write',
          summary: {
            total: 1,
            updatedCandidate: 1,
            updatedPurchase: 1,
            unchanged: 0,
            skipped: 0,
            conflict: 0,
            failed: 0,
          },
        });
      }
      candidateGetCount += 1;
      return candidateGetCount === 1
        ? httpResponse(200, { candidates: [candidate('secret-candidate', { mailMessageId: messageId, itemNameRaw: itemName })] })
        : httpResponse(200, { candidates: [] });
    },
  });
  assert.equal(h.context.reparseHistoricalCandidatesWrite().stoppedReason, 'complete');
  assert.equal(progressCalls, 1);
  const output = h.logs.join('\n');
  for (const secretValue of [runToken, messageId, itemName, price]) {
    assert.equal(output.includes(secretValue), false);
  }
});

test('24 candidate missing required fields is rejected', () => {
  const h = createHarness({ fetch: () => httpResponse(200, { candidates: [{ id: 'synthetic-id' }] }) });
  const result = h.context.ApiBridge.fetchReparseCandidates(null, 20);
  assert.equal(result.status, 'error');
  assert.equal(result.candidates.length, 0);
});

test('25 POST response with wrong mode is rejected', () => {
  const h = createHarness({
    fetch: () => httpResponse(200, {
      mode: 'write',
      summary: {
        total: 0,
        updatedCandidate: 0,
        updatedPurchase: 0,
        unchanged: 0,
        skipped: 0,
        conflict: 0,
        failed: 0,
      },
    }),
  });
  assert.equal(h.context.ApiBridge.postReparseResults('dry_run', []).status, 'error');
});

test('26 POST response with wrong summary total is rejected', () => {
  const h = createHarness({
    fetch: () => httpResponse(200, {
      mode: 'dry_run',
      summary: {
        total: 1,
        updatedCandidate: 0,
        updatedPurchase: 0,
        unchanged: 1,
        skipped: 0,
        conflict: 0,
        failed: 0,
      },
    }),
  });
  assert.equal(h.context.ApiBridge.postReparseResults('dry_run', []).status, 'error');
});

test('27 POST response with unknown summary field is rejected', () => {
  const h = createHarness({
    fetch: () => httpResponse(200, {
      mode: 'dry_run',
      summary: { total: 0, extra: 'synthetic-sensitive-marker' },
    }),
  });
  assert.equal(h.context.ApiBridge.postReparseResults('dry_run', []).status, 'error');
});

test('28 POST response with unknown bySkipReason key is rejected', () => {
  const h = createHarness({
    fetch: () => httpResponse(200, {
      mode: 'dry_run',
      summary: {
        total: 0,
        updatedCandidate: 0,
        updatedPurchase: 0,
        unchanged: 0,
        skipped: 0,
        conflict: 0,
        failed: 0,
        bySkipReason: { unexpected_reason: 1 },
      },
    }),
  });
  assert.equal(h.context.ApiBridge.postReparseResults('dry_run', []).status, 'error');
});

test('29 valid POST summary is accepted as a new sanitized object', () => {
  const rawSummary = {
    total: 1,
    updatedCandidate: 0,
    updatedPurchase: 0,
    unchanged: 1,
    skipped: 0,
    conflict: 0,
    failed: 0,
    bySkipReason: { no_price_found: 1 },
  };
  const rawBody = { mode: 'dry_run', summary: rawSummary };
  const h = createHarness({
    fetch: () => ({
      getResponseCode: () => 200,
      getContentText: () => 'synthetic-response-body',
    }),
  });
  h.context.JSON = { parse: () => rawBody, stringify: JSON.stringify };
  const result = h.context.ApiBridge.postReparseResults('dry_run', [{}]);
  assert.equal(result.status, 'ok');
  assert.equal(JSON.stringify(result.summary), JSON.stringify(rawSummary));
  assert.notEqual(result.summary, rawSummary);
  assert.notEqual(result.summary.bySkipReason, rawSummary.bySkipReason);
});

test('30 rejected POST summary does not reach logs or advance cursor', () => {
  const marker = 'synthetic-sensitive-marker';
  const token = 'malicious-summary-run';
  const key = cursorKey(token, 'dry_run');
  const h = createHarness({
    properties: { REPARSE_RUN_TOKEN: token, [key]: 'saved-cursor' },
    amazonParse: () => ({ items: [{ item_name_raw: 'item-c1', detected_price: '500' }] }),
    fetch: (_url, options) => options.method === 'post'
      ? httpResponse(200, {
          mode: 'dry_run',
          summary: {
            total: 1,
            updatedCandidate: 1,
            updatedPurchase: 0,
            unchanged: 0,
            skipped: 0,
            conflict: 0,
            failed: 0,
            extra: marker,
          },
        })
      : httpResponse(200, { candidates: [candidate('c1')] }),
  });
  const result = h.context.reparseHistoricalCandidatesDryRun();
  assert.equal(result.stoppedReason, 'post_error');
  assert.equal(h.properties.get(key), 'saved-cursor');
  assert.equal(h.logs.join('\n').includes(marker), false);
});

test('31 arbitrary exception name is replaced before logging', () => {
  const marker = 'synthetic-sensitive-marker';
  const h = createHarness({
    fetch: () => {
      const error = new Error('synthetic failure');
      error.name = marker;
      throw error;
    },
  });
  assert.equal(h.context.ApiBridge.fetchReparseCandidates(null, 20).status, 'error');
  const output = h.logs.join('\n');
  assert.equal(output.includes(marker), false);
  assert.equal(output.includes('Error'), true);
});

test('32 standard TypeError name is preserved in logs', () => {
  const h = createHarness({ fetch: () => { throw new TypeError('synthetic failure'); } });
  assert.equal(h.context.ApiBridge.fetchReparseCandidates(null, 20).status, 'error');
  assert.equal(h.logs.join('\n').includes('TypeError'), true);
});

test('33 progress response with inconsistent remaining count is rejected', () => {
  const h = createHarness({
    fetch: () => httpResponse(200, {
      totalTargets: 5,
      processedCount: 2,
      remainingCount: 0,
      complete: false,
    }),
  });
  assert.equal(h.context.ApiBridge.fetchReparseProgress().status, 'error');
});

test('34 progress response with inconsistent complete flag is rejected', () => {
  const h = createHarness({
    fetch: () => httpResponse(200, {
      totalTargets: 5,
      processedCount: 5,
      remainingCount: 0,
      complete: false,
    }),
  });
  assert.equal(h.context.ApiBridge.fetchReparseProgress().status, 'error');
});

(async () => {
  let passed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      passed += 1;
      console.log(`PASS ${name}`);
    } catch (error) {
      process.exitCode = 1;
      console.error(`FAIL ${name}`);
      console.error(error && error.stack ? error.stack : error);
    }
  }
  console.log(`RESULT ${passed}/${tests.length} scenarios passed`);
})();
