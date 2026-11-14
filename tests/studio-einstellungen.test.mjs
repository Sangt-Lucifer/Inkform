// Studio settings file (src/backup.js): the owner's customisations without customer data, in the
// same format and version as the full backup.
import assert from "node:assert/strict";
import test from "node:test";
import { createFullBackup, createStudioSettings, readFullBackup, readStudioSettings } from "../src/backup.js";

const settings = { schemaVersion: 1, studio: { name: "Musterstudio" }, app: { brand: "INKFORM" }, medical: [], legal: [], locale: { customer: ["de"] } };
const logo = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const studio = { settings, theme: "light", logo, retention: { pdfYears: 10, incomeYears: 2 }, backupDays: 14, now: new Date("2026-11-13T10:00:00.000Z") };
const customer = {
  records: [{ id: "a", date: "2026-03-01", artist: "Alex", customer: "Jürgen Müller", totalCents: 100, depositCents: null, source: "", updatedAt: "2026-01-01T00:00:00.000Z" }],
  pdfs: [{ id: "a", bytes: new TextEncoder().encode("%PDF-1.7 Unterschrift") }],
  exports: [{ from: "2026-03-01", to: "2026-03-31", type: "all", at: "2026-04-02T10:00:00.000Z" }],
  removed: new Set(["b"]),
};
const asJson = (value) => JSON.parse(JSON.stringify(value));
const read = (value) => readStudioSettings(asJson(value), (s) => s);

test("round trip: settings, theme, logo, deadlines and interval", () => {
  const data = read(createStudioSettings(studio));
  assert.equal(data.createdAt, "2026-11-13T10:00:00.000Z");
  assert.deepEqual(data.settings, settings);
  assert.equal(data.theme, "light");
  assert.deepEqual(data.logo, logo);
  assert.deepEqual(data.retention, { pdfYears: 10, incomeYears: 2 });
  assert.equal(data.backupDays, 14);
});

test("no customer data: only the customisations, whatever is passed in", () => {
  const file = asJson(createStudioSettings({ ...studio, ...customer }));
  assert.deepEqual(Object.keys(file).sort(), ["backupDays", "createdAt", "icon", "kind", "logo", "retention", "schemaVersion", "settings", "theme"]);
  const keys = [];
  (function walk(value) {
    if (value && typeof value === "object") for (const [key, inner] of Object.entries(value)) keys.push(key.toLowerCase()), walk(inner);
  })(file);
  for (const forbidden of ["income", "records", "pdfs", "pdf", "pdfremoved", "exports", "signature", "pin", "salt", "hash", "pending"])
    assert.ok(!keys.includes(forbidden), forbidden);
  const text = JSON.stringify(file);
  for (const value of ["Jürgen", "Müller", "%PDF", Buffer.from("%PDF").toString("base64").slice(0, 4), "2026-03-31"]) assert.ok(!text.includes(value), value);
});

test("only the known parts of the settings travel, also when more is handed in", () => {
  const smuggled = {
    ...settings,
    income: { records: customer.records },
    pin: { hash: "abc", salt: "def" },
    medical: [{ id: "bloodThinners", title: "Frage", hint: "Hinweis", answer: "ja", customer: "Jürgen Müller" }],
    legal: [{ id: "privacy", title: "Datenschutz", text: "Text", review: true, signature: "data:image/png;base64,AAAA" }],
  };
  const file = asJson(createStudioSettings({ ...studio, settings: smuggled }));
  assert.deepEqual(Object.keys(file.settings).sort(), ["app", "legal", "locale", "medical", "schemaVersion", "studio"]);
  assert.deepEqual(file.settings.medical, [{ id: "bloodThinners", title: "Frage", hint: "Hinweis" }]);
  assert.deepEqual(file.settings.legal, [{ id: "privacy", title: "Datenschutz", text: "Text", review: true }]);
  assert.ok(!/Jürgen|abc|AAAA|"ja"/.test(JSON.stringify(file.settings)));
});

test("same format as the full backup: the customisations are identical", () => {
  const backup = asJson(createFullBackup({ ...studio, ...customer })),
    file = asJson(createStudioSettings(studio));
  assert.equal(backup.schemaVersion, file.schemaVersion);
  for (const key of ["settings", "theme", "logo", "retention", "backupDays"]) assert.deepEqual(backup[key], file[key], key);
});

test("the older settings-only file still imports; what it lacks stays on the device", () => {
  const data = read({ ...settings, theme: "dark" });
  assert.deepEqual(data.settings, { ...settings, theme: "dark" });
  assert.equal(data.theme, "dark");
  assert.equal(data.createdAt, null);
  for (const key of ["logo", "retention", "backupDays"]) assert.equal(data[key], undefined, key);
});

test("wrong files are refused with a hint where they belong", () => {
  assert.throws(() => read(createFullBackup({ ...studio, ...customer })), /Gesamtsicherung.*Wiederherstellen/);
  assert.throws(() => readFullBackup(asJson(createStudioSettings(studio)), (s) => s), /Studio-Einstellungen, keine Gesamtsicherung/);
  assert.throws(() => read({ ...asJson(createStudioSettings(studio)), schemaVersion: 4 }), /neueren App-Version/);
  assert.throws(() => read({ ...asJson(createStudioSettings(studio)), schemaVersion: 1 }), /neueren App-Version/);
  assert.throws(() => read({ kind: "etwas" }), /keine INKFORM-Studio-Einstellungen/);
  assert.throws(() => read({ ...asJson(createStudioSettings(studio)), logo: "AAAA" }), /ungültiges Logo/);
  assert.throws(() => read({ ...asJson(createStudioSettings(studio)), backupDays: 5 }), /Erinnerungsabstand/);
});
