import { PrismaClient } from '@prisma/client';
import { appLogger, LOG_EVENTS } from './logger';

const isDevelopment = process.env.NODE_ENV === 'development';

export const prisma = new PrismaClient({
  log: [
    { level: 'error', emit: 'event' },
    ...(isDevelopment ? [{ level: 'warn' as const, emit: 'event' as const }] : []),
  ],
});

prisma.$on('error', (e) => {
  appLogger.error({ event: LOG_EVENTS.DB_CLIENT_LOG, target: e.target });
});

if (isDevelopment) {
  prisma.$on('warn', (e) => {
    appLogger.warn({ event: LOG_EVENTS.DB_CLIENT_LOG, target: e.target });
  });
}
