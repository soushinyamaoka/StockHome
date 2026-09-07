import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { bridgeCandidatesPayloadSchema, reparseCandidatesQuerySchema, reparseCandidatesPayloadSchema } from '@stockhome/shared';
import { appLogger, ERROR_KINDS, LOG_EVENTS, safeErr } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { parseBody } from '../utils/validate';
import { processBridgeCandidates } from '../services/candidateIntake';
import { getReparseTargets, processReparseResults, ReparseRunInvalidError } from '../services/priceReparse';

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

  // 過去候補の単価再解析: 対象一覧の取得（notice 20260907-STOCKHOME-006 B02/B03対応）
  // HISTORICAL_REPARSE_ENABLED が 'true' の間だけ有効な一時的route。
  // mail_message_id は個人のGmailを参照する識別子のため、事前発行したrunTokenから
  // server側でownerを確定し、そのownerの候補だけに対象を絞る。
  app.get('/reparse-candidates', async (req, reply) => {
    if (process.env.HISTORICAL_REPARSE_ENABLED !== 'true') {
      return reply.code(404).send({ message: 'not found' });
    }
    const query = parseBody(reparseCandidatesQuerySchema, req.query, reply);
    if (!query) return;
    try {
      const candidates = await getReparseTargets(query.runToken, query.cursor, query.limit ?? 20);
      return { candidates };
    } catch (e) {
      if (e instanceof ReparseRunInvalidError) {
        return reply.code(404).send({ message: 'not found' });
      }
      throw e;
    }
  });

  // 過去候補の単価再解析: 結果の反映（dry_run/write。notice 20260907-STOCKHOME-006）
  app.post('/reparse-candidates', async (req, reply) => {
    if (process.env.HISTORICAL_REPARSE_ENABLED !== 'true') {
      return reply.code(404).send({ message: 'not found' });
    }
    const data = parseBody(reparseCandidatesPayloadSchema, req.body, reply);
    if (!data) return;

    let counts;
    try {
      counts = await processReparseResults(data.runToken, data.mode, data.results);
    } catch (e) {
      if (e instanceof ReparseRunInvalidError) {
        return reply.code(404).send({ message: 'not found' });
      }
      throw e;
    }

    // run単位のstart/endではなく、chunk（1回のPOST）単位のBATCH_STEPとして記録する。
    // run_id・email・message_id・金額等の個別値は出さず、集計値のみ
    appLogger.info({
      event: LOG_EVENTS.BATCH_STEP,
      job: 'historical_price_reparse',
      step: data.mode,
      ...counts,
    });
    return { mode: data.mode, summary: counts };
  });

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
          app.log.warn({
            event: LOG_EVENTS.READYGO_ACK_FAILED,
            item_id: a.itemId,
            error_kind: ERROR_KINDS.DB,
            err: safeErr(e),
          });
        }
      }
    }
    return { ok: true, notified };
  });
};

export default bridgeRoutes;
