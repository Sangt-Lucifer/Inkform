// Export by period (src/export.js): period limits, file names, filter and what must stay out.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { addRemovedIds, periodExported, readRemovedIds } from "../src/export.js";
import { createIncomeStore } from "../src/income.js";
import { dueForPdfDeletion } from "../src/retention.js";
import { consentFileName, createExportFeature, exportPeriod, unexportedMonths, validateExportLog, exportPlan, exportable, formatSize, previousMonth, uniqueNames } from "../src/export.js";
import { anonymizeRecord } from "../src/retention.js";

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
const ids = (plan) => plan.consents.map((c) => c.id);

test("month: first to last day, including leap years and December", () => {
  assert.deepEqual(exportPeriod({ kind: "month", month: "2026-03" }), { from: "2026-03-01", to: "2026-03-31", label: "2026-03" });
  assert.equal(exportPeriod({ kind: "month", month: "2026-04" }).to, "2026-04-30");
  assert.equal(exportPeriod({ kind: "month", month: "2026-02" }).to, "2026-02-28");
  assert.equal(exportPeriod({ kind: "month", month: "2028-02" }).to, "2028-02-29");
  assert.equal(exportPeriod({ kind: "month", month: "2100-02" }).to, "2100-02-28");
  assert.equal(exportPeriod({ kind: "month", month: "2026-12" }).to, "2026-12-31");
  for (const month of ["2026-13", "2026-00", "26-03", "", "2026-3"])
    assert.throws(() => exportPeriod({ kind: "month", month }), /Monat/);
});

test("year and free range, with ZIP labels", () => {
  assert.deepEqual(exportPeriod({ kind: "year", year: "2026" }), { from: "2026-01-01", to: "2026-12-31", label: "2026" });
  assert.equal(
    exportPeriod({ kind: "range", from: "2026-12-15", to: "2027-01-15" }).label,
    "2026-12-15_bis_2027-01-15",
  );
  assert.equal(exportPeriod({ kind: "range", from: "2026-05-05", to: "2026-05-05" }).from, "2026-05-05");
  assert.throws(() => exportPeriod({ kind: "range", from: "2026-05-06", to: "2026-05-05" }), /nicht nach/);
  assert.throws(() => exportPeriod({ kind: "range", from: "2026-02-30", to: "2026-03-01" }), /Von/);
  assert.throws(() => exportPeriod({ kind: "range", from: "2026-02-01", to: "2026-02-29" }), /Bis/);
  assert.throws(() => exportPeriod({ kind: "year", year: "26" }), /Jahr/);
  assert.throws(() => exportPeriod({ kind: "woche" }), /Unbekannt/);
});

test("previous month as default, also across the turn of the year", () => {
  assert.equal(previousMonth("2026-11-12"), "2026-10");
  assert.equal(previousMonth("2027-01-01"), "2026-12");
});

test("period limits: last day of a month in, first day of the next out; turn of the year", () => {
  const records = ["2026-02-28", "2026-03-01", "2026-03-31", "2026-04-01", "2026-12-31", "2027-01-01"].map((d, i) => row(String(i), d));
  const all = new Set(records.map((r) => r.id)),
    dates = (period) => exportPlan(records, all, exportPeriod(period), "all").consents.map((c) => c.path.slice(15, 25));
  assert.deepEqual(dates({ kind: "month", month: "2026-03" }), ["2026-03-01", "2026-03-31"]);
  assert.deepEqual(dates({ kind: "year", year: "2026" }), ["2026-02-28", "2026-03-01", "2026-03-31", "2026-04-01", "2026-12-31"]);
  assert.deepEqual(dates({ kind: "month", month: "2027-01" }), ["2027-01-01"]);
  assert.deepEqual(dates({ kind: "range", from: "2026-12-31", to: "2027-01-01" }), ["2026-12-31", "2027-01-01"]);
});

