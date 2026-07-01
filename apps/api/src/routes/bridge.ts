import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { bridgeCandidatesPayloadSchema } from '@stockhome/shared';
import { prisma } from '../lib/prisma';
import { parseBody } from '../utils/validate';
import { processBridgeCandidates } from '../services/candidateIntake';

// GAS ブリッジ用ルート（JWT ではなく共有トークンで認証）
// GAS の Gmail 取込（各ユーザーの個人トリガー）が解析済み候補を POST してくる
const bridgeRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req, reply) => {
    const expected = process.env.BRIDGE_TOKEN;
    if (!expected) {
      return reply.code(503).send({ message: 'BRIDGE_TOKEN が未設定です' });
    }
    const token =
      (req.headers['x-bridge-token'] as string | undefined) ??
      (req.body as { token?: string } | null)?.token;
    if (token !== expected) {
      return reply.code(401).send({ message: '認証に失敗しました' });
    }
  });

  app.get('/health', async () => ({ ok: true }));

  // 解析済み候補のバッチ投入
  app.post('/import-candidates', async (req, reply) => {
    const data = parseBody(bridgeCandidatesPayloadSchema, req.body, reply);
    if (!data) return;

    const result = await processBridgeCandidates(data.candidates);
    return { ok: true, ...result };
  });

  // ReadyGo 配信待ちキューの取得（GAS の夜間トリガーが呼ぶ）
  app.get('/readygo-pending', async () => {
    const rows = await prisma.readyGoOutbox.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    return { pending: rows.map((r) => ({ id: r.id, body: r.body })) };
  });

  // ReadyGo Inbox 投入完了の ACK
  // ここで初めて notification_log を記録する（投入成功時のみ記録、GAS 版の方針を踏襲）
  app.post('/readygo-ack', async (req, reply) => {
    const data = parseBody(z.object({ ids: z.array(z.string()).min(1) }), req.body, reply);
    if (!data) return;

    const now = new Date();
    let notified = 0;

    for (const id of data.ids) {
      const row = await prisma.readyGoOutbox.findUnique({ where: { id } });
      if (!row || row.status === 'delivered') continue;

      await prisma.readyGoOutbox.update({
        where: { id },
        data: { status: 'delivered', deliveredAt: now },
      });

      const alerts = row.alertsJson as { itemId: string; reason: string; line: string }[];
      for (const a of alerts) {
        try {
          await prisma.notificationLog.create({
            data: {
              householdId: row.householdId,
              itemId: a.itemId,
              notificationType: 'stock_alert',
              notificationReason: a.reason,
              targetUserId: 'broadcast',
              message: a.line,
            },
          });
          await prisma.itemRuntimeState.upsert({
            where: { itemId: a.itemId },
            create: {
              householdId: row.householdId,
              itemId: a.itemId,
              lastNotificationReason: a.reason,
              lastNotificationAt: now,
            },
            update: { lastNotificationReason: a.reason, lastNotificationAt: now },
          });
          notified++;
        } catch (e) {
          console.error('[bridge] notification_log 記録失敗:', a.itemId, e);
        }
      }
    }
    return { ok: true, notified };
  });
};

export default bridgeRoutes;
