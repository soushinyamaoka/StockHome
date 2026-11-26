// 拒否の本人通知（alertApiTokenDenied）のDB依存テスト。Codexの非対話実行では実行しない。
// notice 029 差し戻し（2026-11-26）の回帰テスト: 通知結果のログ分類（対象なし・全件失敗）と、通知先の確認（発行者の無効化・所属解除）
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import { prisma } from '../lib/prisma';
import { loggerOptions, type AppLogger } from '../lib/logger';
import { alertApiTokenDenied } from './apiTokenAlerts';
import { generateApiToken } from './apiTokens';

function captureLogger() {
  const lines: Record<string, unknown>[] = [];
  const logger: AppLogger = pino<'critical'>(loggerOptions, { write: (line: string) => void lines.push(JSON.parse(line)) });
  const events = (name: string) => lines.filter((l) => l.event === name);
  return { logger, lines, events };
}

// Expo のプッシュ送信のスタブ。端末ごとの受理結果を ticketStatuses で指定する（httpStatus が200以外なら送信自体の失敗）
function stubExpo(options: { ticketStatuses?: ('ok' | 'error')[]; httpStatus?: number } = {}) {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async (_url: string, init: { body: string }) => {
    calls++;
    const messages = JSON.parse(init.body) as unknown[];
    if (options.httpStatus && options.httpStatus !== 200) return new Response('{}', { status: options.httpStatus });
    const statuses = options.ticketStatuses ?? messages.map(() => 'ok');
    return new Response(
      JSON.stringify({
        data: messages.map((_, i) =>
          statuses[i] === 'ok'
            ? { status: 'ok', id: `alert-test-${Date.now()}-${i}` }
            : { status: 'error', details: { error: 'MessageRateExceeded' } }
        ),
      }),
      { status: 200 }
    );
  };
  return { calls: () => calls, restore: () => ((globalThis as any).fetch = originalFetch) };
}

let counter = 0;
async function createOwner(devices: number) {
  const tag = `${Date.now()}-${++counter}`;
  const household = await prisma.household.create({ data: { name: `alert-${tag}` } });
  const user = await prisma.user.create({
    data: { email: `alert-${tag}@example.invalid`, name: 'Owner', passwordHash: 'test-only' },
  });
  await prisma.householdMember.create({ data: { householdId: household.id, userId: user.id, role: 'member' } });
  for (let i = 0; i < devices; i++) {
    await prisma.pushDevice.create({
      data: { householdId: household.id, userId: user.id, expoPushToken: `ExponentPushToken[alert-${tag}-${i}]`, platform: 'ios' },
    });
  }
  const { tokenHash, tokenPrefix } = generateApiToken();
  const token = await prisma.apiToken.create({
    data: { householdId: household.id, userId: user.id, name: 'Muse', tokenHash, tokenPrefix, revokedAt: new Date() },
  });
  return {
    household,
    user,
    token,
    cleanup: async () => {
      await prisma.household.deleteMany({ where: { id: household.id } });
      await prisma.user.deleteMany({ where: { id: user.id } });
    },
  };
}

async function run(
  devices: number,
  expo: Parameters<typeof stubExpo>[0],
  body: (ctx: Awaited<ReturnType<typeof createOwner>> & ReturnType<typeof captureLogger> & { expo: ReturnType<typeof stubExpo> }) => Promise<void>
) {
  const owner = await createOwner(devices);
  const log = captureLogger();
  const expoStub = stubExpo(expo);
  try {
    await body({ ...owner, ...log, expo: expoStub });
  } finally {
    expoStub.restore();
    await owner.cleanup();
  }
}

test('1台以上で受理されたら sent。一部の端末が失敗しても sent で、失敗数を残す', () =>
  run(2, { ticketStatuses: ['ok', 'error'] }, async ({ token, logger, events }) => {
    assert.equal(await alertApiTokenDenied(token, 'revoked', logger), 'sent');
    const [sent] = events('api_token_alert_sent');
    assert.deepEqual([sent?.push_targeted, sent?.push_accepted, sent?.push_failed], [2, 1, 1]);
    assert.equal(events('api_token_alert_failed').length, 0);
    assert.equal(events('api_token_alert_no_target').length, 0);
  }));

test('有効な端末が無ければ no_target（cause: no_active_device）で、sent を出さない', () =>
  run(0, {}, async ({ token, logger, events, expo }) => {
    assert.equal(await alertApiTokenDenied(token, 'write_not_allowed', logger), 'no_target');
    assert.equal(expo.calls(), 0);
    const [noTarget] = events('api_token_alert_no_target');
    assert.equal(noTarget?.cause, 'no_active_device');
    assert.equal(noTarget?.push_targeted, 0);
    assert.equal(events('api_token_alert_sent').length, 0);
  }));

test('送る先の端末がすべて受理されなければ failed（cause: push_not_accepted）で、sent を出さない', () =>
  run(2, { ticketStatuses: ['error', 'error'] }, async ({ token, logger, events }) => {
    assert.equal(await alertApiTokenDenied(token, 'denied_route', logger), 'failed');
    const [failed] = events('api_token_alert_failed');
    assert.deepEqual([failed?.cause, failed?.push_targeted, failed?.push_accepted, failed?.push_failed], ['push_not_accepted', 2, 0, 2]);
    assert.equal(events('api_token_alert_sent').length, 0);
  }));

test('Expo への送信自体が失敗しても failed で、sent を出さない', () =>
  run(1, { httpStatus: 400 }, async ({ token, logger, events }) => {
    assert.equal(await alertApiTokenDenied(token, 'revoked', logger), 'failed');
    assert.equal(events('api_token_alert_failed')[0]?.cause, 'push_not_accepted');
    assert.equal(events('api_token_alert_sent').length, 0);
  }));

test('24時間以内の2回目は throttled で、送信もログもしない', () =>
  run(1, {}, async ({ token, logger, lines, expo }) => {
    assert.equal(await alertApiTokenDenied(token, 'revoked', logger), 'sent');
    const before = lines.length;
    assert.equal(await alertApiTokenDenied(token, 'revoked', logger), 'throttled');
    assert.equal(expo.calls(), 1);
    assert.equal(lines.length, before);
  }));

test('発行者が無効化されていたら、端末があっても送らない（no_target、cause: owner_inactive）', () =>
  run(1, {}, async ({ token, user, logger, events, expo }) => {
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    assert.equal(await alertApiTokenDenied(token, 'revoked', logger), 'no_target');
    assert.equal(expo.calls(), 0);
    assert.equal(events('api_token_alert_no_target')[0]?.cause, 'owner_inactive');
    // 通知済みの印も付けない（再び有効になった後の拒否は通知される）
    const row = await prisma.apiToken.findUniqueOrThrow({ where: { id: token.id } });
    assert.equal(row.lastAlertedAt, null);
  }));

test('発行者がその家庭から外れていたら、端末が残っていても送らない（no_target、cause: owner_not_member）', () =>
  run(1, {}, async ({ token, user, household, logger, events, expo }) => {
    await prisma.householdMember.deleteMany({ where: { householdId: household.id, userId: user.id } });
    assert.equal(await alertApiTokenDenied(token, 'revoked', logger), 'no_target');
    assert.equal(expo.calls(), 0);
    assert.equal(events('api_token_alert_no_target')[0]?.cause, 'owner_not_member');
  }));
