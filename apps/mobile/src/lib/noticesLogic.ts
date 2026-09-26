import type { MaintenanceStatus, Notice } from '../api/notices';

const ACTIVE_MAINTENANCE_STATUSES: MaintenanceStatus[] = ['scheduled', 'in_progress', 'extended'];
export const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export function isVisibleNow(notice: Notice, nowMs: number): boolean {
  return Date.parse(notice.visible_from) <= nowMs && nowMs < Date.parse(notice.visible_until);
}
export function selectVisibleNotices(notices: Notice[], nowMs: number): Notice[] { return notices.filter((n) => isVisibleNow(n, nowMs)); }
export function selectActiveMaintenanceNotices(notices: Notice[], nowMs: number): Notice[] {
  return selectVisibleNotices(notices, nowMs).filter((n) => n.kind === 'maintenance' && n.maintenance !== undefined && ACTIVE_MAINTENANCE_STATUSES.includes(n.maintenance.status));
}
export function isFeedStale(lastSuccessAtMs: number | null, nowMs: number): boolean { return lastSuccessAtMs !== null && nowMs - lastSuccessAtMs > STALE_THRESHOLD_MS; }
export function countUnread(notices: Notice[], readIds: ReadonlySet<string>): number { return notices.filter((n) => !readIds.has(n.notice_id)).length; }
