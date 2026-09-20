import 'dotenv/config';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prisma } from '../lib/prisma';
import { resolveHouseholdId } from './candidateIntake';

test('resolveHouseholdIdはメール解決を優先し、未指定時は既存householdへフォールバックする', async () => {
  const tag = `${Date.now()}`;
  const householdA = await prisma.household.create({ data: { name: `household-fallback-a-${tag}` } });
  const householdB = await prisma.household.create({ data: { name: `household-fallback-b-${tag}` } });
  const user = await prisma.user.create({
    data: {
      email: `household-fallback-${tag}@example.invalid`,
      name: 'Household fallback test user',
      passwordHash: 'x',
    },
  });
  await prisma.householdMember.create({
    data: { householdId: householdA.id, userId: user.id, role: 'admin' },
  });

  try {
    assert.equal(await resolveHouseholdId(user.email), householdA.id);

    const fallbackId = await resolveHouseholdId(undefined);
    assert.ok(fallbackId);
    assert.ok([householdA.id, householdB.id].includes(fallbackId));
  } finally {
    await prisma.household.deleteMany({ where: { id: { in: [householdA.id, householdB.id] } } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});
