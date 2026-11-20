/**
 * 创作库本地 IndexedDB 缓存模块
 * 库名：mls-creation-library
 * 表结构：
 *   templates: keyPath 'id'
 *   meta: keyPath 'userId' -> { userId, row_cursor, tomb_cursor }
 */

const DB_NAME = 'mls-creation-library';
// v2：新增 sections store（分区名/顺序），模板行里的 section_id/pin_order 仍随增量同步
const DB_VERSION = 2;

let dbInstance = null;

function isIdbSupported() {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function openDb() {
  if (!isIdbSupported()) return Promise.resolve(null);
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('templates')) {
          db.createObjectStore('templates', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'userId' });
        }
        if (!db.objectStoreNames.contains('sections')) {
          db.createObjectStore('sections', { keyPath: 'id' });
        }
      };
      request.onsuccess = (e) => {
        dbInstance = e.target.result;
        resolve(dbInstance);
      };
      request.onerror = () => {
        resolve(null);
      };
    } catch (e) {
      resolve(null);
    }
  });
}

function stripTokenFromUrl(url) {
  if (!url || typeof url !== 'string') return url;
  try {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const u = new URL(url);
      u.searchParams.delete('token');
      return u.toString();
    }
    const idx = url.indexOf('?');
    if (idx === -1) return url;
    const base = url.slice(0, idx);
    const search = url.slice(idx + 1);
    const sp = new URLSearchParams(search);
    sp.delete('token');
    const rest = sp.toString();
    return rest ? `${base}?${rest}` : base;
  } catch (e) {
    return url;
  }
}

function sanitizeTemplateForCache(tpl) {
  if (!tpl || typeof tpl !== 'object') return tpl;
  const clone = { ...tpl };
  if (Array.isArray(clone.origin_images)) {
    clone.origin_images = clone.origin_images.map(img => {
      if (typeof img === 'string') return stripTokenFromUrl(img);
      if (img && typeof img === 'object') {
        return {
          ...img,
          url: stripTokenFromUrl(img.url),
          thumb_url: stripTokenFromUrl(img.thumb_url)
        };
      }
      return img;
    });
  }
  if (Array.isArray(clone.result_images)) {
    clone.result_images = clone.result_images.map(img => {
      if (typeof img === 'string') return stripTokenFromUrl(img);
      if (img && typeof img === 'object') {
        return {
          ...img,
          url: stripTokenFromUrl(img.url),
          thumb_url: stripTokenFromUrl(img.thumb_url)
        };
      }
      return img;
    });
  }
  return clone;
}

export async function getTemplatesCache(userId = 'default') {
  const db = await openDb();
  if (!db) return { templates: [], row_cursor: null, tomb_cursor: null };

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(['templates', 'meta'], 'readonly');
      const templatesStore = tx.objectStore('templates');
      const metaStore = tx.objectStore('meta');

      const getAllReq = templatesStore.getAll();
      const getMetaReq = metaStore.get(String(userId));

      let templates = [];
      let meta = null;

      getAllReq.onsuccess = () => {
        templates = getAllReq.result || [];
      };
      getMetaReq.onsuccess = () => {
        meta = getMetaReq.result || null;
      };

      tx.oncomplete = () => {
        const uid = String(userId);
        const mine = (templates || []).filter((item) => !item?.userId || String(item.userId) === uid);
        resolve({
          templates: mine,
          row_cursor: meta ? meta.row_cursor : null,
          tomb_cursor: meta ? meta.tomb_cursor : null
        });
      };
      tx.onerror = () => {
        resolve({ templates: [], row_cursor: null, tomb_cursor: null });
      };
    } catch (e) {
      resolve({ templates: [], row_cursor: null, tomb_cursor: null });
    }
  });
}

export async function replaceTemplatesCache(items, meta, userId = 'default') {
  const db = await openDb();
  if (!db) return;
  const uid = String(userId);
  const existing = await new Promise((resolve) => {
    try {
      const tx = db.transaction(['templates'], 'readonly');
      const req = tx.objectStore('templates').getAll();
      req.onsuccess = () => resolve(req.result || []);
      tx.onerror = () => resolve([]);
    } catch (e) {
      resolve([]);
    }
  });

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(['templates', 'meta'], 'readwrite');
      const tStore = tx.objectStore('templates');
      const mStore = tx.objectStore('meta');

      for (const item of existing) {
        if (!item?.userId || String(item.userId) === uid) tStore.delete(item.id);
      }
      for (const item of (items || [])) {
        const row = sanitizeTemplateForCache(item);
        if (row && typeof row === 'object') row.userId = uid;
        tStore.put(row);
      }

      if (meta) {
        mStore.put({
          userId: String(userId),
          row_cursor: meta.row_cursor || null,
          tomb_cursor: meta.tomb_cursor || null
        });
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch (e) {
      resolve();
    }
  });
}

export async function mergeTemplatesCache(upsertItems = [], deletedIds = [], nextMeta = null, userId = 'default') {
  const db = await openDb();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(['templates', 'meta'], 'readwrite');
      const tStore = tx.objectStore('templates');
      const mStore = tx.objectStore('meta');

      for (const id of deletedIds) {
        tStore.delete(id);
      }
      for (const item of upsertItems) {
        const row = sanitizeTemplateForCache(item);
        if (row && typeof row === 'object') row.userId = String(userId);
        tStore.put(row);
      }
      if (nextMeta) {
        mStore.put({
          userId: String(userId),
          row_cursor: nextMeta.row_cursor || null,
          tomb_cursor: nextMeta.tomb_cursor || null
        });
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch (e) {
      resolve();
    }
  });
}

export async function getSectionsCache() {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(['sections'], 'readonly');
      const req = tx.objectStore('sections').getAll();
      req.onsuccess = () => resolve(req.result || []);
      tx.onerror = () => resolve([]);
    } catch (e) {
      resolve([]);
    }
  });
}

export async function replaceSectionsCache(items = []) {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(['sections'], 'readwrite');
      const store = tx.objectStore('sections');
      store.clear();
      for (const item of (items || [])) {
        if (item && item.id) store.put(item);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch (e) {
      resolve();
    }
  });
}

export async function clearTemplatesCache(userId) {
  const db = await openDb();
  if (!db) return;
  if (!userId) {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(['templates', 'meta', 'sections'], 'readwrite');
        tx.objectStore('templates').clear();
        tx.objectStore('meta').clear();
        tx.objectStore('sections').clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch (e) {
        resolve();
      }
    });
  }
  const uid = String(userId);
  const existing = await new Promise((resolve) => {
    try {
      const tx = db.transaction(['templates'], 'readonly');
      const req = tx.objectStore('templates').getAll();
      req.onsuccess = () => resolve(req.result || []);
      tx.onerror = () => resolve([]);
    } catch (e) {
      resolve([]);
    }
  });
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(['templates', 'meta'], 'readwrite');
      const tStore = tx.objectStore('templates');
      for (const item of existing) {
        if (!item?.userId || String(item.userId) === uid) tStore.delete(item.id);
      }
      tx.objectStore('meta').delete(uid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch (e) {
      resolve();
    }
  });
}
