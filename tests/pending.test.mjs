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
  // Without IndexedDB at all.
  const plain = createPendingStore({ storage: memory(), files: null });
  assert.equal(await plain.save(entry()), true);
  assert.equal((await plain.load()).blob, null);
});

test("a second consent cannot replace an unconfirmed one", async () => {
  const store = createPendingStore({ storage: memory(), files: fileStore() });
  await store.save(entry());
  await assert.rejects(store.save({ ...entry(), id: "other" }), /offene Einwilligung/);
  // Saving the same consent again (retry) is fine.
  assert.equal(await store.save(entry()), true);
});

test("clear removes metadata and PDF; sweep removes PDFs left without metadata", async () => {
  const storage = memory(),
    files = fileStore(),
    store = createPendingStore({ storage, files });
  await store.save(entry());
  await assert.rejects(store.clear("someone-else"));
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
  await assert.rejects(store.save(entry()), /beschädigt/);
  assert.notEqual(storage.getItem(PENDING_KEY), null);
});
