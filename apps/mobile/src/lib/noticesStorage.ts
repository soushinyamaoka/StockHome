import AsyncStorage from '@react-native-async-storage/async-storage';
import { validateNotices, type Notice } from '../api/notices';

const FEED_KEY = 'stockhome.notices.feed.v1';
const READ_KEY = 'stockhome.notices.read.v1';
export type CachedFeed = { notices: Notice[]; fetchedAtMs: number };

export async function loadCachedFeed(): Promise<CachedFeed | null> {
  try {
    const raw = await AsyncStorage.getItem(FEED_KEY); if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as any).notices) || typeof (parsed as any).fetchedAtMs !== 'number') return null;
    const stored = (parsed as any).notices as unknown[];
    return { notices: validateNotices(stored.map((notice) => typeof notice === 'object' && notice !== null ? { ...(notice as object), target_apps: ['stockhome'] } : notice)), fetchedAtMs: (parsed as any).fetchedAtMs };
  } catch { return null; }
}
export async function saveCachedFeed(feed: CachedFeed): Promise<void> { try { await AsyncStorage.setItem(FEED_KEY, JSON.stringify(feed)); } catch { /* cache is optional */ } }
export async function loadReadIds(): Promise<Set<string>> {
  try { const raw = await AsyncStorage.getItem(READ_KEY); if (!raw) return new Set(); const parsed: unknown = JSON.parse(raw); return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === 'string')) : new Set(); }
  catch { return new Set(); }
}
export async function saveReadIds(ids: ReadonlySet<string>): Promise<void> { try { await AsyncStorage.setItem(READ_KEY, JSON.stringify(Array.from(ids))); } catch { /* read state is optional */ } }
