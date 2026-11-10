// The signed consent that the owner has not yet confirmed as filed. It survives a reload or an
// app restart on the "Vielen Dank" screen, so neither the PDF nor the income entry is lost.
//
//   metadata (file name, pages, prepared income entry; no health data) -> localStorage
//   PDF file (contains health data and signature)                      -> IndexedDB, this device only
//
// The income entry is booked only when the owner confirms the filing. Both parts are removed
// right after that. If the PDF can no longer be read, the owner can book the entry as "PDF fehlt".
export const PENDING_KEY = "inkform.pending.v1";

export function createPendingStore({ storage, files }) {
  function read() {
    const raw = storage.getItem(PENDING_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (
      value?.version !== 1 ||
      typeof value.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(value.id) ||
      typeof value.filename !== "string" ||
      !Number.isInteger(value.pages) ||
      !value.income ||
      typeof value.income !== "object"
    )
      throw Error("Die offene Einwilligung auf diesem Gerät ist beschädigt.");
    return value;
  }
  return {
    read,
    // Metadata is written synchronously first, so the income entry is never lost; the PDF follows.
    async save({ id, filename, pages, income, blob }) {
      const existing = read();
      if (existing && existing.id !== id)
        throw Error("Es gibt noch eine offene Einwilligung. Bitte zuerst deren Ablage bestätigen.");
      const meta = { version: 1, id, filename, pages, income, savedAt: new Date().toISOString() };
      storage.setItem(PENDING_KEY, JSON.stringify(meta));
      try {
        await files?.put(id, blob);
        return true;
      } catch (_) {
        return false;
      }
    },
    async load() {
      const meta = read();
      if (!meta) return null;
      let blob = null;
      try {
        blob = (await files?.get(meta.id)) ?? null;
      } catch (_) {}
      return { ...meta, blob };
    },
    async clear(id) {
      const meta = read();
      if (meta && meta.id !== id) throw Error("Die offene Einwilligung wurde inzwischen ersetzt.");
      storage.removeItem(PENDING_KEY);
      try {
        await files?.clear();
      } catch (_) {}
    },
    // Remove PDFs left behind without metadata (e.g. after an interrupted confirmation).
    async sweep() {
      const meta = read();
      try {
        for (const key of (await files?.keys()) ?? []) if (key !== meta?.id) await files.delete(key);
      } catch (_) {}
    },
  };
}

// Minimal IndexedDB file store. Without IndexedDB every call rejects and only metadata is kept.
export function createIndexedDbFiles(indexedDB = globalThis.indexedDB, name = "inkform-pending") {
  let opening = null;
  function open() {
    if (!indexedDB) return Promise.reject(Error("IndexedDB nicht verfügbar."));
    opening ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("files");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch((error) => {
      opening = null;
      throw error;
    });
    return opening;
  }
  async function run(mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("files", mode),
        request = action(tx.objectStore("files"));
      let result;
      request.onsuccess = () => (result = request.result);
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error || request.error);
    });
  }
  return {
    // Stored as ArrayBuffer: more robust across Safari versions than Blob values.
    // The buffer is read before the transaction starts (a transaction must not wait on it).
    put: async (key, blob) => {
      const data = await blob.arrayBuffer();
      return run("readwrite", (s) => s.put({ type: blob.type, data }, key));
    },
    get: async (key) => {
      const value = await run("readonly", (s) => s.get(key));
      return value?.data ? new Blob([value.data], { type: value.type }) : null;
    },
    delete: (key) => run("readwrite", (s) => s.delete(key)),
    clear: () => run("readwrite", (s) => s.clear()),
    keys: () => run("readonly", (s) => s.getAllKeys()),
  };
}
