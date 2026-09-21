/**
 * Local-only regression test for the retired GAS daily batch path.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC_DIR = path.resolve(__dirname, '..', 'src');
const batchControllerSource = fs.readFileSync(path.join(SRC_DIR, 'BatchController.js'), 'utf8');
const notificationServiceSource = fs.readFileSync(path.join(SRC_DIR, 'NotificationService.js'), 'utf8');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function loadContext() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(batchControllerSource, context, { filename: 'BatchController.js' });
  vm.runInContext(notificationServiceSource, context, { filename: 'NotificationService.js' });
  return context;
}

test('01 runDailyBatch no longer exists', () => {
  const context = loadContext();
  assert.equal(typeof context.runDailyBatch, 'undefined');
});

test('02 createDailyBatchTrigger no longer exists', () => {
  const context = loadContext();
  assert.equal(typeof context.createDailyBatchTrigger, 'undefined');
});

test('03 deleteDailyBatchTrigger still exists (used by ApiBridge.setupStockHomeBridge migration cleanup)', () => {
  const context = loadContext();
  assert.equal(typeof context.deleteDailyBatchTrigger, 'function');
});

test('04 unrelated BatchController functions are unaffected', () => {
  const context = loadContext();
  assert.equal(typeof context.runMyGmailImport, 'function');
  assert.equal(typeof context.runStockRecalculation, 'function');
  assert.equal(typeof context.setDeliveryBufferDays, 'function');
  assert.equal(typeof context.setDeliveryBufferDaysToZero, 'function');
});

test('05 NotificationService.processAllNotifications no longer exists', () => {
  const context = loadContext();
  assert.equal(typeof context.NotificationService.processAllNotifications, 'undefined');
});

test('06 NotificationService retains its still-used exports', () => {
  const context = loadContext();
  assert.equal(typeof context.NotificationService.resolveNotificationReason, 'function');
  assert.equal(typeof context.NotificationService.hasRecentNotification, 'function');
  assert.equal(typeof context.NotificationService.createNotificationRecord, 'function');
  assert.equal(typeof context.NotificationService.getNotificationLogs, 'function');
});

test('07 no source file other than ApiBridge.js and ReadyGoBotService.js calls appendToInbox', () => {
  const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.js'));
  const offenders = [];
  for (const file of files) {
    if (file === 'ApiBridge.js' || file === 'ReadyGoBotService.js') continue;
    const source = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
    if (/appendToInbox\s*\(/.test(source)) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, []);
});

test('08 ApiBridge.js calls appendToInbox with two arguments (body, outboxId)', () => {
  const source = fs.readFileSync(path.join(SRC_DIR, 'ApiBridge.js'), 'utf8');
  const match = source.match(/ReadyGoBotService\.appendToInbox\(([^)]*)\)/);
  assert.ok(match, 'expected a ReadyGoBotService.appendToInbox(...) call in ApiBridge.js');
  const args = match[1].split(',').map((s) => s.trim()).filter(Boolean);
  assert.equal(args.length, 2, `expected 2 arguments, got: ${match[1]}`);
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
