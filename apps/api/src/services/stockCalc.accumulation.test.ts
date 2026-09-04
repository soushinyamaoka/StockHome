// 買い足し累積（積み上げ）機能の回帰・障害再現テスト（VPS管理レビューB02対応）。
// ローカルDocker Postgres（DATABASE_URL、apps/api/.env）に対して実行する。
// 各テストは独立した household/item を作成し、終了時に household をカスケード削除する。
//
// 実行方法: npm test --workspace=@stockhome/api
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma';
import {
  accumulatePurchaseIntoStock,
  processPendingPurchasesForItem,
  reverseAccumulatedPurchase,
  getCurrentEstimatedRemainingQty,
  updateCountedInInventory,
  todayDateOnly,
} from './stockCalc';
import { computeSuggestedDaysPerUnit } from '../routes/purchases';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
let scopeCounter = 0;

interface TestScope {
  householdId: string;
  userId: string;
  itemId: string;
  cleanup: () => Promise<void>;
}

async function createTestScope(daysPerUnit = 10): Promise<TestScope> {
  scopeCounter += 1;
  const tag = `${Date.now()}-${scopeCounter}`;
  const household = await prisma.household.create({ data: { name: `test-household-${tag}` } });
  const user = await prisma.user.create({
    data: { email: `test-${tag}@example.invalid`, name: 'テスト太郎', passwordHash: 'x' },
  });
  await prisma.householdMember.create({
    data: { householdId: household.id, userId: user.id, role: 'admin' },
  });
  const item = await prisma.item.create({
    data: {
      householdId: household.id,
      itemName: `test-item-${tag}`,
      daysPerUnit,
      defaultPurchaseQty: 1,
      runtimeState: { create: { householdId: household.id } },
    },
  });
  return {
    householdId: household.id,
    userId: user.id,
    itemId: item.id,
    cleanup: async () => {
      await prisma.household.delete({ where: { id: household.id } });
    },
  };
}

// 実際のroute/serviceと同じ順序（積み上げ→購入作成の順で同一tx）を再現するテスト用ヘルパー。
// 積み上げを先に行うのは、後にすると残数計算が今作成する購入自身を「直前の購入」として
// 拾ってしまい二重加算になるため（purchases.ts / candidateIntake.ts と同じ理由）
async function registerAccumulatedPurchase(
  scope: TestScope,
  qty: number,
  purchasedAt: Date,
  opts: { source?: 'manual' | 'gmail'; reason?: string } = {}
) {
  const source = opts.source ?? 'manual';
  const reason = opts.reason ?? 'purchase_accumulated';
  return prisma.$transaction(async (tx) => {
    await accumulatePurchaseIntoStock(tx, scope.itemId, scope.householdId, qty, scope.userId, reason);
    return tx.purchaseLog.create({
      data: {
        householdId: scope.householdId,
        itemId: scope.itemId,
        purchasedAt,
        qty,
        source,
        sourceType: source === 'manual' ? 'manual' : 'gmail_auto',
        fulfillmentStatus: source === 'manual' ? 'received' : 'shipped',
        inventoryEffectiveAt: purchasedAt,
        countedInInventory: true,
      },
    });
  });
}

// --- 正常系（回帰） ---

test('手動購入: 同日に2件登録すると上書きされず積み上がる', async () => {
  const scope = await createTestScope(10);
  try {
    const today = todayDateOnly();
    await registerAccumulatedPurchase(scope, 2, today);
    assert.equal(await getCurrentEstimatedRemainingQty(prisma, scope.itemId), 2);

    await registerAccumulatedPurchase(scope, 3, today);
    assert.equal(await getCurrentEstimatedRemainingQty(prisma, scope.itemId), 5);
  } finally {
    await scope.cleanup();
  }
});

test('購入取消: 積み上げ由来の補正値から取消分だけが差し引かれる', async () => {
  const scope = await createTestScope(10);
  try {
    const today = todayDateOnly();
    await registerAccumulatedPurchase(scope, 2, today);
    const p2 = await registerAccumulatedPurchase(scope, 3, today);
    assert.equal(await getCurrentEstimatedRemainingQty(prisma, scope.itemId), 5);

    await prisma.$transaction(async (tx) => {
      await tx.purchaseLog.delete({ where: { id: p2.id } });
      await reverseAccumulatedPurchase(tx, scope.itemId, 3);
    });
    assert.equal(await getCurrentEstimatedRemainingQty(prisma, scope.itemId), 2, '取消分だけ正しく差し引かれていない');
  } finally {
    await scope.cleanup();
  }
});

