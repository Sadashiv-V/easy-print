import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User } from '../lib/types';
import * as api from '../lib/api';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  theme: 'system' | 'light' | 'dark';
  setThemeMode: (mode: 'system' | 'light' | 'dark') => void;
  pendingRechargeCount: number;
  loginUser: (collegeId: string, pass: string) => Promise<User>;
  logoutUser: () => Promise<void>;
  reloadUser: () => Promise<void>;
  refreshPendingCount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(api.getStoredSession());
  const [loading, setLoading] = useState<boolean>(true);
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>(() => {
    return (localStorage.getItem('easyprint_theme') as any) || 'system';
  });
  const [pendingRechargeCount, setPendingRechargeCount] = useState<number>(0);

  // Apply theme to document
  useEffect(() => {
    localStorage.setItem('easyprint_theme', theme);
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }, [theme]);

  const refreshPendingCount = useCallback(async () => {
    try {
      if (user?.role === 'admin') {
        const res = await api.listRecharges('pending', 100, 0);
        setPendingRechargeCount(res.total);
      } else {
        setPendingRechargeCount(0);
      }
    } catch {
      // Ignore background badge error
    }
  }, [user]);

  const reloadUser = useCallback(async () => {
    try {
      const u = await api.me();
      setUser(u);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reloadUser();
    const onOut = () => setUser(null);
    window.addEventListener('easyprint:unauthorized', onOut);
    return () => window.removeEventListener('easyprint:unauthorized', onOut);
  }, [reloadUser]);

  useEffect(() => {
    if (user?.role === 'admin') {
      refreshPendingCount();
    }
  }, [user, refreshPendingCount]);

  const loginUser = async (collegeId: string, pass: string): Promise<User> => {
    const res = await api.login(collegeId, pass);
    setUser(res);
    return res;
  };

  const logoutUser = async (): Promise<void> => {
    await api.logout();
    setUser(null);
  };

  const setThemeMode = (mode: 'system' | 'light' | 'dark') => {
    setTheme(mode);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        theme,
        setThemeMode,
        pendingRechargeCount,
        loginUser,
        logoutUser,
        reloadUser,
        refreshPendingCount,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
