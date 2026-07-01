import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { fetchMe, loginRequest, registerRequest, type AuthUser } from '../api/auth';
import { getStoredToken, setStoredToken } from '../api/client';

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
