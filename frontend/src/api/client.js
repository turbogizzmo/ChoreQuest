const TOKEN_KEY = 'chorequest_access_token';

let accessToken = null;

// Restore token from localStorage on module load
try {
  accessToken = localStorage.getItem(TOKEN_KEY);
} catch { /* SSR / private browsing */ }

export function setAccessToken(token) {
  accessToken = token;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
}

export function getAccessToken() {
  return accessToken;
}

export function clearAccessToken() {
  accessToken = null;
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

async function refreshToken() {
  const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
  if (res.status === 401 || res.status === 403) {
    clearAccessToken();
    throw authError();
  }
  if (!res.ok) {
    // Server down / restarting: keep the current token, the session may be fine.
    const err = new Error('Token refresh failed');
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  setAccessToken(data.access_token);
  return data;
}

// Errors that mean the session is really gone carry status 401, so callers
// can tell them apart from network blips and server errors.
function authError(message = 'Session expired') {
  const err = new Error(message);
  err.status = 401;
  return err;
}

export async function ensureToken() {
  if (!refreshPromise) {
    refreshPromise = refreshToken().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

let refreshPromise = null;

const NO_REFRESH_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/pin-login',
  '/api/auth/register',
]);

export async function api(path, options = {}) {
  const { body, method = 'GET', headers = {}, raw = false } = options;

  const config = {
    method,
    credentials: 'include',
    headers: { ...headers },
  };

  if (accessToken) {
    config.headers['Authorization'] = `Bearer ${accessToken}`;
  }

  if (body && !(body instanceof FormData)) {
    config.headers['Content-Type'] = 'application/json';
    config.body = JSON.stringify(body);
  } else if (body instanceof FormData) {
    config.body = body;
  }

  let res = await fetch(path, config);

  // If 401, try refreshing token and retry once. A 401 from a credential
  // endpoint means wrong username/password/PIN, not an expired session, so
  // let its own error message through.
  if (res.status === 401 && !options._retried && !NO_REFRESH_PATHS.has(path)) {
    try {
      await ensureToken();
      config.headers['Authorization'] = `Bearer ${accessToken}`;
      // Re-assign body from original options so FormData is not consumed/stale
      if (body instanceof FormData) {
        config.body = body;
      }
      res = await fetch(path, { ...config, _retried: true });
    } catch {
      window.dispatchEvent(new CustomEvent('auth:expired'));
      throw authError();
    }
  }

  if (raw) return res;

  if (res.status === 204) return null;

  if (!res.ok) {
    const text = await res.text();
    let detail = 'Request failed';
    try {
      const data = JSON.parse(text);
      detail = data.detail || detail;
    } catch {
      // Response wasn't JSON (server error page, etc.)
    }
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }

  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Invalid response from server');
  }
}
