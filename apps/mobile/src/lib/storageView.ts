// 置き場所タブ・ホームの表示用の純粋関数（API の結果を画面向けに整える）
import type { StorageLocationDto, StoragePlacementDto, StorageResultDto } from '../api/storage';

export const PATH_SEPARATOR = ' › ';

/** 親 ID → 子の場所（API の並び＝木の順を保つ）。最上位は null キー */
export function indexChildren(locations: StorageLocationDto[]): Map<string | null, StorageLocationDto[]> {
  const ids = new Set(locations.map((l) => l.id));
  const index = new Map<string | null, StorageLocationDto[]>();
  for (const loc of locations) {
    const key = loc.parentId && ids.has(loc.parentId) ? loc.parentId : null;
    const list = index.get(key) ?? [];
    list.push(loc);
    index.set(key, list);
  }
  return index;
}

/** 場所とその配下にある物の数（同じ物が配下の複数の場所にあれば、その分数える） */
export function subtreePlacementCount(
  locationId: string,
  children: Map<string | null, StorageLocationDto[]>,
  byId: Map<string, StorageLocationDto>
): number {
  const self = byId.get(locationId)?.placementCount ?? 0;
  return (children.get(locationId) ?? []).reduce(
    (sum, child) => sum + subtreePlacementCount(child.id, children, byId),
    self
  );
}

/** 最上位から自分の親までの場所（パンくず用。自分は含まない） */
export function ancestorsOf(locationId: string, byId: Map<string, StorageLocationDto>): StorageLocationDto[] {
  const result: StorageLocationDto[] = [];
  const seen = new Set<string>([locationId]);
  let parentId = byId.get(locationId)?.parentId ?? null;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    result.unshift(parent);
    parentId = parent.parentId;
  }
  return result;
}

/**
 * 場所の画面で、置き場所を「いま見ている場所からの相対パス」で表す。
 * 見ている場所そのものなら「ここ」、配下なら "A棚 › 1段目"、配下でなければ全体のパス。
 */
export function relativePlacementPath(placement: StoragePlacementDto, baseLocationId: string): string {
  const index = placement.path.findIndex((p) => p.id === baseLocationId);
  if (index < 0) return placement.pathText;
  const rest = placement.path.slice(index + 1).map((p) => p.name);
  return rest.length === 0 ? 'ここ' : rest.join(PATH_SEPARATOR);
}

/** 置き場所が、指定した場所かその配下にあるか */
export function isPlacementUnder(placement: StoragePlacementDto, locationId: string): boolean {
  return placement.path.some((p) => p.id === locationId);
}

/** 消耗品 ID → 置き場所（ホームの「切れそう」にストック場所を出すため） */
export function placementsByItemId(results: StorageResultDto[]): Map<string, StoragePlacementDto[]> {
  const map = new Map<string, StoragePlacementDto[]>();
  for (const r of results) {
    if (r.kind === 'item' && r.placements.length > 0) map.set(r.id, r.placements);
  }
  return map;
}

/**
 * ストック場所の短い表示。1か所なら「パス（メモ）」、複数なら先頭＋「ほかNか所」。
 * 「ストック」を含むメモの場所があれば、それを先頭にする（開封中の場所より、買い置きの場所を知りたいため）。
 */
export function stockLocationLabel(placements: StoragePlacementDto[] | undefined): string | null {
  if (!placements || placements.length === 0) return null;
  const preferred = placements.find((p) => p.memo?.includes('ストック')) ?? placements[0];
  const head = preferred.memo ? `${preferred.pathText}（${preferred.memo}）` : preferred.pathText;
  return placements.length > 1 ? `${head} ほか${placements.length - 1}か所` : head;
}