test('消費ペース実績提案: 購入間隔と数量から正しい平均値を算出する', () => {
  const base = new Date('2026-08-01T00:00:00.000Z').getTime();
  const logs = [
    { purchasedAt: new Date(base), qty: 1 }, // 起点
    { purchasedAt: new Date(base + 8 * MS_PER_DAY), qty: 1 }, // 8日後
    { purchasedAt: new Date(base + 15 * MS_PER_DAY), qty: 1 }, // 7日後
    { purchasedAt: new Date(base + 20 * MS_PER_DAY), qty: 2 }, // 5日後
  ];
  // desc順で渡す（APIの実際の並び順）
  const result = computeSuggestedDaysPerUnit([...logs].reverse());
  assert.ok(result);
  // (8+7+5)/3 = 6.666... -> 6.7
  assert.equal(result!.value, 6.7);
  assert.equal(result!.sampleCount, 3);
});

test('消費ペース実績提案: 購入が1件以下なら提案しない', () => {
  assert.equal(computeSuggestedDaysPerUnit([]), null);
  assert.equal(computeSuggestedDaysPerUnit([{ purchasedAt: new Date(), qty: 1 }]), null);
});

test('夜間バッチ相当: 配送バッファ等で確定時に未countedだった購入が、counted化と同時に積み上がる', async () => {
  const scope = await createTestScope(10);
  try {
    const yesterday = new Date(todayDateOnly().getTime() - MS_PER_DAY);
    const p1 = await prisma.purchaseLog.create({
      data: {
        householdId: scope.householdId, itemId: scope.itemId, purchasedAt: yesterday, qty: 7,
        source: 'gmail', sourceType: 'gmail_auto', fulfillmentStatus: 'shipped',
        inventoryEffectiveAt: yesterday, countedInInventory: false,
      },
    });
    assert.equal(await getCurrentEstimatedRemainingQty(prisma, scope.itemId), 0);

    const updated = await updateCountedInInventory(scope.householdId);
    assert.equal(updated, 1);

    const reloaded = await prisma.purchaseLog.findUniqueOrThrow({ where: { id: p1.id } });
    assert.equal(reloaded.countedInInventory, true);
    assert.equal(await getCurrentEstimatedRemainingQty(prisma, scope.itemId), 7);
  } finally {
    await scope.cleanup();
  }
});

test('Gmail取込確定相当: 積み上げが手動購入と同じ仕組みで動く', async () => {
  const scope = await createTestScope(10);
  try {
    const today = todayDateOnly();
    await registerAccumulatedPurchase(scope, 2, today, { source: 'manual' });
    await registerAccumulatedPurchase(scope, 1, today, { source: 'gmail', reason: 'purchase_accumulated_gmail' });
    assert.equal(await getCurrentEstimatedRemainingQty(prisma, scope.itemId), 3);
  } finally {
    await scope.cleanup();
  }
});

// --- 障害・同時実行の再現（B02） ---

test('B02-1: 同一品目への同時購入で両方の数量が一度だけ加算される（並行トランザクション）', async () => {
  const scope = await createTestScope(10);
  try {
    const today = todayDateOnly();

    await Promise.all([
      registerAccumulatedPurchase(scope, 2, today),
      registerAccumulatedPurchase(scope, 3, today),
    ]);

    const remaining = await getCurrentEstimatedRemainingQty(prisma, scope.itemId);
    assert.equal(remaining, 5, '同時実行で一方の加算が失われている（lost update）');

    const purchaseCount = await prisma.purchaseLog.count({ where: { itemId: scope.itemId } });
    assert.equal(purchaseCount, 2);
  } finally {
    await scope.cleanup();
  }
});

test('B02-2: 積み上げ＋購入作成の一連処理が失敗すると、両方ロールバックされる', async () => {
  const scope = await createTestScope(10);
  try {
    const today = todayDateOnly();

    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await accumulatePurchaseIntoStock(tx, scope.itemId, scope.householdId, 5, null, 'purchase_accumulated_gmail');
        await tx.purchaseLog.create({
          data: {
            householdId: scope.householdId, itemId: scope.itemId, purchasedAt: today, qty: 5,
            source: 'gmail', sourceType: 'gmail_auto', fulfillmentStatus: 'shipped',
            inventoryEffectiveAt: today, countedInInventory: true,
          },
        });
        // 同一トランザクション内での後続失敗（実運用での想定: 他の書き込み・制約違反等）を再現する
        throw new Error('simulated failure after accumulation');
      }),
      /simulated failure/
    );

    const purchaseCount = await prisma.purchaseLog.count({ where: { itemId: scope.itemId } });
    assert.equal(purchaseCount, 0, '購入行だけがロールバックされずに残っている（部分確定）');

    const remaining = await getCurrentEstimatedRemainingQty(prisma, scope.itemId);
    assert.equal(remaining, 0, '積み上げがロールバックされずに残っている（部分確定）');
  } finally {
    await scope.cleanup();
  }
});

