// 保管場所管理（場所・物・置き場所・用途タグ・検索・一括登録）
//
// - 場所は深さ可変の木。世帯あたり高々数百件の想定なので、操作ごとに世帯分をまとめて読み込み、
//   パス計算・配下判定・循環チェックはメモリ上で行う。
// - 置き場所・用途タグは消耗品(items)と物(storage_things)の両方を対象にする（どちらか一方を指す）。
// - 名前（場所・物・タグ）は shared の normalizeStorageName を通した値で保存・照合する。
import { Prisma, type StorageLocation } from '@prisma/client';
import {
  STORAGE_LIMITS,
  normalizeStorageName,
  type StorageImportEntry,
  type StorageLocationCreateInput,
  type StorageLocationUpdateInput,
  type StoragePlacementCreateInput,
  type StoragePlacementUpdateInput,
  type StorageSearchQuery,
  type StorageThingCreateInput,
  type StorageThingUpdateInput,
} from '@stockhome/shared';
import { prisma } from '../lib/prisma';

type Db = Prisma.TransactionClient;

/** ルートで HTTP ステータスに変換する業務エラー */
export class StorageError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

export const PATH_SEPARATOR = ' › ';

// ============================================================
// 世帯単位の直列化
// ============================================================

/** pg_advisory_xact_lock の第1キー（保管場所機能の名前空間。"STOR"） */
const STORAGE_LOCK_NAMESPACE = 0x53544f52;

/**
 * 保管場所の更新系トランザクション。開始直後に世帯単位のアドバイザリーロックを取り、
 * 同じ世帯の更新を1つずつ実行する。
 * 場所の木は「世帯分を読み込んでメモリ上で循環・段数を検査してから書く」ため、ロックが無いと
 * 同時に A→B の下、B→A の下へ移動した2つの更新がどちらも検査を通り、循環ができてしまう。
 * ロック取得後に木を読み込むので、各トランザクションは先行の確定済み変更を見て検査できる
 * （READ COMMITTED では文ごとに最新の確定済みデータを読む）。
 * ロックはトランザクション終了（commit/rollback）で自動的に外れる。行ロックではないため、
 * 購入登録など他機能の households への外部キー参照（KEY SHARE）を妨げない。
 */
