import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import {
  storageImportSchema,
  storageLocationCreateSchema,
  storageLocationMergeSchema,
  storageLocationUpdateSchema,
  storagePlacementCreateSchema,
  storagePlacementUpdateSchema,
  storageSearchQuerySchema,
  storageThingCreateSchema,
  storageThingUpdateSchema,
  usageTagAssignSchema,
  usageTagCreateSchema,
  usageTagMergeSchema,
  usageTagUpdateSchema,
} from '@stockhome/shared';
import { parseBody } from '../utils/validate';
import {
  StorageError,
  assignTags,
  createLocation,
  createPlacement,
  createTag,
  createThing,
  deleteLocation,
  deletePlacement,
  deleteTag,
  deleteThing,
  getStorageTarget,
  listLocations,
  listTags,
  mergeLocation,
  mergeTag,
  renameTag,
  runStorageImport,
  searchStorage,
  updateLocation,
  updatePlacement,
  updateThing,
} from '../services/storage';

// 業務エラー（StorageError）と同時更新による一意制約違反を HTTP ステータスに変換する
async function respond<T>(reply: FastifyReply, run: () => Promise<T>, statusCode = 200) {
  try {
    const body = await run();
    return reply.code(statusCode).send(body);
  } catch (e) {
    if (e instanceof StorageError) {
      return reply.code(e.statusCode).send({ message: e.message });
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return reply.code(409).send({ message: '同じ内容がすでに登録されています。画面を更新してやり直してください' });
    }
    throw e;
  }
}

function parseQuery<T>(schema: { parse: (v: unknown) => T }, query: unknown, reply: FastifyReply): T | null {
  try {
    return schema.parse(query);
  } catch (e) {
    if (e instanceof ZodError) {
      reply.code(400).send({ message: '検索条件にエラーがあります', errors: e.flatten() });
      return null;
    }
    throw e;
  }
}

const storageRoutes: FastifyPluginAsync = async (app) => {
  // --- 場所 ---
  app.get('/locations', async (req) => ({ locations: await listLocations(req.auth.householdId) }));

  app.post('/locations', async (req, reply) => {
    const data = parseBody(storageLocationCreateSchema, req.body, reply);
    if (!data) return;
    return respond(reply, async () => ({ location: await createLocation(req.auth.householdId, data) }), 201);
  });

  app.patch('/locations/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = parseBody(storageLocationUpdateSchema, req.body, reply);
    if (!data) return;
    return respond(reply, async () => ({ location: await updateLocation(req.auth.householdId, id, data) }));
  });

  app.delete('/locations/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    return respond(reply, async () => {
      await deleteLocation(req.auth.householdId, id);
      return { ok: true };
    });
  });

  app.post('/locations/:id/merge', async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = parseBody(storageLocationMergeSchema, req.body, reply);
    if (!data) return;
    return respond(reply, async () => {
      await mergeLocation(req.auth.householdId, id, data.targetId);
      return { ok: true };
    });
  });

  // --- 物（場所だけ管理する物） ---
  app.post('/things', async (req, reply) => {
    const data = parseBody(storageThingCreateSchema, req.body, reply);
    if (!data) return;
    return respond(reply, async () => ({ thing: await createThing(req.auth.householdId, data) }), 201);
  });

  app.get('/things/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    return respond(reply, async () => ({ thing: await getStorageTarget(req.auth.householdId, { thingId: id }) }));
  });

  app.patch('/things/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = parseBody(storageThingUpdateSchema, req.body, reply);
    if (!data) return;
    return respond(reply, async () => ({ thing: await updateThing(req.auth.householdId, id, data) }));
  });

  app.delete('/things/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    return respond(reply, async () => {
      await deleteThing(req.auth.householdId, id);
      return { ok: true };
    });
  });

  // --- 消耗品の置き場所・用途タグ ---
  app.get('/items/:itemId', async (req, reply) => {
    const { itemId } = req.params as { itemId: string };
    return respond(reply, async () => ({ item: await getStorageTarget(req.auth.householdId, { itemId }) }));
  });

  // --- 置き場所 ---
  app.post('/placements', async (req, reply) => {
    const data = parseBody(storagePlacementCreateSchema, req.body, reply);
    if (!data) return;
    return respond(reply, async () => ({ placement: await createPlacement(req.auth.householdId, data) }), 201);
  });

  app.patch('/placements/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = parseBody(storagePlacementUpdateSchema, req.body, reply);
    if (!data) return;
    return respond(reply, async () => ({ placement: await updatePlacement(req.auth.householdId, id, data) }));
  });

  // 「ここに無かった」で外す場合もこれを使う
  app.delete('/placements/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    return respond(reply, async () => {
      await deletePlacement(req.auth.householdId, id);
      return { ok: true };
    });
  });

  // --- 用途タグ ---
  app.get('/tags', async (req) => ({ tags: await listTags(req.auth.householdId) }));

  app.post('/tags', async (req, reply) => {
    const data = parseBody(usageTagCreateSchema, req.body, reply);
    if (!data) return;
    return respond(reply, async () => ({ tag: await createTag(req.auth.householdId, data.name) }), 201);
  });

  app.patch('/tags/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = parseBody(usageTagUpdateSchema, req.body, reply);
    if (!data) return;
    return respond(reply, async () => ({ tag: await renameTag(req.auth.householdId, id, data.name) }));
  });

  app.post('/tags/:id/merge', async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = parseBody(usageTagMergeSchema, req.body, reply);
    if (!data) return;
    return respond(reply, async () => {
      await mergeTag(req.auth.householdId, id, data.targetId);
      return { ok: true };
    });
  });

  app.delete('/tags/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    return respond(reply, async () => {
      await deleteTag(req.auth.householdId, id);
      return { ok: true };
    });
  });

  // 対象の用途タグを指定した名前の集合に置き換える
  app.put('/tag-assignments', async (req, reply) => {
    const data = parseBody(usageTagAssignSchema, req.body, reply);
    if (!data) return;
    return respond(reply, async () => ({
      tags: await assignTags(req.auth.householdId, { itemId: data.itemId, thingId: data.thingId }, data.names),
    }));
  });

  // --- 検索 ---
  app.get('/search', async (req, reply) => {
    const query = parseQuery(storageSearchQuerySchema, req.query, reply);
    if (!query) return;
    return { results: await searchStorage(req.auth.householdId, query) };
  });

  // --- 一括登録（チャット経由の初回登録用。dryRun で確認してから本登録する） ---
  app.post('/import', async (req, reply) => {
    const data = parseBody(storageImportSchema, req.body, reply);
    if (!data) return;
    const result = await runStorageImport(req.auth.householdId, data.entries, data.dryRun);
    return reply.code(!data.dryRun && result.summary.errors > 0 ? 422 : 200).send(result);
  });
};

export default storageRoutes;
