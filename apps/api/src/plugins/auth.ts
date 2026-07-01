import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    auth: {
      userId: string;
      householdId: string;
      role: string;
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
    secret: process.env.JWT_SECRET || 'dev-secret-please-change',
    sign: { expiresIn: '7d' },
  });

  fastify.decorate(
    'authenticate',
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        await req.jwtVerify();
      } catch (err) {
        return reply.code(401).send({ message: '認証が必要です' });
      }

      const { userId } = req.user as { userId: string };
      const membership = await prisma.householdMember.findFirst({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      });
      if (!membership) {
        return reply.code(403).send({ message: '所属している家庭が見つかりません' });
      }
      req.auth = {
        userId,
        householdId: membership.householdId,
        role: membership.role,
      };
    }
  );
};

export default fp(authPlugin);
