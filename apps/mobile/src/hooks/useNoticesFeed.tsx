import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { fetchNoticesFeed, type Notice } from '../api/notices';
import { countUnread, isFeedStale, selectActiveMaintenanceNotices, selectVisibleNotices } from '../lib/noticesLogic';
import { loadCachedFeed, loadReadIds, saveCachedFeed, saveReadIds, type CachedFeed } from '../lib/noticesStorage';

interface NoticesContextValue {
  status: 'loading' | 'unavailable' | 'ready'; visibleNotices: Notice[]; maintenanceBanners: Notice[]; unreadCount: number;
  isStale: boolean; lastSuccessAt: Date | null; markRead: (noticeIds: string[]) => void;
  readIds: ReadonlySet<string>;
}
const NoticesContext = createContext<NoticesContextValue | null>(null);

export function NoticesProvider({ children }: React.PropsWithChildren) {
  const [feed, setFeed] = useState<CachedFeed | null>(null);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<NoticesContextValue['status']>('loading');
  const [clock, setClock] = useState(Date.now());
  const inFlight = useRef(false); const mounted = useRef(true); const initialized = useRef(false);
  const feedRef = useRef<CachedFeed | null>(null);
  feedRef.current = feed;
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const notices = await fetchNoticesFeed();
      const next = { notices, fetchedAtMs: Date.now() };
      await saveCachedFeed(next);
      if (mounted.current) { feedRef.current = next; setFeed(next); setStatus('ready'); }
    } catch {
      if (mounted.current) setStatus(feedRef.current ? 'ready' : 'unavailable');
    } finally {
      inFlight.current = false;
      if (mounted.current) setClock(Date.now());
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    let alive = true;
    Promise.all([loadCachedFeed(), loadReadIds()]).then(([cached, ids]) => {
      if (!alive) return;
      initialized.current = true; feedRef.current = cached; setFeed(cached); setReadIds(ids); setStatus(cached ? 'ready' : 'loading'); setClock(Date.now());
      void refresh();
    });
    const appState = AppState.addEventListener('change', (state) => { if (state === 'active' && initialized.current) void refresh(); });
    const timer = setInterval(() => { if (AppState.currentState === 'active' && initialized.current) void refresh(); }, 5 * 60 * 1000);
    return () => { alive = false; mounted.current = false; appState.remove(); clearInterval(timer); };
  }, [refresh]);
  const markRead = useCallback((noticeIds: string[]) => {
    setReadIds((current) => { const next = new Set(current); noticeIds.forEach((id) => next.add(id)); void saveReadIds(next); return next; });
  }, []);
  const value = useMemo<NoticesContextValue>(() => {
    const now = clock; const notices = feed?.notices ?? []; const visibleNotices = selectVisibleNotices(notices, now); const last = feed?.fetchedAtMs ?? null;
    return { status, visibleNotices, maintenanceBanners: selectActiveMaintenanceNotices(notices, now), unreadCount: countUnread(visibleNotices, readIds), isStale: isFeedStale(last, now), lastSuccessAt: last === null ? null : new Date(last), markRead, readIds };
  }, [clock, feed, markRead, readIds, status]);
  return <NoticesContext.Provider value={value}>{children}</NoticesContext.Provider>;
}
export function useNotices(): NoticesContextValue {
  const value = useContext(NoticesContext); if (!value) throw new Error('useNotices must be used within NoticesProvider'); return value;
}
