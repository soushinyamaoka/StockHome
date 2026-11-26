import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma';
import {
  LAST_USED_UPDATE_INTERVAL_MS,
  hashApiToken,
  isApiTokenFormat,
  isDeniedForApiToken,
  isReadMethod,
} from '../services/apiTokens';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    auth: {
      userId: string;
      householdId: string;
      role: string;
      /** 外部連携用トークンで呼ばれた場合、そのトークンのID */
      apiTokenId?: string;
    };
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { userId: string };
    user: { userId: string };
  }
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(jwt, {
    // Development fallback. entrypoint.ts rejects a missing JWT_SECRET in production.
    secret: process.env.JWT_SECRET || 'dev-secret-please-change',
    // Disabled users are checked on every authenticated request.
    sign: { expiresIn: '90d' },
  });

  fastify.decorate(
    'authenticate',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (bearer && isApiTokenFormat(bearer)) {
        return authenticateApiToken(req, reply, bearer);
      }

      try {
        await req.jwtVerify();
      } catch (err) {
        return reply.code(401).send({ message: '認証が必要です' });
      }

      const { userId } = req.user as { userId: string };
      const membership = await prisma.householdMember.findFirst({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        include: { user: { select: { isActive: true } } },
      });
      if (!membership) {
        return reply.code(403).send({ message: '所属している家庭が見つかりません' });
      }
      if (!membership.user.isActive) {
        return reply.code(403).send({ message: 'このアカウントは利用できません' });
      }
      req.auth = {
        userId,
        householdId: membership.householdId,
        role: membership.role,
      };
    }
  );
};

// 外部連携用トークン（shk_...）の認証。発行した本人として動き、書き込みはトークンごとの許可に従う
async function authenticateApiToken(req: FastifyRequest, reply: FastifyReply, token: string) {
  const apiToken = await prisma.apiToken.findUnique({
    where: { tokenHash: hashApiToken(token) },
    include: { user: { select: { isActive: true } } },
  });
  if (!apiToken || apiToken.revokedAt) {
    return reply.code(401).send({ message: '認証が必要です' });
  }
  const membership = await prisma.householdMember.findUnique({
    where: { householdId_userId: { householdId: apiToken.householdId, userId: apiToken.userId } },
  });
  if (!membership) {
    return reply.code(403).send({ message: '所属している家庭が見つかりません' });
  }
  if (!apiToken.user.isActive) {
    return reply.code(403).send({ message: 'このアカウントは利用できません' });
  }
  if (isDeniedForApiToken(req.method, req.routeOptions.url ?? req.url)) {
    return reply.code(403).send({ message: '外部連携用のトークンでは使えない操作です' });
  }
  if (!apiToken.allowWrite && !isReadMethod(req.method)) {
    return reply.code(403).send({ message: 'このトークンは読み取り専用です。アプリの「外部連携」で書き込みを許可できます' });
  }

  const now = new Date();
  if (!apiToken.lastUsedAt || now.getTime() - apiToken.lastUsedAt.getTime() >= LAST_USED_UPDATE_INTERVAL_MS) {
    // 応答を待たせないよう、最終利用日時の記録の失敗はログだけにする
    prisma.apiToken
      .update({ where: { id: apiToken.id }, data: { lastUsedAt: now } })
      .catch((err) => req.log.warn({ err, event: 'api_token_last_used_update_failed' }));
  }

  req.auth = {
    userId: apiToken.userId,
    householdId: apiToken.householdId,
    role: membership.role,
    apiTokenId: apiToken.id,
  };
}

export default fp(authPlugin);
