import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isNotifyTargetForUser,
  resolveNotifyTargetUserIds,
  type NotifyMember,
} from './notifyTarget';

const members: NotifyMember[] = [
  { userId: 'admin-active', role: 'admin', isActive: true },
  { userId: 'member-active', role: 'member', isActive: true },
  { userId: 'admin-inactive', role: 'admin', isActive: false },
  { userId: 'member-inactive', role: 'member', isActive: false },
];

test('all: roleに関係なく表示し、有効メンバー全員を通知対象にする', () => {
  const item = { notifyTargetType: 'all', notifyTargetUserId: null };

  assert.equal(isNotifyTargetForUser(item, 'admin-active', 'admin'), true);
  assert.equal(isNotifyTargetForUser(item, 'member-active', 'member'), true);
  assert.deepEqual(resolveNotifyTargetUserIds(item, members), [
    'admin-active',
    'member-active',
  ]);
});

test('representative: adminだけに表示し、有効なadminだけを通知対象にする', () => {
  const item = { notifyTargetType: 'representative', notifyTargetUserId: null };

  assert.equal(isNotifyTargetForUser(item, 'admin-active', 'admin'), true);
  assert.equal(isNotifyTargetForUser(item, 'member-active', 'member'), false);
  assert.deepEqual(resolveNotifyTargetUserIds(item, members), ['admin-active']);
});

test('specific_user: 指定ユーザーだけに表示し、その有効メンバーだけを通知対象にする', () => {
  const item = { notifyTargetType: 'specific_user', notifyTargetUserId: 'member-active' };

  assert.equal(isNotifyTargetForUser(item, 'member-active', 'member'), true);
  assert.equal(isNotifyTargetForUser(item, 'admin-active', 'admin'), false);
  assert.deepEqual(resolveNotifyTargetUserIds(item, members), ['member-active']);
});

test('specific_user: notifyTargetUserIdがnullなら通知対象はいない', () => {
  const item = { notifyTargetType: 'specific_user', notifyTargetUserId: null };

  assert.deepEqual(resolveNotifyTargetUserIds(item, members), []);
});

test('specific_user: 指定ユーザーが世帯メンバーでなければ通知対象はいない', () => {
  const item = { notifyTargetType: 'specific_user', notifyTargetUserId: 'not-a-member' };

  assert.deepEqual(resolveNotifyTargetUserIds(item, members), []);
});

test('無効メンバーはall・representative・specific_userのいずれでも通知対象外になる', () => {
  assert.deepEqual(
    resolveNotifyTargetUserIds({ notifyTargetType: 'all', notifyTargetUserId: null }, members),
    ['admin-active', 'member-active']
  );
  assert.deepEqual(
    resolveNotifyTargetUserIds(
      { notifyTargetType: 'representative', notifyTargetUserId: null },
      members
    ),
    ['admin-active']
  );
  assert.deepEqual(
    resolveNotifyTargetUserIds(
      { notifyTargetType: 'specific_user', notifyTargetUserId: 'member-inactive' },
      members
    ),
    []
  );
});
