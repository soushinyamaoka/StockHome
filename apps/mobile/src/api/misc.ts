import { api } from './client';
import type { CandidateDto, DashboardData, FamilyUser, NotificationDto, PurchaseDto } from './types';

// --- ダッシュボード ---
export async function fetchDashboard(): Promise<DashboardData> {
  const res = await api.get('/api/dashboard');
  return res.data;
}

export async function runBatchManually(): Promise<{
  alerts: number;
  queued: boolean;
}> {
  const res = await api.post('/api/dashboard/run-batch', {});
  return res.data;
}

// --- 取込候補 ---
export async function fetchCandidates(
  includeResolved = false
): Promise<{ candidates: CandidateDto[] }> {
  const res = await api.get('/api/import-candidates', { params: { includeResolved } });
  return res.data;
}

export async function confirmCandidate(
  id: string,
  matchedItemId: string
): Promise<{ candidate: CandidateDto; purchase: PurchaseDto }> {
  const res = await api.post(`/api/import-candidates/${id}/confirm`, { matchedItemId });
  return res.data;
}

export async function ignoreCandidate(id: string): Promise<{ candidate: CandidateDto }> {
  const res = await api.post(`/api/import-candidates/${id}/ignore`, {});
  return res.data;
}

// --- 通知履歴 ---
export async function fetchNotifications(limit = 50): Promise<{ notifications: NotificationDto[] }> {
  const res = await api.get('/api/notifications', { params: { limit } });
  return res.data;
}

// --- 家族ユーザー ---
export async function fetchUsers(): Promise<{ users: FamilyUser[] }> {
  const res = await api.get('/api/users');
  return res.data;
}

export async function createFamilyMember(input: {
  email: string;
  name: string;
  password: string;
  role: string;
}): Promise<{ user: FamilyUser }> {
  const res = await api.post('/api/users', input);
  return res.data;
}

export async function updateFamilyMember(
  id: string,
  input: { name?: string; role?: string; isActive?: boolean }
): Promise<{ user: FamilyUser }> {
  const res = await api.patch(`/api/users/${id}`, input);
  return res.data;
}

// --- アプリ設定 ---
export async function fetchAppConfig(): Promise<{
  configs: Record<string, string>;
  deliveryBufferDays: number;
}> {
  const res = await api.get('/api/app-config');
  return res.data;
}

export async function updateDeliveryBuffer(days: number): Promise<void> {
  await api.put('/api/app-config/delivery-buffer', { days });
}
