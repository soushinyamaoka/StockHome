import assert from 'node:assert/strict';
import test from 'node:test';
import { itemSavedAlert, parseInitialQty } from './itemFormFlow';

test('parseInitialQty accepts empty, nonnegative finite quantities, and rejects invalid values', () => {
  assert.deepEqual(parseInitialQty(''), { kind: 'empty' });
  assert.deepEqual(parseInitialQty('   '), { kind: 'empty' });
  assert.deepEqual(parseInitialQty('3'), { kind: 'value', value: 3 });
  assert.deepEqual(parseInitialQty(' 2.5 '), { kind: 'value', value: 2.5 });
  assert.deepEqual(parseInitialQty('0'), { kind: 'value', value: 0 });
  assert.deepEqual(parseInitialQty('-1'), { kind: 'invalid' });
  assert.deepEqual(parseInitialQty('abc'), { kind: 'invalid' });
  assert.deepEqual(parseInitialQty('Infinity'), { kind: 'invalid' });
});

test('itemSavedAlert describes edit, registration, initial quantity, and candidate return outcomes', () => {
  assert.deepEqual(
    itemSavedAlert({ isEdit: true, itemName: '洗剤', returnToCandidate: true, initialQtySaved: true, initialQtyFailed: true }),
    { title: '保存完了', message: '消耗品を更新しました' }
  );
  assert.equal(
    itemSavedAlert({ isEdit: false, itemName: '', returnToCandidate: false, initialQtySaved: false, initialQtyFailed: false }).message,
    '消耗品を登録しました'
  );
  assert.equal(
    itemSavedAlert({ isEdit: false, itemName: '', returnToCandidate: false, initialQtySaved: true, initialQtyFailed: false }).message,
    '消耗品を登録しました\nいまの数から在庫の予測を始めます'
  );
  assert.equal(
    itemSavedAlert({ isEdit: false, itemName: '洗剤', returnToCandidate: true, initialQtySaved: false, initialQtyFailed: true }).message,
    '消耗品を登録しました\n手元の数は保存できませんでした。在庫画面の「在庫のなおし」から入れてください\n取込便に戻り、「洗剤」を選んだ状態にします'
  );
});
