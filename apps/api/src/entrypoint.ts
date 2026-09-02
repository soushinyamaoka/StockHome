import { spawn, type ChildProcess } from 'node:child_process';
import { appLogger, flushLogs, LOG_EVENTS } from './lib/logger';

const PRISMA_SCHEMA = 'prisma/schema.prisma';

function durationSince(startedAt: number): number {
  return Date.now() - startedAt;
}

function prismaErrorCode(output: string): string | null {
  return output.match(/\bP\d{4}\b/)?.[0] ?? null;
}

function failEntrypoint(): never {
  appLogger.critical({ event: LOG_EVENTS.STARTUP_FAILED });
  flushLogs();
  process.exit(1);
}

export async function runMigrations(): Promise<number> {
  const startedAt = Date.now();
  appLogger.info({ event: LOG_EVENTS.MIGRATION_START, schema: PRISMA_SCHEMA });

  try {
    const prismaCli = require.resolve('prisma/build/index.js');

    return await new Promise<number>((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;

      const child = spawn(
        process.execPath,
        [prismaCli, 'migrate', 'deploy', '--schema', PRISMA_SCHEMA],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            PRISMA_HIDE_UPDATE_MESSAGE: 'true',
          },
        }
      );

      child.stdout.on('data', (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      const finish = (exitCode: number) => {
        if (settled) return;
        settled = true;

        if (exitCode === 0) {
          const match = stdout.match(/(\d+)\s+migrations?\s+found/i);
          appLogger.info({
            event: LOG_EVENTS.MIGRATION_END,
            status: 'success',
            exit_code: 0,
            duration_ms: durationSince(startedAt),
            migrations_found: match ? Number.parseInt(match[1], 10) : null,
          });
        } else {
          appLogger.critical({
            event: LOG_EVENTS.MIGRATION_END,
            status: 'failure',
            exit_code: exitCode,
            duration_ms: durationSince(startedAt),
            prisma_error_code: prismaErrorCode(stdout + stderr),
          });
        }

        resolve(exitCode);
      };

      child.once('error', () => finish(1));
      child.once('close', (code) => finish(code ?? 1));
    });
  } catch {
    appLogger.critical({
      event: LOG_EVENTS.MIGRATION_END,
      status: 'failure',
      exit_code: 1,
      duration_ms: durationSince(startedAt),
      prisma_error_code: null,
    });
    return 1;
  }
}

export function startServer(): void {
  const child: ChildProcess = spawn(process.execPath, ['dist/server.js'], {
    stdio: 'inherit',
  });
  let settled = false;

  const handleSignal = (signal: NodeJS.Signals) => {
    try {
      child.kill(signal);
    } catch {
      failEntrypoint();
    }
  };
  const handleSigterm = () => handleSignal('SIGTERM');
  const handleSigint = () => handleSignal('SIGINT');

  const removeSignalHandlers = () => {
    process.removeListener('SIGTERM', handleSigterm);
    process.removeListener('SIGINT', handleSigint);
  };

  process.on('SIGTERM', handleSigterm);
  process.on('SIGINT', handleSigint);

  child.once('error', () => {
    if (settled) return;
    settled = true;
    removeSignalHandlers();
    failEntrypoint();
  });

  child.once('exit', (code, signal) => {
    if (settled) return;
    settled = true;
    removeSignalHandlers();

    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

async function main(): Promise<void> {
  const migrationExitCode = await runMigrations();
  if (migrationExitCode !== 0) {
    flushLogs();
    process.exit(migrationExitCode);
  }

  startServer();
}

process.once('uncaughtException', () => failEntrypoint());
process.once('unhandledRejection', () => failEntrypoint());

void main().catch(() => failEntrypoint());
