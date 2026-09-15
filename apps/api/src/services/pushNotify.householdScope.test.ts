// household境界を維持する端末検索・更新のDB依存テスト（S007-B01対応）。
// ローカルDocker Postgres（DATABASE_URL、apps/api/.env）に対して実行する。
// Codexの非対話実行ではDBへ接続せず、Claudeの対話セッションで別途実行する。
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma';
import {
  findActiveDevicesForHouseholdUser,
  markDevicesPushed,
} from './pushNotify';

let scopeCounter = 0;

interface TestScope {
  householdAId: string;
  householdBId: string;
  userId: string;
  tag: string;
  cleanup: () => Promise<void>;
}

async function createTestScope(): Promise<TestScope> {
  scopeCounter += 1;
  const tag = `${Date.now()}-${scopeCounter}`;
  const householdA = await prisma.household.create({
    data: { name: `test-household-a-${tag}` },
  });
  const householdB = await prisma.household.create({
    data: { name: `test-household-b-${tag}` },
  });
  const user = await prisma.user.create({
    data: { email: `test-${tag}@example.invalid`, name: 'テスト太郎', passwordHash: 'x' },
  });
  await prisma.householdMember.create({
    data: { householdId: householdA.id, userId: user.id, role: 'admin' },
  });
  await prisma.householdMember.create({
    data: { householdId: householdB.id, userId: user.id, role: 'member' },
  });

  return {
    householdAId: householdA.id,
    householdBId: householdB.id,
    userId: user.id,
    tag,
    cleanup: async () => {
      await prisma.household.deleteMany({
        where: { id: { in: [householdA.id, householdB.id] } },
      });
      await prisma.user.delete({ where: { id: user.id } });
    },
  };
}

test('findActiveDevicesForHouseholdUserは同一userの端末をhouseholdごとに分離する', async () => {
  const scope = await createTestScope();
  try {
    const deviceA = await prisma.pushDevice.create({
      data: {
        householdId: scope.householdAId,
        userId: scope.userId,
        expoPushToken: `ExponentPushToken[scope-a-${scope.tag}]`,
        platform: 'android',
      },
    });
    const deviceB = await prisma.pushDevice.create({
      data: {
        householdId: scope.householdBId,
        userId: scope.userId,
        expoPushToken: `ExponentPushToken[scope-b-${scope.tag}]`,
        platform: 'ios',
      },
    });

    assert.deepEqual(await findActiveDevicesForHouseholdUser(scope.householdAId, scope.userId), [
      { id: deviceA.id, expoPushToken: deviceA.expoPushToken },
    ]);
    assert.deepEqual(await findActiveDevicesForHouseholdUser(scope.householdBId, scope.userId), [
      { id: deviceB.id, expoPushToken: deviceB.expoPushToken },
    ]);
  } finally {
    await scope.cleanup();
  }
});

test('findActiveDevicesForHouseholdUserは無効端末を除外する', async () => {
  const scope = await createTestScope();
  try {
    const activeDevice = await prisma.pushDevice.create({
      data: {
        householdId: scope.householdAId,
        userId: scope.userId,
        expoPushToken: `ExponentPushToken[active-${scope.tag}]`,
        platform: 'android',
      },
    });
    await prisma.pushDevice.create({
      data: {
        householdId: scope.householdAId,
        userId: scope.userId,
        expoPushToken: `ExponentPushToken[inactive-${scope.tag}]`,
        platform: 'android',
        isActive: false,
      },
    });

    assert.deepEqual(await findActiveDevicesForHouseholdUser(scope.householdAId, scope.userId), [
      { id: activeDevice.id, expoPushToken: activeDevice.expoPushToken },
    ]);
  } finally {
    await scope.cleanup();
  }
});

test('markDevicesPushedは対象householdの端末だけlastPushAtを更新する', async () => {
  const scope = await createTestScope();
  try {
    const deviceA = await prisma.pushDevice.create({
      data: {
        householdId: scope.householdAId,
        userId: scope.userId,
        expoPushToken: `ExponentPushToken[mark-a-${scope.tag}]`,
        platform: 'android',
      },
    });
    const deviceB = await prisma.pushDevice.create({
      data: {
        householdId: scope.householdBId,
        userId: scope.userId,
        expoPushToken: `ExponentPushToken[mark-b-${scope.tag}]`,
        platform: 'ios',
      },
    });

    await markDevicesPushed(scope.householdAId, scope.userId);

    const [reloadedA, reloadedB] = await Promise.all([
      prisma.pushDevice.findUniqueOrThrow({ where: { id: deviceA.id } }),
      prisma.pushDevice.findUniqueOrThrow({ where: { id: deviceB.id } }),
    ]);
    assert.ok(reloadedA.lastPushAt instanceof Date);
    assert.equal(reloadedB.lastPushAt, null);
  } finally {
    await scope.cleanup();
  }
});
