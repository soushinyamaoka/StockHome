import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import * as Notifications from 'expo-notifications';
import { fetchMe, loginRequest, registerRequest, type AuthUser } from '../api/auth';
import { getStoredToken, setStoredToken, setUnauthorizedHandler } from '../api/client';
import { navigateToStockItem, registerForPushNotifications } from '../lib/push';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    name: string;
    householdName?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const token = await getStoredToken();
        if (!token) {
          setUser(null);
          return;
        }
        const me = await fetchMe();
        setUser(me.user);
      } catch {
        await setStoredToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    return () => setUnauthorizedHandler(null);
  }, []);

  // ログイン済みになったらプッシュ通知の許可とトークン登録を試みる。
  // 失敗（未許可・Expo Go・projectId未設定）はアプリの動作に影響させない
  useEffect(() => {
    if (!user) return;
    registerForPushNotifications().catch(() => {});
  }, [user?.id]);

  const lastNotificationResponse = Notifications.useLastNotificationResponse();

  useEffect(() => {
    if (!user || !lastNotificationResponse) return;
    const itemId = lastNotificationResponse.notification.request.content.data
      ?.itemId as string | undefined;
    navigateToStockItem(itemId);
    Notifications.clearLastNotificationResponse();
  }, [user?.id, lastNotificationResponse]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await loginRequest(email, password);
    await setStoredToken(res.token);
    setUser(res.user);
  }, []);

  const register = useCallback(
    async (input: { email: string; password: string; name: string; householdName?: string }) => {
      const res = await registerRequest(input);
      await setStoredToken(res.token);
      setUser(res.user);
    },
    []
  );

  const logout = useCallback(async () => {
    await setStoredToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
