// Retention help (no DOM): reminders for deleting consent PDFs and anonymizing the income list.
// The deadlines are set by the studio; without a deadline nothing is listed. Not legal advice.
export const RETENTION_KEY = "inkform.retention.v1";
export const LAST_BACKUP_KEY = "inkform.backup.v1";
export const ANONYMIZED = "anonymisiert";
export const PENDING_REMINDER_DAYS = 7;

// null (no deadline) or whole years 1..50.
function years(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "string" ? Number(value.trim()) : value;
  if (!Number.isInteger(n) || n < 1 || n > 50)
    throw Error("Fristen bitte als ganze Jahre zwischen 1 und 50 angeben oder leer lassen.");
  return n;
}
export function validateRetention(value) {
  return { pdfYears: years(value?.pdfYears), incomeYears: years(value?.incomeYears) };
}
export function readRetention(storage) {
  try {
    return validateRetention(JSON.parse(storage.getItem(RETENTION_KEY) || "null") ?? {});
  } catch (_) {
    return { pdfYears: null, incomeYears: null };
  }
}
export function writeRetention(storage, value) {
  const checked = validateRetention(value);
  storage.setItem(RETENTION_KEY, JSON.stringify(checked));
  return checked;
}

// Same calendar day `n` years earlier (29 Feb -> 28 Feb).
export function yearsBefore(today, n) {
  const [y, m, d] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y - n, m, 0)).getUTCDate();
  return `${String(y - n).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

// Appointment date counts; due once the full deadline has passed.
const due = (record, today, n) => n !== null && record.date < yearsBefore(today, n);

// Consents whose PDF should be deleted in the Files app and is not yet marked as deleted.
export function dueForPdfDeletion(records, pdfYears, today) {
  return records
    .filter((r) => due(r, today, pdfYears) && !r.pdfDeletedAt && !r.pdfMissing && !r.anonymizedAt)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Whether a signed PDF still exists in the Files app is unknown until the owner marks it as
// deleted or the entry was booked as "PDF fehlt" - also for entries without a file name (added by
// hand). Such entries keep their name, because that is how the owner finds the PDF; they are
// anonymized only afterwards.
export const pdfMayExist = (r) => !r.pdfDeletedAt && !r.pdfMissing;

// Income entries whose name and PDF reference can be removed now.
export function dueForAnonymization(records, incomeYears, today) {
  return records
    .filter((r) => due(r, today, incomeYears) && !r.anonymizedAt && !pdfMayExist(r))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Past the income deadline, but waiting until their PDF is deleted.
export function waitingForPdfDeletion(records, incomeYears, today) {
  return records.filter((r) => due(r, today, incomeYears) && !r.anonymizedAt && pdfMayExist(r));
}

// Name and PDF reference removed; date, artist and amounts stay for totals.
export function anonymizeRecord(record, today, now = new Date().toISOString()) {
  const { pdfMissing, ...rest } = record;
  return { ...rest, customer: ANONYMIZED, source: "", anonymizedAt: today, updatedAt: now };
}

export function daysBetween(fromIso, toDate = new Date()) {
  return Math.floor((toDate.getTime() - Date.parse(fromIso)) / 86_400_000);
}
