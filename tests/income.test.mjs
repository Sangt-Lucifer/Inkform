import test from "node:test";
import assert from "node:assert/strict";
import {
  createIncomeStore,
  validateIncomeBackup,
  selectIncome,
  summarizeIncome,
  incomeCsv,
  INCOME_KEY,
} from "../src/income.js";
const row = (change = {}) => ({
  id: "consent-1",
  date: "2026-11-06",
  artist: "Alex",
  customer: "Testkunde",
  totalCents: 45050,
  depositCents: 10000,
  source: "test.pdf",
  updatedAt: "2026-11-06T12:00:00.000Z",
  ...change,
});
const memory = () => {
  let value = null;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
  };
};
test("totals count full prices once, never add deposits", () => {
  assert.deepEqual(
    summarizeIncome([row(), row({ id: "two", totalCents: 10000, depositCents: 10000 })]),
    { totalCents: 55050, open: 0, count: 2 },
  );
});
test("missing prices remain entries and explicit zero is a known price", () => {
  assert.deepEqual(
    summarizeIncome([
      row({ totalCents: null, depositCents: null }),
      row({ id: "zero", totalCents: 0, depositCents: 0 }),
    ]),
    { totalCents: 0, open: 1, count: 2 },
  );
});
test("filters combine artist, year and month using the tattoo date", () => {
  const rows = [
    row(),
    row({ id: "two", date: "2026-10-01" }),
    row({ id: "three", artist: "Robin" }),
    row({ id: "four", date: "2025-11-06" }),
  ];
  assert.equal(selectIncome(rows, { artist: " alex ", year: "2026", month: "11" }).length, 1);
  assert.equal(selectIncome(rows, { artist: "ALEX", year: "2026" }).length, 2);
  assert.equal(selectIncome(rows, { artist: "Alex" }).length, 3);
});
test("unassigned artist has a working filter", () =>
  assert.equal(
    selectIncome([row(), row({ id: "two", artist: "" })], { unassigned: true }).length,
    1,
  ));
test("confirmation is idempotent and survives a new store instance", () => {
  const storage = memory(),
    store = createIncomeStore(storage);
  store.add(row());
  store.add(row());
  assert.equal(createIncomeStore(storage).list().length, 1);
});
test("price can be completed later without modifying the PDF reference", () => {
  const store = createIncomeStore(memory());
  const before = row({ totalCents: null, depositCents: null });
  store.add(before);
  store.update(
    { ...before, totalCents: 30000, updatedAt: "2026-11-06T13:00:00Z" },
    before.updatedAt,
  );
  assert.equal(store.list()[0].source, "test.pdf");
  assert.equal(summarizeIncome(store.list()).totalCents, 30000);
});
test("stale edits fail without losing another saved edit", () => {
  const store = createIncomeStore(memory());
  store.add(row());
  store.update(row({ totalCents: 50000, updatedAt: "2026-11-06T14:00:00Z" }), row().updatedAt);
  assert.throws(() => store.update(row({ totalCents: 70000 }), row().updatedAt));
  assert.equal(store.list()[0].totalCents, 50000);
});
test("local deletion requires the current version", () => {
  const store = createIncomeStore(memory());
  store.add(row());
  assert.throws(() => store.remove("consent-1", "old"));
  assert.equal(store.list().length, 1);
  store.remove("consent-1", row().updatedAt);
  assert.equal(store.list().length, 0);
});
test("full or unavailable browser storage reports failure", () => {
  const store = createIncomeStore({
    getItem: () => null,
    setItem: () => {
      throw Error("QuotaExceeded");
    },
  });
  assert.throws(() => store.add(row()), /QuotaExceeded/);
});
test("corrupted storage is not overwritten", () => {
  let written = false;
  const store = createIncomeStore({
    getItem: () => "{invalid",
    setItem: () => {
      written = true;
    },
  });
  assert.throws(() => store.add(row()));
  assert.equal(written, false);
});
test("backup restores and repeated import does not duplicate turnover", () => {
  const a = createIncomeStore(memory()),
    b = createIncomeStore(memory());
  a.add(row());
  const backup = { schemaVersion: 1, records: a.list() };
  b.merge(backup);
  b.merge(backup);
  assert.equal(b.list().length, 1);
});
test("conflicting backup fails as a whole and preserves existing rows", () => {
  const store = createIncomeStore(memory());
  store.add(row());
  assert.throws(() =>
    store.merge({ schemaVersion: 1, records: [row({ id: "new" }), row({ totalCents: 80000 })] }),
  );
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].totalCents, 45050);
});
test("negative, fractional and excess-deposit amounts are rejected", () => {
  for (const r of [
    row({ totalCents: -1 }),
    row({ totalCents: 100.5 }),
    row({ totalCents: 10, depositCents: 11 }),
  ])
    assert.throws(() => validateIncomeBackup({ schemaVersion: 1, records: [r] }));
});
test("invalid calendar dates and duplicate IDs are rejected", () => {
  assert.throws(() =>
    validateIncomeBackup({ schemaVersion: 1, records: [row({ date: "2026-02-30" })] }),
  );
  assert.throws(() => validateIncomeBackup({ schemaVersion: 1, records: [row(), row()] }));
});
test("health answers or signatures cannot enter the financial backup", () => {
  assert.throws(() =>
    validateIncomeBackup({ schemaVersion: 1, records: [{ ...row(), health: "secret" }] }),
  );
  assert.throws(() =>
    validateIncomeBackup({ schemaVersion: 1, records: [{ ...row(), signature: "secret" }] }),
  );
});
test("CSV escapes spreadsheet formulas, delimiters and embedded quotes", () => {
  const csv = incomeCsv([row({ customer: ' =HYPERLINK("x");', artist: "@SUM(1)" })]);
  assert.ok(csv.includes('"\' =HYPERLINK(""x"");"'));
  assert.ok(csv.includes('"\'@SUM(1)"'));
  assert.ok(csv.startsWith("\uFEFF"));
});
test("CSV keeps missing price blank and explicit zero numeric", () => {
  const csv = incomeCsv([
    row({ totalCents: null, depositCents: null }),
    row({ id: "zero", totalCents: 0, depositCents: 0 }),
  ]);
  assert.ok(csv.includes('"";"";"Preis offen"'));
  assert.ok(csv.includes('"0,00";"0,00";"Preis erfasst"'));
});

