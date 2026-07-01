import type { ItemInput, PurchaseInput, CorrectionInput, SnoozeAction } from '@stockhome/shared';
import { api } from './client';
import type {
  ItemDto,
  ItemWithStock,
  PurchaseDto,
  PriceStats,
  StockEntry,
} from './types';

// --- 品目 ---
export async function fetchItems(includeInactive = false): Promise<{ items: ItemWithStock[] }> {
  const res = await api.get('/api/items', { params: { includeInactive } });
  return res.data;
}

export async function fetchItem(id: string): Promise<{ item: ItemWithStock }> {
  const res = await api.get(`/api/items/${id}`);
  return res.data;
}

export async function createItem(input: ItemInput): Promise<{ item: ItemDto }> {
  const res = await api.post('/api/items', input);
  return res.data;
}

export async function updateItem(id: string, input: ItemInput): Promise<{ item: ItemDto }> {
  const res = await api.put(`/api/items/${id}`, input);
  return res.data;
}

export async function toggleItemNotification(id: string, enabled: boolean): Promise<{ item: ItemDto }> {
  const res = await api.patch(`/api/items/${id}/notification`, { enabled });
  return res.data;
}

export async function deleteItem(id: string): Promise<void> {
  await api.delete(`/api/items/${id}`);
}

// --- 購入履歴 ---
export async function fetchPurchases(
  itemId: string
): Promise<{ purchases: PurchaseDto[]; priceStats: PriceStats }> {
  const res = await api.get(`/api/items/${itemId}/purchases`);
  return res.data;
}

export async function createPurchase(input: PurchaseInput): Promise<{ purchase: PurchaseDto }> {
  const res = await api.post('/api/purchases', input);
  return res.data;
}

export async function deletePurchase(id: string): Promise<void> {
  await api.delete(`/api/purchases/${id}`);
}

// --- 在庫 ---
export async function fetchStocks(): Promise<{ stocks: StockEntry[] }> {
  const res = await api.get('/api/stocks');
  return res.data;
}

export async function recalculateStocks(): Promise<{ ok: boolean }> {
  const res = await api.post('/api/stocks/recalculate', {});
  return res.data;
}

// --- 在庫補正 / スヌーズ ---
export async function createCorrection(input: CorrectionInput): Promise<void> {
  await api.post('/api/corrections', input);
}

export async function setSnooze(itemId: string, action: SnoozeAction): Promise<void> {
  await api.post('/api/snooze', { itemId, action });
}
