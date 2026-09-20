import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { resolveTrustedProxies } from './trustedProxies';

async function withTrustedProxyEnv(value: string | undefined, run: () => void): Promise<void> {
  const previous = process.env.TRUSTED_PROXY_IPS;
  try {
    if (value === undefined) delete process.env.TRUSTED_PROXY_IPS;
    else process.env.TRUSTED_PROXY_IPS = value;
    run();
  } finally {
    if (previous === undefined) delete process.env.TRUSTED_PROXY_IPS;
    else process.env.TRUSTED_PROXY_IPS = previous;
  }
}

test('uses loopback proxies when TRUSTED_PROXY_IPS is unset', async () => {
  await withTrustedProxyEnv(undefined, () => {
    assert.deepEqual(resolveTrustedProxies(), ['127.0.0.1', '::1']);
  });
});

test('uses loopback proxies when TRUSTED_PROXY_IPS is blank', async () => {
  await withTrustedProxyEnv('   ', () => {
    assert.deepEqual(resolveTrustedProxies(), ['127.0.0.1', '::1']);
  });
});

test('parses trimmed comma-separated trusted proxies', async () => {
  await withTrustedProxyEnv(' 172.19.0.1 , 10.0.0.5,  ', () => {
    assert.deepEqual(resolveTrustedProxies(), ['172.19.0.1', '10.0.0.5']);
  });
});

test('uses the proxy-appended client address instead of a spoofed XFF prefix', async () => {
  const app = Fastify({ trustProxy: ['172.19.0.1'] });
  app.get('/', async (req) => ({ ip: req.ip }));
  await app.ready();
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/',
      remoteAddress: '172.19.0.1',
      headers: { 'x-forwarded-for': '9.9.9.9, 203.0.113.50' },
    });
    assert.equal(response.json().ip, '203.0.113.50');
  } finally {
    await app.close();
  }
});

test('ignores XFF from an untrusted direct connection', async () => {
  const app = Fastify({ trustProxy: ['172.19.0.1'] });
  app.get('/', async (req) => ({ ip: req.ip }));
  await app.ready();
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/',
      remoteAddress: '203.0.113.99',
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    assert.equal(response.json().ip, '203.0.113.99');
  } finally {
    await app.close();
  }
});
