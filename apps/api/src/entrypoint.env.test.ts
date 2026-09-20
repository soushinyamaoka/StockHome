import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { test } from 'node:test';

const apiRoot = resolve(__dirname, '..');

async function runEntrypoint(envOverrides: Record<string, string | undefined>) {
  const env = { ...process.env };
  delete env.JWT_SECRET;
  delete env.DATABASE_URL;
  Object.assign(env, envOverrides);

  const child = spawn(process.execPath, ['--import', 'tsx', 'src/entrypoint.ts'], {
    cwd: apiRoot,
    env,
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

  const [code] = (await once(child, 'close')) as [number | null];
  return { code, stdout, stderr };
}

for (const [scenario, jwtSecret] of [
  ['unset', undefined],
  ['empty', ''],
] as const) {
  test(`entrypoint exits before migrations when JWT_SECRET is ${scenario} in production`, { timeout: 15_000 }, async () => {
    const { code, stdout, stderr } = await runEntrypoint({ NODE_ENV: 'production', JWT_SECRET: jwtSecret });

    assert.equal(code, 1, `unexpected stderr: ${stderr}`);
    assert.match(stdout, /"event":"startup_failed"/);
    assert.match(stdout, /"reason":"missing_required_env"/);
    assert.match(stdout, /"env_name":"JWT_SECRET"/);
    assert.doesNotMatch(stdout, /"event":"migration_start"/);
    assert.doesNotMatch(stdout, /"JWT_SECRET"\s*:/);
  });
}
