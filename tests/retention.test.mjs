// Retention help: deadlines, deletion list, anonymization (src/retention.js) and the income fields.
import assert from "node:assert/strict";
import test from "node:test";
import {
  ANONYMIZED,
  RETENTION_KEY,
  anonymizeRecord,
  daysBetween,
  dueForAnonymization,
  dueForPdfDeletion,
  readRetention,
  validateRetention,
  writeRetention,
  yearsBefore,
} from "../src/retention.js";
import { createIncomeStore, validateIncomeBackup, validateIncomeRecord } from "../src/income.js";

const memory = () => {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)) };
};
const row = (id, date, extra = {}) => ({
  id,
  date,
  artist: "Alex",
  customer: `Kunde ${id}`,
  totalCents: 10000,
  depositCents: null,
  source: `Tattoo_Einwilligung_${id}.pdf`,
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});

test("deadlines: empty means none; whole years 1..50 only", () => {
  assert.deepEqual(validateRetention({}), { pdfYears: null, incomeYears: null });
  assert.deepEqual(validateRetention({ pdfYears: "10", incomeYears: "" }), { pdfYears: 10, incomeYears: null });
  for (const bad of [0, 51, 2.5, "zehn", -1]) assert.throws(() => validateRetention({ pdfYears: bad }));
  const storage = memory();
  assert.deepEqual(readRetention(storage), { pdfYears: null, incomeYears: null });
  writeRetention(storage, { pdfYears: 3, incomeYears: 10 });
  assert.deepEqual(readRetention(storage), { pdfYears: 3, incomeYears: 10 });
  storage.setItem(RETENTION_KEY, "{kaputt");
  assert.deepEqual(readRetention(storage), { pdfYears: null, incomeYears: null }, "corrupt -> no deadline, nothing listed");
});

test("years before a date, including 29 February", () => {
  assert.equal(yearsBefore("2026-11-11", 3), "2023-11-11");
  assert.equal(yearsBefore("2028-02-29", 1), "2027-02-28");
});

test("deletion list: only past the full deadline, not yet deleted, not 'PDF fehlt', oldest first", () => {
  const records = [
    row("b", "2023-11-10"),
    row("a", "2020-05-01"),
    row("edge", "2023-11-11"), // exactly 3 years: not yet due
    row("done", "2019-01-01", { pdfDeletedAt: "2025-01-01" }),
    row("missing", "2019-01-01", { pdfMissing: true }),
    row("anon", "2019-01-01", { anonymizedAt: "2025-01-01", customer: ANONYMIZED, source: "" }),
  ];
  assert.deepEqual(dueForPdfDeletion(records, 3, "2026-11-11").map((r) => r.id), ["a", "b"]);
  assert.deepEqual(dueForPdfDeletion(records, null, "2026-11-11"), [], "no deadline, nothing listed");
});

test("anonymization removes name and PDF reference, keeps date, artist and amounts", () => {
  const records = [row("old", "2010-01-01", { pdfMissing: true }), row("new", "2025-01-01")];
  const due = dueForAnonymization(records, 10, "2026-11-11");
  assert.deepEqual(due.map((r) => r.id), ["old"]);
  const anon = validateIncomeRecord(anonymizeRecord(due[0], "2026-11-11", "2026-11-11T10:00:00.000Z"));
  assert.equal(anon.customer, ANONYMIZED);
  assert.equal(anon.source, "");
  assert.equal(anon.anonymizedAt, "2026-11-11");
  assert.equal(anon.totalCents, 10000);
  assert.equal(anon.date, "2010-01-01");
  assert.equal("pdfMissing" in anon, false);
  assert.deepEqual(dueForAnonymization([anon], 10, "2030-01-01"), [], "not anonymized twice");
});

test("income fields pdfDeletedAt/anonymizedAt: optional dates, old backups unchanged", () => {
  assert.equal(validateIncomeRecord(row("x", "2020-01-01", { pdfDeletedAt: "2026-11-11" })).pdfDeletedAt, "2026-11-11");
  assert.throws(() => validateIncomeRecord(row("x", "2020-01-01", { pdfDeletedAt: "gestern" })));
  assert.equal("anonymizedAt" in validateIncomeRecord(row("x", "2020-01-01", { anonymizedAt: "" })), false);
  const old = validateIncomeBackup({ schemaVersion: 1, records: [row("x", "2020-01-01")] });
  assert.deepEqual(Object.keys(old[0]).sort(), ["artist", "customer", "date", "depositCents", "id", "source", "totalCents", "updatedAt"]);
});

test("updateMany changes several entries at once or none", () => {
  const store = createIncomeStore(memory());
  store.add(row("a", "2010-01-01"));
  store.add(row("b", "2011-01-01"));
  store.updateMany([anonymizeRecord(store.list()[0], "2026-11-11"), anonymizeRecord(store.list()[1], "2026-11-11")]);
  assert.ok(store.list().every((r) => r.customer === ANONYMIZED));
  assert.throws(() => store.updateMany([row("a", "2010-01-01"), row("gone", "2010-01-01")]));
  assert.ok(store.list().every((r) => r.customer === ANONYMIZED), "nothing changed on error");
});

test("days between two dates", () => {
  assert.equal(daysBetween("2026-11-01T12:00:00.000Z", new Date("2026-11-08T12:00:00.000Z")), 7);
});

// ---------- Review Phase 4 ----------
import { pdfMayExist, waitingForPdfDeletion } from "../src/retention.js";

test("an entry whose PDF may still exist is not anonymized, but listed as waiting", () => {
  const records = [
    row("pdf", "2010-01-01"), // PDF not yet marked as deleted
    row("deleted", "2010-01-01", { pdfDeletedAt: "2026-01-01" }),
    row("missing", "2010-01-01", { pdfMissing: true }),
    row("noref", "2010-01-01", { source: "" }),
  ];
  assert.deepEqual(dueForAnonymization(records, 10, "2026-11-11").map((r) => r.id), ["deleted", "missing", "noref"]);
  assert.deepEqual(waitingForPdfDeletion(records, 10, "2026-11-11").map((r) => r.id), ["pdf"]);
  assert.equal(pdfMayExist(records[0]), true);
  // Even with no PDF deadline at all, the PDF entry is never silently anonymized.
  assert.equal(dueForPdfDeletion(records, null, "2026-11-11").length, 0);
  assert.ok(!dueForAnonymization(records, 1, "2026-11-11").some((r) => r.id === "pdf"));
});

test("an anonymized entry cannot get a name or PDF reference back (edit, import)", () => {
  const anon = validateIncomeRecord(anonymizeRecord(row("a", "2010-01-01", { pdfDeletedAt: "2026-01-01" }), "2026-11-11"));
  assert.throws(() => validateIncomeRecord({ ...anon, customer: "Kunde a" }), /anonymisierter Eintrag/);
  assert.throws(() => validateIncomeRecord({ ...anon, source: "Tattoo_Einwilligung_a.pdf" }), /anonymisierter Eintrag/);
  const store = createIncomeStore(memory());
  store.add(row("a", "2010-01-01", { pdfDeletedAt: "2026-01-01" }));
  store.updateMany([anonymizeRecord(store.list()[0], "2026-11-11")]);
  const current = store.list()[0];
  assert.throws(() => store.update({ ...current, customer: "Kunde a" }, current.updatedAt));
  // Re-importing an old backup with the original name is refused as a whole.
  assert.throws(() => store.merge({ schemaVersion: 1, records: [row("a", "2010-01-01")] }), /abweichend/);
  assert.equal(store.list()[0].customer, ANONYMIZED);
});
