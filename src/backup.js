// Full backup of this device's app data as one JSON file: settings, theme, income list, retention
// deadlines, export log, reminder interval and the consent PDFs kept for the ZIP export.
// Not included: the PIN (the restoring device keeps its own) and an open, unconfirmed consent.
// Copies deleted from the app on purpose stay deleted: the list of their ids travels with the
// backup and is merged with the device's own list when restoring.
import { t } from "./i18n.js";
import { validateIncomeBackup } from "./income.js";
import { validateRetention } from "./retention.js";
import { exportable, validateExportLog, validateRemovedIds } from "./export.js";

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
export function createFullBackup({ settings, theme, retention, backupDays, exports, records, pdfs, removed, now = new Date() }) {
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
    pdfRemoved: [...removed],
    pdfs: pdfs.map(({ id, bytes }) => ({ id, pdf: toBase64(bytes) })),
  };
}

// Checks the whole file before anything is written. validateSettings comes from the app.
export function readFullBackup(value, validateSettings) {
  if (value?.kind !== BACKUP_KIND || value.schemaVersion !== 1)
    throw Error(t("backup.invalid"));
  if (typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt)))
    throw Error(t("backup.invalidDate"));
  if (!["dark", "light"].includes(value.theme)) throw Error(t("backup.invalidTheme"));
  if (!BACKUP_INTERVALS.includes(value.backupDays)) throw Error(t("backup.invalidInterval"));
  const records = validateIncomeBackup(value.income),
    removed = validateRemovedIds(value.pdfRemoved ?? []),
    allowed = new Set(records.filter((r) => exportable(r) && !removed.includes(r.id)).map((r) => r.id)),
    seen = new Set();
  if (!Array.isArray(value.pdfs)) throw Error(t("backup.noPdfs"));
  const pdfs = value.pdfs.map((entry) => {
    if (!allowed.has(entry?.id) || seen.has(entry.id))
      throw Error(t("backup.orphanPdf"));
    seen.add(entry.id);
    let bytes;
    try {
      bytes = typeof entry.pdf === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(entry.pdf) ? fromBase64(entry.pdf) : null;
    } catch (_) {}
    if (!bytes || String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-")
      throw Error(t("backup.damagedPdf"));
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
    removed,
    pdfs,
  };
}

// What a restore writes. Deleted from the app is whatever either list names or either side marks;
// those entries keep (or get) the "PDF nicht mehr in der App" mark and their PDFs are left out.
// Throws before anything is written if the merged list is too long.
export function applyRemovals(data, deviceRemoved, deviceRecords, today) {
  const marked = new Map(deviceRecords.filter((r) => r.pdfRemovedAt).map((r) => [r.id, r.pdfRemovedAt])),
    removed = new Set(
      validateRemovedIds([...new Set([...deviceRemoved, ...data.removed, ...marked.keys(), ...data.records.filter((r) => r.pdfRemovedAt).map((r) => r.id)])]),
    );
  return {
    removed,
    records: data.records.map((r) => (removed.has(r.id) && !r.pdfRemovedAt ? { ...r, pdfRemovedAt: marked.get(r.id) ?? today } : r)),
    pdfs: data.pdfs.filter((p) => !removed.has(p.id)),
    skipped: data.pdfs.filter((p) => removed.has(p.id)).length,
  };
}
