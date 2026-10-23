// Shared cache for the "update available" check (GET /api/admin/update/check).
//
// The check asks GitHub for the latest commit, so it's cached per tab to stay
// well under GitHub's unauthenticated rate limit. The cache is only trusted
// while the server is still running the same version it was computed for, and
// only for a short time — otherwise a tab that applied an update (the overlay
// reloads the same tab, and sessionStorage survives reloads) kept showing
// "update available" for the rest of the session.

import { api } from '../api/client';

const KEY = 'cq_update_check';
const LEGACY_KEYS = ['cq_update_checked', 'cq_update_available'];
const MAX_AGE_MS = 15 * 60 * 1000;
export const UPDATE_STATUS_EVENT = 'app:update-status';

function read() {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Cached result if it's fresh and was computed for `runningVersion`. */
export function getCachedUpdateCheck(runningVersion) {
  const cached = read();
  if (!cached) return null;
  if (Date.now() - cached.checkedAt > MAX_AGE_MS) return null;
  if (runningVersion && cached.current !== runningVersion) return null;
  return cached;
}

/** True if this tab has checked before (Settings uses it to auto-refresh). */
export function hasUpdateCheck() {
  return read() !== null;
}

/** Store a /check response and tell the header badge about it. */
export function saveUpdateCheck(data) {
  const entry = {
    current: data.current ?? null,
    available: !!data.update_available,
    checkedAt: Date.now(),
  };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(entry));
    LEGACY_KEYS.forEach((k) => sessionStorage.removeItem(k));
  } catch { /* storage unavailable — badge still updates via the event */ }
  window.dispatchEvent(new CustomEvent(UPDATE_STATUS_EVENT, { detail: entry }));
  return entry;
}

/** Forget the cached result (call when an update is applied). */
export function clearUpdateCheck() {
  try {
    sessionStorage.removeItem(KEY);
    LEGACY_KEYS.forEach((k) => sessionStorage.removeItem(k));
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(UPDATE_STATUS_EVENT, { detail: { available: false } }));
}

/**
 * Background check for the header badge: reuse the cache when it still
 * matches the running server version, otherwise ask the server again.
 */
export async function refreshUpdateCheck() {
  let runningVersion = null;
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    runningVersion = (await res.json())?.version ?? null;
  } catch { /* health unreachable — fall back to the age check only */ }

  const cached = getCachedUpdateCheck(runningVersion);
  if (cached) return cached;
  return saveUpdateCheck(await api('/api/admin/update/check'));
}
