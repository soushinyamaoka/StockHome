import { api } from './client';

// 外部連携用トークン（Museなど、アプリ以外からAPIを呼ぶ用）

export interface ApiTokenDto {
  id: string;
  name: string;
  /** 見分けるための先頭部分（例: shk_ab12cd）。これだけでは使えない */
  tokenPrefix: string;
  allowWrite: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  owner: { id: string; name: string };
  isMine: boolean;
}

export async function fetchApiTokens(): Promise<{ tokens: ApiTokenDto[] }> {
  const res = await api.get('/api/api-tokens');
  return res.data;
}

/** 発行。トークン本体（token）が返るのはこの1回だけ */
export async function createApiToken(input: {
  name: string;
  allowWrite?: boolean;
}): Promise<{ token: string; apiToken: ApiTokenDto }> {
  const res = await api.post('/api/api-tokens', input);
  return res.data;
}

export async function updateApiToken(id: string, input: { allowWrite: boolean }): Promise<{ apiToken: ApiTokenDto }> {
  const res = await api.patch(`/api/api-tokens/${id}`, input);
  return res.data;
}

export async function revokeApiToken(id: string): Promise<void> {
  await api.delete(`/api/api-tokens/${id}`);
}
