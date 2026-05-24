// IndexedDB-backed save system for Adventure Mode.
// Saves are keyed by userId so each family member has a separate slot.

const DB_NAME    = 'chorequest_adventure';
const DB_VERSION = 1;
const STORE      = 'saves';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'userId' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

export const defaultSave = (userId) => ({
  userId,
  level: 1,
  xp: 0,
  coins: 0,
  hp: 5,
  maxHp: 5,   // matches MAX_HEARTS (5) in HUD.js — each heart = 1 HP
  weapon: 'broom',
  unlockedWeapons: ['broom'],
  playerX: 640,
  playerY: 640,
  completedChoreIds: [],
  portalRestoreLevels: {},
  equippedHat: null,
  tutorialSeen: false,
  savedAt: Date.now(),
});

export async function loadSave(userId) {
  try {
    const db    = await openDB();
    const tx    = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    return await new Promise((resolve, reject) => {
      const req = store.get(userId);
      req.onsuccess = (e) => resolve(e.target.result || null);
      req.onerror   = (e) => reject(e.target.error);
    });
  } catch {
    return null;
  }
}

export async function writeSave(data) {
  try {
    const db    = await openDB();
    const tx    = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    data.savedAt = Date.now();
    await new Promise((resolve, reject) => {
      const req = store.put(data);
      req.onsuccess = resolve;
      req.onerror   = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.warn('[SaveSystem] write failed', err);
  }
}

export async function deleteSave(userId) {
  try {
    const db    = await openDB();
    const tx    = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    await new Promise((resolve, reject) => {
      const req = store.delete(userId);
      req.onsuccess = resolve;
      req.onerror   = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.warn('[SaveSystem] delete failed', err);
  }
}