test('B02-3: 夜間バッチのcounted化中に1件が失敗すると、同一品目の他の購入もcounted化・積み上げされない', async () => {
  const scope = await createTestScope(10);
  try {
    const yesterday = new Date(todayDateOnly().getTime() - MS_PER_DAY);
    const p1 = await prisma.purchaseLog.create({
      data: {
        householdId: scope.householdId, itemId: scope.itemId, purchasedAt: yesterday, qty: 3,
        source: 'gmail', sourceType: 'gmail_auto', fulfillmentStatus: 'shipped',
        inventoryEffectiveAt: yesterday, countedInInventory: false,
      },
    });

    await assert.rejects(
      prisma.$transaction((tx) =>
        processPendingPurchasesForItem(tx, scope.itemId, [
          { id: p1.id, itemId: scope.itemId, householdId: scope.householdId, qty: 3 },
          // 存在しない購入行を混ぜ、2件目の処理中に失敗させる
          { id: 'nonexistent-purchase-id', itemId: scope.itemId, householdId: scope.householdId, qty: 4 },
        ])
      )
    );

    const reloaded = await prisma.purchaseLog.findUniqueOrThrow({ where: { id: p1.id } });
    assert.equal(reloaded.countedInInventory, false, '同一品目内の他購入がロールバックされずcounted化されている');

    const state = await prisma.itemRuntimeState.findUnique({ where: { itemId: scope.itemId } });
    assert.equal(state?.manualOverrideQty ?? null, null, '積み上げがロールバックされずに残っている');
  } finally {
    await scope.cleanup();
  }
});

test('B02-4: 失敗後の再実行では二重加算されず正常完了する', async () => {
  const scope = await createTestScope(10);
  try {
    const yesterday = new Date(todayDateOnly().getTime() - MS_PER_DAY);
    const p1 = await prisma.purchaseLog.create({
      data: {
        householdId: scope.householdId, itemId: scope.itemId, purchasedAt: yesterday, qty: 3,
        source: 'gmail', sourceType: 'gmail_auto', fulfillmentStatus: 'shipped',
        inventoryEffectiveAt: yesterday, countedInInventory: false,
      },
    });

    // 1回目: 失敗（B02-3と同様の障害注入）
    await assert.rejects(
      prisma.$transaction((tx) =>
        processPendingPurchasesForItem(tx, scope.itemId, [
          { id: p1.id, itemId: scope.itemId, householdId: scope.householdId, qty: 3 },
          { id: 'nonexistent-purchase-id', itemId: scope.itemId, householdId: scope.householdId, qty: 4 },
        ])
      )
    );

    // 2回目: 正しい内容で再実行
    await prisma.$transaction((tx) =>
      processPendingPurchasesForItem(tx, scope.itemId, [
        { id: p1.id, itemId: scope.itemId, householdId: scope.householdId, qty: 3 },
      ])
    );

    const reloaded = await prisma.purchaseLog.findUniqueOrThrow({ where: { id: p1.id } });
    assert.equal(reloaded.countedInInventory, true);
    assert.equal(await getCurrentEstimatedRemainingQty(prisma, scope.itemId), 3, '再実行時に二重加算されている');
  } finally {
    await scope.cleanup();
  }
});

test('B02-5: 購入取消は、累積に実際に含まれた購入だけを一度だけ差し戻す', async () => {
  const scope = await createTestScope(10);
  try {
    const today = todayDateOnly();
    const p = await registerAccumulatedPurchase(scope, 4, today);
    assert.equal(await getCurrentEstimatedRemainingQty(prisma, scope.itemId), 4);

    await prisma.$transaction(async (tx) => {
      await tx.purchaseLog.delete({ where: { id: p.id } });
      await reverseAccumulatedPurchase(tx, scope.itemId, 4);
    });
    assert.equal(await getCurrentEstimatedRemainingQty(prisma, scope.itemId), 0);

    // 同じ購入を二重に差し戻そうとしても、0未満にはならない（フロアされる）
    await prisma.$transaction(async (tx) => {
      await reverseAccumulatedPurchase(tx, scope.itemId, 4);
    });
    assert.equal(await getCurrentEstimatedRemainingQty(prisma, scope.itemId), 0, '差し戻しがマイナスへ振れてはいけない');
  } finally {
    await scope.cleanup();
  }
});

test('B02-5b: 積み上げ由来でない補正値（手動の在庫補正）は購入取消で差し戻されない', async () => {
  const scope = await createTestScope(10);
  try {
    // 手動の在庫補正を模擬（reasonが purchase_accumulated* で始まらない）
    await prisma.itemRuntimeState.upsert({
      where: { itemId: scope.itemId },
      create: {
        householdId: scope.householdId, itemId: scope.itemId,
        manualOverrideQty: 10, manualOverrideAt: new Date(), manualOverrideReason: 'counted_actual_stock',
      },
      update: {
        manualOverrideQty: 10, manualOverrideAt: new Date(), manualOverrideReason: 'counted_actual_stock',
      },
    });

    await prisma.$transaction(async (tx) => {
      await reverseAccumulatedPurchase(tx, scope.itemId, 4);
    });

    const state = await prisma.itemRuntimeState.findUnique({ where: { itemId: scope.itemId } });
    assert.equal(state?.manualOverrideQty, 10, '手動補正値が誤って差し引かれている');
  } finally {
    await scope.cleanup();
  }
});
