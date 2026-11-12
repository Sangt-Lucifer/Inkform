// Export by period (src/export.js): period limits, file names, filter and what must stay out.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { consentFileName, exportPeriod, exportPlan, exportable, formatSize, previousMonth, uniqueNames } from "../src/export.js";
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
