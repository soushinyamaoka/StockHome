import { api } from './client';

// 保管場所管理（/api/storage/*）

export interface StorageLocationDto {
  id: string;
  name: string;
  parentId: string | null;
  memo: string | null;
  sortOrder: number;
  /** 最上位を1とした段数 */
  depth: number;
  /** 例: "1階 › パントリー › A棚" */
  pathText: string;
  childCount: number;
  /** この場所に直接ある物の数（配下は含まない） */
  placementCount: number;
}

export interface StorageTagDto {
  id: string;
  name: string;
  usageCount: number;
}

export interface StoragePlacementDto {
  id: string;
  itemId: string | null;
  thingId: string | null;
  memo: string | null;
  locationId: string;
  path: { id: string; name: string }[];
  pathText: string;
}

export interface StorageResultDto {
  /** item=消耗品 / thing=場所だけ管理する物 */
  kind: 'item' | 'thing';
  id: string;
  name: string;
  memo: string | null;
  unit: string | null;
  placements: StoragePlacementDto[];
  tags: { id: string; name: string }[];
}

export interface StorageSearchParams {
  q?: string;
  tagId?: string;
  locationId?: string;
  kind?: 'item' | 'thing';
}

export async function fetchStorageLocations(): Promise<{ locations: StorageLocationDto[] }> {
  const res = await api.get('/api/storage/locations');
  return res.data;
}

export async function fetchStorageTags(): Promise<{ tags: StorageTagDto[] }> {
  const res = await api.get('/api/storage/tags');
  return res.data;
}

export async function searchStorage(params: StorageSearchParams): Promise<{ results: StorageResultDto[] }> {
  const res = await api.get('/api/storage/search', { params });
  return res.data;
}

// --- 1件の消耗品・物（置き場所と用途タグ付き） ---

export async function fetchStorageThing(id: string): Promise<{ thing: StorageResultDto }> {
  const res = await api.get(`/api/storage/things/${id}`);
  return res.data;
}

export async function fetchStorageItem(itemId: string): Promise<{ item: StorageResultDto }> {
  const res = await api.get(`/api/storage/items/${itemId}`);
  return res.data;
}

// --- 場所 ---

export async function createStorageLocation(input: {
  name: string;
  parentId?: string | null;
  memo?: string | null;
}): Promise<{ location: { id: string; name: string; parentId: string | null } }> {
  const res = await api.post('/api/storage/locations', input);
  return res.data;
}

export async function updateStorageLocation(
  id: string,
  input: { name?: string; parentId?: string | null; memo?: string | null }
): Promise<void> {
  await api.patch(`/api/storage/locations/${id}`, input);
}

export async function deleteStorageLocation(id: string): Promise<void> {
  await api.delete(`/api/storage/locations/${id}`);
}

export async function mergeStorageLocation(id: string, targetId: string): Promise<void> {
  await api.post(`/api/storage/locations/${id}/merge`, { targetId });
}

// --- 物（場所だけ管理する物） ---

export async function createStorageThing(input: {
  name: string;
  memo?: string | null;
  placements?: { locationId: string; memo?: string | null }[];
  tags?: string[];
}): Promise<{ thing: StorageResultDto }> {
  const res = await api.post('/api/storage/things', input);
  return res.data;
}

export async function updateStorageThing(id: string, input: { name?: string; memo?: string | null }): Promise<void> {
  await api.patch(`/api/storage/things/${id}`, input);
}

export async function deleteStorageThing(id: string): Promise<void> {
  await api.delete(`/api/storage/things/${id}`);
}

// --- 置き場所 ---

export type StorageTargetRef = { itemId: string; thingId?: undefined } | { thingId: string; itemId?: undefined };

export async function createStoragePlacement(
  input: StorageTargetRef & { locationId: string; memo?: string | null }
): Promise<void> {
  await api.post('/api/storage/placements', input);
}

export async function updateStoragePlacement(
  id: string,
  input: { locationId?: string; memo?: string | null }
): Promise<void> {
  await api.patch(`/api/storage/placements/${id}`, input);
}

export async function deleteStoragePlacement(id: string): Promise<void> {
  await api.delete(`/api/storage/placements/${id}`);
}

// --- 用途タグ ---

/** 対象の用途タグを、指定した名前の集合に置き換える（未登録の名前は新規作成） */
export async function assignStorageTags(input: StorageTargetRef & { names: string[] }): Promise<void> {
  await api.put('/api/storage/tag-assignments', input);
}

export async function renameStorageTag(id: string, name: string): Promise<void> {
  await api.patch(`/api/storage/tags/${id}`, { name });
}

export async function mergeStorageTag(id: string, targetId: string): Promise<void> {
  await api.post(`/api/storage/tags/${id}/merge`, { targetId });
}

export async function deleteStorageTag(id: string): Promise<void> {
  await api.delete(`/api/storage/tags/${id}`);
}
