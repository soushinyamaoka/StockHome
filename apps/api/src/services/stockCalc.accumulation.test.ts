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
  calculateStock,
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

test('B02-3: 夜間バッチのcounted化中に後続処理が失敗すると、同一品目の購入もcounted化・積み上げされない', async () => {
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

    // processPendingPurchasesForItem自体は正常に完了するが、それを包む
    // トランザクション（実運用ではupdateCountedInInventoryのループ）内で後続に失敗が起きた
    // 場合を再現する。同一トランザクションである以上、counted化・積み上げも巻き戻ることを確認する
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await processPendingPurchasesForItem(tx, scope.itemId, [
          { id: p1.id, itemId: scope.itemId, householdId: scope.householdId, qty: 3 },
        ]);
        throw new Error('simulated failure after processing');
      }),
      /simulated failure/
    );

    const reloaded = await prisma.purchaseLog.findUniqueOrThrow({ where: { id: p1.id } });
    assert.equal(reloaded.countedInInventory, false, '同一トランザクション内の購入がロールバックされずcounted化されている');

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

    // 1回目: 失敗（B02-3と同様の障害注入。ロールバックされ、purchase_logはfalseのまま残る）
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await processPendingPurchasesForItem(tx, scope.itemId, [
          { id: p1.id, itemId: scope.itemId, householdId: scope.householdId, qty: 3 },
        ]);
        throw new Error('simulated failure after processing');
      }),
      /simulated failure/
    );

    // 2回目: 同じ一覧で再実行（夜間バッチの次回起動が同じpendingを拾い直す状況を再現）
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

test('B07: 夜間バッチの二重起動で同じpending購入を二重加算しない', async () => {
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

    // 2つの実行が「counted_in_inventory=false」時点の同じpending一覧を読んだ状況を再現する
    // （updateCountedInInventoryのfindManyがtransaction開始前に行われるため、2回の呼び出しは
    // 同じ一覧を受け取り得る）。品目ロックにより処理は直列化されるが、後続の実行がロック取得後に
    // DB上の最新状態を再確認しなければ、先行実行が既にcounted化・加算した購入を再度加算してしまう
    const sameList = [{ id: p1.id, itemId: scope.itemId, householdId: scope.householdId, qty: 3 }];
    await Promise.all([
      prisma.$transaction((tx) => processPendingPurchasesForItem(tx, scope.itemId, sameList)),
      prisma.$transaction((tx) => processPendingPurchasesForItem(tx, scope.itemId, sameList)),
    ]);

    const reloaded = await prisma.purchaseLog.findUniqueOrThrow({ where: { id: p1.id } });
    assert.equal(reloaded.countedInInventory, true);
    assert.equal(
      await getCurrentEstimatedRemainingQty(prisma, scope.itemId),
      3,
      '二重起動により二重加算されている（期待値3）'
    );
  } finally {
    await scope.cleanup();
  }
});

test('B07-2: updateCountedInInventory自体を二重起動しても二重加算しない', async () => {
  const scope = await createTestScope(10);
  try {
    const yesterday = new Date(todayDateOnly().getTime() - MS_PER_DAY);
    await prisma.purchaseLog.create({
      data: {
        householdId: scope.householdId, itemId: scope.itemId, purchasedAt: yesterday, qty: 5,
        source: 'gmail', sourceType: 'gmail_auto', fulfillmentStatus: 'shipped',
        inventoryEffectiveAt: yesterday, countedInInventory: false,
      },
    });

    const [countA, countB] = await Promise.all([
      updateCountedInInventory(scope.householdId),
      updateCountedInInventory(scope.householdId),
    ]);
    // 一方が処理し、もう一方は「既に処理済み」として0件になる（合計は1件のまま）
    assert.equal(countA + countB, 1, 'どちらか一方の実行だけが1件処理し、合計は1件であるべき');

    assert.equal(await getCurrentEstimatedRemainingQty(prisma, scope.itemId), 5, '二重起動により二重加算されている（期待値5）');
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

// --- JST日付境界の固定日時回帰test（B08対応） ---
//
// calculateStock()はDB書き込みを伴わない純粋関数で、today引数を明示的に渡せるため、
// 実行時刻に依存しない決定的なtestにできる。ここでは
// 「UTCでは前日・JSTでは当日」になる固定日時（2026-01-15T23:30:00Z = 2026-01-16 08:30 JST）を
// manualOverrideAtとして使い、todayDateOnly()と同じ丸め方（JSTのカレンダー日付）で
// 揃えたtoday（2026-01-16のUTC 0時表現）を渡す。修正前の実装（UTC getterで基準日を切り出す）
// では、この組み合わせで基準日が2026-01-15 UTCと誤判定され、1日分（1/daysPerUnit）が
// 即座に減衰していた
function buildTestItem(overrides: { daysPerUnit: number; manualOverrideQty: number; manualOverrideAt: Date }) {
  return {
    id: 'fixture-item',
    daysPerUnit: overrides.daysPerUnit,
    lowStockThresholdQty: null,
    leadDays: 0,
    safetyDays: 0,
    isInventoryUnknown: false,
    runtimeState: {
      manualOverrideQty: overrides.manualOverrideQty,
      manualOverrideAt: overrides.manualOverrideAt,
    },
    // calculateStock()が参照しないフィールドはtestの目的上不要なためanyで許容する
  } as any;
}

test('B08: JST 0時〜9時台に書き込まれた補正値が、直後の再計算で即座に1日分減衰しない（固定日時）', () => {
  // 2026-01-15T23:30:00Z (UTC) = 2026-01-16T08:30:00+09:00 (JST)
  const manualOverrideAt = new Date('2026-01-15T23:30:00.000Z');
  // todayDateOnly()相当（JSTのカレンダー日付をUTC0時で表現）: JSTで2026-01-16
  const today = new Date(Date.UTC(2026, 0, 16));

  const item = buildTestItem({ daysPerUnit: 10, manualOverrideQty: 5, manualOverrideAt });
  const result = calculateStock(item, null, today);

  assert.equal(
    result.estimatedRemainingQty,
    5,
    'JST当日に書き込まれた補正値が、同じJST日のうちに即座に減衰してはいけない'
  );
});

test('B08-2: 翌JST日になれば正しく1日分減衰する（固定日時、回帰防止の対照test）', () => {
  const manualOverrideAt = new Date('2026-01-15T23:30:00.000Z'); // JST 2026-01-16 08:30
  // 1日後（JSTで2026-01-17）
  const today = new Date(Date.UTC(2026, 0, 17));

  const item = buildTestItem({ daysPerUnit: 10, manualOverrideQty: 5, manualOverrideAt });
  const result = calculateStock(item, null, today);

  assert.equal(result.estimatedRemainingQty, 4.9, '翌日には1/daysPerUnitぶん正しく減衰するべき');
});
