// ZIP export of a period: consent PDFs kept on this device and the income list.
// The PDFs live in their own IndexedDB database, keyed by the income entry's id; a PDF is kept only
// while its entry may still have a PDF (see exportable), sync() removes all others.
import { fileSlug } from "./consent.js";
import { incomeCsv } from "./income.js";
import { pdfMayExist } from "./retention.js";
import { createZip } from "./zip.js";

export const ARCHIVE_DB = "inkform-archive";
export const EXPORT_LOG_KEY = "inkform.export.v1";
// Ids of entries whose copy in the app was deleted on purpose. Kept for good, so neither a sync nor
// an older full backup can bring such a copy back.
export const PDF_REMOVED_KEY = "inkform.pdf-removed.v1";
// From this total size the export page suggests deleting copies of checked periods.
export const COPY_HINT_BYTES = 200 * 1024 * 1024;
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
export const exportable = (r) => pdfMayExist(r) && !r.anonymizedAt && !r.pdfRemovedAt;

export function validateRemovedIds(value) {
  if (!Array.isArray(value) || value.length > 20000 || value.some((id) => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)))
    throw Error("Ungültige Liste gelöschter PDF-Kopien.");
  return [...new Set(value)];
}
export function readRemovedIds(storage) {
  return new Set(validateRemovedIds(JSON.parse(storage.getItem(PDF_REMOVED_KEY) || "[]")));
}
export function addRemovedIds(storage, ids) {
  storage.setItem(PDF_REMOVED_KEY, JSON.stringify(validateRemovedIds([...readRemovedIds(storage), ...ids])));
}

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
    removed: type === "income" ? 0 : inPeriod.filter((r) => r.pdfRemovedAt).length,
  };
}

// Saved ZIP files: { from, to, type, at }. Used for the reminder about months not yet exported.
export function validateExportLog(value) {
  if (!Array.isArray(value) || value.length > 1000) throw Error("Ungültiges Export-Protokoll.");
  return value.map((entry) => {
    if (!entry || typeof entry.at !== "string" || !Object.hasOwn(EXPORT_TYPES, entry.type))
      throw Error("Ungültiger Eintrag im Export-Protokoll.");
    const { from, to } = exportPeriod({ kind: "range", from: entry.from, to: entry.to });
    return { from, to, type: entry.type, at: entry.at };
  });
}
export function readExportLog(storage) {
  try {
    return validateExportLog(JSON.parse(storage.getItem(EXPORT_LOG_KEY) || "[]"));
  } catch (_) {
    return [];
  }
}

// Whether a saved ZIP with consents covered the whole period.
export const periodExported = (log, { from, to }) => log.some((e) => e.type !== "income" && e.from <= from && e.to >= to);

// Completed months with consent PDFs on this device that no saved ZIP with consents covered.
export function unexportedMonths(records, archivedIds, log, today) {
  const current = today.slice(0, 7),
    months = new Set(records.filter((r) => exportable(r) && archivedIds.has(r.id) && r.date.slice(0, 7) < current).map((r) => r.date.slice(0, 7)));
  return [...months].filter((month) => !periodExported(log, exportPeriod({ kind: "month", month }))).sort();
}

