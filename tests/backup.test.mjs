// Full backup (src/backup.js): complete round trip, strict checks before anything is restored.
import assert from "node:assert/strict";
import test from "node:test";
import { BACKUP_INTERVAL_KEY, applyRemovals, createFullBackup, fromBase64, readBackupDays, readFullBackup, toBase64 } from "../src/backup.js";

const row = (id, date, extra = {}) => ({
  id,
  date,
  artist: "Alex",
  customer: `Vorname${id} Nachname${id}`,
  totalCents: 10000,
  depositCents: null,
  source: "",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});
const pdf = (text) => new TextEncoder().encode(`%PDF-1.7 ${text}`);
const settings = { schemaVersion: 1, studio: { name: "Musterstudio" }, app: {} };
const validateSettings = (value) => {
  if (value?.schemaVersion !== 1) throw Error("Diese Datei ist keine unterstützte INKFORM-Konfiguration (Version 1).");
  return value;
};
const backup = (extra = {}) =>
  JSON.parse(
    JSON.stringify(
      createFullBackup({
        settings,
        theme: "light",
        retention: { pdfYears: 10, incomeYears: null },
        backupDays: 14,
        exports: [{ from: "2026-03-01", to: "2026-03-31", type: "all", at: "2026-04-02T10:00:00.000Z" }],
        records: [row("a", "2026-03-01"), row("b", "2026-03-02", { pdfMissing: true })],
        pdfs: [{ id: "a", bytes: pdf("Jürgen Müller") }],
        removed: new Set(),
        now: new Date("2026-04-03T08:00:00.000Z"),
        ...extra,
      }),
    ),
  );

test("base64 keeps every byte, also for large files", () => {
  const bytes = new Uint8Array(200_000).map((_, i) => (i * 7) % 256);
  assert.deepEqual(fromBase64(toBase64(bytes)), bytes);
  assert.equal(toBase64(new Uint8Array(0)), "");
});

test("round trip: everything needed to restore, PDFs byte for byte", () => {
  const data = readFullBackup(backup(), validateSettings);
  assert.equal(data.createdAt, "2026-04-03T08:00:00.000Z");
  assert.deepEqual(data.settings, settings);
  assert.equal(data.theme, "light");
  assert.deepEqual(data.retention, { pdfYears: 10, incomeYears: null });
  assert.equal(data.backupDays, 14);
  assert.equal(data.exports.length, 1);
  assert.deepEqual(data.records.map((r) => r.id), ["a", "b"]);
  assert.deepEqual(data.pdfs, [{ id: "a", bytes: pdf("Jürgen Müller") }]);
});

test("no PIN and no open consent in the file", () => {
  const text = JSON.stringify(backup());
  for (const key of ["pin", "salt", "hash", "pending"]) assert.ok(!text.toLowerCase().includes(`"${key}`), key);
});

test("wrong or damaged files are refused as a whole", () => {
  const refuse = (change, message) => {
    const value = backup();
    change(value);
    assert.throws(() => readFullBackup(value, validateSettings), message);
  };
  refuse((v) => (v.kind = "etwas-anderes"), /keine INKFORM-Gesamtsicherung/);
  refuse((v) => (v.schemaVersion = 2), /keine INKFORM-Gesamtsicherung/);
  refuse((v) => (v.createdAt = "gestern"), /Erstellungsdatum/);
  refuse((v) => (v.theme = "blau"), /Farbschema/);
  refuse((v) => (v.backupDays = 5), /Erinnerungsabstand/);
  refuse((v) => (v.settings = { schemaVersion: 9 }), /Konfiguration/);
  refuse((v) => (v.retention = { pdfYears: 0 }), /Fristen/);
  refuse((v) => (v.exports = [{ from: "2026-03-31", to: "2026-03-01", type: "all", at: "x" }]), /nicht nach/);
  refuse((v) => (v.income.records[0].health = "nein"), /Einnahmeneintrag/);
  refuse((v) => (v.pdfs = null), /PDF-Liste/);
  refuse((v) => (v.pdfs[0].id = "unbekannt"), /ohne passenden Einnahmeneintrag/);
  refuse((v) => v.pdfs.push({ ...v.pdfs[0] }), /ohne passenden Einnahmeneintrag/);
  refuse((v) => (v.pdfs[0].id = "b"), /ohne passenden Einnahmeneintrag/);
  refuse((v) => (v.pdfs[0].pdf = "kein base64!"), /beschädigtes PDF/);
  refuse((v) => (v.pdfs[0].pdf = toBase64(new TextEncoder().encode("GIF89a"))), /beschädigtes PDF/);
});

