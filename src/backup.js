// Two files share one format and one version number:
// - Studio settings: the owner's customisations only (settings with texts, questions, languages
//   and translations; theme, logo, home screen icon, retention deadlines, reminder interval). No
//   customer data.
// - Full backup: the same customisations plus income list, export log, the list of deleted PDF
//   copies and the consent PDFs kept for the ZIP export.
// Neither holds the PIN, the language of this device or an open, unconfirmed consent. Copies
// deleted from the app on purpose stay deleted: the list of their ids travels with the backup and
// is merged with the device's own list when restoring.
// Version 1 (full backup only) has no logo; version 2 adds it, version 3 the home screen icon,
// version 4 the language packs installed on the device (languages: { code: pack }).
import { t } from "./i18n.js";
import { validateIncomeBackup } from "./income.js";
import { validateRetention } from "./retention.js";
import { exportable, validateExportLog, validateRemovedIds } from "./export.js";
import { checkIcon, checkLogo } from "./logo.js";
import { validatePacks } from "./languages.js";

export const BACKUP_INTERVAL_KEY = "inkform.backup.interval.v1";
export const BACKUP_INTERVALS = [1, 3, 7, 14, 30];
export const BACKUP_KIND = "inkform-gesamtsicherung";
export const STUDIO_KIND = "inkform-studio-einstellungen";
const FORMAT_VERSION = 4;

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

// The customisations, in both files. logo, icon: PNG bytes, or null for the one built into the app.
// Only the known parts of the settings are taken, so nothing else can travel with them.
const SETTINGS_PARTS = ["schemaVersion", "savedAt", "studio", "app", "medical", "legal", "locale", "translations"];
const ITEM_PARTS = ["id", "title", "hint", "text", "review"];
const pick = (value, keys) => Object.fromEntries(keys.filter((key) => key in value).map((key) => [key, value[key]]));
function studioPart({ settings, theme, logo = null, icon = null, retention, backupDays, packs = {} }) {
  const picked = pick(settings, SETTINGS_PARTS);
  for (const key of ["medical", "legal"]) if (Array.isArray(picked[key])) picked[key] = picked[key].map((item) => pick(item, ITEM_PARTS));
  return { settings: picked, theme, logo: logo && toBase64(logo), icon: icon && toBase64(icon), retention, backupDays, languages: packs };
}
// The packs are read first: the settings may name their languages. validateSettings(settings,
// packs) checks the settings as if those packs were installed.
function readStudioPart(value, validateSettings) {
  if (!["dark", "light"].includes(value.theme)) throw Error(t("backup.invalidTheme"));
  const languages = value.schemaVersion < 4 ? undefined : validatePacks(value.languages);
  const logo = value.schemaVersion === 1 ? undefined : readImage(value.logo, checkLogo, "backup.invalidLogo"),
    icon = value.schemaVersion < 3 ? undefined : readImage(value.icon, checkIcon, "backup.invalidIcon");
  if (!BACKUP_INTERVALS.includes(value.backupDays)) throw Error(t("backup.invalidInterval"));
  return {
    settings: validateSettings(value.settings, languages),
    languages,
    theme: value.theme,
    logo,
    icon,
    retention: validateRetention(value.retention),
    backupDays: value.backupDays,
  };
}
function readHeader(value, kind) {
  const lowest = kind === BACKUP_KIND ? 1 : 2;
  if (value?.kind !== kind || !Number.isInteger(value.schemaVersion) || value.schemaVersion < lowest || value.schemaVersion > FORMAT_VERSION) {
    if (value?.kind === BACKUP_KIND && kind !== BACKUP_KIND) throw Error(t("studioFile.isBackup"));
    if (value?.kind === STUDIO_KIND && kind !== STUDIO_KIND) throw Error(t("backup.isStudio"));
    throw Error(t(kind === BACKUP_KIND ? "backup.invalid" : "studioFile.invalid"));
  }
  if (typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt)))
    throw Error(t("backup.invalidDate"));
}

export function createStudioSettings({ now = new Date(), ...part }) {
  return { kind: STUDIO_KIND, schemaVersion: FORMAT_VERSION, createdAt: now.toISOString(), ...studioPart(part) };
}
// Also reads the older settings-only file (the settings with the theme): what it lacks is
// undefined and stays as it is on the device.
export function readStudioSettings(value, validateSettings) {
  if (value && !value.kind && value.studio && value.app)
    return {
      createdAt: null,
      version: null,
      settings: validateSettings(value),
      languages: undefined,
      theme: ["dark", "light"].includes(value.theme) ? value.theme : undefined,
      logo: undefined,
      icon: undefined,
      retention: undefined,
      backupDays: undefined,
    };
  readHeader(value, STUDIO_KIND);
  return { createdAt: value.createdAt, version: value.schemaVersion, ...readStudioPart(value, validateSettings) };
}

// pdfs: [{ id, bytes: Uint8Array }]
export function createFullBackup({ exports, records, pdfs, removed, now = new Date(), ...part }) {
  return {
    kind: BACKUP_KIND,
    schemaVersion: FORMAT_VERSION,
    createdAt: now.toISOString(),
    ...studioPart(part),
    exports,
    income: { schemaVersion: 1, records },
    pdfRemoved: [...removed],
    pdfs: pdfs.map(({ id, bytes }) => ({ id, pdf: toBase64(bytes) })),
  };
}

// Checks the whole file before anything is written. validateSettings comes from the app.
// What an older version lacks (logo before 2, icon before 3) is undefined: the device keeps its own.
export function readFullBackup(value, validateSettings) {
  readHeader(value, BACKUP_KIND);
  const studio = readStudioPart(value, validateSettings);
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
    version: value.schemaVersion,
    ...studio,
    exports: validateExportLog(value.exports),
    records,
    removed,
    pdfs,
  };
}

function readImage(value, check, invalid) {
  if (value === null) return null;
  try {
    if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw Error(t("logo.notPng"));
    return check(fromBase64(value));
  } catch (error) {
    throw Error(t(invalid, { fehler: error.message }));
  }
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
