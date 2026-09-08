import type {
  FastifyBaseLogger,
  FastifyError,
  FastifyInstance,
  FastifyRequest,
  FastifyTypeProvider,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerBase,
} from 'fastify';
import { STATUS_CODES } from 'node:http';
import { ERROR_KINDS, LOG_EVENTS, safeErr } from './logger';

function routePattern(request: { routeOptions: FastifyRequest['routeOptions'] }): string {
  return request.routeOptions.url || 'unmatched';
}

function isDatabaseError(error: FastifyError): boolean {
  return typeof error.name === 'string' && error.name.startsWith('PrismaClient');
}

function errorKind(error: FastifyError, statusCode: number) {
  if (isDatabaseError(error)) return ERROR_KINDS.DB;
  if (statusCode === 401 || statusCode === 403) return ERROR_KINDS.AUTH;
  if (statusCode >= 400 && statusCode < 500) return ERROR_KINDS.VALIDATION;
  return ERROR_KINDS.INTERNAL;
}

// production（server.ts）とtest（HTTPレベルtest）の両方から同一実装を使うために
// 抽出した（第5回レビューR5-05対応。以前はserver.ts内にのみ存在し、
// testが素のFastifyインスタンスを使っていたためproduction相当のログ経路を
// 検証できていなかった）
export function registerHttpErrorHandling<
  RawServer extends RawServerBase,
  RawRequest extends RawRequestDefaultExpression<RawServer>,
  RawReply extends RawReplyDefaultExpression<RawServer>,
  Logger extends FastifyBaseLogger,
  TypeProvider extends FastifyTypeProvider,
>(app: FastifyInstance<RawServer, RawRequest, RawReply, Logger, TypeProvider>): void {
  app.addHook('onResponse', async (request, reply) => {
    const line = {
      event: LOG_EVENTS.HTTP_REQUEST,
      method: request.method,
      route: routePattern(request),
      status: reply.statusCode,
      duration_ms: Math.round(reply.elapsedTime),
    };
    if (reply.statusCode >= 500) {
      request.log.error(line);
    } else {
      request.log.info(line);
    }
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const candidateStatus = error.statusCode;
    const statusCode =
      candidateStatus && candidateStatus >= 400 && candidateStatus < 600
        ? candidateStatus
        : 500;

    request.log.error({
      event: LOG_EVENTS.REQUEST_FAILED,
      method: request.method,
      route: routePattern(request),
      status: statusCode,
      error_kind: errorKind(error, statusCode),
      err: safeErr(error),
    });

    const clientMessage =
      statusCode >= 500 ? (STATUS_CODES[statusCode] ?? 'Internal Server Error') : error.message;

    return reply.status(statusCode).send({
      statusCode,
      error: STATUS_CODES[statusCode] ?? 'Internal Server Error',
      message: clientMessage,
    });
  });
}
