import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api, setAccessToken, clearAccessToken, getAccessToken, ensureToken } from '../api/client';

// /me returns a fresh object on every refresh; keep the old reference when
// nothing changed so context consumers (the whole app) don't re-render.
const sameUser = (a, b) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const refreshPromiseRef = useRef(null);

  const refreshSession = useCallback(async () => {
    // Deduplicate concurrent refresh calls (React StrictMode double-fires)
    if (refreshPromiseRef.current) return refreshPromiseRef.current;

    refreshPromiseRef.current = (async () => {
      try {
        // If we have a stored token (from localStorage), try using it
        // directly via /me.  The api() 401-retry will automatically
        // attempt a cookie-based refresh if the token has expired.
        if (getAccessToken()) {
          const userData = await api('/api/auth/me');
          setUser((prev) => (sameUser(prev, userData) ? prev : userData));
          return true;
        }

        // No stored token — try cookie-based refresh. Go through the shared
        // ensureToken() promise so this never races an api() 401 retry with
        // the same refresh cookie.
        const data = await ensureToken();
        setUser((prev) => (sameUser(prev, data.user) ? prev : data.user));
        return true;
      } catch (err) {
        // Only an auth failure ends the session. This runs on every WS
        // message, so a network blip or a 5xx during a container update
        // must not log the kid out.
        if (err?.status === 401) {
          clearAccessToken();
          setUser(null);
        }
        return false;
      } finally {
        refreshPromiseRef.current = null;
      }
    })();

    return refreshPromiseRef.current;
  }, []);

  useEffect(() => {
    refreshSession().finally(() => setLoading(false));

    const handleExpired = () => {
      clearAccessToken();
      setUser(null);
    };
    window.addEventListener('auth:expired', handleExpired);
    return () => window.removeEventListener('auth:expired', handleExpired);
  }, [refreshSession]);

  const login = useCallback(async (username, password) => {
    const data = await api('/api/auth/login', { method: 'POST', body: { username, password } });
    setAccessToken(data.access_token);
    setUser(data.user);
    return data.user;
  }, []);

  const pinLogin = useCallback(async (username, pin) => {
    const data = await api('/api/auth/pin-login', { method: 'POST', body: { username, pin } });
    setAccessToken(data.access_token);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (username, password, display_name, role, invite_code) => {
    const body = { username, password, display_name, role };
    if (invite_code) body.invite_code = invite_code;
    const data = await api('/api/auth/register', { method: 'POST', body });
    setAccessToken(data.access_token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch { /* ignore */ }
    clearAccessToken();
    setUser(null);
  }, []);

  const updateUser = useCallback((updates) => {
    setUser(prev => prev ? { ...prev, ...updates } : null);
  }, []);

  // Stable value: consumers only re-render when user/loading actually change
  const value = useMemo(
    () => ({ user, loading, login, pinLogin, register, logout, updateUser, refreshSession }),
    [user, loading, login, pinLogin, register, logout, updateUser, refreshSession],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
