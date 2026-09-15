import type { Item, StockSnapshot } from '@prisma/client';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupNewAlertsByHouseholdUser,
  type AlertTarget,
} from './batch';
import type { NotifyMember } from './notifyTarget';

function makeTarget(
  id: string,
  householdId: string,
  notifyTargetType: string,
  notifyTargetUserId: string | null = null
): AlertTarget {
  return {
    item: {
      id,
      householdId,
      notifyTargetType,
      notifyTargetUserId,
    } as unknown as Item,
    snapshot: {} as StockSnapshot,
    reason: 'days_threshold',
  };
}

test('同一userが所属する2householdの品目を別グループに分離する', () => {
  const userId = 'shared-user';
  const targetA = makeTarget('item-a', 'household-a', 'all');
  const targetB = makeTarget('item-b', 'household-b', 'all');
  const membersByHousehold = new Map<string, NotifyMember[]>([
    ['household-a', [{ userId, role: 'member', isActive: true }]],
    ['household-b', [{ userId, role: 'member', isActive: true }]],
  ]);

  const groups = groupNewAlertsByHouseholdUser([targetA, targetB], membersByHousehold);
  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map((group) => ({
      householdId: group.householdId,
      userId: group.userId,
      itemIds: group.targets.map((target) => target.item.id),
    })),
    [
      { householdId: 'household-a', userId, itemIds: ['item-a'] },
      { householdId: 'household-b', userId, itemIds: ['item-b'] },
    ]
  );
});

test('同一householdのall対象品目をユーザーごとのグループに分ける', () => {
  const target = makeTarget('item-a', 'household-a', 'all');
  const membersByHousehold = new Map<string, NotifyMember[]>([
    [
      'household-a',
      [
        { userId: 'admin-user', role: 'admin', isActive: true },
        { userId: 'member-user', role: 'member', isActive: true },
      ],
    ],
  ]);

  const groups = groupNewAlertsByHouseholdUser([target], membersByHousehold);
  assert.deepEqual(
    groups.map((group) => ({
      householdId: group.householdId,
      userId: group.userId,
      itemIds: group.targets.map((entry) => entry.item.id),
    })),
    [
      { householdId: 'household-a', userId: 'admin-user', itemIds: ['item-a'] },
      { householdId: 'household-a', userId: 'member-user', itemIds: ['item-a'] },
    ]
  );
});

test('specific_userの対象がhouseholdメンバーでなければグループを作らない', () => {
  const target = makeTarget(
    'item-a',
    'household-a',
    'specific_user',
    'not-a-member'
  );
  const membersByHousehold = new Map<string, NotifyMember[]>([
    ['household-a', [{ userId: 'member-user', role: 'member', isActive: true }]],
  ]);

  assert.deepEqual(groupNewAlertsByHouseholdUser([target], membersByHousehold), []);
});