test("reminder interval: only the offered values, otherwise 7 days", () => {
  const storage = (value) => ({ getItem: (k) => (k === BACKUP_INTERVAL_KEY ? value : null) });
  assert.equal(readBackupDays(storage(null)), 7);
  assert.equal(readBackupDays(storage("14")), 14);
  assert.equal(readBackupDays(storage("5")), 7);
  assert.equal(readBackupDays(storage("abc")), 7);
});

test("deleted copies travel with the backup; a PDF for one of them is refused", () => {
  const value = backup({ removed: new Set(["x"]) });
  assert.deepEqual(readFullBackup(value, validateSettings).removed, ["x"]);
  const older = backup();
  delete older.pdfRemoved;
  assert.deepEqual(readFullBackup(older, validateSettings).removed, [], "backups without the list stay readable");
  assert.throws(() => readFullBackup(backup({ removed: new Set(["a"]) }), validateSettings), /ohne passenden Einnahmeneintrag/);
});

test("restore never brings back a copy this device deleted from the app", () => {
  const data = readFullBackup(backup(), validateSettings),
    device = [{ ...row("a", "2026-03-01"), pdfRemovedAt: "2026-04-10" }];
  const result = applyRemovals(data, new Set(["a"]), device, "2026-05-01");
  assert.deepEqual(result.pdfs, []);
  assert.equal(result.skipped, 1);
  assert.equal(result.records.find((r) => r.id === "a").pdfRemovedAt, "2026-04-10");
  assert.deepEqual([...result.removed], ["a"]);
  const unknownDate = applyRemovals(data, new Set(["a"]), [], "2026-05-01");
  assert.equal(unknownDate.records.find((r) => r.id === "a").pdfRemovedAt, "2026-05-01");
  const nothing = applyRemovals(data, new Set(), [], "2026-05-01");
  assert.deepEqual([nothing.pdfs.length, nothing.skipped, "pdfRemovedAt" in nothing.records[0]], [1, 0, false]);
});

test("restore: marks on either side block a copy, even when the id list does not name it", () => {
  const data = readFullBackup(backup(), validateSettings);
  const deviceMarked = applyRemovals(data, new Set(), [{ ...row("a", "2026-03-01"), pdfRemovedAt: "2026-04-10" }], "2026-05-01");
  assert.deepEqual([deviceMarked.pdfs.length, deviceMarked.skipped, [...deviceMarked.removed]], [0, 1, ["a"]]);
  const backupMarked = readFullBackup(
    backup({ records: [row("a", "2026-03-01", { pdfRemovedAt: "2026-04-01" }), row("b", "2026-03-02", { pdfMissing: true })], pdfs: [] }),
    validateSettings,
  );
  assert.deepEqual([...applyRemovals(backupMarked, new Set(), [], "2026-05-01").removed], ["a"]);
});

test("restore: a merged list that would be too long stops before anything is written", () => {
  const data = readFullBackup(backup(), validateSettings);
  data.removed = Array.from({ length: 60000 }, (_, i) => `b${i}`);
  assert.throws(() => applyRemovals(data, new Set(Array.from({ length: 60000 }, (_, i) => `d${i}`)), [], "2026-05-01"), /Ungültige Liste/);
});

test("restore: overlapping lists are counted after merging", () => {
  const data = readFullBackup(backup(), validateSettings),
    ids = Array.from({ length: 60000 }, (_, i) => `x${i}`);
  data.removed = ids;
  assert.equal(applyRemovals(data, new Set(ids), [], "2026-05-01").removed.size, 60000);
});