test("the device time zone never moves an entry into another period", () => {
  const module = new URL("../src/export.js", import.meta.url).href,
    script = `const {exportPeriod,exportPlan,previousMonth}=await import(${JSON.stringify(module)});
const r=(id,date)=>({id,date,customer:"A B",source:""});
const records=[r("a","2026-02-28"),r("b","2026-03-01"),r("c","2026-03-31"),r("d","2026-04-01")];
const plan=exportPlan(records,new Set(["a","b","c","d"]),exportPeriod({kind:"month",month:"2026-03"}),"all");
console.log(JSON.stringify([plan.consents.map(c=>c.id),exportPeriod({kind:"month",month:"2028-02"}).to,previousMonth("2027-01-01")]));`;
  for (const TZ of ["UTC", "Europe/Berlin", "Pacific/Kiritimati", "Pacific/Pago_Pago", "America/St_Johns"]) {
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, TZ },
      encoding: "utf8",
      cwd: fileURLToPath(new URL("..", import.meta.url)),
    });
    assert.deepEqual(JSON.parse(out), [["b", "c"], "2028-02-29", "2026-12"], TZ);
  }
});

test("filter: consents, income or both", () => {
  const records = [row("a", "2026-03-02"), row("b", "2026-03-03", { pdfMissing: true })],
    archived = new Set(["a"]),
    period = exportPeriod({ kind: "month", month: "2026-03" });
  const both = exportPlan(records, archived, period, "all");
  assert.deepEqual(ids(both), ["a"]);
  assert.equal(both.income.length, 2);
  assert.equal(both.withoutPdf, 1);
  const consents = exportPlan(records, archived, period, "consents");
  assert.deepEqual([ids(consents), consents.income.length], [["a"], 0]);
  const income = exportPlan(records, archived, period, "income");
  assert.deepEqual([ids(income), income.income.length, income.withoutPdf], [[], 2, 0]);
});

test("deleted, missing, anonymized, removed or never archived PDFs stay out of the export", () => {
  const anonymized = anonymizeRecord(row("anon", "2026-03-05", { pdfMissing: true }), "2036-01-01");
  assert.ok(!("pdfMissing" in anonymized), "anonymizing drops the flag");
  const records = [
    row("ok", "2026-03-01"),
    row("deleted", "2026-03-02", { pdfDeletedAt: "2036-01-01" }),
    row("missing", "2026-03-03", { pdfMissing: true }),
    row("old", "2026-03-04"),
    anonymized,
  ];
  const archived = new Set(["ok", "deleted", "missing", "anon", "removed"]);
  const plan = exportPlan(records, archived, exportPeriod({ kind: "month", month: "2026-03" }), "consents");
  assert.deepEqual(ids(plan), ["ok"]);
  assert.equal(plan.withoutPdf, 4);
  assert.deepEqual(records.filter(exportable).map((r) => r.id), ["ok", "old"]);
});

test("file names: JJJJ-MM-TT_Nachname_Vorname.pdf with umlauts, safe for file systems", () => {
  const generated = row("1", "2026-03-05", {
    customer: "Gül Şahin",
    source: "Tattoo_Einwilligung_Şahin_Gül_2026-03-05_143012_AB12.pdf",
  });
  assert.equal(consentFileName(generated), "2026-03-05_Şahin_Gül.pdf");
  const twoWords = row("2", "2026-03-05", {
    customer: "Anna von Berg",
    source: "Tattoo_Einwilligung_von_Berg_Anna_2026-03-05_143012_AB12.pdf",
  });
  assert.equal(consentFileName(twoWords), "2026-03-05_von_Berg_Anna.pdf");
  assert.equal(consentFileName(row("3", "2026-03-05", { customer: "Jürgen Müller", source: "eigene Datei.pdf" })), "2026-03-05_Müller_Jürgen.pdf");
  assert.equal(consentFileName(row("4", "2026-03-05", { customer: "A/B: C*D?", source: "" })), "2026-03-05_C_D__A_B_.pdf");
  assert.equal(consentFileName(row("5", "2026-03-05", { customer: "Jo\u0308rg Mu\u0308ller", source: "" })), "2026-03-05_Müller_Jörg.pdf");
  assert.equal(consentFileName(row("6", "2026-03-05", { customer: "😀", source: "" })), "2026-03-05__.pdf");
});