async function storageTransaction<T>(
  householdId: string,
  run: (tx: Db) => Promise<T>,
  options?: { timeout?: number; maxWait?: number }
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${STORAGE_LOCK_NAMESPACE}::int, hashtext(${householdId}))`;
    return run(tx);
    // ロック待ちも含めた時間。他の更新（最長は一括登録）の完了を待てるよう既定の5秒より長くする
  }, { timeout: 20_000, maxWait: 20_000, ...options });
}

// ============================================================
// 場所の木
// ============================================================

export interface LocationTree {
  byId: Map<string, StorageLocation>;
  childrenOf: Map<string | null, StorageLocation[]>;
}

function sortLocations(a: StorageLocation, b: StorageLocation) {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ja');
}

export function buildLocationTree(locations: StorageLocation[]): LocationTree {
  const byId = new Map<string, StorageLocation>();
  const childrenOf = new Map<string | null, StorageLocation[]>();
  for (const loc of locations) byId.set(loc.id, loc);
  for (const loc of locations) {
    const key = loc.parentId && byId.has(loc.parentId) ? loc.parentId : null;
    const list = childrenOf.get(key) ?? [];
    list.push(loc);
    childrenOf.set(key, list);
  }
  for (const list of childrenOf.values()) list.sort(sortLocations);
  return { byId, childrenOf };
}

export async function loadLocationTree(db: Db, householdId: string): Promise<LocationTree> {
  return buildLocationTree(await db.storageLocation.findMany({ where: { householdId } }));
}

/** 最上位から自分までの場所（自分を含む） */
export function locationPath(tree: LocationTree, id: string): StorageLocation[] {
  const path: StorageLocation[] = [];
  const seen = new Set<string>();
  let current = tree.byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId ? tree.byId.get(current.parentId) : undefined;
  }
  return path;
}

/** 自分と配下すべての場所 ID */
export function descendantIds(tree: LocationTree, id: string): Set<string> {
  const result = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (result.has(current)) continue;
    result.add(current);
    for (const child of tree.childrenOf.get(current) ?? []) stack.push(child.id);
  }
  return result;
}

/** 自分を1段目として、配下の最も深い場所までの段数 */
function subtreeHeight(tree: LocationTree, id: string): number {
  const children = tree.childrenOf.get(id) ?? [];
  return 1 + children.reduce((max, child) => Math.max(max, subtreeHeight(tree, child.id)), 0);
}

function depthOf(tree: LocationTree, id: string | null): number {
  return id ? locationPath(tree, id).length : 0;
}

function assertDepth(depth: number) {
  if (depth > STORAGE_LIMITS.MAX_LOCATION_DEPTH) {
    throw new StorageError(400, `場所の階層は${STORAGE_LIMITS.MAX_LOCATION_DEPTH}段までです`);
  }
}

function findSibling(tree: LocationTree, parentId: string | null, name: string, excludeId?: string) {
  return (tree.childrenOf.get(parentId) ?? []).find((c) => c.name === name && c.id !== excludeId);
}

function requireLocation(tree: LocationTree, id: string): StorageLocation {
  const loc = tree.byId.get(id);
  if (!loc) throw new StorageError(404, '場所が見つかりません');
  return loc;
}

export function serializeLocationRef(tree: LocationTree, id: string) {
  const path = locationPath(tree, id);
  return {
    locationId: id,
    path: path.map((p) => ({ id: p.id, name: p.name })),
    pathText: path.map((p) => p.name).join(PATH_SEPARATOR),
  };
}

// ============================================================
// 場所の操作
// ============================================================

export async function listLocations(householdId: string) {
  const [locations, placementCounts] = await Promise.all([
    prisma.storageLocation.findMany({ where: { householdId } }),
    prisma.storagePlacement.groupBy({
      by: ['locationId'],
      where: { householdId },
      _count: { _all: true },
    }),
  ]);
  const tree = buildLocationTree(locations);
  const counts = new Map(placementCounts.map((c) => [c.locationId, c._count._all]));

  // 木の順（親→子、兄弟は並び順）で平らに返す
  const ordered: StorageLocation[] = [];
  const walk = (parentId: string | null) => {
    for (const child of tree.childrenOf.get(parentId) ?? []) {
      ordered.push(child);
      walk(child.id);
    }
  };
  walk(null);

  return ordered.map((loc) => {
    const ref = serializeLocationRef(tree, loc.id);
    return {
      id: loc.id,
      name: loc.name,
      parentId: loc.parentId,
      memo: loc.memo,
      sortOrder: loc.sortOrder,
      depth: ref.path.length,
      pathText: ref.pathText,
      childCount: (tree.childrenOf.get(loc.id) ?? []).length,
      placementCount: counts.get(loc.id) ?? 0,
    };
  });
}

export async function createLocation(householdId: string, input: StorageLocationCreateInput) {
  return storageTransaction(householdId, async (tx) => {
    const tree = await loadLocationTree(tx, householdId);
    const parentId = input.parentId ?? null;
    if (parentId) requireLocation(tree, parentId);
    assertDepth(depthOf(tree, parentId) + 1);
    if (findSibling(tree, parentId, input.name)) {
      throw new StorageError(409, `同じ場所に「${input.name}」がすでにあります`);
    }
    return tx.storageLocation.create({
      data: {
        householdId,
        name: input.name,
        parentId,
        memo: input.memo ?? null,
        sortOrder: input.sortOrder ?? 0,
      },
    });
  });
}

export async function updateLocation(householdId: string, id: string, input: StorageLocationUpdateInput) {
  return storageTransaction(householdId, async (tx) => {
    const tree = await loadLocationTree(tx, householdId);
    const current = requireLocation(tree, id);
    const nextParentId = input.parentId !== undefined ? input.parentId : current.parentId;
    const nextName = input.name ?? current.name;

    if (input.parentId !== undefined && nextParentId !== current.parentId) {
      if (nextParentId) {
        requireLocation(tree, nextParentId);
        if (descendantIds(tree, id).has(nextParentId)) {
          throw new StorageError(400, '自分自身やその中の場所の下へは移動できません');
        }
      }
      assertDepth(depthOf(tree, nextParentId) + subtreeHeight(tree, id));
    }
    if (findSibling(tree, nextParentId, nextName, id)) {
      throw new StorageError(409, `同じ場所に「${nextName}」がすでにあります。統合を使ってください`);
    }

    return tx.storageLocation.update({
      where: { id },
      data: {
        name: nextName,
        parentId: nextParentId,
        ...(input.memo !== undefined ? { memo: input.memo } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
    });
  });
}

export async function deleteLocation(householdId: string, id: string) {
  await storageTransaction(householdId, async (tx) => {
    const tree = await loadLocationTree(tx, householdId);
    requireLocation(tree, id);
    const placements = await tx.storagePlacement.count({ where: { locationId: id } });
    if ((tree.childrenOf.get(id) ?? []).length > 0 || placements > 0) {
      throw new StorageError(409, '中に物や場所があるため削除できません。中身を移動するか、別の場所と統合してください');
    }
    await tx.storageLocation.delete({ where: { id } });
  });
}

/**
 * source を target へ統合する。source の中の場所は target の下へ移り（同名があればさらに統合）、
 * source の置き場所は target へ移る（target に同じ物がすでにあれば target 側を残す）。最後に source を削除する。
 */
export async function mergeLocation(householdId: string, sourceId: string, targetId: string) {
  if (sourceId === targetId) throw new StorageError(400, '同じ場所どうしは統合できません');
  await storageTransaction(householdId, async (tx) => {
    const tree = await loadLocationTree(tx, householdId);
    requireLocation(tree, sourceId);
    requireLocation(tree, targetId);
    if (descendantIds(tree, sourceId).has(targetId)) {
      throw new StorageError(400, '自分の中の場所へは統合できません');
    }
    // source 配下の各場所は target からの相対位置で並ぶ
    assertDepth(depthOf(tree, targetId) + subtreeHeight(tree, sourceId) - 1);
    await mergeInto(tx, tree, sourceId, targetId);
  });
}

async function mergeInto(tx: Db, tree: LocationTree, sourceId: string, targetId: string) {
  for (const child of [...(tree.childrenOf.get(sourceId) ?? [])]) {
    const same = findSibling(tree, targetId, child.name);
    if (same) {
      await mergeInto(tx, tree, child.id, same.id);
    } else {
      await tx.storageLocation.update({ where: { id: child.id }, data: { parentId: targetId } });
      moveInTree(tree, child, targetId);
    }
  }
  await moveAllPlacements(tx, sourceId, targetId);
  await tx.storageLocation.delete({ where: { id: sourceId } });
  removeFromTree(tree, sourceId);
}

function moveInTree(tree: LocationTree, loc: StorageLocation, newParentId: string) {
  const oldKey = loc.parentId ?? null;
  tree.childrenOf.set(oldKey, (tree.childrenOf.get(oldKey) ?? []).filter((c) => c.id !== loc.id));
  const moved = { ...loc, parentId: newParentId };
  tree.byId.set(loc.id, moved);
  tree.childrenOf.set(newParentId, [...(tree.childrenOf.get(newParentId) ?? []), moved].sort(sortLocations));
}

function removeFromTree(tree: LocationTree, id: string) {
  const loc = tree.byId.get(id);
  if (!loc) return;
  const key = loc.parentId ?? null;
  tree.childrenOf.set(key, (tree.childrenOf.get(key) ?? []).filter((c) => c.id !== id));
  tree.byId.delete(id);
}

async function moveAllPlacements(tx: Db, fromId: string, toId: string) {
  const sources = await tx.storagePlacement.findMany({ where: { locationId: fromId } });
  for (const p of sources) {
    const existing = await tx.storagePlacement.findFirst({
      where: { locationId: toId, itemId: p.itemId, thingId: p.thingId },
    });
    if (existing) {
      if (!existing.memo && p.memo) {
        await tx.storagePlacement.update({ where: { id: existing.id }, data: { memo: p.memo } });
      }
      await tx.storagePlacement.delete({ where: { id: p.id } });
    } else {
      await tx.storagePlacement.update({ where: { id: p.id }, data: { locationId: toId } });
    }
  }
}

// ============================================================
// 対象（消耗品・物）の確認
// ============================================================

interface Target {
  itemId?: string | null;
  thingId?: string | null;
}

async function assertTargetInHousehold(db: Db, householdId: string, target: Target) {
  if (target.itemId) {
    const item = await db.item.findFirst({ where: { id: target.itemId, householdId, isActive: true } });
    if (!item) throw new StorageError(404, '消耗品が見つからないか削除済みです');
  } else if (target.thingId) {
    const thing = await db.storageThing.findFirst({ where: { id: target.thingId, householdId, isActive: true } });
    if (!thing) throw new StorageError(404, '物が見つからないか削除済みです');
  } else {
    throw new StorageError(400, 'itemId と thingId のどちらか一方を指定してください');
  }
}

function targetWhere(target: Target) {
  return target.itemId ? { itemId: target.itemId } : { thingId: target.thingId! };
}

// ============================================================
// 置き場所
// ============================================================

export async function createPlacement(householdId: string, input: StoragePlacementCreateInput) {
  return storageTransaction(householdId, async (tx) => {
    await assertTargetInHousehold(tx, householdId, input);
    const tree = await loadLocationTree(tx, householdId);
    requireLocation(tree, input.locationId);
    const dup = await tx.storagePlacement.findFirst({
      where: { locationId: input.locationId, ...targetWhere(input) },
    });
    if (dup) throw new StorageError(409, 'すでにその場所に登録されています');
    const placement = await tx.storagePlacement.create({
      data: {
        householdId,
        locationId: input.locationId,
        itemId: input.itemId ?? null,
        thingId: input.thingId ?? null,
        memo: input.memo ?? null,
      },
    });
    return serializePlacement(tree, placement);
  });
}

export async function updatePlacement(householdId: string, id: string, input: StoragePlacementUpdateInput) {
  return storageTransaction(householdId, async (tx) => {
    const placement = await tx.storagePlacement.findFirst({ where: { id, householdId } });
    if (!placement) throw new StorageError(404, '置き場所が見つかりません');
    const tree = await loadLocationTree(tx, householdId);
    if (input.locationId && input.locationId !== placement.locationId) {
      requireLocation(tree, input.locationId);
      const dup = await tx.storagePlacement.findFirst({
        where: { locationId: input.locationId, itemId: placement.itemId, thingId: placement.thingId },
      });
      if (dup) throw new StorageError(409, '移動先にすでに登録されています');
    }
    const updated = await tx.storagePlacement.update({
      where: { id },
      data: {
        ...(input.locationId ? { locationId: input.locationId } : {}),
        ...(input.memo !== undefined ? { memo: input.memo } : {}),
      },
    });
    return serializePlacement(tree, updated);
  });
}

export async function deletePlacement(householdId: string, id: string) {
  const result = await prisma.storagePlacement.deleteMany({ where: { id, householdId } });
  if (result.count === 0) throw new StorageError(404, '置き場所が見つかりません');
}

function serializePlacement(
  tree: LocationTree,
  p: { id: string; locationId: string; itemId: string | null; thingId: string | null; memo: string | null }
) {
  return {
    id: p.id,
    itemId: p.itemId,
    thingId: p.thingId,
    memo: p.memo,
    ...serializeLocationRef(tree, p.locationId),
  };
}

// ============================================================
// 用途タグ
// ============================================================

export async function listTags(householdId: string) {
  const tags = await prisma.usageTag.findMany({
    where: { householdId },
    include: {
      links: {
        where: { OR: [{ item: { isActive: true } }, { thing: { isActive: true } }] },
        select: { id: true },
      },
    },
  });
  return tags
    .map((t) => ({ id: t.id, name: t.name, usageCount: t.links.length }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

export async function createTag(householdId: string, name: string) {
  const existing = await prisma.usageTag.findUnique({ where: { householdId_name: { householdId, name } } });
  if (existing) throw new StorageError(409, `用途タグ「${name}」はすでにあります`);
  const tag = await prisma.usageTag.create({ data: { householdId, name } });
  return { id: tag.id, name: tag.name, usageCount: 0 };
}

export async function renameTag(householdId: string, id: string, name: string) {
  const tag = await prisma.usageTag.findFirst({ where: { id, householdId } });
  if (!tag) throw new StorageError(404, '用途タグが見つかりません');
  const other = await prisma.usageTag.findUnique({ where: { householdId_name: { householdId, name } } });
  if (other && other.id !== id) {
    throw new StorageError(409, `用途タグ「${name}」はすでにあります。統合を使ってください`);
  }
  const updated = await prisma.usageTag.update({ where: { id }, data: { name } });
  return { id: updated.id, name: updated.name };
}

/** source のタグ付けを target へ移して source を削除する（表記ゆれの統合） */
export async function mergeTag(householdId: string, sourceId: string, targetId: string) {
  if (sourceId === targetId) throw new StorageError(400, '同じタグどうしは統合できません');
  await storageTransaction(householdId, async (tx) => {
    const [source, target] = await Promise.all([
      tx.usageTag.findFirst({ where: { id: sourceId, householdId } }),
      tx.usageTag.findFirst({ where: { id: targetId, householdId } }),
    ]);
    if (!source || !target) throw new StorageError(404, '用途タグが見つかりません');
    const links = await tx.usageTagLink.findMany({ where: { tagId: sourceId } });
    for (const link of links) {
      const dup = await tx.usageTagLink.findFirst({
        where: { tagId: targetId, itemId: link.itemId, thingId: link.thingId },
      });
      if (dup) {
        await tx.usageTagLink.delete({ where: { id: link.id } });
      } else {
        await tx.usageTagLink.update({ where: { id: link.id }, data: { tagId: targetId } });
      }
    }
    await tx.usageTag.delete({ where: { id: sourceId } });
  });
}

export async function deleteTag(householdId: string, id: string) {
  const result = await prisma.usageTag.deleteMany({ where: { id, householdId } });
  if (result.count === 0) throw new StorageError(404, '用途タグが見つかりません');
}

/** 名前のタグを取得し、無ければ作る。作ったかどうかも返す */
async function ensureTag(tx: Db, householdId: string, name: string) {
  const existing = await tx.usageTag.findUnique({ where: { householdId_name: { householdId, name } } });
  if (existing) return { tag: existing, created: false };
  return { tag: await tx.usageTag.create({ data: { householdId, name } }), created: true };
}

/** 対象に名前のタグを足す（すでに付いていれば何もしない）。結果を返す */
async function addTags(tx: Db, householdId: string, target: Target, names: string[]) {
  const createdTags: string[] = [];
  const addedTags: string[] = [];
  for (const name of names) {
    const { tag, created } = await ensureTag(tx, householdId, name);
    if (created) createdTags.push(name);
    const linked = await tx.usageTagLink.findFirst({ where: { tagId: tag.id, ...targetWhere(target) } });
    if (!linked) {
      await tx.usageTagLink.create({
        data: { householdId, tagId: tag.id, itemId: target.itemId ?? null, thingId: target.thingId ?? null },
      });
      addedTags.push(name);
    }
  }
  return { createdTags, addedTags };
}

/** 対象の用途タグを、指定した名前の集合に置き換える */
export async function assignTags(householdId: string, target: Target, names: string[]) {
  return storageTransaction(householdId, async (tx) => {
    await assertTargetInHousehold(tx, householdId, target);
    await addTags(tx, householdId, target, names);
    const links = await tx.usageTagLink.findMany({ where: targetWhere(target), include: { tag: true } });
    const keep = new Set(names);
    const removeIds = links.filter((l) => !keep.has(l.tag.name)).map((l) => l.id);
    if (removeIds.length > 0) await tx.usageTagLink.deleteMany({ where: { id: { in: removeIds } } });
    return links
      .filter((l) => keep.has(l.tag.name))
      .map((l) => ({ id: l.tag.id, name: l.tag.name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  });
}

// ============================================================
// 物（場所だけ管理する物）
// ============================================================

export async function createThing(householdId: string, input: StorageThingCreateInput) {
  const thingId = await storageTransaction(householdId, async (tx) => {
    const tree = await loadLocationTree(tx, householdId);
    for (const p of input.placements) requireLocation(tree, p.locationId);
    const thing = await tx.storageThing.create({
      data: { householdId, name: input.name, memo: input.memo ?? null },
    });
    const seen = new Set<string>();
    for (const p of input.placements) {
      if (seen.has(p.locationId)) continue;
      seen.add(p.locationId);
      await tx.storagePlacement.create({
        data: { householdId, locationId: p.locationId, thingId: thing.id, memo: p.memo ?? null },
      });
    }
    await addTags(tx, householdId, { thingId: thing.id }, input.tags);
    return thing.id;
  });
  return getStorageTarget(householdId, { thingId });
}

export async function updateThing(householdId: string, id: string, input: StorageThingUpdateInput) {
  const result = await prisma.storageThing.updateMany({
    where: { id, householdId, isActive: true },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.memo !== undefined ? { memo: input.memo } : {}),
    },
  });
  if (result.count === 0) throw new StorageError(404, '物が見つからないか削除済みです');
  return getStorageTarget(householdId, { thingId: id });
}

/** 論理削除（置き場所・タグは残すが、検索や一覧には出さない） */
export async function deleteThing(householdId: string, id: string) {
  const result = await prisma.storageThing.updateMany({
    where: { id, householdId, isActive: true },
    data: { isActive: false, deletedAt: new Date() },
  });
  if (result.count === 0) throw new StorageError(404, '物が見つからないか削除済みです');
}

// ============================================================
// 検索・詳細
// ============================================================

const placementInclude = { select: { id: true, locationId: true, itemId: true, thingId: true, memo: true } } as const;
const tagLinkInclude = { select: { tag: { select: { id: true, name: true } } } } as const;

export interface StorageResult {
  kind: 'item' | 'thing';
  id: string;
  name: string;
  memo: string | null;
  unit: string | null;
  placements: ReturnType<typeof serializePlacement>[];
  tags: { id: string; name: string }[];
}

function toResult(
  tree: LocationTree,
  kind: 'item' | 'thing',
  row: {
    id: string;
    name: string;
    memo: string | null;
    unit: string | null;
    placements: Parameters<typeof serializePlacement>[1][];
    usageTagLinks: { tag: { id: string; name: string } }[];
  }
): StorageResult {
  return {
    kind,
    id: row.id,
    name: row.name,
    memo: row.memo,
    unit: row.unit,
    placements: row.placements
      .map((p) => serializePlacement(tree, p))
      .sort((a, b) => a.pathText.localeCompare(b.pathText, 'ja')),
    tags: row.usageTagLinks.map((l) => l.tag).sort((a, b) => a.name.localeCompare(b.name, 'ja')),
  };
}

async function loadResults(householdId: string, where: { itemIds?: string[]; thingIds?: string[] } = {}) {
  const [tree, things, items] = await Promise.all([
    loadLocationTree(prisma, householdId),
    where.itemIds && !where.thingIds
      ? Promise.resolve([])
      : prisma.storageThing.findMany({
          where: { householdId, isActive: true, ...(where.thingIds ? { id: { in: where.thingIds } } : {}) },
          include: { placements: placementInclude, usageTagLinks: tagLinkInclude },
        }),
    where.thingIds && !where.itemIds
      ? Promise.resolve([])
      : prisma.item.findMany({
          where: { householdId, isActive: true, ...(where.itemIds ? { id: { in: where.itemIds } } : {}) },
          include: { placements: placementInclude, usageTagLinks: tagLinkInclude },
        }),
  ]);
  const results: StorageResult[] = [
    ...things.map((t) => toResult(tree, 'thing', { ...t, unit: null })),
    ...items.map((i) => toResult(tree, 'item', { ...i, name: i.itemName, memo: i.itemMemo, unit: i.unit })),
  ];
  return { tree, results };
}

/** 1件の消耗品・物の置き場所と用途タグ */
export async function getStorageTarget(householdId: string, target: Target) {
  const { results } = await loadResults(
    householdId,
    target.itemId ? { itemIds: [target.itemId] } : { thingIds: [target.thingId!] }
  );
  if (results.length === 0) {
    throw new StorageError(404, target.itemId ? '消耗品が見つからないか削除済みです' : '物が見つからないか削除済みです');
  }
  return results[0];
}

function matchesText(result: StorageResult, needle: string): boolean {
  const haystack = [
    result.name,
    result.memo ?? '',
    ...result.tags.map((t) => t.name),
    ...result.placements.flatMap((p) => [p.pathText, p.memo ?? '']),
  ]
    .map((s) => normalizeStorageName(s).toLowerCase())
    .join('\n');
  return haystack.includes(needle);
}

/**
 * 検索。条件はすべて AND。
 * - q: 名前・メモ・用途タグ名・置き場所（場所名のパス・置き場所メモ）の部分一致
 * - tagId: その用途タグが付いているもの
 * - locationId: その場所か配下に置き場所があるもの
 * 条件なしの場合は、物すべてと「置き場所か用途タグがある消耗品」を返す。
 * q で消耗品の名前に一致した場合は、置き場所未登録でも返す（「場所未登録」と分かるように）。
 */
export async function searchStorage(householdId: string, query: StorageSearchQuery) {
  const { tree, results } = await loadResults(householdId);
  const needle = query.q ? normalizeStorageName(query.q).toLowerCase() : '';
  const inLocation = query.locationId ? descendantIds(tree, query.locationId) : null;
  const hasFilter = !!needle || !!query.tagId || !!inLocation;

  return results
    .filter((r) => {
      if (query.kind && r.kind !== query.kind) return false;
      if (query.tagId && !r.tags.some((t) => t.id === query.tagId)) return false;
      if (inLocation && !r.placements.some((p) => inLocation.has(p.locationId))) return false;
      if (needle && !matchesText(r, needle)) return false;
      if (!hasFilter && r.kind === 'item' && r.placements.length === 0 && r.tags.length === 0) return false;
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

// ============================================================
// 一括登録（チャット経由の初回登録用）
// ============================================================

export interface ImportEntryPlan {
  index: number;
  kind: 'thing' | 'item';
  name: string;
  /** create=物を新規作成 / update=既存の物・消耗品へ追記 / error=登録できない */
  action: 'create' | 'update' | 'error';
  targetId: string | null;
  error?: string;
  memoUpdated: boolean;
  createdLocations: string[];
  addedPlacements: { pathText: string; memo: string | null }[];
  updatedPlacements: { pathText: string; memo: string | null }[];
  unchangedPlacements: string[];
  createdTags: string[];
  addedTags: string[];
}

export interface ImportResult {
  dryRun: boolean;
  applied: boolean;
  summary: {
    entries: number;
    errors: number;
    thingsCreated: number;
    targetsUpdated: number;
    locationsCreated: number;
    placementsAdded: number;
    tagsCreated: number;
  };
  entries: ImportEntryPlan[];
}

class ImportRollback extends Error {
  constructor(public readonly result: ImportResult) {
    super('import rollback');
  }
}

/**
 * 一括登録。dryRun でも本番と同じ処理をトランザクション内で実行し、最後にロールバックすることで
 * 「確認時の表示」と「実際の登録」がずれないようにする。
 * 1件でもエラーがあれば（dryRun でなくても）何も登録しない。
 */
export async function runStorageImport(
  householdId: string,
  entries: StorageImportEntry[],
  dryRun: boolean
): Promise<ImportResult> {
  try {
    return await storageTransaction(
      householdId,
      async (tx) => {
        const tree = await loadLocationTree(tx, householdId);
        const plans: ImportEntryPlan[] = [];
        for (const [index, entry] of entries.entries()) {
          plans.push(await importEntry(tx, householdId, tree, index, entry));
        }
        const result = summarize(plans, dryRun);
        if (dryRun || result.summary.errors > 0) throw new ImportRollback(result);
        return result;
      },
      { timeout: 60_000 }
    );
  } catch (e) {
    if (e instanceof ImportRollback) return e.result;
    throw e;
  }
}

function summarize(plans: ImportEntryPlan[], dryRun: boolean): ImportResult {
  const errors = plans.filter((p) => p.action === 'error').length;
  return {
    dryRun,
    applied: !dryRun && errors === 0,
    summary: {
      entries: plans.length,
      errors,
      thingsCreated: plans.filter((p) => p.action === 'create').length,
      targetsUpdated: plans.filter((p) => p.action === 'update').length,
      locationsCreated: plans.reduce((n, p) => n + p.createdLocations.length, 0),
      placementsAdded: plans.reduce((n, p) => n + p.addedPlacements.length, 0),
      tagsCreated: plans.reduce((n, p) => n + p.createdTags.length, 0),
    },
    entries: plans,
  };
}

async function importEntry(
  tx: Db,
  householdId: string,
  tree: LocationTree,
  index: number,
  entry: StorageImportEntry
): Promise<ImportEntryPlan> {
  const plan: ImportEntryPlan = {
    index,
    kind: entry.kind,
    name: entry.name,
    action: 'update',
    targetId: null,
    memoUpdated: false,
    createdLocations: [],
    addedPlacements: [],
    updatedPlacements: [],
    unchangedPlacements: [],
    createdTags: [],
    addedTags: [],
  };
  const fail = (message: string): ImportEntryPlan => ({ ...plan, action: 'error', error: message });

  // 1. 対象を決める
  let target: Target;
  if (entry.kind === 'item') {
    const items = entry.itemId
      ? await tx.item.findMany({ where: { id: entry.itemId, householdId, isActive: true } })
      : (await tx.item.findMany({ where: { householdId, isActive: true } })).filter(
          (i) => normalizeStorageName(i.itemName) === entry.name
        );
    if (items.length === 0) return fail('消耗品が見つかりません（品名か ID を確認してください）');
    if (items.length > 1) return fail('同じ品名の消耗品が複数あります。itemId で指定してください');
    target = { itemId: items[0].id };
    plan.targetId = items[0].id;
  } else {
    const things = await tx.storageThing.findMany({ where: { householdId, isActive: true, name: entry.name } });
    if (things.length > 1) return fail('同じ名前の物が複数あります。アプリから個別に登録してください');
    if (things.length === 1) {
      target = { thingId: things[0].id };
      plan.targetId = things[0].id;
      if (entry.memo !== undefined && entry.memo !== things[0].memo) {
        await tx.storageThing.update({ where: { id: things[0].id }, data: { memo: entry.memo } });
        plan.memoUpdated = true;
      }
    } else {
      const created = await tx.storageThing.create({
        data: { householdId, name: entry.name, memo: entry.memo ?? null },
      });
      target = { thingId: created.id };
      plan.targetId = created.id;
      plan.action = 'create';
    }
  }

  // 2. 場所（無い階層は作る）と置き場所
  for (const loc of entry.locations) {
    let parentId: string | null = null;
    for (const [depth, name] of loc.path.entries()) {
      const existing = findSibling(tree, parentId, name);
      if (existing) {
        parentId = existing.id;
        continue;
      }
      if (depth + 1 > STORAGE_LIMITS.MAX_LOCATION_DEPTH) {
        return fail(`場所の階層は${STORAGE_LIMITS.MAX_LOCATION_DEPTH}段までです`);
      }
      const created: StorageLocation = await tx.storageLocation.create({
        data: { householdId, name, parentId },
      });
      tree.byId.set(created.id, created);
      tree.childrenOf.set(parentId, [...(tree.childrenOf.get(parentId) ?? []), created].sort(sortLocations));
      plan.createdLocations.push(serializeLocationRef(tree, created.id).pathText);
      parentId = created.id;
    }
    const locationId = parentId!;
    const pathText = serializeLocationRef(tree, locationId).pathText;
    const existing = await tx.storagePlacement.findFirst({ where: { locationId, ...targetWhere(target) } });
    if (!existing) {
      await tx.storagePlacement.create({
        data: {
          householdId,
          locationId,
          itemId: target.itemId ?? null,
          thingId: target.thingId ?? null,
          memo: loc.memo ?? null,
        },
      });
      plan.addedPlacements.push({ pathText, memo: loc.memo ?? null });
    } else if (loc.memo !== undefined && loc.memo !== existing.memo) {
      await tx.storagePlacement.update({ where: { id: existing.id }, data: { memo: loc.memo } });
      plan.updatedPlacements.push({ pathText, memo: loc.memo });
    } else {
      plan.unchangedPlacements.push(pathText);
    }
  }

  // 3. 用途タグ（追加のみ。既存のタグは外さない）
  const tags = await addTags(tx, householdId, target, entry.tags);
  plan.createdTags = tags.createdTags;
  plan.addedTags = tags.addedTags;

  return plan;
}
