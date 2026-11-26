import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ApiToken } from '@prisma/client';
import { API_TOKEN_LIMITS, apiTokenCreateSchema, apiTokenUpdateSchema } from '@stockhome/shared';
import { prisma } from '../lib/prisma';
import { generateApiToken } from '../services/apiTokens';
import { parseBody } from '../utils/validate';

// 外部連携用トークンの管理。発行は本人の分だけ。一覧・切り替え・取り消しは本人の分と、admin なら家族全員の分。
// 外部連携用トークン自身ではここを呼べない（plugins/auth.ts）
const apiTokenRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async (req) => {
    const tokens = await prisma.apiToken.findMany({
      where: {
        householdId: req.auth.householdId,
        revokedAt: null,
        ...(req.auth.role === 'admin' ? {} : { userId: req.auth.userId }),
      },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return { tokens: tokens.map((t) => serializeApiToken(t, req)) };
  });

  app.post('/', async (req, reply) => {
    const data = parseBody(apiTokenCreateSchema, req.body, reply);
    if (!data) return;
    const active = await prisma.apiToken.count({ where: { userId: req.auth.userId, revokedAt: null } });
    if (active >= API_TOKEN_LIMITS.MAX_ACTIVE_PER_USER) {
      return reply
        .code(409)
        .send({ message: `外部連携用のトークンは1人${API_TOKEN_LIMITS.MAX_ACTIVE_PER_USER}個までです。使っていないものを取り消してください` });
    }
    const { token, tokenHash, tokenPrefix } = generateApiToken();
    const created = await prisma.apiToken.create({
      data: {
        householdId: req.auth.householdId,
        userId: req.auth.userId,
        name: data.name,
        tokenHash,
        tokenPrefix,
        allowWrite: data.allowWrite,
      },
      include: { user: { select: { id: true, name: true } } },
    });
    // トークン本体を返すのはこの1回だけ
    return reply.code(201).send({ token, apiToken: serializeApiToken(created, req) });
  });

  app.patch('/:id', async (req, reply) => {
    const data = parseBody(apiTokenUpdateSchema, req.body, reply);
    if (!data) return;
    const target = await findManageable(req);
    if (!target) return reply.code(404).send({ message: 'トークンが見つからないか、取り消し済みです' });
    const updated = await prisma.apiToken.update({
      where: { id: target.id },
      data: { allowWrite: data.allowWrite },
      include: { user: { select: { id: true, name: true } } },
    });
    return { apiToken: serializeApiToken(updated, req) };
  });

  app.delete('/:id', async (req, reply) => {
    const target = await findManageable(req);
    if (!target) return reply.code(404).send({ message: 'トークンが見つからないか、取り消し済みです' });
    await prisma.apiToken.update({ where: { id: target.id }, data: { revokedAt: new Date() } });
    return reply.code(204).send();
  });
};

// 操作してよいトークン（同じ家庭・取り消し前で、本人の分か、admin なら誰の分でも）
async function findManageable(req: FastifyRequest) {
  const { id } = req.params as { id: string };
  return prisma.apiToken.findFirst({
    where: {
      id,
      householdId: req.auth.householdId,
      revokedAt: null,
      ...(req.auth.role === 'admin' ? {} : { userId: req.auth.userId }),
    },
  });
}

function serializeApiToken(t: ApiToken & { user: { id: string; name: string } }, req: FastifyRequest) {
  return {
    id: t.id,
    name: t.name,
    tokenPrefix: t.tokenPrefix,
    allowWrite: t.allowWrite,
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    owner: t.user,
    isMine: t.userId === req.auth.userId,
  };
}

export default apiTokenRoutes;
