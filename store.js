// Cloud's CAD - small local database (IndexedDB) with a plain in-memory fallback. License: GPL v3
// Used for the profile library and the drawing history. Nothing leaves this computer.
const DB = 'cloudcad-data';
const STORES = ['library', 'history'];
let dbp = null;
const mem = { library: new Map(), history: new Map() };

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = () => { for (const s of STORES) if (!rq.result.objectStoreNames.contains(s)) rq.result.createObjectStore(s, { keyPath: 'id' }); };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => resolve(null);
      rq.onblocked = () => resolve(null);
    } catch (e) { resolve(null); }
  });
  return dbp;
}
const wrap = (rq) => new Promise((res, rej) => { rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });

export const store = {
  async put(name, obj) {
    if (!obj.id) obj.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const db = await open();
    if (!db) { mem[name].set(obj.id, obj); return obj; }
    await wrap(db.transaction(name, 'readwrite').objectStore(name).put(obj));
    return obj;
  },
  async get(name, id) {
    const db = await open();
    if (!db) return mem[name].get(id);
    return wrap(db.transaction(name).objectStore(name).get(id));
  },
  async all(name) {
    const db = await open();
    if (!db) return [...mem[name].values()];
    return wrap(db.transaction(name).objectStore(name).getAll());
  },
  async del(name, id) {
    const db = await open();
    if (!db) { mem[name].delete(id); return; }
    await wrap(db.transaction(name, 'readwrite').objectStore(name).delete(id));
  },
  async persistent() { return !!(await open()); },
};