test("duplicate names become unique, also by case and Unicode normalization", () => {
  assert.deepEqual(uniqueNames(["a.pdf", "a.pdf", "A.pdf", "a_2.pdf", "Mu\u0308ller.pdf", "Müller.pdf"]), [
    "a.pdf",
    "a_2.pdf",
    "A_3.pdf",
    "a_2_2.pdf",
    "Mu\u0308ller.pdf",
    "Müller_2.pdf",
  ]);
  const records = [row("x", "2026-03-05", { customer: "Anna Muster" }), row("y", "2026-03-05", { customer: "Anna Muster" })];
  const plan = exportPlan(records, new Set(["x", "y"]), exportPeriod({ kind: "year", year: "2026" }), "all");
  assert.deepEqual(plan.consents.map((c) => c.path), [
    "Einwilligungen/2026-03-05_Muster_Anna.pdf",
    "Einwilligungen/2026-03-05_Muster_Anna_2.pdf",
  ]);
});

test("size for the preview", () => {
  assert.equal(formatSize(1), "1 KB");
  assert.equal(formatSize(300 * 1024), "300 KB");
  assert.equal(formatSize(14 * 1024 * 1024 + 200_000), "14,2 MB");
});

// The feature with a minimal page: only the elements it touches.
function feature({ records, archive, removed = new Set() }) {
  const listeners = [],
    elements = {
      "admin-app": { addEventListener: (type, fn) => type === "change" && listeners.push(fn) },
      "export-preview": { textContent: "", classList: { add() {}, remove() {}, toggle() {} } },
      "export-save": { disabled: true },
      "export-delete": { disabled: true, textContent: "" },
      "copies-usage": { textContent: "", classList: { toggle() {} } },
    };
  globalThis.document = {
    getElementById: (id) => elements[id] ?? null,
    querySelectorAll: () => [],
    createElement: () => ({ setAttribute() {}, addEventListener() {}, querySelectorAll: () => [] }),
    body: { append() {} },
  };
  const exporter = createExportFeature({
    archive,
    records,
    incomeReport: () => new Blob(["%PDF"]),
    isUnlocked: () => true,
    escape: (s) => s,
    notify() {},
    save: async () => "share",
    logExport() {},
    exportLog: () => [],
    removedIds: () => removed,
    removeCopies: async () => {},
    today: () => "2026-04-10",
  });
  const change = (id, value) => listeners.forEach((fn) => fn({ target: { id, value } }));
  const preview = async () => {
    for (let n = 0; n < 50 && /berechnet|^$/.test(elements["export-preview"].textContent); n++) await new Promise((r) => setTimeout(r, 5));
    return elements["export-preview"].textContent;
  };
  return { exporter, change, preview, elements };
}
const memoryArchive = (keys) => {
  const map = new Map(keys.map((k) => [k, new Blob(["%PDF"])]));
  return {
    map,
    keys: async () => [...map.keys()],
    get: async (k) => map.get(k) ?? null,
    put: async (k, v) => void map.set(k, v),
    delete: async (k) => void map.delete(k),
  };
};

test("sync never deletes a PDF kept by another window while it was running", async () => {
  let list = [row("old", "2026-03-01")];
  const archive = memoryArchive(["old", "gone"]),
    keys = archive.keys;
  archive.keys = async () => {
    const found = await keys();
    archive.map.set("new", new Blob(["%PDF"]));
    list = [...list, row("new", "2026-03-02")];
    return [...found, "new"];
  };
  const { exporter } = feature({ records: () => list, archive });
  await exporter.sync();
  assert.deepEqual([...archive.map.keys()].sort(), ["new", "old"]);
});

test("a PDF whose entry was removed or marked during the write is not kept", async () => {
  let list = [row("a", "2026-03-01"), row("b", "2026-03-02")];
  const archive = memoryArchive([]),
    put = archive.put;
  archive.put = async (k, v) => {
    await put(k, v);
    list = k === "a" ? list.filter((r) => r.id !== "a") : list.map((r) => ({ ...r, pdfDeletedAt: "2026-04-10" }));
  };
  const { exporter } = feature({ records: () => list, archive });
  await exporter.keep("a", new Blob(["%PDF"]));
  await exporter.keep("b", new Blob(["%PDF"]));
  assert.equal(archive.map.size, 0);
});

test("income only works without the PDF store", async () => {
  const archive = memoryArchive([]);
  archive.keys = () => Promise.reject(Error("IndexedDB nicht verfügbar."));
  const { change, preview } = feature({ records: () => [row("a", "2026-03-05")], archive });
  change("export-type", "income");
  assert.match(await preview(), /^1 PDF und 1 CSV, /);
  change("export-type", "all");
  assert.match(await preview(), /IndexedDB nicht verfügbar/);
});