test("same ID with changed content reports a conflict", () => {
  const store = createIncomeStore(memory());
  store.add(row());
  assert.throws(() => store.add(row({ totalCents: 80000 })), /abweichender/);
  assert.equal(store.list()[0].totalCents, 45050);
});
test("literal artist names cannot collide with unassigned filter", () => {
  const rows = [row({ artist: "__unassigned__" }), row({ id: "empty", artist: "" })];
  assert.equal(selectIncome(rows, { artist: "__unassigned__" })[0].id, "consent-1");
  assert.equal(selectIncome(rows, { unassigned: true })[0].id, "empty");
});

// ---------- "PDF fehlt" and single booking (Phase 3) ----------
import { incomeCsv as csvPhase3, validateIncomeRecord as validatePhase3, createIncomeStore as storePhase3 } from "../src/income.js";
test("pdfMissing is optional, boolean only, and stored only when true", () => {
  const base = { id: "p1", date: "2026-11-10", artist: "Alex", customer: "Ayşe Yıldız", totalCents: 1000, depositCents: null, source: "", updatedAt: "2026-11-10T10:00:00.000Z" };
  assert.equal("pdfMissing" in validatePhase3(base), false);
  assert.equal("pdfMissing" in validatePhase3({ ...base, pdfMissing: false }), false);
  assert.equal(validatePhase3({ ...base, pdfMissing: true }).pdfMissing, true);
  assert.throws(() => validatePhase3({ ...base, pdfMissing: "ja" }));
  const csv = csvPhase3([validatePhase3({ ...base, pdfMissing: true })]);
  assert.match(csv, /Preis erfasst · PDF fehlt/);
  assert.match(csv, /Ayşe Yıldız/);
});
test("old backups without pdfMissing still import unchanged", () => {
  const map = new Map(),
    storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
  const store = storePhase3(storage);
  const row = { id: "old", date: "2026-01-02", artist: "", customer: "Alt", totalCents: null, depositCents: null, source: "", updatedAt: "2026-01-02T00:00:00.000Z" };
  store.merge({ schemaVersion: 1, records: [row] });
  assert.deepEqual(store.list(), [row]);
});
