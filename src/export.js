// ZIP export of a period: consent PDFs kept on this device and the income list.
// The PDFs live in their own IndexedDB database, keyed by the income entry's id; a PDF is kept only
// while its entry may still have a PDF (see exportable), sync() removes all others.
import { fileSlug } from "./consent.js";
import { incomeCsv } from "./income.js";
import { pdfMayExist } from "./retention.js";
import { createZip } from "./zip.js";

export const ARCHIVE_DB = "inkform-archive";
export const EXPORT_TYPES = { all: "Alles", consents: "Nur Einwilligungen", income: "Nur Einnahmen" };

// Calendar day YYYY-MM-DD that really exists (no 30 February).
function checkedDay(text, label) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text ?? ""),
    d = m && new Date(Date.UTC(+m[1], m[2] - 1, +m[3]));
  if (!d || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== m[2] - 1 || d.getUTCDate() !== +m[3])
    throw Error(`${label}: Bitte ein gültiges Datum wählen.`);
  return text;
}

// Inclusive local calendar days. Appointment dates are plain YYYY-MM-DD strings, so the time zone
// of the device never moves an entry into another period.
export function exportPeriod({ kind, month = "", year = "", from = "", to = "" }) {
  if (kind === "month") {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error("Bitte Monat und Jahr wählen.");
    const [y, m] = month.split("-").map(Number),
      last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}`, label: month };
  }
  if (kind === "year") {
    if (!/^\d{4}$/.test(String(year))) throw Error("Bitte ein Jahr mit vier Ziffern angeben.");
    return { from: `${year}-01-01`, to: `${year}-12-31`, label: String(year) };
  }
  if (kind === "range") {
    checkedDay(from, "Von");
    checkedDay(to, "Bis");
    if (from > to) throw Error("„Von“ darf nicht nach „Bis“ liegen.");
    return { from, to, label: `${from}_bis_${to}` };
  }
  throw Error("Unbekannter Zeitraum.");
}

export const previousMonth = (today) => {
  const [y, m] = today.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

// Anonymizing drops the "PDF fehlt" flag, so anonymized entries are excluded explicitly.
export const exportable = (r) => pdfMayExist(r) && !r.anonymizedAt;

const GENERATED = /^Tattoo_Einwilligung_(.+)_\d{4}-\d{2}-\d{2}_\d{6}_[A-Z0-9]{4}\.pdf$/u;
// "JJJJ-MM-TT_Nachname_Vorname.pdf": the name part of the generated PDF name (as signed), otherwise
// the income entry's "Vorname Nachname".
export function consentFileName(record) {
  const words = record.customer.trim().split(/\s+/),
    name = record.source.normalize("NFC").match(GENERATED)?.[1] ?? [words.at(-1), ...words.slice(0, -1)].join("_");
  return `${record.date}_${fileSlug(name) || "Unbekannt"}.pdf`;
}

// File systems may treat names case-insensitively and in any Unicode normalization (APFS).
export function uniqueNames(names) {
  const key = (name) => name.normalize("NFC").toLocaleLowerCase("de-DE"),
    seen = new Set();
  return names.map((name) => {
    const dot = name.lastIndexOf(".");
    let candidate = name;
    for (let n = 2; seen.has(key(candidate)); n++)
      candidate = `${name.slice(0, dot)}_${n}${name.slice(dot)}`;
    seen.add(key(candidate));
    return candidate;
  });
}

export function exportPlan(records, archivedIds, period, type) {
  const inPeriod = records
    .filter((r) => r.date >= period.from && r.date <= period.to)
    .sort((a, b) => a.date.localeCompare(b.date) || a.customer.localeCompare(b.customer, "de") || a.id.localeCompare(b.id));
  const consents = type === "income" ? [] : inPeriod.filter((r) => exportable(r) && archivedIds.has(r.id)),
    names = uniqueNames(consents.map(consentFileName));
  return {
    consents: consents.map((r, i) => ({ id: r.id, path: `Einwilligungen/${names[i]}` })),
    income: type === "consents" ? [] : inPeriod,
    withoutPdf: type === "income" ? 0 : inPeriod.length - consents.length,
  };
}

export function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB`;
}

