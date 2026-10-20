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
