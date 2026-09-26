export type MaintenanceStatus = 'scheduled' | 'in_progress' | 'extended' | 'completed' | 'cancelled';

export type Notice = {
  notice_id: string;
  kind: 'feature' | 'maintenance';
  title_ja: string;
  message_ja: string;
  visible_from: string;
  visible_until: string;
  action_ja?: string;
  published_at?: string;
  revision?: number;
  maintenance?: {
    status: MaintenanceStatus;
    starts_at?: string;
    expected_end_at?: string;
    affected_features_ja?: string[];
    impact?: string;
    data_loss_expected?: boolean;
    next_update_at?: string;
  };
};

const STATUSES: MaintenanceStatus[] = ['scheduled', 'in_progress', 'extended', 'completed', 'cancelled'];
const TARGET_APP_ID = 'stockhome';
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonempty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const dateValue = (v: unknown): number | null => {
  if (!nonempty(v) || !/(Z|[+-]\d{2}:\d{2})$/.test(v)) return null;
  const time = Date.parse(v);
  return Number.isFinite(time) ? time : null;
};
const optionalDate = (v: unknown): string | undefined => dateValue(v) === null ? undefined : v as string;

export function validateNotices(value: unknown): Notice[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): Notice[] => {
    if (!record(item) || !nonempty(item.notice_id) || (item.kind !== 'feature' && item.kind !== 'maintenance') ||
      !Array.isArray(item.target_apps) || !item.target_apps.includes(TARGET_APP_ID) || !nonempty(item.title_ja) || !nonempty(item.message_ja)) return [];
    const from = dateValue(item.visible_from);
    const until = dateValue(item.visible_until);
    if (from === null || until === null || from >= until) return [];
    let maintenance: Notice['maintenance'];
    if (item.kind === 'maintenance') {
      if (!record(item.maintenance) || !STATUSES.includes(item.maintenance.status as MaintenanceStatus)) return [];
      const m = item.maintenance;
      maintenance = { status: m.status as MaintenanceStatus };
      const starts = optionalDate(m.starts_at); const ends = optionalDate(m.expected_end_at); const update = optionalDate(m.next_update_at);
      if (starts) maintenance.starts_at = starts;
      if (ends) maintenance.expected_end_at = ends;
      if (update) maintenance.next_update_at = update;
      if (Array.isArray(m.affected_features_ja) && m.affected_features_ja.every(nonempty)) maintenance.affected_features_ja = m.affected_features_ja;
      if (typeof m.impact === 'string') maintenance.impact = m.impact;
      if (typeof m.data_loss_expected === 'boolean') maintenance.data_loss_expected = m.data_loss_expected;
    }
    const notice: Notice = { notice_id: item.notice_id, kind: item.kind, title_ja: item.title_ja, message_ja: item.message_ja,
      visible_from: item.visible_from as string, visible_until: item.visible_until as string };
    if (typeof item.action_ja === 'string') notice.action_ja = item.action_ja;
    const published = optionalDate(item.published_at); if (published) notice.published_at = published;
    if (typeof item.revision === 'number' && Number.isFinite(item.revision)) notice.revision = item.revision;
    if (maintenance) notice.maintenance = maintenance;
    return [notice];
  });
}

export async function fetchNoticesFeed(): Promise<Notice[]> {
  const url = process.env.EXPO_PUBLIC_NOTICES_FEED_URL?.trim();
  if (!url) throw new Error('notices feed url is not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    if (!response.ok) throw new Error('notices feed request failed');
    const data: unknown = await response.json();
    if (!record(data) || data.schema_version !== 1 || !Array.isArray(data.notices)) throw new Error('unsupported notices feed schema');
    return validateNotices(data.notices);
  } finally { clearTimeout(timer); }
}
