// The unconfirmed consent survives a reload; the income entry is booked only once.
import assert from "node:assert/strict";
import test from "node:test";
import { PENDING_KEY, createPendingStore } from "../src/pending.js";

const memory = () => {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
};
const fileStore = () => {
  const map = new Map();
  return {
    map,
    put: async (k, v) => void map.set(k, v),
    get: async (k) => map.get(k) ?? null,
    delete: async (k) => void map.delete(k),
    clear: async () => map.clear(),
    keys: async () => [...map.keys()],
  };
};
const income = { id: "abc-1", date: "2026-11-10", artist: "Alex", customer: "Gül Şahin", totalCents: 30000, depositCents: null, source: "x.pdf", updatedAt: "2026-11-10T10:00:00.000Z" };
const entry = (blob = new Blob(["%PDF-1.3 test"], { type: "application/pdf" })) => ({ id: income.id, filename: "x.pdf", pages: 3, income, blob });

test("a saved consent is restored after a reload (new store instance) with its PDF", async () => {
  const storage = memory(),
    files = fileStore();
  assert.equal(await createPendingStore({ storage, files }).save(entry()), true);
  const restored = await createPendingStore({ storage, files }).load();
  assert.equal(restored.filename, "x.pdf");
  assert.equal(restored.pages, 3);
  assert.deepEqual(restored.income, income);
  assert.equal(await restored.blob.text(), "%PDF-1.3 test");
});

test("metadata holds no PDF and no health data; the PDF lives only in the file store", async () => {
  const storage = memory(),
    files = fileStore();
  await createPendingStore({ storage, files }).save(entry());
  const raw = storage.getItem(PENDING_KEY);
  assert.doesNotMatch(raw, /PDF-1\.3|signature|medical/);
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ["filename", "id", "income", "pages", "savedAt", "version"]);
  assert.equal(files.map.size, 1);
});

test("if the PDF cannot be stored or read back, the income entry is still kept (PDF fehlt)", async () => {
  const storage = memory();
  const broken = { put: async () => { throw Error("quota"); }, get: async () => { throw Error("gone"); } };
  const store = createPendingStore({ storage, files: broken });
  assert.equal(await store.save(entry()), false);
  const restored = await createPendingStore({ storage, files: broken }).load();
  assert.equal(restored.blob, null);
  assert.deepEqual(restored.income, income);
  // Without IndexedDB at all: metadata kept, PDF reported as not stored.
  const plain = createPendingStore({ storage: memory(), files: null });
  assert.equal(await plain.save(entry()), false);
  assert.deepEqual((await plain.load()).income, income);
  assert.equal((await plain.load()).blob, null);
});

test("a second consent cannot replace an unconfirmed one", async () => {
  const store = createPendingStore({ storage: memory(), files: fileStore() });
  await store.save(entry());
  assert.throws(() => store.save({ ...entry(), id: "other" }), /offene Einwilligung/);
  // Saving the same consent again (retry) is fine.
  assert.equal(await store.save(entry()), true);
});

test("clear removes metadata and PDF; sweep removes PDFs left without metadata", async () => {
  const storage = memory(),
    files = fileStore(),
    store = createPendingStore({ storage, files });
  await store.save(entry());
  await store.clear("someone-else");
  assert.notEqual(storage.getItem(PENDING_KEY), null, "another consent's metadata stays");
  await store.clear(income.id);
  assert.equal(storage.getItem(PENDING_KEY), null);
  assert.equal(files.map.size, 0);
  assert.equal(await store.load(), null);
  files.map.set("orphan", new Blob(["x"]));
  await store.save(entry());
  await store.sweep();
  assert.deepEqual([...files.map.keys()], [income.id]);
});

test("corrupt metadata fails loudly instead of silently dropping the consent", async () => {
  const storage = memory();
  storage.setItem(PENDING_KEY, JSON.stringify({ version: 1, id: "../x" }));
  const store = createPendingStore({ storage, files: fileStore() });
  assert.throws(() => store.read(), /beschädigt/);
  assert.throws(() => store.save(entry()), /beschädigt/);
  assert.notEqual(storage.getItem(PENDING_KEY), null);
});

