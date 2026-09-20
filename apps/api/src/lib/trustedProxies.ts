export function resolveTrustedProxies(): string[] {
  const raw = process.env.TRUSTED_PROXY_IPS;
  if (!raw || raw.trim() === '') return ['127.0.0.1', '::1'];
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}
