/**
 * このfileはGASへdeployされない。ローカル検証専用。
 * ReadyGoのInbox行へのoutbox id同時書き込みと、LockServiceによる並行実行対策を検証する。
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC_DIR = path.resolve(__dirname, '..', 'src');
const apiBridgeSource = fs.readFileSync(path.join(SRC_DIR, 'ApiBridge.js'), 'utf8');
const readyGoBotServiceSource = fs.readFileSync(path.join(SRC_DIR, 'ReadyGoBotService.js'), 'utf8');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

/** Inboxシートの最小限の振る舞いをin-memory配列で再現する。 */
function createFakeSheet(initialRows) {
  const data = (initialRows || []).map((row) => row.slice());
  return {
    data,
    getLastRow: () => data.length,
    getRange: (row, column, numRows, numColumns) => ({
      getValues: () => {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const sourceRow = data[row - 1 + r] || [];
          const line = [];
          for (let c = 0; c < numColumns; c++) line.push(sourceRow[column - 1 + c] ?? '');
          out.push(line);
        }
        return out;
      },
    }),
    appendRow: (values) => { data.push(Array.from(values)); },
  };
}

function createHarness(options = {}) {
  const properties = new Map(Object.entries(options.properties || {}).filter(([, value]) => value != null));
  const propertyApi = {
    getProperty: (key) => properties.get(key) ?? null,
    setProperty: (key, value) => { properties.set(key, String(value)); return propertyApi; },
    deleteProperty: (key) => { properties.delete(key); return propertyApi; },
  };
  const logs = [];
  let lockHeld = false;
  const lockCalls = { tryLock: 0, released: 0 };
  const lock = {
    tryLock: () => {
      lockCalls.tryLock += 1;
      if (options.lockUnavailable || lockHeld) return false;
      lockHeld = true;
      return true;
    },
    releaseLock: () => { lockHeld = false; lockCalls.released += 1; },
  };
  const sheet = options.sheet || createFakeSheet();
  const context = {
    console,
    PropertiesService: { getScriptProperties: () => propertyApi },
    LockService: { getScriptLock: () => lock },
    UrlFetchApp: { fetch: () => { throw new Error('unexpected UrlFetchApp.fetch call in this test'); } },
    Logger: { log: (...args) => { logs.push(args.map(String).join(' ')); } },
    SpreadsheetApp: {
      openById: () => {
        if (options.spreadsheetOpenFails) throw new Error('synthetic open failure');
        return { getSheetByName: (name) => (name === 'Inbox' ? sheet : null) };
      },
    },
    getReadyGoSpreadsheetId: () => (options.spreadsheetIdMissing ? null : 'fake-spreadsheet-id'),
    toStr: (value) => (value == null ? '' : String(value).trim()),
  };
  vm.createContext(context);
  vm.runInContext(readyGoBotServiceSource, context, { filename: 'ReadyGoBotService.js' });
  vm.runInContext(apiBridgeSource, context, { filename: 'ApiBridge.js' });
  return { context, properties, propertyApi, logs, sheet, lockCalls };
}

/** ApiBridgeのキュー取得・ACKだけをmockへ差し替える。 */
function installApiMocks(harness, options = {}) {
  const ackCalls = [];
  let pendingQueue = options.pending || [];
  harness.context.ApiBridge = {
    fetchReadyGoPending: () => pendingQueue,
    ackReadyGoDelivered: (ids) => {
      ackCalls.push(Array.from(ids));
      return { ok: true, notified: ids.length };
    },
  };
  return { ackCalls, setPending: (pending) => { pendingQueue = pending; } };
}

// ---- ReadyGoBotService.appendToInbox 単体テスト ----

test('01 appendToInbox writes a row with the outbox id in column E', () => {
  const h = createHarness();
  assert.equal(h.context.ReadyGoBotService.appendToInbox('hello', 'id-1'), true);
  assert.equal(h.sheet.data.length, 1);
  assert.deepEqual(h.sheet.data[0].slice(1), ['StockHome', 'hello', false, 'id-1']);
});

test('02 appendToInbox skips re-appending a duplicate outbox id and still returns true', () => {
  const h = createHarness();
  h.context.ReadyGoBotService.appendToInbox('hello', 'id-1');
  assert.equal(h.context.ReadyGoBotService.appendToInbox('hello (retry)', 'id-1'), true);
  assert.equal(h.sheet.data.length, 1, 'must not add a second row for the same id');
});

test('03 appendToInbox with a missing outboxId returns false and does not append', () => {
  const h = createHarness();
  assert.equal(h.context.ReadyGoBotService.appendToInbox('hello', ''), false);
  assert.equal(h.sheet.data.length, 0);
});

test('04 appendToInbox with no configured spreadsheet id returns false', () => {
  const h = createHarness({ spreadsheetIdMissing: true });
  assert.equal(h.context.ReadyGoBotService.appendToInbox('hello', 'id-1'), false);
});

test('05 appendToInbox when the sheet cannot be opened returns false', () => {
  const h = createHarness({ spreadsheetOpenFails: true });
  assert.equal(h.context.ReadyGoBotService.appendToInbox('hello', 'id-1'), false);
});

// ---- deliverStockHomeNotifications 統合テスト ----

test('06 normal delivery: one row appended with its id, ack called with that id', () => {
  const h = createHarness();
  const mocks = installApiMocks(h, { pending: [{ id: 'a', body: 'body-a' }] });
  h.context.deliverStockHomeNotifications();
  assert.equal(h.sheet.data.length, 1);
  assert.equal(h.sheet.data[0][4], 'a');
  assert.deepEqual(mocks.ackCalls, [['a']]);
});

test('07 ACK failure then re-delivery: same id already in Inbox is not re-appended, ack is retried', () => {
  const h = createHarness();
  const mocks = installApiMocks(h, { pending: [{ id: 'x', body: 'body-x' }] });
  h.context.deliverStockHomeNotifications();
  assert.equal(h.sheet.data.length, 1);
  assert.deepEqual(mocks.ackCalls, [['x']]);
  mocks.ackCalls.length = 0;
  h.context.deliverStockHomeNotifications();
  assert.equal(h.sheet.data.length, 1, 'must not add a second Inbox row');
  assert.deepEqual(mocks.ackCalls, [['x']], 'must still retry ACK');
});

test('08 concurrent execution: a held lock prevents a second delivery run entirely', () => {
  const h = createHarness({ lockUnavailable: true });
  const mocks = installApiMocks(h, { pending: [{ id: 'a', body: 'body-a' }] });
  h.context.deliverStockHomeNotifications();
  assert.equal(h.sheet.data.length, 0, 'must not touch the Inbox while locked');
  assert.deepEqual(mocks.ackCalls, [], 'must not attempt ACK while locked');
  assert.equal(h.lockCalls.released, 0, 'a lock that was never acquired must not be released');
});

test('09 lock is released after a normal run (and after no-pending), allowing the next run to acquire it', () => {
  const h = createHarness();
  const mocks = installApiMocks(h, { pending: [] });
  h.context.deliverStockHomeNotifications();
  assert.equal(h.lockCalls.tryLock, 1);
  assert.equal(h.lockCalls.released, 1);
  mocks.setPending([{ id: 'b', body: 'body-b' }]);
  h.context.deliverStockHomeNotifications();
  assert.equal(h.lockCalls.tryLock, 2, 'the lock must be acquirable again for the next run');
  assert.equal(h.sheet.data.length, 1);
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
