// Full backup of this device's app data as one JSON file: settings, theme, income list, retention
// deadlines, export log, reminder interval and the consent PDFs kept for the ZIP export.
// Not included: the PIN (the restoring device keeps its own) and an open, unconfirmed consent.
import { validateIncomeBackup } from "./income.js";
import { validateRetention } from "./retention.js";
import { exportable, validateExportLog } from "./export.js";

export const BACKUP_INTERVAL_KEY = "inkform.backup.interval.v1";
export const BACKUP_INTERVALS = [1, 3, 7, 14, 30];
const BACKUP_KIND = "inkform-gesamtsicherung";

export function readBackupDays(storage) {
  const days = Number(storage.getItem(BACKUP_INTERVAL_KEY));
  return BACKUP_INTERVALS.includes(days) ? days : 7;
}

export function toBase64(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
}
export function fromBase64(text) {
  const raw = atob(text),
    bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

// pdfs: [{ id, bytes: Uint8Array }]
export function createFullBackup({ settings, theme, retention, backupDays, exports, records, pdfs, now = new Date() }) {
  return {
    kind: BACKUP_KIND,
    schemaVersion: 1,
    createdAt: now.toISOString(),
    settings,
    theme,
    retention,
    backupDays,
    exports,
    income: { schemaVersion: 1, records },
    pdfs: pdfs.map(({ id, bytes }) => ({ id, pdf: toBase64(bytes) })),
  };
}

// Checks the whole file before anything is written. validateSettings comes from the app.
export function readFullBackup(value, validateSettings) {
  if (value?.kind !== BACKUP_KIND || value.schemaVersion !== 1)
    throw Error("Diese Datei ist keine INKFORM-Gesamtsicherung (Version 1).");
  if (typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt)))
    throw Error("Die Sicherung hat kein gültiges Erstellungsdatum.");
  if (!["dark", "light"].includes(value.theme)) throw Error("Die Sicherung enthält kein gültiges Farbschema.");
  if (!BACKUP_INTERVALS.includes(value.backupDays)) throw Error("Die Sicherung enthält keinen gültigen Erinnerungsabstand.");
  const records = validateIncomeBackup(value.income),
    allowed = new Set(records.filter(exportable).map((r) => r.id)),
    seen = new Set();
  if (!Array.isArray(value.pdfs)) throw Error("Die Sicherung enthält keine PDF-Liste.");
  const pdfs = value.pdfs.map((entry) => {
    if (!allowed.has(entry?.id) || seen.has(entry.id))
      throw Error("Die Sicherung enthält ein PDF ohne passenden Einnahmeneintrag.");
    seen.add(entry.id);
    let bytes;
    try {
      bytes = typeof entry.pdf === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(entry.pdf) ? fromBase64(entry.pdf) : null;
    } catch (_) {}
    if (!bytes || String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-")
      throw Error("Die Sicherung enthält ein beschädigtes PDF.");
    return { id: entry.id, bytes };
  });
  return {
    createdAt: value.createdAt,
    settings: validateSettings(value.settings),
    theme: value.theme,
    retention: validateRetention(value.retention),
    backupDays: value.backupDays,
    exports: validateExportLog(value.exports),
    records,
    pdfs,
  };
}
