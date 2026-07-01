// 開発用シード: デモユーザーとサンプル品目を作成する
// 本番データはスプレッドシート移行スクリプト（scripts/migrate-from-xlsx.ts）で投入する
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = 'demo@example.com';
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) {
    console.log('シード済みのためスキップします');
    return;
  }

  const passwordHash = await bcrypt.hash('demo1234', 10);
  const user = await prisma.user.create({
    data: { email, name: 'デモユーザー', passwordHash },
  });
  const household = await prisma.household.create({ data: { name: 'デモの家' } });
  await prisma.householdMember.create({
    data: { userId: user.id, householdId: household.id, role: 'admin' },
  });

  const item = await prisma.item.create({
    data: {
      householdId: household.id,
      itemName: 'ティッシュ',
      category: '日用品',
      unit: '箱',
      defaultPurchaseQty: 5,
      daysPerUnit: 10,
      leadDays: 3,
      safetyDays: 2,
      lowStockThresholdQty: 1,
      runtimeState: { create: { householdId: household.id } },
    },
  });

  // 30日前に5箱購入 → 残り約2箱の状態を再現
  const purchasedAt = new Date();
  purchasedAt.setUTCDate(purchasedAt.getUTCDate() - 30);
  const dateOnly = new Date(
    Date.UTC(purchasedAt.getUTCFullYear(), purchasedAt.getUTCMonth(), purchasedAt.getUTCDate())
  );
  await prisma.purchaseLog.create({
    data: {
      householdId: household.id,
      itemId: item.id,
      purchasedAt: dateOnly,
      qty: 5,
      price: 398,
      source: 'manual',
      sourceType: 'manual',
      purchasedByUserId: user.id,
      purchasedByUserName: user.name,
      fulfillmentStatus: 'received',
      inventoryEffectiveAt: dateOnly,
      countedInInventory: true,
    },
  });

  console.log('シード完了: demo@example.com / demo1234');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
