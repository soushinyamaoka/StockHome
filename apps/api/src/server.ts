import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import cron from 'node-cron';
import authPlugin from './plugins/auth';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import itemRoutes from './routes/items';
import purchaseRoutes from './routes/purchases';
import stockRoutes from './routes/stocks';
import correctionRoutes from './routes/corrections';
import importCandidateRoutes from './routes/importCandidates';
import notificationRoutes from './routes/notifications';
import dashboardRoutes from './routes/dashboard';
import appConfigRoutes from './routes/appConfig';
import bridgeRoutes from './routes/bridge';
import { runDailyBatch } from './services/batch';

async function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
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
    await instance.register(notificationRoutes, { prefix: '/api/notifications' });
    await instance.register(dashboardRoutes, { prefix: '/api/dashboard' });
    await instance.register(appConfigRoutes, { prefix: '/api/app-config' });
  });

  return app;
}

(async () => {
  try {
    const app = await buildServer();
    const port = Number(process.env.PORT) || 4002;
    const host = process.env.HOST || '0.0.0.0';
    await app.listen({ port, host });
    app.log.info(`StockHome API listening on http://${host}:${port}`);

    // 夜間バッチ: 毎日 19:55 JST
    // （GAS の夜間トリガー(20時台)がキューを取得 → ReadyGo の 21:00 LINE 配信に載る）
    cron.schedule(
      '55 19 * * *',
      async () => {
        try {
          await runDailyBatch();
        } catch (e) {
          app.log.error(e, '夜間バッチでエラー');
        }
      },
      { timezone: 'Asia/Tokyo' }
    );
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