// ---------- races between saving, confirming and cleanup ----------
const delayed = () => {
  const store = fileStore(),
    gates = [];
  const put = store.put;
  store.put = (k, v) => new Promise((resolve) => gates.push(() => resolve(put(k, v))));
  // put() starts one microtask after save(): wait a turn so every pending write is queued.
  store.release = async () => {
    await new Promise((r) => setImmediate(r));
    gates.splice(0).forEach((open) => open());
  };
  return store;
};

test("metadata is stored synchronously; a failing metadata write throws instead of being hidden", () => {
  const storage = memory(),
    store = createPendingStore({ storage, files: delayed() });
  store.save(entry());
  assert.notEqual(storage.getItem(PENDING_KEY), null, "metadata present before any await");
  const full = { ...memory(), setItem: () => { throw Error("QuotaExceededError"); } };
  assert.throws(() => createPendingStore({ storage: full, files: fileStore() }).save(entry()), /Quota/);
});

test("confirming while the PDF is still being written leaves no PDF behind", async () => {
  const storage = memory(),
    files = delayed(),
    store = createPendingStore({ storage, files });
  const kept = store.save(entry());
  const cleared = store.clear(income.id); // owner confirms before the write has finished
  assert.equal(storage.getItem(PENDING_KEY), null, "metadata removed at once");
  await files.release();
  assert.equal(await kept, true);
  await cleared;
  assert.equal(files.map.size, 0);
});

test("the next customer can start at once, and the previous cleanup never deletes their PDF", async () => {
  const storage = memory(),
    files = delayed(),
    store = createPendingStore({ storage, files });
  store.save(entry()); // customer A, write still pending
  const cleanupA = store.clear(income.id);
  const b = { ...entry(new Blob(["%PDF B"])), id: "abc-2", income: { ...income, id: "abc-2", customer: "B" } };
  const keptB = store.save(b); // must not be rejected because of A
  await files.release();
  await Promise.all([cleanupA, keptB]);
  assert.deepEqual([...files.map.keys()], ["abc-2"]);
  const restored = await createPendingStore({ storage, files }).load();
  assert.equal(restored.income.customer, "B");
  assert.equal(await restored.blob.text(), "%PDF B");
});

test("a PDF whose deletion failed is removed by the sweep at the next start", async () => {
  const storage = memory(),
    files = fileStore(),
    store = createPendingStore({ storage, files });
  await store.save(entry());
  const del = files.delete;
  files.delete = async () => { throw Error("transaction aborted"); };
  await assert.rejects(store.clear(income.id));
  assert.equal(storage.getItem(PENDING_KEY), null);
  assert.equal(files.map.size, 1, "orphaned health PDF");
  files.delete = del;
  // Next app start, no pending metadata at all:
  assert.equal(await createPendingStore({ storage, files }).sweep(), 1);
  assert.equal(files.map.size, 0);
});

test("sweep never deletes a consent saved while it is running", async () => {
  const storage = memory(),
    files = fileStore(),
    store = createPendingStore({ storage, files });
  files.map.set("orphan", new Blob(["x"]));
  const keys = files.keys;
  let open;
  files.keys = () => new Promise((r) => (open = () => r(keys())));
  const sweeping = store.sweep(); // started at app start, keys() delayed
  await store.save(entry()); // consent saved meanwhile (this or another window)
  open();
  await sweeping;
  assert.deepEqual([...files.map.keys()], [income.id]);
  // Same with a second store instance (another window) that has no in-memory write record.
  files.keys = keys;
  files.map.set("orphan2", new Blob(["y"]));
  await createPendingStore({ storage, files }).sweep();
  assert.deepEqual([...files.map.keys()], [income.id]);
});

test("a read error is reported apart from a missing PDF, and the PDF stays for a retry", async () => {
  const storage = memory(),
    files = fileStore();
  const store = createPendingStore({ storage, files });
  await store.save(entry());
  const get = files.get;
  files.get = async () => {
    throw Error("Lesetest");
  };
  const failed = await store.load();
  assert.equal(failed.blob, null);
  assert.equal(failed.readError.message, "Lesetest");
  files.get = get;
  const again = await store.load();
  assert.equal(again.readError, null);
  assert.equal(await again.blob.text(), "%PDF-1.3 test");
  files.map.clear();
  const gone = await store.load();
  assert.equal(gone.blob, null);
  assert.equal(gone.readError, null);
});
