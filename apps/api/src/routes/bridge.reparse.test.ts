import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import Fastify from 'fastify';
import bridgeRoutes from './bridge';

function buildTestApp() {
  const app = Fastify();
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
  return app;
}

const BRIDGE_TOKEN = 'test-bridge-token';
const REPARSE_HEADER = 'x-reparse-run-token';

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) previous[key] = process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return fn().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function captureFailingRequestStdout(runToken: string): Promise<string> {
  const script = `
    import 'dotenv/config';
    import Fastify from 'fastify';
    import bridgeRoutes from './src/routes/bridge.ts';

    const app = Fastify();
    app.removeContentTypeParser('application/json');
    app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
      const text = body ?? '';
      if (text.trim() === '') return done(null, {});
      try { done(null, JSON.parse(text)); } catch (error) { done(error, undefined); }
    });
    await app.register(bridgeRoutes, { prefix: '/api/bridge' });
    await app.ready();
    const response = await app.inject({
      method: 'POST',
      url: '/api/bridge/reparse-candidates',
      headers: {
        'x-bridge-token': process.env.BRIDGE_TOKEN,
        'x-reparse-run-token': process.env.REPARSE_TEST_TOKEN,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ mode: 'dry_run', results: [] }),
    });
    await app.close();
    if (response.statusCode !== 404) process.exitCode = 1;
  `;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BRIDGE_TOKEN,
        HISTORICAL_REPARSE_ENABLED: 'true',
        REPARSE_TEST_TOKEN: runToken,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`stdout probe child failed with exit code ${code}: ${stderr}`));
    });
  });
}

async function captureProductionPathStdout(
  scenario: 'success' | 'infrastructure_failure',
  runToken: string
): Promise<{ stdout: string; stderr: string }> {
  const script = `
    import 'dotenv/config';
    import Fastify from 'fastify';
    import bridgeRoutes from './src/routes/bridge.ts';
    import { registerHttpErrorHandling } from './src/lib/httpErrorHandling.ts';
    import { appLogger } from './src/lib/logger.ts';
    import { prisma } from './src/lib/prisma.ts';

    const app = Fastify({ loggerInstance: appLogger, disableRequestLogging: true });
    registerHttpErrorHandling(app);
    app.removeContentTypeParser('application/json');
    app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
      const text = body ?? '';
      if (text.trim() === '') return done(null, {});
      try { done(null, JSON.parse(text)); } catch (error) { done(error, undefined); }
    });

    const scenario = process.env.REPARSE_TEST_SCENARIO;
    const runToken = process.env.REPARSE_TEST_TOKEN;
    let householdId;
    let runId;
    let candidateId;
    const runDelegate = prisma.priceReparseRun;
    const originalFindUnique = runDelegate.findUnique;

    try {
      if (scenario === 'success') {
        const household = await prisma.household.create({
          data: { name: 'bridge-reparse-log-test-' + Date.now() },
        });
        householdId = household.id;
        const candidate = await prisma.importOrderCandidate.create({
          data: {
            householdId,
            vendor: 'amazon',
            mailMessageId: 'bridge-reparse-log-test-' + Date.now(),
            importedByEmail: 'owner@example.invalid',
            mailDate: new Date('2026-09-01T00:00:00.000Z'),
            mailType: 'order_confirm',
            mailPhase: 'ordered',
            itemNameRaw: 'bridge reparse log test item',
            candidateStatus: 'detected',
          },
        });
        candidateId = candidate.id;
        const run = await prisma.priceReparseRun.create({
          data: {
            runToken,
            householdId,
            importedByEmail: 'owner@example.invalid',
            cutoffAt: new Date(Date.now() + 60_000),
            expiresAt: new Date(Date.now() + 3_600_000),
          },
        });
        runId = run.id;
      } else {
        runDelegate.findUnique = async () => {
          throw new Error('simulated reparse run lookup infrastructure failure');
        };
      }

      await app.register(bridgeRoutes, { prefix: '/api/bridge' });
      await app.ready();
      const response = await app.inject(
        scenario === 'success'
          ? {
              method: 'POST',
              url: '/api/bridge/reparse-candidates',
              headers: {
                'x-bridge-token': process.env.BRIDGE_TOKEN,
                'x-reparse-run-token': runToken,
                'content-type': 'application/json',
              },
              payload: JSON.stringify({
                mode: 'dry_run',
                results: [{ candidateId, detectedPrice: 500 }],
              }),
            }
          : {
              method: 'GET',
              url: '/api/bridge/reparse-progress',
              headers: {
                'x-bridge-token': process.env.BRIDGE_TOKEN,
                'x-reparse-run-token': runToken,
              },
            }
      );
      const expectedStatus = scenario === 'success' ? 200 : 500;
      if (response.statusCode !== expectedStatus) process.exitCode = 1;
    } finally {
      runDelegate.findUnique = originalFindUnique;
      await app.close();
      if (runId) {
        await prisma.priceReparseTarget.deleteMany({ where: { runId } });
        await prisma.priceReparseAudit.deleteMany({ where: { runId } });
        await prisma.priceReparseItemSnapshot.deleteMany({ where: { runId } });
        await prisma.priceReparseRun.delete({ where: { id: runId } });
      }
      if (householdId) {
        await prisma.household.delete({ where: { id: householdId } });
      }
      await prisma.$disconnect();
    }
  `;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BRIDGE_TOKEN,
        HISTORICAL_REPARSE_ENABLED: 'true',
        REPARSE_TEST_SCENARIO: scenario,
        REPARSE_TEST_TOKEN: runToken,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`production log probe child failed with exit code ${code}: ${stderr}`));
    });
  });
}