test("months not yet exported: only completed months with PDFs on this device", () => {
  const records = [
    row("jan", "2026-01-10"),
    row("feb", "2026-02-10"),
    row("mar", "2026-03-31"),
    row("old", "2025-12-10"),
    row("gone", "2026-02-20", { pdfDeletedAt: "2026-03-01" }),
    row("now", "2026-04-02"),
  ];
  const archived = new Set(["jan", "feb", "mar", "gone", "now"]);
  assert.deepEqual(unexportedMonths(records, archived, [], "2026-04-10"), ["2026-01", "2026-02", "2026-03"]);
  const log = [
    { from: "2026-01-01", to: "2026-01-31", type: "income", at: "x" },
    { from: "2026-02-01", to: "2026-02-27", type: "all", at: "x" },
    { from: "2026-03-01", to: "2026-03-31", type: "consents", at: "x" },
  ];
  assert.deepEqual(unexportedMonths(records, archived, log, "2026-04-10"), ["2026-01", "2026-02"]);
  assert.deepEqual(unexportedMonths(records, archived, [{ from: "2025-12-01", to: "2026-12-31", type: "all", at: "x" }], "2026-04-10"), []);
  assert.deepEqual(unexportedMonths(records, archived, [], "2027-01-01").at(-1), "2026-04");
});

test("export log: checked entries only", () => {
  assert.deepEqual(validateExportLog([]), []);
  assert.throws(() => validateExportLog({}), /Protokoll/);
  assert.throws(() => validateExportLog([{ from: "2026-01-01", to: "2026-01-31", type: "alles", at: "x" }]), /Protokoll/);
  assert.throws(() => validateExportLog([{ from: "2026-02-30", to: "2026-03-01", type: "all", at: "x" }]), /Datum/);
});

const memoryStorage = () => {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)) };
};

test("copy deleted from the app: excluded from the export, named in the preview, separate from deleted", () => {
  const records = [row("a", "2026-03-01"), row("b", "2026-03-02", { pdfRemovedAt: "2026-04-01" }), row("c", "2026-03-03", { pdfDeletedAt: "2026-04-01" })];
  assert.deepEqual(records.filter(exportable).map((r) => r.id), ["a"]);
  const plan = exportPlan(records, new Set(["a", "b", "c"]), exportPeriod({ kind: "month", month: "2026-03" }), "all");
  assert.deepEqual([ids(plan), plan.withoutPdf, plan.removed], [["a"], 2, 1]);
  assert.equal(exportPlan(records, new Set(), exportPeriod({ kind: "month", month: "2026-03" }), "income").removed, 0);
  // Still in the Files app as far as the app knows: stays on the retention list.
  assert.deepEqual(dueForPdfDeletion(records, 1, "2027-06-01").map((r) => r.id), ["a", "b"]);
});

test("the list of deleted copies only grows and refuses damaged values", () => {
  const storage = memoryStorage();
  assert.deepEqual([...readRemovedIds(storage)], []);
  addRemovedIds(storage, ["a", "b"]);
  addRemovedIds(storage, ["b", "c"]);
  assert.deepEqual([...readRemovedIds(storage)], ["a", "b", "c"]);
  assert.throws(() => addRemovedIds(storage, ["../x"]), /Ungültige Liste/);
  storage.setItem("inkform.pdf-removed.v1", "{}");
  assert.throws(() => readRemovedIds(storage), /Ungültige Liste/);
});

test("the mark \u201ePDF nicht mehr in der App\u201c cannot be taken back, neither by editing nor by import", () => {
  const store = createIncomeStore(memoryStorage());
  store.add(row("a", "2026-03-01"));
  const marked = { ...row("a", "2026-03-01"), pdfRemovedAt: "2026-04-01", updatedAt: "2026-04-01T00:00:00.000Z" };
  store.updateMany([{ record: marked, expected: "2026-01-01T00:00:00.000Z" }]);
  assert.throws(() => store.update({ ...marked, pdfRemovedAt: "", updatedAt: "2026-04-02T00:00:00.000Z" }, marked.updatedAt), /nicht zurückholen/);
  assert.throws(() => store.merge({ schemaVersion: 1, records: [row("a", "2026-03-01")] }), /abweichenden Eintrag/);
  assert.equal(store.list()[0].pdfRemovedAt, "2026-04-01");
  assert.throws(() => store.add({ ...row("x", "2026-03-01"), pdfRemovedAt: "gestern" }), /pdfRemovedAt/);
});

