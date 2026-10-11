'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authApi, setAccessToken, setRefreshToken } from '@/lib/api-client';
import type { User, AuthResponse } from '@/types';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** Returns { mfaToken } when the account has 2FA — the caller must then call completeMfa. */
  login: (email: string, password: string) => Promise<{ mfaToken?: string }>;
  completeMfa: (mfaToken: string, code: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  const bootstrap = useCallback(async (attempt = 0): Promise<void> => {
    try {
      // Validate the session using the access token already in localStorage (set by
      // email login or the Google callback). If it's expired, the api-client's 401
      // interceptor transparently refreshes it via the stored refresh token. This is
      // far more robust than eagerly rotating the refresh token on every page load.
      const user = await authApi.me();
      setUser(user);
      setIsLoading(false);
    } catch (err: any) {
      // Only a refused session ends it. A rate limit (429), a server hiccup or a dropped
      // connection says nothing about the session — logging the owner out for one made a
      // busy minute (several open tabs refreshing live) look like an expired login.
      const status = err?.response?.status;
      const passing = status === undefined || status === 429 || status >= 500;
      if (passing && attempt < 4) {
        setTimeout(() => { void bootstrap(attempt + 1); }, 1500 * (attempt + 1));
        return;
      }
      setAccessToken(null);
      setRefreshToken(null);
      setUser(null);
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  const applySession = (data: AuthResponse) => {
    setAccessToken(data.access_token);
    if (data.refresh_token) setRefreshToken(data.refresh_token);
    setUser(data.user);
    router.push('/dashboard');
  };

  const login = async (email: string, password: string): Promise<{ mfaToken?: string }> => {
    const res = await authApi.login(email, password);
    // 2FA-enabled accounts get a challenge instead of a session.
    if (res.mfa_required && res.mfa_token) return { mfaToken: res.mfa_token };
    applySession(res as AuthResponse);
    return {};
  };

  const completeMfa = async (mfaToken: string, code: string) => {
    const res = await authApi.loginMfa(mfaToken, code);
    applySession(res);
  };

  const register = async (email: string, password: string) => {
    const { access_token, refresh_token, user } = await authApi.register(email, password);
    setAccessToken(access_token);
    if (refresh_token) setRefreshToken(refresh_token);
    setUser(user);
    router.push('/dashboard');
  };

  const logout = async () => {
    await authApi.logout().catch(() => {});
    setAccessToken(null);
    setRefreshToken(null);
    setUser(null);
    router.push('/login');
  };

  return (
    <AuthContext.Provider value={{
      user,
      isLoading,
      isAuthenticated: !!user,
      login,
      completeMfa,
      register,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
