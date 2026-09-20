import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { bridgeCandidatesPayloadSchema, reparseCandidatesQuerySchema, reparseCandidatesPayloadSchema } from '@stockhome/shared';
import { appLogger, ERROR_KINDS, LOG_EVENTS, safeErr } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { parseBody } from '../utils/validate';
import { processBridgeCandidates } from '../services/candidateIntake';
import {
  getReparseRunProgress,
  getReparseTargets,
  processReparseResults,
  ReparseRunInvalidError,
} from '../services/priceReparse';

// GAS ブリッジ用ルート（JWT ではなく共有トークンで認証）
// GAS の Gmail 取込（各ユーザーの個人トリガー）が解析済み候補を POST してくる
const RECLAIM_LEASE_MS = 30 * 60 * 1000;

// 未ACKのままlease切れとなったclaimed行を、household単位で個別に回収する
// （S014-B06: daily_batchの並行insertとの原子性対応）。household当たり
// pendingは最大1件というpartial unique indexがあるため、reclaim先の
// pendingへの更新は「他householdの回収を巻き込まない単一行のupdateMany」で
// 試み、一意制約違反（P2002）を捕捉したら「同一householdへの新しいpending
// 行が並行して作られた＝このstale行はsupersede済み」とみなして削除に
// フォールバックする。batch.tsのupsertPendingReadyGoRowと同じ
// insert→catch P2002→フォールバックの作法をreclaimにも適用したもの。
async function reclaimStaleClaims(leaseThreshold: Date): Promise<void> {
  const stale = await prisma.readyGoOutbox.findMany({
    where: { status: 'claimed', claimedAt: { lt: leaseThreshold } },
    select: { id: true },
  });
  for (const { id } of stale) {
    try {
      await prisma.readyGoOutbox.updateMany({
        where: { id, status: 'claimed', claimedAt: { lt: leaseThreshold } },
        data: { status: 'pending', claimedAt: null },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        await prisma.readyGoOutbox.deleteMany({ where: { id, status: 'claimed' } });
      } else {
        throw e;
      }
    }
  }
}

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

  const REPARSE_TOKEN_HEADER = 'x-reparse-run-token';

  app.get('/health', async () => ({ ok: true }));

  // 過去候補の単価再解析: 対象一覧の取得（notice 20260907-STOCKHOME-006）
  // HISTORICAL_REPARSE_ENABLED が 'true' の間だけ有効な一時的route。
  // runTokenは専用headerで受け取る（query stringに載せない。第3回レビューB03:
  // bearer secretがaccess logへ残ることを防ぐ）
  app.get('/reparse-candidates', async (req, reply) => {
    if (process.env.HISTORICAL_REPARSE_ENABLED !== 'true') {
      return reply.code(404).send({ message: 'not found' });
    }
    const runToken = req.headers[REPARSE_TOKEN_HEADER] as string | undefined;
    if (!runToken) {
      return reply.code(404).send({ message: 'not found' });
    }
    const query = parseBody(reparseCandidatesQuerySchema, req.query, reply);
    if (!query) return;
    try {
      const candidates = await getReparseTargets(runToken, query.cursor, query.limit ?? 20);
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
    const runToken = req.headers[REPARSE_TOKEN_HEADER] as string | undefined;
    if (!runToken) {
      return reply.code(404).send({ message: 'not found' });
    }
    const data = parseBody(reparseCandidatesPayloadSchema, req.body, reply);
    if (!data) return;

    if (data.mode === 'write' && process.env.HISTORICAL_REPARSE_WRITE_ENABLED !== 'true') {
      return reply.code(403).send({ message: 'write mode is not enabled' });
    }

    let counts;
    try {
      counts = await processReparseResults(runToken, data.mode, data.results);
    } catch (e) {
      if (e instanceof ReparseRunInvalidError) {
        return reply.code(404).send({ message: 'not found' });
      }
      throw e;
    }

    appLogger.info({
      event: LOG_EVENTS.BATCH_STEP,
      job: 'historical_price_reparse',
      step: data.mode,
      ...counts,
    });
    return { mode: data.mode, summary: counts };
  });

  // 過去候補の単価再解析: runの進捗確認（notice 20260907-STOCKHOME-006、
  // 第5回レビューR5-02対応）。期限切れ・失効後のrunでも進捗を確認できる
  // （getReparseRunProgressはfindActiveRunを使わない）
  app.get('/reparse-progress', async (req, reply) => {
    if (process.env.HISTORICAL_REPARSE_ENABLED !== 'true') {
      return reply.code(404).send({ message: 'not found' });
    }
    const runToken = req.headers[REPARSE_TOKEN_HEADER] as string | undefined;
    if (!runToken) {
      return reply.code(404).send({ message: 'not found' });
    }
    try {
      const progress = await getReparseRunProgress(runToken);
      return progress;
    } catch (e) {
      if (e instanceof ReparseRunInvalidError) {
        return reply.code(404).send({ message: 'not found' });
      }
      throw e;
    }
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
    const leaseThreshold = new Date(Date.now() - RECLAIM_LEASE_MS);
    await reclaimStaleClaims(leaseThreshold);

    const claimed = await prisma.$queryRaw<{ id: string; body: string }[]>`
      WITH claimed_rows AS (
        UPDATE readygo_outbox
        SET status = 'claimed', claimed_at = now()
        WHERE id IN (
          SELECT id FROM readygo_outbox
          WHERE status = 'pending'
          ORDER BY created_at ASC
          LIMIT 20
          FOR UPDATE SKIP LOCKED
        )
        AND status = 'pending'
        RETURNING id, body, created_at
      )
      SELECT id, body FROM claimed_rows ORDER BY created_at ASC
    `;
    return { pending: claimed };
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
      if (!row || row.status !== 'claimed') continue;

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
