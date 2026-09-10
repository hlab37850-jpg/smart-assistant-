/* ============================================================
   Smart Assistant — Database Layer (IndexedDB)
   Real relational-style schema with indexes & constraints.
   No sales/purchases/invoices tables — balances only, by design.
   ============================================================ */

const DB_NAME = 'smart_assistant_db';
const DB_VERSION = 1;

const STORES = {
  customers: 'customers',
  items: 'items',
  categories: 'categories',
  units: 'units',
  settings: 'settings',
  activityLog: 'activityLog',
  backups: 'backups',
  importBatches: 'importBatches',
  reviewQueue: 'reviewQueue',
  users: 'users'
};

let _db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains(STORES.customers)) {
        const s = db.createObjectStore(STORES.customers, { keyPath: 'id' });
        s.createIndex('name', 'name', { unique: false });
        s.createIndex('phone', 'phone', { unique: false });
        s.createIndex('balance', 'balance', { unique: false });
        s.createIndex('dueDate', 'dueDate', { unique: false });
        s.createIndex('status', 'status', { unique: false });
        s.createIndex('externalId', 'externalId', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.items)) {
        const s = db.createObjectStore(STORES.items, { keyPath: 'id' });
        s.createIndex('name', 'name', { unique: false });
        s.createIndex('code', 'code', { unique: false });
        s.createIndex('category', 'categoryId', { unique: false });
        s.createIndex('status', 'status', { unique: false });
        s.createIndex('externalId', 'externalId', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.categories)) {
        db.createObjectStore(STORES.categories, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.units)) {
        db.createObjectStore(STORES.units, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.settings)) {
        db.createObjectStore(STORES.settings, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORES.activityLog)) {
        const s = db.createObjectStore(STORES.activityLog, { keyPath: 'id' });
        s.createIndex('timestamp', 'timestamp', { unique: false });
        s.createIndex('type', 'type', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.backups)) {
        const s = db.createObjectStore(STORES.backups, { keyPath: 'id' });
        s.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.importBatches)) {
        const s = db.createObjectStore(STORES.importBatches, { keyPath: 'id' });
        s.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.reviewQueue)) {
        db.createObjectStore(STORES.reviewQueue, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.users)) {
        const s = db.createObjectStore(STORES.users, { keyPath: 'id' });
        s.createIndex('username', 'username', { unique: true });
      }
    };

    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function tx(storeName, mode = 'readonly') {
  return _db.transaction(storeName, mode).objectStore(storeName);
}

const DB = {
  async init() { await openDB(); return this; },

  // ---- generic CRUD ----
  put(store, value) {
    return new Promise((resolve, reject) => {
      const r = tx(store, 'readwrite').put(value);
      r.onsuccess = () => resolve(value);
      r.onerror = (e) => reject(e.target.error);
    });
  },
  bulkPut(store, values) {
    return new Promise((resolve, reject) => {
      const t = _db.transaction(store, 'readwrite');
      const os = t.objectStore(store);
      values.forEach(v => os.put(v));
      t.oncomplete = () => resolve(values.length);
      t.onerror = (e) => reject(e.target.error);
    });
  },
  get(store, id) {
    return new Promise((resolve, reject) => {
      const r = tx(store).get(id);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = (e) => reject(e.target.error);
    });
  },
  getAll(store) {
    return new Promise((resolve, reject) => {
      const r = tx(store).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = (e) => reject(e.target.error);
    });
  },
  delete(store, id) {
    return new Promise((resolve, reject) => {
      const r = tx(store, 'readwrite').delete(id);
      r.onsuccess = () => resolve(true);
      r.onerror = (e) => reject(e.target.error);
    });
  },
  clear(store) {
    return new Promise((resolve, reject) => {
      const r = tx(store, 'readwrite').clear();
      r.onsuccess = () => resolve(true);
      r.onerror = (e) => reject(e.target.error);
    });
  },
  count(store) {
    return new Promise((resolve, reject) => {
      const r = tx(store).count();
      r.onsuccess = () => resolve(r.result);
      r.onerror = (e) => reject(e.target.error);
    });
  },

  // ---- domain helpers ----
  async findCustomerByMatch({ externalId, phone, name }) {
    const all = await this.getAll(STORES.customers);
    if (externalId) {
      const byExt = all.find(c => c.externalId && c.externalId === externalId);
      if (byExt) return { match: byExt, confidence: 1, reason: 'external_id' };
    }
    if (phone) {
      const norm = String(phone).replace(/\D/g, '');
      const byPhone = all.find(c => c.phone && String(c.phone).replace(/\D/g, '') === norm && norm.length >= 6);
      if (byPhone) return { match: byPhone, confidence: 0.95, reason: 'phone' };
    }
    if (name) {
      const exact = all.find(c => c.name && c.name.trim() === name.trim());
      if (exact) return { match: exact, confidence: 0.7, reason: 'exact_name' };
      // fuzzy: normalized whitespace/diacritics-insensitive compare
      const normalize = (s) => s.replace(/[\u064B-\u0652]/g, '').replace(/\s+/g, ' ').trim();
      const fuzzy = all.find(c => c.name && normalize(c.name) === normalize(name));
      if (fuzzy) return { match: fuzzy, confidence: 0.5, reason: 'fuzzy_name' };
    }
    return { match: null, confidence: 0, reason: 'none' };
  },

  async findItemByMatch({ externalId, code, name }) {
    const all = await this.getAll(STORES.items);
    if (externalId) {
      const byExt = all.find(i => i.externalId && i.externalId === externalId);
      if (byExt) return { match: byExt, confidence: 1, reason: 'external_id' };
    }
    if (code) {
      const byCode = all.find(i => i.code && String(i.code).trim() === String(code).trim());
      if (byCode) return { match: byCode, confidence: 0.9, reason: 'code' };
    }
    if (name) {
      const exact = all.find(i => i.name && i.name.trim() === name.trim());
      if (exact) return { match: exact, confidence: 0.7, reason: 'exact_name' };
    }
    return { match: null, confidence: 0, reason: 'none' };
  },

  async logActivity(type, details, userName) {
    const entry = {
      id: 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      type,
      details,
      user: userName || (await this.getSetting('currentUser'))?.name || 'مستخدم',
      timestamp: Date.now()
    };
    await this.put(STORES.activityLog, entry);
    return entry;
  },

  async getSetting(key) {
    const row = await this.get(STORES.settings, key);
    return row ? row.value : null;
  },
  async setSetting(key, value) {
    return this.put(STORES.settings, { key, value });
  },

  // ---- full DB export/import (backup/restore) ----
  async exportAll() {
    const data = {};
    for (const s of Object.values(STORES)) {
      data[s] = await this.getAll(s);
    }
    data.__meta = { exportedAt: Date.now(), version: DB_VERSION, app: 'smart-assistant' };
    return data;
  },
  async importAll(data, { wipe = true } = {}) {
    for (const s of Object.values(STORES)) {
      if (!data[s]) continue;
      if (wipe) await this.clear(s);
      if (data[s].length) await this.bulkPut(s, data[s]);
    }
    return true;
  },

  STORES
};

window.DB = DB;
