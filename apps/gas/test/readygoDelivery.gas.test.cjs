/**
 * このfileはGASへdeployされない。ローカル検証専用。
 *
 * ApiBridge.js を node:vm へ読み込み、Apps Script API（PropertiesService・
 * Logger）を合成mockへ置き換えて、ReadyGo配信の冪等化ロジック
 * （notice 20260920-STOCKHOME-014、第3回VPS管理レビュー対応）を検証する。
 * ApiBridge.fetchReadyGoPending / ackReadyGoDelivered と ReadyGoBotService は
 * このfile側の合成mockへ差し替え、UrlFetchApp・SpreadsheetAppは呼ばれない
 * 前提（呼ばれたら例外を投げて検知する）。
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC_DIR = path.resolve(__dirname, '..', 'src');
const apiBridgeSource = fs.readFileSync(path.join(SRC_DIR, 'ApiBridge.js'), 'utf8');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function createHarness(options = {}) {
  const initialProperties = { ...(options.properties || {}) };
  const properties = new Map(Object.entries(initialProperties).filter(([, value]) => value != null));
  const logs = [];
  const propertyApi = {
    getProperty: (key) => properties.get(key) ?? null,
    setProperty: (key, value) => { properties.set(key, String(value)); return propertyApi; },
    deleteProperty: (key) => { properties.delete(key); return propertyApi; },
  };

  const context = {
    console,
    PropertiesService: { getScriptProperties: () => propertyApi },
    UrlFetchApp: {
      fetch: () => { throw new Error('unexpected UrlFetchApp.fetch call in this test'); },
    },
    Logger: { log: (...args) => { logs.push(args.map(String).join(' ')); } },
  };

  vm.createContext(context);
  vm.runInContext(apiBridgeSource, context, { filename: 'ApiBridge.js' });

  return { context, properties, propertyApi, logs };
}

/**
 * ApiBridge.fetchReadyGoPending / ackReadyGoDelivered と ReadyGoBotService を
 * mockへ差し替える。
 * @param {ReturnType<typeof createHarness>} harness
 * @param {Object} [options]
 * @param {{id:string, body:string}[]} [options.pending] 初期pending一覧
 * @param {boolean} [options.appendFails] appendToInboxを常に失敗させる
 * @param {boolean} [options.ackFails] ackReadyGoDeliveredを常に失敗（null）させる
 */
function installMocks(harness, options = {}) {
  const appendCalls = [];
  const ackCalls = [];
  let pendingQueue = options.pending || [];

  harness.context.ApiBridge = {
    fetchReadyGoPending: () => pendingQueue,
    ackReadyGoDelivered: (ids) => {
      // Array.from (this file's own realm) rather than ids.slice() (the vm
      // context's Array.prototype.slice), so the stored copy is a plain
      // outer-realm array and compares equal to literal arrays in assertions.
      ackCalls.push(Array.from(ids));
      if (options.ackFails) return null;
      return { ok: true, notified: ids.length };
    },
  };
  harness.context.ReadyGoBotService = {
    appendToInbox: (body) => {
      appendCalls.push(body);
      return !options.appendFails;
    },
  };

  return {
    appendCalls,
    ackCalls,
    setPending: (p) => { pendingQueue = p; },
  };
}

test('01 normal delivery: append once, ack once', () => {
  const h = createHarness();
  const mocks = installMocks(h, { pending: [{ id: 'a', body: 'body-a' }] });
  h.context.deliverStockHomeNotifications();
  assert.deepEqual(mocks.appendCalls, ['body-a']);
  assert.deepEqual(mocks.ackCalls, [['a']]);
  assert.equal(h.context.isRecordedAsDelivered_('a'), true);
});

test('02 ACK failure records local delivery, next run skips re-append but retries ack', () => {
  const h = createHarness();
  const mocks = installMocks(h, { pending: [{ id: 'x', body: 'body-x' }], ackFails: true });

  h.context.deliverStockHomeNotifications();
  assert.deepEqual(mocks.appendCalls, ['body-x']);
  assert.deepEqual(mocks.ackCalls, [['x']]);
  assert.equal(h.context.isRecordedAsDelivered_('x'), true);

  // Simulate the next trigger run: the server-side lease reclaim served the SAME
  // row again because the previous ACK never landed. ackFails is now false
  // (simulating the network recovering).
  mocks.ackCalls.length = 0;
  mocks.appendCalls.length = 0;
  h.context.ApiBridge.ackReadyGoDelivered = (ids) => {
    mocks.ackCalls.push(Array.from(ids));
    return { ok: true, notified: ids.length };
  };
  h.context.deliverStockHomeNotifications();

  assert.deepEqual(mocks.appendCalls, [], 'must not re-append to Inbox');
  assert.deepEqual(mocks.ackCalls, [['x']], 'must still retry ACK');
});

test('03 Inbox append failure does not record local delivery, and ack is not attempted', () => {
  const h = createHarness();
  const mocks = installMocks(h, { pending: [{ id: 'y', body: 'body-y' }], appendFails: true });
  h.context.deliverStockHomeNotifications();
  assert.deepEqual(mocks.appendCalls, ['body-y']);
  assert.deepEqual(mocks.ackCalls, []);
  assert.equal(h.context.isRecordedAsDelivered_('y'), false);
});

test('04 mixed batch: previously-recorded id is skipped, new id is delivered, both are acked', () => {
  const h = createHarness();
  const mocks = installMocks(h, {
    pending: [
      { id: 'already', body: 'body-already' },
      { id: 'fresh', body: 'body-fresh' },
    ],
  });
  h.context.recordAsDelivered_('already');
  h.context.deliverStockHomeNotifications();
  assert.deepEqual(mocks.appendCalls, ['body-fresh']);
  assert.equal(mocks.ackCalls.length, 1);
  assert.deepEqual(mocks.ackCalls[0].sort(), ['already', 'fresh']);
});

test('05 no pending: neither append, ack, nor prune-triggering property write happens', () => {
  const h = createHarness();
  const mocks = installMocks(h, { pending: [] });
  h.context.deliverStockHomeNotifications();
  assert.deepEqual(mocks.appendCalls, []);
  assert.deepEqual(mocks.ackCalls, []);
});

test('06 pruneDeliveredRecord_ removes entries older than the TTL and keeps fresh ones', () => {
  const h = createHarness();
  const now = Date.now();
  const record = {
    stale: now - (8 * 24 * 60 * 60 * 1000),
    fresh: now - (1 * 24 * 60 * 60 * 1000),
  };
  h.propertyApi.setProperty('READYGO_DELIVERED_IDS', JSON.stringify(record));
  h.context.pruneDeliveredRecord_();
  assert.equal(h.context.isRecordedAsDelivered_('stale'), false);
  assert.equal(h.context.isRecordedAsDelivered_('fresh'), true);
});

test('07 malformed stored record is treated as empty rather than throwing', () => {
  const h = createHarness({ properties: { READYGO_DELIVERED_IDS: '{not valid json' } });
  assert.equal(h.context.isRecordedAsDelivered_('anything'), false);
  h.context.recordAsDelivered_('z');
  assert.equal(h.context.isRecordedAsDelivered_('z'), true);
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