export function createExportFeature({ archive, records, incomeReport, isUnlocked, escape, notify, download, today }) {
  const e = escape,
    dateDe = (iso) => iso.split("-").reverse().join(".");
  const state = {
    kind: "month",
    month: previousMonth(today()),
    year: today().slice(0, 4),
    from: `${today().slice(0, 4)}-01-01`,
    to: today(),
    type: "all",
  };
  let prepared = null,
    run = 0,
    sharing = false;
  const $ = (id) => document.getElementById(id),
    allowed = (id) => records().some((r) => r.id === id && exportable(r));

  async function prepare() {
    const period = exportPeriod(state),
      all = records(),
      plan = exportPlan(all, new Set(state.type === "income" ? [] : await archive.keys()), period, state.type),
      files = [];
    for (const { id, path } of plan.consents) {
      const blob = await archive.get(id);
      if (blob) files.push({ name: path, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    const consents = files.length;
    let note = "";
    if (plan.income.length) {
      const base = `Einnahmen/Einnahmen_${period.label}`;
      try {
        const pdf = incomeReport(plan.income, `Zeitraum: ${dateDe(period.from)} bis ${dateDe(period.to)}`);
        files.push({ name: `${base}.pdf`, data: new Uint8Array(await pdf.arrayBuffer()) });
      } catch (error) {
        note = ` Einnahmenübersicht nur als CSV: ${error.message}`;
      }
      files.push({ name: `${base}.csv`, data: new TextEncoder().encode(incomeCsv(plan.income)) });
    }
    return { name: `Inkform_${period.label}.zip`, files, consents, withoutPdf: plan.withoutPdf, note, basis: JSON.stringify(all) };
  }

  function summary({ files, consents, withoutPdf, note }) {
    if (!files.length) return "Im gewählten Zeitraum gibt es keine Dokumente. Es wird keine ZIP-Datei erstellt.";
    const pdfs = files.filter((f) => f.name.endsWith(".pdf")).length,
      csv = files.length - pdfs,
      size = files.reduce((sum, f) => sum + f.data.length, 0);
    return (
      `${pdfs} ${pdfs === 1 ? "PDF" : "PDFs"}${csv ? " und 1 CSV" : ""}, ${formatSize(size)}. ` +
      `Davon ${consents} ${consents === 1 ? "Einwilligung" : "Einwilligungen"}.` +
      (withoutPdf
        ? ` ${withoutPdf} ${withoutPdf === 1 ? "Eintrag" : "Einträge"} im Zeitraum ohne PDF in der App (gelöscht, „PDF fehlt“, anonymisiert oder vor diesem Update abgelegt).`
        : "") +
      note
    );
  }

  async function preview() {
    const host = $("export-preview"),
      button = $("export-save");
    if (!host) return;
    const current = ++run;
    prepared = null;
    button.disabled = true;
    host.classList.remove("ad-warn");
    host.textContent = "Vorschau wird berechnet …";
    try {
      const result = await prepare();
      if (current !== run) return;
      prepared = result;
      host.textContent = summary(result);
      host.classList.toggle("ad-warn", !result.files.length);
      button.disabled = !result.files.length;
    } catch (error) {
      if (current !== run) return;
      host.textContent = error.message;
      host.classList.add("ad-warn");
    }
  }

  // Runs synchronously up to navigator.share, so Safari keeps the tap as user activation.
  function save() {
    const ready = prepared,
      status = $("export-status");
    if (!ready?.files.length || sharing) return;
    if (JSON.stringify(records()) !== ready.basis) {
      notify("Die Einträge haben sich geändert. Bitte die neue Vorschau prüfen.");
      preview();
      return;
    }
    const file = new File([createZip(ready.files)], ready.name, { type: "application/zip" });
    let native = false;
    try {
      native = !!(window.isSecureContext && navigator.share && navigator.canShare?.({ files: [file] }));
    } catch (_) {}
    if (!native) {
      download(file, file.name);
      status.textContent = `${file.name} an den Browser übergeben. Prüfe die Datei in der Dateien-App im Downloadordner.`;
      return;
    }
    sharing = true;
    navigator
      .share({ files: [file], title: file.name })
      .then(
        () => (status.textContent = `Systemdialog abgeschlossen. Prüfe in der Dateien-App, ob ${file.name} im gewählten Ordner liegt.`),
        (error) =>
          (status.textContent =
            error.name === "AbortError"
              ? "Speichern abgebrochen. Über „ZIP erstellen und sichern“ erneut versuchen."
              : "Der Systemdialog konnte nicht geöffnet werden. Bitte erneut versuchen."),
      )
      .finally(() => (sharing = false));
  }

  function view() {
    if (!isUnlocked()) return '<p class="ad-notice">Bitte den Admin-Bereich mit der Inhaber-PIN entsperren.</p>';
    const option = (value, label, selected) =>
      `<option value="${e(value)}"${value === selected ? " selected" : ""}>${e(label)}</option>`;
    const field = (kind, html) => `<label data-export-for="${kind}"${state.kind === kind ? "" : " hidden"}>${html}</label>`;
    return `<section class="ad-panel"><div class="ad-panel-header"><h2>ZIP-Datei nach Zeitraum</h2></div><div class="ad-panel-body">
      <p class="ad-section-copy">Enthält die Einwilligungs-PDFs, die auf diesem Gerät abgelegt wurden, in „Einwilligungen/“ und die Einnahmenübersicht als PDF und CSV in „Einnahmen/“. Maßgeblich ist das Termindatum. Einwilligungs-PDFs, die als gelöscht markiert, als „PDF fehlt“ gebucht, entfernt oder anonymisiert sind, sind nicht enthalten. Die Einnahmenübersicht enthält wie die Einnahmenliste alle Einträge des Zeitraums; Namen entfallen erst beim Anonymisieren.</p>
      <div class="income-filters">
      <label>Zeitraum<select id="export-kind">${option("month", "Ein Monat", state.kind)}${option("year", "Ein Jahr", state.kind)}${option("range", "Von – bis", state.kind)}</select></label>
      ${field("month", `Monat<input id="export-month" type="month" value="${e(state.month)}">`)}
      ${field("year", `Jahr<input id="export-year" type="number" inputmode="numeric" min="2000" max="2100" value="${e(state.year)}">`)}
      ${field("range", `Von<input id="export-from" type="date" value="${e(state.from)}">`)}
      ${field("range", `Bis<input id="export-to" type="date" value="${e(state.to)}">`)}
      <label>Dokumente<select id="export-type">${Object.entries(EXPORT_TYPES)
        .map(([value, label]) => option(value, label, state.type))
        .join("")}</select></label></div>
      <p id="export-preview" class="ad-section-copy" role="status" aria-live="polite"></p>
      <div class="ad-actions-row"><button class="ad-button primary" type="button" id="export-save" disabled>ZIP erstellen und sichern</button></div>
      <p id="export-status" class="ad-preview-note" role="status"></p>
      </div></section>`;
  }

  document.getElementById("admin-app").addEventListener("change", (event) => {
    const key = { "export-kind": "kind", "export-month": "month", "export-year": "year", "export-from": "from", "export-to": "to", "export-type": "type" }[event.target.id];
    if (!key || !isUnlocked()) return;
    state[key] = event.target.value;
    if (key === "kind")
      document.querySelectorAll("[data-export-for]").forEach((el) => (el.hidden = el.dataset.exportFor !== state.kind));
    preview();
  });
  document.getElementById("admin-app").addEventListener("click", (event) => {
    if (event.target.closest("#export-save") && isUnlocked()) save();
  });

  return {
    view,
    preview,
    // Kept after the owner confirmed the filing; asks the browser not to evict the app's storage.
    // An entry removed or marked while the PDF was being written loses the copy right away.
    async keep(id, blob) {
      navigator.storage?.persist?.().catch(() => {});
      await archive.put(id, blob);
      if (!allowed(id)) await archive.delete(id);
    },
    // The entries are re-read before each deletion: a PDF kept meanwhile (also by another window)
    // belongs to an entry that already exists, so it is never deleted.
    async sync() {
      for (const key of await archive.keys()) if (!allowed(key)) await archive.delete(key);
      if ($("export-preview")) preview();
    },
  };
}
