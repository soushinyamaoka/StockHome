import 'dotenv/config';
import Fastify from 'fastify';
import type { FastifyError, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import cron, { type ScheduledTask } from 'node-cron';
import { STATUS_CODES } from 'node:http';
import authPlugin from './plugins/auth';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import itemRoutes from './routes/items';
import purchaseRoutes from './routes/purchases';
import stockRoutes from './routes/stocks';
import correctionRoutes from './routes/corrections';
import importCandidateRoutes from './routes/importCandidates';
import reflectionRoutes from './routes/reflections';
import notificationRoutes from './routes/notifications';
import dashboardRoutes from './routes/dashboard';
import appConfigRoutes from './routes/appConfig';
import bridgeRoutes from './routes/bridge';
import pushDeviceRoutes from './routes/pushDevices';
import {
  appLogger,
  ERROR_KINDS,
  LOG_EVENTS,
  safeErr,
  type AppLogger,
} from './lib/logger';
import { runDailyBatch } from './services/batch';

function routePattern(request: FastifyRequest): string {
  return request.routeOptions.url || 'unmatched';
}

function isDatabaseError(error: FastifyError): boolean {
  return typeof error.name === 'string' && error.name.startsWith('PrismaClient');
}

function errorKind(error: FastifyError, statusCode: number) {
  if (isDatabaseError(error)) return ERROR_KINDS.DB;
  if (statusCode === 401 || statusCode === 403) return ERROR_KINDS.AUTH;
  if (statusCode >= 400 && statusCode < 500) return ERROR_KINDS.VALIDATION;
  return ERROR_KINDS.INTERNAL;
}

async function buildServer(logger: AppLogger) {
  const app = Fastify({
    loggerInstance: logger,
    disableRequestLogging: true,
  });

  app.addHook('onResponse', async (request, reply) => {
    const line = {
      event: LOG_EVENTS.HTTP_REQUEST,
      method: request.method,
      route: routePattern(request),
      status: reply.statusCode,
      duration_ms: Math.round(reply.elapsedTime),
    };
    if (reply.statusCode >= 500) {
      request.log.error(line);
    } else {
      request.log.info(line);
    }
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const candidateStatus = error.statusCode;
    const statusCode =
      candidateStatus && candidateStatus >= 400 && candidateStatus < 600
        ? candidateStatus
        : 500;

    request.log.error({
      event: LOG_EVENTS.REQUEST_FAILED,
      method: request.method,
      route: routePattern(request),
      status: statusCode,
      error_kind: errorKind(error, statusCode),
      err: safeErr(error),
    });

    const clientMessage =
      statusCode >= 500 ? (STATUS_CODES[statusCode] ?? 'Internal Server Error') : error.message;

    return reply.status(statusCode).send({
      statusCode,
      error: STATUS_CODES[statusCode] ?? 'Internal Server Error',
      message: clientMessage,
    });
  });

  // fastify@5 の既定JSONパーサは空ボディを拒否するので、空文字を{}として扱う
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = (body as string) ?? '';
    if (text.trim() === '') {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  await app.register(cors, { origin: true });
  await app.register(sensible);
  await app.register(authPlugin);

  app.get('/health', async () => ({ status: 'ok' }));

  // 認証不要
  await app.register(authRoutes, { prefix: '/api/auth' });

  // GAS ブリッジ（共有トークン認証）
  await app.register(bridgeRoutes, { prefix: '/api/bridge' });

  // 認証必須
  await app.register(async (instance) => {
    instance.addHook('preHandler', instance.authenticate);
    await instance.register(userRoutes, { prefix: '/api/users' });
    await instance.register(itemRoutes, { prefix: '/api/items' });
    await instance.register(purchaseRoutes, { prefix: '/api' });
    await instance.register(stockRoutes, { prefix: '/api/stocks' });
    await instance.register(correctionRoutes, { prefix: '/api' });
    await instance.register(importCandidateRoutes, { prefix: '/api/import-candidates' });
    await instance.register(reflectionRoutes, { prefix: '/api/reflections' });
    await instance.register(notificationRoutes, { prefix: '/api/notifications' });
    await instance.register(dashboardRoutes, { prefix: '/api/dashboard' });
    await instance.register(appConfigRoutes, { prefix: '/api/app-config' });
    await instance.register(pushDeviceRoutes, { prefix: '/api/push-devices' });
  });

  return app;
}

let app: Awaited<ReturnType<typeof buildServer>> | undefined;
let dailyBatchTask: ScheduledTask | undefined;
let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  appLogger.info({ event: LOG_EVENTS.SHUTDOWN });
  dailyBatchTask?.stop();
  if (app) await app.close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('uncaughtException', (err) => {
  appLogger.critical({ event: LOG_EVENTS.UNCAUGHT_EXCEPTION, err });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error('Unhandled rejection');
  appLogger.critical({ event: LOG_EVENTS.UNCAUGHT_EXCEPTION, err });
  process.exit(1);
});

(async () => {
  try {
    app = await buildServer(appLogger);
    const port = Number(process.env.PORT) || 4002;
    const host = process.env.HOST || '0.0.0.0';
    const previousLevel = appLogger.level;
    appLogger.level = 'silent';
    try {
      await app.listen({ port, host });
    } finally {
      appLogger.level = previousLevel;
    }
    app.log.info({ event: LOG_EVENTS.STARTUP });

    // 夜間バッチ: 毎日 19:55 JST
    // （GAS の夜間トリガー(20時台)がキューを取得 → ReadyGo の 21:00 LINE 配信に載る）
    dailyBatchTask = cron.schedule(
      '55 19 * * *',
      async () => {
        try {
          await runDailyBatch(appLogger);
        } catch {}
      },
      { timezone: 'Asia/Tokyo' }
    );
  } catch (err) {
    appLogger.critical({ event: LOG_EVENTS.STARTUP_FAILED, err });
    process.exit(1);
  }
})();