test("periodExported: only a saved ZIP with consents that covers the whole period", () => {
  const march = exportPeriod({ kind: "month", month: "2026-03" });
  assert.equal(periodExported([], march), false);
  assert.equal(periodExported([{ from: "2026-03-01", to: "2026-03-31", type: "income", at: "x" }], march), false);
  assert.equal(periodExported([{ from: "2026-03-02", to: "2026-03-31", type: "all", at: "x" }], march), false);
  assert.equal(periodExported([{ from: "2026-01-01", to: "2026-12-31", type: "consents", at: "x" }], march), true);
});

test("deleted copies are not offered by the feature", async () => {
  const list = [row("a", "2026-03-01"), row("b", "2026-03-02")],
    archive = memoryArchive(["a", "b"]);
  const { exporter } = feature({ records: () => list, archive, removed: new Set(["b"]) });
  await exporter.sync();
  assert.deepEqual([...archive.map.keys()], ["a"]);
  assert.deepEqual([...exporter.copies()], ["a"]);
});

test("storage display: count and size of the copies, a hint from 200 MB", async () => {
  const list = [row("a", "2026-03-01"), row("b", "2026-03-02"), row("c", "2026-03-03", { pdfRemovedAt: "2026-04-01" })],
    archive = memoryArchive([]);
  archive.sizes = async () => new Map([["a", 150 * 1024 * 1024], ["b", 60 * 1024 * 1024], ["c", 999]]);
  const { exporter, elements } = feature({ records: () => list, archive });
  await exporter.usage();
  assert.match(elements["copies-usage"].textContent, /^2 PDF-Kopien in der App, zusammen 210 MB\. Das ist viel Speicher/);
  archive.sizes = async () => new Map([["a", 1024 * 1024]]);
  await exporter.usage();
  assert.equal(elements["copies-usage"].textContent, "1 PDF-Kopie in der App, zusammen 1 MB.");
});

test("preview: with only deleted copies the empty result still names the mark", async () => {
  const list = [row("a", "2026-03-05", { pdfRemovedAt: "2026-04-01" }), row("b", "2026-03-06", { pdfRemovedAt: "2026-04-01" })];
  const { change, preview } = feature({ records: () => list, archive: memoryArchive([]) });
  change("export-month", "2026-03");
  change("export-type", "consents");
  assert.match(await preview(), /^Im gewählten Zeitraum gibt es keine Dokumente\. .* 2 Einträge haben den Vermerk „PDF nicht mehr in der App“\./);
});

test("the permanent list keeps a copy out of the ZIP even if its entry is not marked", async () => {
  const list = [row("a", "2026-03-05"), row("b", "2026-03-06")];
  const { change, preview } = feature({ records: () => list, archive: memoryArchive(["a", "b"]), removed: new Set(["a"]) });
  change("export-month", "2026-03");
  assert.match(await preview(), /Davon 1 Einwilligung\./);
});

test("an entry marked while sync or backup run loses its copy in the same run", async () => {
  let list = [row("a", "2026-03-05"), row("b", "2026-03-06")];
  const archive = memoryArchive(["a", "b"]),
    keys = archive.keys;
  archive.keys = async () => {
    const found = await keys();
    list = list.map((r) => (r.id === "a" ? { ...r, pdfRemovedAt: "2026-04-01" } : r));
    return found;
  };
  const { exporter } = feature({ records: () => list, archive });
  await exporter.sync();
  assert.deepEqual([...archive.map.keys()], ["b"]);
  list = [row("a", "2026-03-05"), row("b", "2026-03-06")];
  archive.map.set("a", new Blob(["%PDF"]));
  assert.deepEqual((await exporter.pdfs()).map((p) => p.id), ["b"]);
});

test("hasCopy reads the store itself, not the last sync", async () => {
  const list = [row("a", "2026-03-05")],
    archive = memoryArchive([]);
  const { exporter } = feature({ records: () => list, archive });
  assert.equal(await exporter.hasCopy("a"), false);
  archive.map.set("a", new Blob(["%PDF"]));
  assert.equal(await exporter.hasCopy("a"), true);
  assert.deepEqual([...exporter.copies()], [], "this window has not synced yet");
});
