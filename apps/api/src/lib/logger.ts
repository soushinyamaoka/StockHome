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
} as const;

export const ERROR_KINDS = {
  EXTERNAL_API: 'external_api',
  DB: 'db',
  AUTH: 'auth',
  VALIDATION: 'validation',
  TIMEOUT: 'timeout',
  INTERNAL: 'internal',
} as const;

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
    ],
    remove: true,
  },
};

export type AppLogger = Logger<'critical'>;

export function createAppLogger(): AppLogger {
  return pino<'critical'>(loggerOptions);
}

export const appLogger = createAppLogger();