test('GET /reparse-candidates requires the header token and rejects a query-string token', async () => {
  await withEnv({ BRIDGE_TOKEN, HISTORICAL_REPARSE_ENABLED: 'true' }, async () => {
    const app = buildTestApp();
    await app.register(bridgeRoutes, { prefix: '/api/bridge' });
    await app.ready();
    try {
      const withoutHeader = await app.inject({
        method: 'GET',
        url: '/api/bridge/reparse-candidates?runToken=some-token&limit=5',
        headers: { 'x-bridge-token': BRIDGE_TOKEN },
      });
      assert.equal(withoutHeader.statusCode, 404);

      const withHeader = await app.inject({
        method: 'GET',
        url: '/api/bridge/reparse-candidates',
        headers: { 'x-bridge-token': BRIDGE_TOKEN, [REPARSE_HEADER]: 'nonexistent-token' },
      });
      assert.equal(withHeader.statusCode, 404);
    } finally {
      await app.close();
    }
  });
});

test('POST /reparse-candidates rejects a body-supplied runToken and requires the header', async () => {
  await withEnv({ BRIDGE_TOKEN, HISTORICAL_REPARSE_ENABLED: 'true' }, async () => {
    const app = buildTestApp();
    await app.register(bridgeRoutes, { prefix: '/api/bridge' });
    await app.ready();
    try {
      const withoutHeader = await app.inject({
        method: 'POST',
        url: '/api/bridge/reparse-candidates',
        headers: { 'x-bridge-token': BRIDGE_TOKEN, 'content-type': 'application/json' },
        payload: JSON.stringify({ runToken: 'some-token', mode: 'dry_run', results: [] }),
      });
      assert.equal(withoutHeader.statusCode, 404);
    } finally {
      await app.close();
    }
  });
});

test('the reparse run token never appears in stdout log output for a failing request', async () => {
  const secretToken = 'rrun_should_never_appear_in_any_log_line';
  const output = await captureFailingRequestStdout(secretToken);
  assert.ok(!output.includes(secretToken), 'stdout leaked the reparse run token');
});

test('production batch_step and request logs omit the run token after a successful dry run', async () => {
  const runToken = `rrun_${'b'.repeat(64)}`;
  const { stdout, stderr } = await captureProductionPathStdout('success', runToken);
  assert.match(stdout, /"event":"batch_step"/);
  assert.match(stdout, /"event":"http_request"/);
  assert.ok(!stdout.includes(runToken), 'stdout leaked the reparse run token');
  assert.ok(!stderr.includes(runToken), 'stderr leaked the reparse run token');
});

test('production error and request logs omit the run token after an infrastructure failure', async () => {
  const runToken = `rrun_${'a'.repeat(64)}`;
  const { stdout, stderr } = await captureProductionPathStdout('infrastructure_failure', runToken);
  assert.match(stdout, /"event":"request_failed"/);
  assert.match(stdout, /"event":"http_request"/);
  assert.ok(!stdout.includes(runToken), 'stdout leaked the reparse run token');
  assert.ok(!stderr.includes(runToken), 'stderr leaked the reparse run token');
});
