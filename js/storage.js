/**
 * Persist grows in IndexedDB, with localStorage fallback.
 * All data stays on the device.
 */

const DB_NAME = "grow-app";
const DB_VERSION = 1;
const STORE = "kv";
const STATE_KEY = "state";
const LS_KEY = "grow-app-v1";

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("no indexedDB"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("idb open failed"));
  });
}

function idbGet() {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(STATE_KEY);
        req.onsuccess = () => {
          db.close();
          resolve(req.result || null);
        };
        req.onerror = () => {
          db.close();
          reject(req.error);
        };
      }),
  );
}

function idbSet(state) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(state, STATE_KEY);
        tx.oncomplete = () => {
          db.close();
          resolve(true);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

function lsGet() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function lsSet(state) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function emptyState() {
  return { version: 1, activeId: null, grows: [] };
}

export async function loadState() {
  try {
    const fromIdb = await idbGet();
    if (fromIdb && Array.isArray(fromIdb.grows)) return fromIdb;
  } catch {
    /* fallback */
  }
  const fromLs = lsGet();
  if (fromLs && Array.isArray(fromLs.grows)) return fromLs;
  return emptyState();
}

export async function saveState(state) {
  const payload = {
    version: 1,
    activeId: state.activeId || null,
    grows: state.grows || [],
  };
  let ok = false;
  try {
    await idbSet(payload);
    ok = true;
  } catch {
    ok = false;
  }
  const lsOk = lsSet(payload);
  return ok || lsOk;
}

export function activeGrow(state) {
  if (!state || !state.grows || !state.grows.length) return null;
  return state.grows.find((g) => g.id === state.activeId) || state.grows[0] || null;
}

export function upsertGrow(state, grow) {
  const grows = (state.grows || []).slice();
  const i = grows.findIndex((g) => g.id === grow.id);
  const next = { ...grow, updatedAt: new Date().toISOString() };
  if (i >= 0) grows[i] = next;
  else grows.push(next);
  return { ...state, grows, activeId: next.id };
}

export function deleteGrow(state, id) {
  const grows = (state.grows || []).filter((g) => g.id !== id);
  let activeId = state.activeId;
  if (activeId === id) activeId = grows[0] ? grows[0].id : null;
  return { ...state, grows, activeId };
}
