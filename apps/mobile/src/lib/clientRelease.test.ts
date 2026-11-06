import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLIENT_RELEASE, clientReleaseLabel } from './clientRelease';

test('アプリの版は番号と配信月日で表示する', () => {
  assert.match(CLIENT_RELEASE.deliveredOn, /^\d{4}-\d{2}-\d{2}$/);
  const [, month, day] = CLIENT_RELEASE.deliveredOn.split('-');
  assert.equal(clientReleaseLabel(), `${CLIENT_RELEASE.number}（${Number(month)}/${Number(day)}配信）`);
});
