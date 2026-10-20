import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import authPlugin from '../plugins/auth';
import { prisma } from '../lib/prisma';
import storageRoutes from './storage';

async function buildAuthedApp() {
  const app = Fastify();
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = (body as string) ?? '';
    if (text.trim() === '') {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch (err) {
      done(err as Error, undefined);
    }
  });
  await app.register(authPlugin);
  await app.register(async (instance) => {
    instance.addHook('preHandler', instance.authenticate);
    await instance.register(storageRoutes, { prefix: '/api/storage' });
  });
  await app.ready();
  return app;
}

type App = Awaited<ReturnType<typeof buildAuthedApp>>;

let scopeCounter = 0;

async function createTestScope() {
  scopeCounter += 1;
  const tag = `${Date.now()}-${scopeCounter}`;
  const householdA = await prisma.household.create({ data: { name: `storage-http-a-${tag}` } });
  const householdB = await prisma.household.create({ data: { name: `storage-http-b-${tag}` } });
  const userA = await prisma.user.create({
    data: { email: `storage-http-a-${tag}@example.invalid`, name: 'Storage User A', passwordHash: 'test-only' },
  });
  const userB = await prisma.user.create({
    data: { email: `storage-http-b-${tag}@example.invalid`, name: 'Storage User B', passwordHash: 'test-only' },
  });
  await prisma.householdMember.createMany({
    data: [
      { householdId: householdA.id, userId: userA.id, role: 'admin' },
      { householdId: householdB.id, userId: userB.id, role: 'admin' },
    ],
  });
  const itemA = await prisma.item.create({
    data: { householdId: householdA.id, itemName: 'サンポール', daysPerUnit: 30, unit: '本' },
  });
  const itemB = await prisma.item.create({
    data: { householdId: householdB.id, itemName: 'other-household-item', daysPerUnit: 30 },
  });
  const app = await buildAuthedApp();
  const headersA = { authorization: `Bearer ${app.jwt.sign({ userId: userA.id })}` };
  const headersB = { authorization: `Bearer ${app.jwt.sign({ userId: userB.id })}` };

  return {
    app,
    householdAId: householdA.id,
    householdBId: householdB.id,
    itemAId: itemA.id,
    itemBId: itemB.id,
    headersA,
    headersB,
    cleanup: async () => {
      await app.close();
      await prisma.household.deleteMany({ where: { id: { in: [householdA.id, householdB.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    },
  };
}

type Scope = Awaited<ReturnType<typeof createTestScope>>;

async function call(scope: Scope, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: object) {
  return scope.app.inject({ method, url: `/api/storage${url}`, headers: scope.headersA, payload });
}

async function createLocation(scope: Scope, name: string, parentId?: string) {
  const res = await call(scope, 'POST', '/locations', { name, parentId });
  assert.equal(res.statusCode, 201, res.body);
  return res.json().location.id as string;
}

test('locations: create with normalized names, reject sibling duplicates, list in tree order with paths', async () => {
  const scope = await createTestScope();
  try {
    const floor1 = await createLocation(scope, '1階');
    const pantry = await createLocation(scope, 'パントリー', floor1);
    // 全角の「Ａ棚」は NFKC で「A棚」として保存される
    const shelfA = await createLocation(scope, 'Ａ棚', pantry);
    await createLocation(scope, '洗面台下', floor1);

    const dup = await call(scope, 'POST', '/locations', { name: 'A棚', parentId: pantry });
    assert.equal(dup.statusCode, 409);
    // 別の親の下なら同じ名前でもよい
    await createLocation(scope, 'A棚', floor1);

    const list = await call(scope, 'GET', '/locations');
    assert.equal(list.statusCode, 200);
    const locations = list.json().locations as { id: string; pathText: string; depth: number }[];
    assert.deepEqual(
      locations.map((l) => l.pathText),
      ['1階', '1階 › A棚', '1階 › パントリー', '1階 › パントリー › A棚', '1階 › 洗面台下']
    );
    assert.equal(locations.find((l) => l.id === shelfA)?.depth, 3);
  } finally {
    await scope.cleanup();
  }
});

test('locations: moving under its own descendant is rejected and depth is limited', async () => {
  const scope = await createTestScope();
  try {
    const root = await createLocation(scope, '3階');
    const room = await createLocation(scope, '寝室A', root);
    const closet = await createLocation(scope, 'Aクローゼット', room);

    const cycle = await call(scope, 'PATCH', `/locations/${root}`, { parentId: closet });
    assert.equal(cycle.statusCode, 400);

    let parent = closet;
    for (let depth = 4; depth <= 8; depth++) parent = await createLocation(scope, `段${depth}`, parent);
    const tooDeep = await call(scope, 'POST', '/locations', { name: '段9', parentId: parent });
    assert.equal(tooDeep.statusCode, 400);

    const moveToRoot = await call(scope, 'PATCH', `/locations/${closet}`, { parentId: null });
    assert.equal(moveToRoot.statusCode, 200);
    assert.equal(moveToRoot.json().location.parentId, null);
  } finally {
    await scope.cleanup();
  }
});

test('locations: delete is blocked while it has contents; merge moves children and placements', async () => {
  const scope = await createTestScope();
  try {
    const floor1 = await createLocation(scope, '1階');
    const oldShelf = await createLocation(scope, '旧棚', floor1);
    const oldTier = await createLocation(scope, '1段目', oldShelf);
    const oldBox = await createLocation(scope, '青いケース', oldShelf);
    const newShelf = await createLocation(scope, 'A棚', floor1);
    const newTier = await createLocation(scope, '1段目', newShelf);

    const thing = await call(scope, 'POST', '/things', {
      name: 'ほうき',
      placements: [{ locationId: oldTier, memo: '床置き' }],
    });
    assert.equal(thing.statusCode, 201);
    const thingId = thing.json().thing.id as string;
    // 移動先にも同じ物があり、メモ無し → 統合時に移動元のメモが引き継がれる
    await prisma.storagePlacement.create({
      data: { householdId: scope.householdAId, locationId: newTier, thingId },
    });

    const blocked = await call(scope, 'DELETE', `/locations/${oldShelf}`);
    assert.equal(blocked.statusCode, 409);

    const merge = await call(scope, 'POST', `/locations/${oldShelf}/merge`, { targetId: newShelf });
    assert.equal(merge.statusCode, 200, merge.body);

    assert.equal(await prisma.storageLocation.count({ where: { id: { in: [oldShelf, oldTier] } } }), 0);
    assert.equal((await prisma.storageLocation.findUniqueOrThrow({ where: { id: oldBox } })).parentId, newShelf);
    const placements = await prisma.storagePlacement.findMany({ where: { thingId } });
    assert.equal(placements.length, 1);
    assert.equal(placements[0].locationId, newTier);
    assert.equal(placements[0].memo, '床置き');

    const emptyDelete = await call(scope, 'DELETE', `/locations/${oldBox}`);
    assert.equal(emptyDelete.statusCode, 200);
  } finally {
    await scope.cleanup();
  }
});

test('search: matches name, tag, location path and descendant locations; items without storage hidden unless named', async () => {
  const scope = await createTestScope();
  try {
    const floor1 = await createLocation(scope, '1階');
    const toilet = await createLocation(scope, 'トイレ収納', floor1);
    const floor3 = await createLocation(scope, '3階');

    await call(scope, 'POST', '/things', {
      name: 'トイレブラシ',
      placements: [{ locationId: toilet, memo: '右奥' }],
      tags: ['トイレ掃除', '掃除全般'],
    });
    await call(scope, 'POST', '/things', { name: 'スーツケース', placements: [{ locationId: floor3 }], tags: ['旅行'] });

    const all = await call(scope, 'GET', '/search');
    assert.deepEqual(
      (all.json().results as { name: string }[]).map((r) => r.name).sort(),
      ['スーツケース', 'トイレブラシ']
    );

    const byName = await call(scope, 'GET', `/search?q=${encodeURIComponent('サンポール')}`);
    const named = byName.json().results;
    assert.equal(named.length, 1);
    assert.equal(named[0].kind, 'item');
    assert.equal(named[0].placements.length, 0);

    const byPath = await call(scope, 'GET', `/search?q=${encodeURIComponent('トイレ収納')}`);
    assert.deepEqual(byPath.json().results.map((r: { name: string }) => r.name), ['トイレブラシ']);

    const tags = (await call(scope, 'GET', '/tags')).json().tags as { id: string; name: string; usageCount: number }[];
    const travel = tags.find((t) => t.name === '旅行')!;
    assert.equal(travel.usageCount, 1);
    const byTag = await call(scope, 'GET', `/search?tagId=${travel.id}`);
    assert.deepEqual(byTag.json().results.map((r: { name: string }) => r.name), ['スーツケース']);

    // 1階を指定すると配下のトイレ収納の物も出る
    const byLocation = await call(scope, 'GET', `/search?locationId=${floor1}`);
    const found = byLocation.json().results;
    assert.deepEqual(found.map((r: { name: string }) => r.name), ['トイレブラシ']);
    assert.equal(found[0].placements[0].pathText, '1階 › トイレ収納');
    assert.equal(found[0].placements[0].memo, '右奥');
  } finally {
    await scope.cleanup();
  }
});

test('placements and tags on consumables: create, conflict, move, remove, replace tags', async () => {
  const scope = await createTestScope();
  try {
    const sink = await createLocation(scope, '洗面台下');
    const pantry = await createLocation(scope, 'パントリー');

    const created = await call(scope, 'POST', '/placements', { itemId: scope.itemAId, locationId: sink, memo: '開封中' });
    assert.equal(created.statusCode, 201);
    const placementId = created.json().placement.id as string;
    const dup = await call(scope, 'POST', '/placements', { itemId: scope.itemAId, locationId: sink });
    assert.equal(dup.statusCode, 409);
    await call(scope, 'POST', '/placements', { itemId: scope.itemAId, locationId: pantry, memo: 'ストック2本' });

    const moveConflict = await call(scope, 'PATCH', `/placements/${placementId}`, { locationId: pantry });
    assert.equal(moveConflict.statusCode, 409);

    const assign = await call(scope, 'PUT', '/tag-assignments', { itemId: scope.itemAId, names: ['トイレ掃除', '掃除全般'] });
    assert.equal(assign.statusCode, 200);
    const replace = await call(scope, 'PUT', '/tag-assignments', { itemId: scope.itemAId, names: ['トイレ掃除'] });
    assert.deepEqual(replace.json().tags.map((t: { name: string }) => t.name), ['トイレ掃除']);

    const removed = await call(scope, 'DELETE', `/placements/${placementId}`);
    assert.equal(removed.statusCode, 200);

    const detail = await call(scope, 'GET', `/items/${scope.itemAId}`);
    const item = detail.json().item;
    assert.equal(item.kind, 'item');
    assert.equal(item.unit, '本');
    assert.deepEqual(item.placements.map((p: { pathText: string }) => p.pathText), ['パントリー']);
    assert.deepEqual(item.tags.map((t: { name: string }) => t.name), ['トイレ掃除']);
  } finally {
    await scope.cleanup();
  }
});

test('tags: rename conflict suggests merge; merge moves links without duplicates', async () => {
  const scope = await createTestScope();
  try {
    const thing = await call(scope, 'POST', '/things', { name: 'ウタマロ石鹸', tags: ['服の汚れ', '服汚れ'] });
    const thingId = thing.json().thing.id as string;
    await call(scope, 'PUT', '/tag-assignments', { itemId: scope.itemAId, names: ['服汚れ'] });
    const tags = (await call(scope, 'GET', '/tags')).json().tags as { id: string; name: string }[];
    const canonical = tags.find((t) => t.name === '服の汚れ')!;
    const variant = tags.find((t) => t.name === '服汚れ')!;

    const rename = await call(scope, 'PATCH', `/tags/${variant.id}`, { name: '服の汚れ' });
    assert.equal(rename.statusCode, 409);

    const merge = await call(scope, 'POST', `/tags/${variant.id}/merge`, { targetId: canonical.id });
    assert.equal(merge.statusCode, 200);
    const after = (await call(scope, 'GET', '/tags')).json().tags as { name: string; usageCount: number }[];
    assert.deepEqual(after, [{ id: canonical.id, name: '服の汚れ', usageCount: 2 }]);
    assert.equal(await prisma.usageTagLink.count({ where: { thingId } }), 1);
  } finally {
    await scope.cleanup();
  }
});

test('things: logical delete hides from search', async () => {
  const scope = await createTestScope();
  try {
    const thing = await call(scope, 'POST', '/things', { name: '季節家電の説明書', memo: '箱入り' });
    const thingId = thing.json().thing.id as string;
    const patched = await call(scope, 'PATCH', `/things/${thingId}`, { memo: null });
    assert.equal(patched.json().thing.memo, null);
    assert.equal((await call(scope, 'DELETE', `/things/${thingId}`)).statusCode, 200);
    assert.equal((await call(scope, 'GET', `/things/${thingId}`)).statusCode, 404);
    assert.equal((await call(scope, 'GET', '/search')).json().results.length, 0);
    const row = await prisma.storageThing.findUniqueOrThrow({ where: { id: thingId } });
    assert.equal(row.isActive, false);
    assert.notEqual(row.deletedAt, null);
  } finally {
    await scope.cleanup();
  }
});

test('household isolation: other household locations, items and placements are not reachable', async () => {
  const scope = await createTestScope();
  try {
    const otherLocation = await prisma.storageLocation.create({
      data: { householdId: scope.householdBId, name: 'other' },
    });
    const otherPlacement = await prisma.storagePlacement.create({
      data: { householdId: scope.householdBId, locationId: otherLocation.id, itemId: scope.itemBId },
    });
    const mine = await createLocation(scope, 'mine');

    assert.equal((await call(scope, 'POST', '/placements', { itemId: scope.itemBId, locationId: mine })).statusCode, 404);
    assert.equal(
      (await call(scope, 'POST', '/placements', { itemId: scope.itemAId, locationId: otherLocation.id })).statusCode,
      404
    );
    assert.equal((await call(scope, 'POST', '/locations', { name: 'x', parentId: otherLocation.id })).statusCode, 404);
    assert.equal((await call(scope, 'DELETE', `/placements/${otherPlacement.id}`)).statusCode, 404);
    assert.equal((await call(scope, 'DELETE', `/locations/${otherLocation.id}`)).statusCode, 404);
    assert.equal((await call(scope, 'GET', `/items/${scope.itemBId}`)).statusCode, 404);
    assert.deepEqual(
      (await call(scope, 'GET', '/locations')).json().locations.map((l: { name: string }) => l.name),
      ['mine']
    );
  } finally {
    await scope.cleanup();
  }
});

test('import: dry run writes nothing, apply creates paths/things/tags, rerun is idempotent', async () => {
  const scope = await createTestScope();
  try {
    const existingFloor = await createLocation(scope, '1階');
    const payload = {
      entries: [
        {
          kind: 'thing',
          name: 'ほうき',
          locations: [{ path: ['1階', 'パントリー', 'A棚', '1段目'], memo: '床置き' }],
          tags: ['掃除全般'],
        },
        // 全角・空白ゆれは同じ場所として扱う
        { kind: 'thing', name: 'ちりとり', locations: [{ path: [' 1階 ', 'パントリー', 'Ａ棚', '1段目'] }], tags: ['掃除全般'] },
        { kind: 'item', name: 'サンポール', locations: [{ path: ['1階', 'トイレ収納'], memo: 'ストック' }], tags: ['トイレ掃除'] },
      ],
    };

    const dry = await call(scope, 'POST', '/import', { ...payload, dryRun: true });
    assert.equal(dry.statusCode, 200, dry.body);
    const dryResult = dry.json();
    assert.equal(dryResult.applied, false);
    assert.deepEqual(dryResult.entries[0].createdLocations, ['1階 › パントリー', '1階 › パントリー › A棚', '1階 › パントリー › A棚 › 1段目']);
    assert.deepEqual(dryResult.entries[1].createdLocations, []);
    assert.equal(dryResult.entries[2].action, 'update');
    assert.equal(dryResult.summary.thingsCreated, 2);
    assert.equal(dryResult.summary.locationsCreated, 4);
    assert.equal(await prisma.storageThing.count({ where: { householdId: scope.householdAId } }), 0);
    assert.equal(await prisma.storageLocation.count({ where: { householdId: scope.householdAId } }), 1);

    const applied = await call(scope, 'POST', '/import', { ...payload, dryRun: false });
    assert.equal(applied.statusCode, 200, applied.body);
    assert.deepEqual(applied.json().summary, dryResult.summary);
    assert.equal(applied.json().applied, true);

    const tree = (await call(scope, 'GET', '/locations')).json().locations as { id: string; pathText: string; placementCount: number }[];
    assert.equal(tree.find((l) => l.pathText === '1階')?.id, existingFloor);
    assert.equal(tree.find((l) => l.pathText === '1階 › パントリー › A棚 › 1段目')?.placementCount, 2);

    const rerun = await call(scope, 'POST', '/import', { ...payload, dryRun: false });
    const rerunResult = rerun.json();
    assert.equal(rerunResult.summary.thingsCreated, 0);
    assert.equal(rerunResult.summary.locationsCreated, 0);
    assert.equal(rerunResult.summary.placementsAdded, 0);
    assert.deepEqual(rerunResult.entries[0].unchangedPlacements, ['1階 › パントリー › A棚 › 1段目']);
    assert.equal(await prisma.storageThing.count({ where: { householdId: scope.householdAId } }), 2);
  } finally {
    await scope.cleanup();
  }
});

test('import: any error rolls back the whole batch with 422', async () => {
  const scope = await createTestScope();
  try {
    const res = await call(scope, 'POST', '/import', {
      dryRun: false,
      entries: [
        { kind: 'thing', name: 'ほうき', locations: [{ path: ['1階', '階段下'] }] },
        { kind: 'item', name: '存在しない消耗品', locations: [{ path: ['1階'] }] },
        { kind: 'item', name: 'x', itemId: scope.itemBId },
      ],
    });
    assert.equal(res.statusCode, 422);
    const result = res.json();
    assert.equal(result.applied, false);
    assert.equal(result.summary.errors, 2);
    assert.equal(result.entries[0].action, 'create');
    assert.match(result.entries[1].error, /見つかりません/);
    assert.equal(await prisma.storageThing.count({ where: { householdId: scope.householdAId } }), 0);
    assert.equal(await prisma.storageLocation.count({ where: { householdId: scope.householdAId } }), 0);
  } finally {
    await scope.cleanup();
  }
});

test('database rejects a placement pointing at both an item and a thing', async () => {
  const scope = await createTestScope();
  try {
    const location = await prisma.storageLocation.create({ data: { householdId: scope.householdAId, name: 'x' } });
    const thing = await prisma.storageThing.create({ data: { householdId: scope.householdAId, name: 't' } });
    await assert.rejects(
      prisma.storagePlacement.create({
        data: { householdId: scope.householdAId, locationId: location.id, itemId: scope.itemAId, thingId: thing.id },
      })
    );
  } finally {
    await scope.cleanup();
  }
});

// --- 同時更新（場所の木を世帯単位で直列化していることの回帰確認） ---

/** 世帯の場所の木に循環が無いこと（どの場所から親を辿っても最上位に着く）を DB から確認する */
async function assertNoCycle(householdId: string) {
  const rows = await prisma.storageLocation.findMany({ where: { householdId } });
  const parentOf = new Map(rows.map((r) => [r.id, r.parentId]));
  for (const row of rows) {
    const seen = new Set<string>();
    let current: string | null = row.id;
    while (current) {
      assert.ok(!seen.has(current), `場所の木に循環がある: ${row.name}`);
      seen.add(current);
      current = parentOf.get(current) ?? null;
    }
  }
}

const ROUNDS = 8;

test('concurrency: crossing moves (A under B and B under A at once) never create a cycle', async () => {
  const scope = await createTestScope();
  try {
    for (let round = 0; round < ROUNDS; round++) {
      const a = await createLocation(scope, `A${round}`);
      const b = await createLocation(scope, `B${round}`);
      const [moveA, moveB] = await Promise.all([
        call(scope, 'PATCH', `/locations/${a}`, { parentId: b }),
        call(scope, 'PATCH', `/locations/${b}`, { parentId: a }),
      ]);
      // 後から実行された方は、先の移動を見たうえで循環として拒否される
      assert.deepEqual([moveA.statusCode, moveB.statusCode].sort(), [200, 400], `round ${round}`);
      await assertNoCycle(scope.householdAId);
    }
  } finally {
    await scope.cleanup();
  }
});

test('concurrency: merging X into Y while moving Y under X never creates a cycle', async () => {
  const scope = await createTestScope();
  try {
    for (let round = 0; round < ROUNDS; round++) {
      const x = await createLocation(scope, `X${round}`);
      const y = await createLocation(scope, `Y${round}`);
      const [merge, move] = await Promise.all([
        call(scope, 'POST', `/locations/${x}/merge`, { targetId: y }),
        call(scope, 'PATCH', `/locations/${y}`, { parentId: x }),
      ]);
      // 統合が先なら X は消えて移動は404、移動が先なら Y は X の配下になり統合は400
      const statuses = [merge.statusCode, move.statusCode];
      assert.ok(
        (statuses[0] === 200 && statuses[1] === 404) || (statuses[0] === 400 && statuses[1] === 200),
        `round ${round}: merge=${statuses[0]} move=${statuses[1]}`
      );
      await assertNoCycle(scope.householdAId);
    }
  } finally {
    await scope.cleanup();
  }
});

test('concurrency: parallel imports creating the same new path share one location chain', async () => {
  const scope = await createTestScope();
  try {
    for (let round = 0; round < ROUNDS; round++) {
      const path = [`${round}階`, '納戸', '上段'];
      const [first, second] = await Promise.all([
        call(scope, 'POST', '/import', { dryRun: false, entries: [{ kind: 'thing', name: `物a${round}`, locations: [{ path }] }] }),
        call(scope, 'POST', '/import', { dryRun: false, entries: [{ kind: 'thing', name: `物b${round}`, locations: [{ path }] }] }),
      ]);
      assert.equal(first.statusCode, 200, first.body);
      assert.equal(second.statusCode, 200, second.body);
      // 2つ目は1つ目が作った場所を再利用し、同じ場所が2重にできない
      assert.equal(first.json().summary.locationsCreated + second.json().summary.locationsCreated, 3);
      assert.equal(await prisma.storageLocation.count({ where: { householdId: scope.householdAId, name: path[0] } }), 1);
      const leaf = await prisma.storageLocation.findFirstOrThrow({
        where: { householdId: scope.householdAId, name: '上段', parent: { name: '納戸', parent: { name: path[0] } } },
        include: { placements: true },
      });
      assert.equal(leaf.placements.length, 2);
    }
    await assertNoCycle(scope.householdAId);
  } finally {
    await scope.cleanup();
  }
});
