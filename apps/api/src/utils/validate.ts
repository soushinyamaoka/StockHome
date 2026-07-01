import type { FastifyReply } from 'fastify';
import { ZodError, type z } from 'zod';

// Zodスキーマでbodyを検証する。失敗時は400を返してnull
export function parseBody<S extends z.ZodTypeAny>(
  schema: S,
  body: unknown,
  reply: FastifyReply
): z.infer<S> | null {
  try {
    return schema.parse(body);
  } catch (e) {
    if (e instanceof ZodError) {
      reply.code(400).send({
        message: '入力内容にエラーがあります',
        errors: e.flatten(),
      });
      return null;
    }
    throw e;
  }
}
