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
  // PDF writes still running, per consent: cleanup waits for them, so a late write can never
  // leave a PDF behind (and never touches another consent's PDF).
  const writing = new Map();
  return {
    read,
    // Metadata is written synchronously before the first await, so the prepared income entry is
    // stored at once; a failure throws. Resolves true once the PDF is stored, false if it is not.
    save({ id, filename, pages, income, blob }) {
      const existing = read();
      if (existing && existing.id !== id)
        throw Error("Es gibt noch eine offene Einwilligung. Bitte zuerst deren Ablage bestätigen.");
      const meta = { version: 1, id, filename, pages, income, savedAt: new Date().toISOString() };
      storage.setItem(PENDING_KEY, JSON.stringify(meta));
      const write = Promise.resolve()
        .then(() => (files ? files.put(id, blob) : Promise.reject(Error("kein Dateispeicher"))))
        .then(
          () => true,
          () => false,
        );
      writing.set(id, write);
      write.finally(() => writing.get(id) === write && writing.delete(id));
      return write;
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
    // Metadata of this consent is removed synchronously (the next consent can start at once);
    // then only this consent's PDF is deleted, after a write still in progress has finished.
    // Rejects if the PDF could not be deleted; sweep() at the next start removes it then.
    async clear(id) {
      if (read()?.id === id) storage.removeItem(PENDING_KEY);
      await writing.get(id);
      if (files) await files.delete(id);
    },
    // Remove PDFs without metadata (interrupted or failed cleanup). Runs at every app start.
    // The current metadata is re-read right before each deletion: metadata is always written
    // before its PDF (also by another window), so a consent saved meanwhile is never deleted.
    async sweep() {
      if (!files) return 0;
      let removed = 0;
      for (const key of await files.keys()) {
        if (key === read()?.id || writing.has(key)) continue;
        await files.delete(key);
        removed++;
      }
      return removed;
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
    // Byte size per key, read one entry at a time.
    sizes: async () => {
      const db = await open(),
        sizes = new Map();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("files", "readonly"),
          request = tx.objectStore("files").openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          sizes.set(cursor.key, cursor.value?.data?.byteLength ?? 0);
          cursor.continue();
        };
        tx.oncomplete = () => resolve(sizes);
        tx.onerror = tx.onabort = () => reject(tx.error || request.error);
      });
    },
  };
}
