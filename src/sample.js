// Invented sample entries for trying out the neutral edition. Every id starts with SAMPLE_PREFIX,
// so they can always be removed completely, also after editing.
import { t } from "./i18n.js";

export const SAMPLE_PREFIX = "beispiel-";
export const isSample = (record) => record.id.startsWith(SAMPLE_PREFIX);

const SAMPLES = [
  ["Erika", "Beispiel", "Artist A", 1, 3, 25000, 5000],
  ["Jonas", "Probe", "Artist B", 1, 12, 48000, 10000],
  ["Zoë", "Fiktiv", "Artist A", 1, 21, null, 5000],
  ["Ömer", "Demo", "Artist B", 2, 5, 32000, null],
  ["Lea", "Platzhalter", "Artist A", 2, 14, 61000, 15000],
  ["Paul", "Erfunden", "", 2, 27, 18000, null],
];

// Entries in the two months before today's month (day clamped to the month's length).
export function sampleRecords(today, now = new Date().toISOString()) {
  const [year, month] = today.split("-").map(Number);
  return SAMPLES.map(([first, last, artist, back, day, totalCents, depositCents], i) => {
    const d = new Date(Date.UTC(year, month - 1 - back, 1)),
      days = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(),
      date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(day, days)).padStart(2, "0")}`;
    return {
      id: `${SAMPLE_PREFIX}${i + 1}`,
      date,
      artist,
      customer: `${first} ${last}`,
      totalCents,
      depositCents,
      source: `${t("file.consent")}_${last}_${first}_${date}_120000_DEMO.pdf`,
      updatedAt: now,
    };
  });
}
