import pino, { type Logger, type LoggerOptions } from 'pino';

export const LOG_EVENTS = {
  UNCLASSIFIED: 'unclassified',
  STARTUP: 'startup',
  SHUTDOWN: 'shutdown',
  JOB_START: 'job_start',
  JOB_END: 'job_end',
  HTTP_REQUEST: 'http_request',
  REQUEST_FAILED: 'request_failed',
  STARTUP_FAILED: 'startup_failed',
  UNCAUGHT_EXCEPTION: 'uncaught_exception',
  BATCH_STEP: 'batch_step',
  READYGO_QUEUED: 'readygo_queued',
  READYGO_ACK_FAILED: 'readygo_ack_failed',
  CANDIDATE_INTAKE_FAILED: 'candidate_intake_failed',
  DB_CLIENT_LOG: 'db_client_log',
  MIGRATION_START: 'migration_start',
  MIGRATION_END: 'migration_end',
  PUSH_SEND_FAILED: 'push_send_failed',
  // 「Expoがペイロードを受理した」ことを表す。端末への配信完了は意味しない
  // （実配信の可否は push_receipt_checked で判明する）
  PUSH_DISPATCHED: 'push_dispatched',
  PUSH_RECEIPT_CHECKED: 'push_receipt_checked',
  PUSH_RECEIPT_CHECK_FAILED: 'push_receipt_check_failed',
  PUSH_DEVICE_REGISTERED: 'push_device_registered',
  PUSH_TICKETS_CLEANED: 'push_tickets_cleaned',
} as const;

export const ERROR_KINDS = {
  EXTERNAL_API: 'external_api',
  DB: 'db',
  AUTH: 'auth',
  VALIDATION: 'validation',
  TIMEOUT: 'timeout',
  INTERNAL: 'internal',
} as const;

export function safeErr(e: unknown): { name?: string; code?: string } {
  if (e instanceof Error) {
    const code = (e as { code?: unknown }).code;
    return {
      name: e.name,
      ...(typeof code === 'string' ? { code } : {}),
    };
  }
  return {};
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function isoWithOffset(date = new Date()): string {
  const offsetMinutes = date.getTimezoneOffset();
  const offsetSign = offsetMinutes <= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = pad(Math.floor(absoluteOffset / 60));
  const offsetRemainderMinutes = pad(absoluteOffset % 60);

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${offsetSign}${offsetHours}:${offsetRemainderMinutes}`
  );
}

// 明示的にfd 1へ同期書き込みするdestination（プロセス強制終了時の最終行欠落を防ぐ）
const destination = pino.destination({ dest: 1, sync: true });

export const loggerOptions: LoggerOptions<'critical'> = {
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  base: { app: 'stockhome' },
  customLevels: { critical: 70 },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: () => `,"ts":"${isoWithOffset()}"`,
  mixin: () => ({ event: LOG_EVENTS.UNCLASSIFIED }),
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-bridge-token"]',
      'password',
      'passwordHash',
      'token',
      'jwt',
      '*.password',
      '*.token',
      'err.meta',
      'req.body.token',
      'body.token',
    ],
    remove: true,
  },
};

export type AppLogger = Logger<'critical'>;

export function createAppLogger(): AppLogger {
  return pino<'critical'>(loggerOptions, destination);
}

export const appLogger = createAppLogger();

export function flushLogs(): void {
  destination.flushSync();
}