export function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB`;
}

export function createExportFeature({
  archive,
  records,
  incomeReport,
  isUnlocked,
  escape,
  notify,
  save: saveFile,
  logExport,
  exportLog,
  removedIds,
  removeCopies,
  today,
}) {
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
    sharing = false,
    archived = new Set();
  const $ = (id) => document.getElementById(id),
    allowed = (id) => !removedIds().has(id) && records().some((r) => r.id === id && exportable(r)),
    periodText = (period) => `${dateDe(period.from)} bis ${dateDe(period.to)}`,
    copiesText = (n) => `${n} ${n === 1 ? "PDF-Kopie" : "PDF-Kopien"}`;

  async function prepare() {
    const period = exportPeriod(state),
      all = records(),
      plan = exportPlan(all, new Set(state.type === "income" ? [] : await archive.keys()), period, state.type),
      files = [];
    for (const { id, path } of plan.consents) {
      const blob = await archive.get(id);
      if (blob) files.push({ name: path, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    const consents = files.length,
      copies = plan.consents.filter((c) => files.some((f) => f.name === c.path)).map((c) => c.id),
      copyBytes = files.filter((f) => f.name.startsWith("Einwilligungen/")).reduce((sum, f) => sum + f.data.length, 0);
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
    return {
      name: `Inkform_${period.label}.zip`,
      period,
      type: state.type,
      files,
      consents,
      copies,
      copyBytes,
      withoutPdf: plan.withoutPdf,
      removed: plan.removed,
      note,
      basis: JSON.stringify(all),
    };
  }

  function summary({ files, consents, withoutPdf, removed, note }) {
    if (!files.length) return "Im gewählten Zeitraum gibt es keine Dokumente. Es wird keine ZIP-Datei erstellt.";
    const pdfs = files.filter((f) => f.name.endsWith(".pdf")).length,
      csv = files.length - pdfs,
      size = files.reduce((sum, f) => sum + f.data.length, 0);
    return (
      `${pdfs} ${pdfs === 1 ? "PDF" : "PDFs"}${csv ? " und 1 CSV" : ""}, ${formatSize(size)}. ` +
      `Davon ${consents} ${consents === 1 ? "Einwilligung" : "Einwilligungen"}.` +
      (withoutPdf
        ? ` ${withoutPdf} ${withoutPdf === 1 ? "Eintrag" : "Einträge"} im Zeitraum ohne PDF in der App (gelöscht, „PDF fehlt“, anonymisiert, Kopie aus der App gelöscht oder vor diesem Update abgelegt).`
        : "") +
      (removed ? ` Davon ${removed} mit dem Vermerk „PDF nicht mehr in der App“.` : "") +
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
    $("export-delete").disabled = true;
    host.classList.remove("ad-warn");
    host.textContent = "Vorschau wird berechnet …";
    try {
      const result = await prepare();
      if (current !== run) return;
      prepared = result;
      host.textContent = summary(result);
      host.classList.toggle("ad-warn", !result.files.length);
      button.disabled = !result.files.length;
      $("export-delete").disabled = !result.copies.length;
      $("export-delete").textContent = result.copies.length
        ? `${copiesText(result.copies.length)} dieses Zeitraums aus der App löschen …`
        : result.type === "income"
          ? "Zum Löschen „Alles“ oder „Nur Einwilligungen“ wählen"
          : "Keine PDF-Kopien in diesem Zeitraum";
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
    sharing = true;
    saveFile(file)
      .then(
        (way) => {
          logExport({ from: ready.period.from, to: ready.period.to, type: ready.type, at: new Date().toISOString() });
          status.textContent =
            way === "download"
              ? `${file.name} an den Browser übergeben. Prüfe die Datei in der Dateien-App im Downloadordner.`
              : `Systemdialog abgeschlossen. Prüfe in der Dateien-App, ob ${file.name} im gewählten Ordner liegt.`;
          if (ready.copies.length) {
            offered = { ids: ready.copies, period: ready.period, bytes: ready.copyBytes, zip: file.name };
            $("export-offer-text").textContent = `Die ${ready.copies.length} PDFs dieses Zeitraums jetzt aus der App löschen? Das spart Speicher auf dem iPad. Vorher die ZIP-Datei prüfen; „Später löschen“ ist jederzeit möglich, ohne dass etwas verloren geht.`;
            $("export-offer").hidden = false;
          }
        },
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
      <div id="export-offer" class="ad-notice" hidden><p id="export-offer-text"></p><div class="ad-actions-row"><button class="ad-button danger" type="button" id="export-offer-delete">Prüfen und löschen …</button><button class="ad-button" type="button" id="export-offer-later">Später löschen</button></div></div>
      </div></section>
      <section class="ad-panel"><div class="ad-panel-header"><h2>PDF-Kopien in der App</h2></div><div class="ad-panel-body">
      <p id="copies-usage" class="ad-section-copy" role="status">Speicher wird berechnet …</p>
      <p class="ad-section-copy">Gelöscht werden hier nur die Kopien im Speicher dieser App. PDFs in der Dateien-App, auf dem Mac, auf USB-Sticks oder in ZIP-Dateien werden nie berührt. Die Einträge in der Einnahmenliste bleiben vollständig und bekommen den Vermerk „PDF nicht mehr in der App“. Diese PDFs sind danach in keinem ZIP-Export mehr enthalten. Gelöscht wird nur, wenn du es selbst auslöst.</p>
      <div class="ad-actions-row"><button class="ad-button danger" type="button" id="export-delete" disabled>PDF-Kopien dieses Zeitraums aus der App löschen …</button></div>
      </div></section>`;
  }

  // Shows the number and size of the copies; the period choice above also selects what to delete.
  async function usage() {
    const host = $("copies-usage");
    if (!host) return;
    try {
      const sizes = [...(await archive.sizes())].filter(([id]) => allowed(id)),
        bytes = sizes.reduce((sum, [, size]) => sum + size, 0);
      host.textContent = `${copiesText(sizes.length)} in der App, zusammen ${sizes.length ? formatSize(bytes) : "0 KB"}.${
        bytes >= COPY_HINT_BYTES
          ? " Das ist viel Speicher: Zeiträume, die als ZIP gesichert und geprüft sind, können aus der App gelöscht werden."
          : ""
      }`;
      host.classList.toggle("ad-warn", bytes >= COPY_HINT_BYTES);
    } catch (error) {
      host.textContent = "Speicher nicht lesbar: " + error.message;
    }
  }

  // Check step before deleting: warning, instructions, a ticked box, then a last question.
  const dialog = document.createElement("dialog");
  dialog.id = "copy-delete-dialog";
  dialog.setAttribute("aria-labelledby", "copy-delete-title");
  dialog.innerHTML = `<div class="dialog-head"><h2 id="copy-delete-title">PDF-Kopien aus der App löschen</h2><button class="close-button" type="button" data-copy-later aria-label="Dialog schließen">×</button></div>
    <div class="dialog-body"><p id="copy-delete-summary" class="ad-section-copy"></p>
    <p id="copy-delete-never" class="ad-error" hidden>Dieser Zeitraum wurde noch nie als ZIP-Datei gesichert. Bitte zuerst eine ZIP-Datei erstellen, sichern und prüfen.</p>
    <p class="ad-error">Gelöschte PDFs sind aus der App für immer weg und lassen sich nicht wiederherstellen. Beim Speichern können Fehler passieren. Prüfe deshalb vorher die ZIP-Datei.</p>
    <ol class="ad-checklist"><li id="copy-delete-step-open">Die ZIP-Datei in der Dateien-App öffnen; ein Tippen entpackt sie in einen Ordner.</li><li id="copy-delete-step-count"></li><li>Ein oder zwei PDFs stichprobenartig öffnen und prüfen, ob sie vollständig und lesbar sind.</li></ol>
    <p class="ad-preview-note">Nur die Kopien in dieser App werden gelöscht. PDFs in der Dateien-App, auf dem Mac, auf USB-Sticks und in ZIP-Dateien bleiben unberührt. Die Einträge in der Einnahmenliste bleiben vollständig.</p>
    <label class="income-check"><input type="checkbox" id="copy-delete-checked"> Ich habe die ZIP-Datei geöffnet und geprüft</label>
    <div class="dialog-actions"><button class="secondary-button" type="button" data-copy-later>Später löschen</button><button class="primary-button" type="button" id="copy-delete-confirm" disabled></button></div></div>`;
  document.body.append(dialog);
  let pending = null,
    offered = null;
  function openDelete(target) {
    pending = target;
    const n = target.ids.length;
    $("copy-delete-summary").textContent = `${copiesText(n)} für ${periodText(target.period)}, zusammen ${formatSize(target.bytes)}.`;
    $("copy-delete-never").hidden = periodExported(exportLog(), target.period);
    $("copy-delete-step-count").textContent = `Im Ordner „Einwilligungen“ die PDFs zählen: Es müssen genau ${n} sein.`;
    $("copy-delete-step-open").textContent = target.zip
      ? `Die ZIP-Datei „${target.zip}“ in der Dateien-App öffnen; ein Tippen entpackt sie in einen Ordner.`
      : "Die ZIP-Datei dieses Zeitraums in der Dateien-App öffnen; ein Tippen entpackt sie in einen Ordner.";
    $("copy-delete-checked").checked = false;
    $("copy-delete-confirm").disabled = true;
    $("copy-delete-confirm").textContent = `${copiesText(n)} löschen`;
    dialog.showModal();
  }
  dialog.addEventListener("change", (event) => {
    if (event.target.id === "copy-delete-checked") $("copy-delete-confirm").disabled = !event.target.checked;
  });
  dialog.addEventListener("click", async (event) => {
    if (event.target.closest("[data-copy-later]")) {
      pending = null;
      dialog.close();
      return;
    }
    if (!event.target.closest("#copy-delete-confirm") || !pending || !$("copy-delete-checked").checked || !isUnlocked()) return;
    const target = pending,
      ids = target.ids.filter(allowed);
    if (!window.confirm(`Letzte Rückfrage: ${copiesText(ids.length)} für ${periodText(target.period)} endgültig aus der App löschen?`)) return;
    pending = null;
    dialog.close();
    try {
      await removeCopies(ids);
      notify(`${copiesText(ids.length)} aus der App gelöscht. Die Einträge in der Einnahmenliste bleiben erhalten.`);
      if (offered?.ids === target.ids) {
        offered = null;
        $("export-offer").hidden = true;
      }
    } catch (error) {
      notify("PDF-Kopien nicht gelöscht: " + error.message);
    }
    preview();
    usage();
  });

  document.getElementById("admin-app").addEventListener("change", (event) => {
    const key = { "export-kind": "kind", "export-month": "month", "export-year": "year", "export-from": "from", "export-to": "to", "export-type": "type" }[event.target.id];
    if (!key || !isUnlocked()) return;
    state[key] = event.target.value;
    if (key === "kind")
      document.querySelectorAll("[data-export-for]").forEach((el) => (el.hidden = el.dataset.exportFor !== state.kind));
    preview();
  });
  document.getElementById("admin-app").addEventListener("click", (event) => {
    if (!isUnlocked()) return;
    if (event.target.closest("#export-save")) save();
    if (event.target.closest("#export-offer-delete") && offered) openDelete(offered);
    if (event.target.closest("#export-offer-later")) {
      offered = null;
      $("export-offer").hidden = true;
    }
    if (event.target.closest("#export-delete") && prepared?.copies.length)
      openDelete({ ids: prepared.copies, period: prepared.period, bytes: prepared.copyBytes });
  });

  return {
    view,
    preview,
    usage,
    // Copies in the app, from the last sync; the income list reads it synchronously.
    copies: () => new Set([...archived].filter(allowed)),
    // Kept after the owner confirmed the filing; asks the browser not to evict the app's storage.
    // An entry removed or marked while the PDF was being written loses the copy right away.
    async keep(id, blob) {
      navigator.storage?.persist?.().catch(() => {});
      await archive.put(id, blob);
      if (allowed(id)) archived.add(id);
      else await archive.delete(id);
    },
    // The entries are re-read before each deletion: a PDF kept meanwhile (also by another window)
    // belongs to an entry that already exists, so it is never deleted.
    async sync() {
      for (const key of await archive.keys())
        if (allowed(key)) archived.add(key);
        else {
          await archive.delete(key);
          archived.delete(key);
        }
      if ($("export-preview")) preview();
      usage();
    },
    // From the last sync; the overview reads it synchronously.
    unexportedMonths: (log) => unexportedMonths(records(), archived, log, today()),
    async pdfs() {
      const out = [];
      for (const id of await archive.keys()) {
        const blob = allowed(id) ? await archive.get(id) : null;
        if (blob) out.push({ id, bytes: new Uint8Array(await blob.arrayBuffer()) });
      }
      return out;
    },
    // Restore writes the PDFs before the entries exist; the sync after the restore removes the rest.
    async restore(pdfs) {
      for (const { id, bytes } of pdfs) await archive.put(id, new Blob([bytes], { type: "application/pdf" }));
    },
  };
}
