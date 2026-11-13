// ZIP export of a period: consent PDFs kept on this device and the income list.
// The PDFs live in their own IndexedDB database, keyed by the income entry's id; a PDF is kept only
// while its entry may still have a PDF (see exportable), sync() removes all others.
import { fileSlug } from "./consent.js";
import { BASE_LANGUAGE, applyTexts, language, t, textsInAllLanguages, th, translator } from "./i18n.js";
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
export const EXPORT_TYPES = { all: "export.type.all", consents: "export.type.consents", income: "export.type.income" };

// Calendar day YYYY-MM-DD that really exists (no 30 February).
function checkedDay(text, label) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text ?? ""),
    d = m && new Date(Date.UTC(+m[1], m[2] - 1, +m[3]));
  if (!d || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== m[2] - 1 || d.getUTCDate() !== +m[3])
    throw Error(t("export.invalidDay", { feld: label }));
  return text;
}

// Inclusive local calendar days. Appointment dates are plain YYYY-MM-DD strings, so the time zone
// of the device never moves an entry into another period.
export function exportPeriod({ kind, month = "", year = "", from = "", to = "" }) {
  if (kind === "month") {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error(t("export.chooseMonth"));
    const [y, m] = month.split("-").map(Number),
      last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}`, label: month };
  }
  if (kind === "year") {
    if (!/^\d{4}$/.test(String(year))) throw Error(t("export.chooseYear"));
    return { from: `${year}-01-01`, to: `${year}-12-31`, label: String(year) };
  }
  if (kind === "range") {
    checkedDay(from, t("export.from"));
    checkedDay(to, t("export.to"));
    if (from > to) throw Error(t("export.fromAfterTo"));
    return { from, to, label: `${from}_bis_${to}` };
  }
  throw Error(t("export.unknownPeriod"));
}

export const previousMonth = (today) => {
  const [y, m] = today.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

// Anonymizing drops the "PDF fehlt" flag, so anonymized entries are excluded explicitly.
export const exportable = (r) => pdfMayExist(r) && !r.anonymizedAt && !r.pdfRemovedAt;

export function validateRemovedIds(value) {
  if (!Array.isArray(value) || value.length > 100000 || value.some((id) => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)))
    throw Error(t("export.invalidRemoved"));
  return [...new Set(value)];
}
export function readRemovedIds(storage) {
  return new Set(validateRemovedIds(JSON.parse(storage.getItem(PDF_REMOVED_KEY) || "[]")));
}
export function addRemovedIds(storage, ids) {
  storage.setItem(PDF_REMOVED_KEY, JSON.stringify(validateRemovedIds([...readRemovedIds(storage), ...ids])));
}

// Generated PDF names start with the file name of any language the app has.
let generatedFor = null,
  generatedRegex = null;
function generated() {
  const prefixes = textsInAllLanguages("file.consent");
  if (prefixes !== generatedFor) {
    const alternatives = prefixes.map((p) => p.normalize("NFC").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    generatedRegex = new RegExp(`^(?:${alternatives})_(.+)_\\d{4}-\\d{2}-\\d{2}_\\d{6}_[A-Z0-9]{4}\\.pdf$`, "u");
    generatedFor = prefixes;
  }
  return generatedRegex;
}
// "JJJJ-MM-TT_Nachname_Vorname.pdf": the name part of the generated PDF name (as signed), otherwise
// the income entry's "Vorname Nachname".
export function consentFileName(record) {
  const words = record.customer.trim().split(/\s+/),
    name = record.source.normalize("NFC").match(generated())?.[1] ?? [words.at(-1), ...words.slice(0, -1)].join("_");
  return `${record.date}_${fileSlug(name) || t("file.unknown")}.pdf`;
}

// File systems may treat names case-insensitively and in any Unicode normalization (APFS).
export function uniqueNames(names) {
  const key = (name) => name.normalize("NFC").toLowerCase(),
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
    .sort((a, b) => a.date.localeCompare(b.date) || a.customer.localeCompare(b.customer, translator(BASE_LANGUAGE).locale) || a.id.localeCompare(b.id));
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
  if (!Array.isArray(value) || value.length > 1000) throw Error(t("export.invalidLog"));
  return value.map((entry) => {
    if (!entry || typeof entry.at !== "string" || !Object.hasOwn(EXPORT_TYPES, entry.type))
      throw Error(t("export.invalidLogEntry"));
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
  if (bytes < 1024 * 1024) return t("size.kb", { wert: Math.max(1, Math.ceil(bytes / 1024)) });
  return t("size.mb", { wert: language().number(bytes / 1024 / 1024, { maximumFractionDigits: 1 }) });
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
    dateDe = (iso) => language().date(iso, { day: "2-digit", month: "2-digit", year: "numeric" });
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
    // Ids whose copy may stay in the app; computed once per action (reading the list is not free).
    allowedIds = () => {
      const removed = removedIds();
      return new Set(records().filter((r) => exportable(r) && !removed.has(r.id)).map((r) => r.id));
    },
    allowed = (id) => allowedIds().has(id),
    periodText = (period) => t("export.period", { von: dateDe(period.from), bis: dateDe(period.to) }),
    copiesText = (n) => t("export.copies", { anzahl: n });

  async function prepare() {
    const period = exportPeriod(state),
      all = records(),
      ok = allowedIds(),
      plan = exportPlan(all, new Set(state.type === "income" ? [] : (await archive.keys()).filter((id) => ok.has(id))), period, state.type),
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
        const pdf = incomeReport(plan.income, t("export.reportScope", { zeitraum: periodText(period) }));
        files.push({ name: `${base}.pdf`, data: new Uint8Array(await pdf.arrayBuffer()) });
      } catch (error) {
        note = t("export.csvOnly", { fehler: error.message });
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
      copyEntries: copies.map((id) => ({ id, updatedAt: all.find((r) => r.id === id).updatedAt })),
      copyBytes,
      withoutPdf: plan.withoutPdf,
      removed: plan.removed,
      note,
      basis: JSON.stringify(all),
    };
  }

  function summary({ files, consents, withoutPdf, removed, note }) {
    if (!files.length)
      return [t("export.empty"), removed && t("export.emptyRemoved", { anzahl: removed })].filter(Boolean).join(" ");
    const pdfs = files.filter((f) => f.name.endsWith(".pdf")).length,
      csv = files.length - pdfs,
      size = files.reduce((sum, f) => sum + f.data.length, 0);
    return [
      t(csv ? "export.filesCsv" : "export.files", { anzahl: pdfs, groesse: formatSize(size) }),
      t("export.consentCount", { anzahl: consents }),
      withoutPdf && t("export.withoutPdf", { anzahl: withoutPdf }),
      removed && t("export.removed", { anzahl: removed }),
      note,
    ]
      .filter(Boolean)
      .join(" ");
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
    host.textContent = t("export.computing");
    try {
      const result = await prepare();
      if (current !== run) return;
      prepared = result;
      host.textContent = summary(result);
      host.classList.toggle("ad-warn", !result.files.length);
      button.disabled = !result.files.length;
      $("export-delete").disabled = !result.copies.length;
      $("export-delete").textContent = result.copies.length
        ? t("export.deletePeriod", { anzahl: result.copies.length })
        : result.type === "income"
          ? t("export.deleteChooseType")
          : t("export.noCopies");
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
      notify(t("export.changed"));
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
              ? t("export.downloaded", { datei: file.name })
              : t("export.shared", { datei: file.name });
          if (ready.copies.length) {
            offered = { entries: ready.copyEntries, period: ready.period, bytes: ready.copyBytes, zip: file.name };
            $("export-offer-text").textContent = t("export.offer", { anzahl: ready.copies.length });
            $("export-offer").hidden = false;
          }
        },
        (error) =>
          (status.textContent =
            error.name === "AbortError"
              ? t("export.aborted")
              : t("export.dialogFailed")),
      )
      .finally(() => (sharing = false));
  }

  function view() {
    if (!isUnlocked()) return `<p class="ad-notice">${th("income.unlock")}</p>`;
    const option = (value, label, selected) =>
      `<option value="${e(value)}"${value === selected ? " selected" : ""}>${e(label)}</option>`;
    const field = (kind, html) => `<label data-export-for="${kind}"${state.kind === kind ? "" : " hidden"}>${html}</label>`;
    return `<section class="ad-panel"><div class="ad-panel-header"><h2>${th("export.zipTitle")}</h2></div><div class="ad-panel-body">
      <p class="ad-section-copy">${th("export.intro")}</p>
      <div class="income-filters">
      <label>${th("export.periodLabel")}<select id="export-kind">${option("month", t("export.kind.month"), state.kind)}${option("year", t("export.kind.year"), state.kind)}${option("range", t("export.kind.range"), state.kind)}</select></label>
      ${field("month", `${th("income.month")}<input id="export-month" type="month" value="${e(state.month)}">`)}
      ${field("year", `${th("income.year")}<input id="export-year" type="number" inputmode="numeric" min="2000" max="2100" value="${e(state.year)}">`)}
      ${field("range", `${th("export.from")}<input id="export-from" type="date" value="${e(state.from)}">`)}
      ${field("range", `${th("export.to")}<input id="export-to" type="date" value="${e(state.to)}">`)}
      <label>${th("export.documents")}<select id="export-type">${Object.entries(EXPORT_TYPES)
        .map(([value, label]) => option(value, t(label), state.type))
        .join("")}</select></label></div>
      <p id="export-preview" class="ad-section-copy" role="status" aria-live="polite"></p>
      <div class="ad-actions-row"><button class="ad-button primary" type="button" id="export-save" disabled>${th("export.save")}</button></div>
      <p id="export-status" class="ad-preview-note" role="status"></p>
      <div id="export-offer" class="ad-notice" hidden><p id="export-offer-text"></p><div class="ad-actions-row"><button class="ad-button danger" type="button" id="export-offer-delete">${th("export.checkDelete")}</button><button class="ad-button" type="button" id="export-offer-later">${th("export.later")}</button></div></div>
      </div></section>
      <section class="ad-panel"><div class="ad-panel-header"><h2>${th("export.copiesTitle")}</h2></div><div class="ad-panel-body">
      <p id="copies-usage" class="ad-section-copy" role="status">${th("export.usageComputing")}</p>
      <p class="ad-section-copy">${th("export.copiesIntro")}</p>
      <div class="ad-actions-row"><button class="ad-button danger" type="button" id="export-delete" disabled>${th("export.deleteButton")}</button></div>
      </div></section>`;
  }

  // Shows the number and size of the copies; the period choice above also selects what to delete.
  async function usage() {
    const host = $("copies-usage");
    if (!host) return;
    try {
      const ok = allowedIds(),
        sizes = [...(await archive.sizes())].filter(([id]) => ok.has(id)),
        bytes = sizes.reduce((sum, [, size]) => sum + size, 0);
      host.textContent = [
        t("export.usage", { anzahl: sizes.length, groesse: sizes.length ? formatSize(bytes) : t("size.kb", { wert: 0 }) }),
        bytes >= COPY_HINT_BYTES && t("export.usageHigh"),
      ]
        .filter(Boolean)
        .join(" ");
      host.classList.toggle("ad-warn", bytes >= COPY_HINT_BYTES);
    } catch (error) {
      host.textContent = t("export.usageFailed", { fehler: error.message });
    }
  }

  // Check step before deleting: warning, instructions, a ticked box, then a last question.
  const dialog = document.createElement("dialog");
  dialog.id = "copy-delete-dialog";
  dialog.setAttribute("aria-labelledby", "copy-delete-title");
  dialog.innerHTML = `<div class="dialog-head"><h2 id="copy-delete-title" data-t="export.dialogTitle"></h2><button class="close-button" type="button" data-copy-later data-t-aria-label="common.closeDialog">×</button></div>
    <div class="dialog-body"><p id="copy-delete-summary" class="ad-section-copy"></p>
    <p id="copy-delete-never" class="ad-error" hidden data-t="export.neverSaved"></p>
    <p class="ad-error" data-t="export.dialogWarning"></p>
    <ol class="ad-checklist"><li id="copy-delete-step-open"></li><li id="copy-delete-step-count"></li><li data-t="export.stepSample"></li></ol>
    <p class="ad-preview-note" data-t="export.dialogNote"></p>
    <label class="income-check"><input type="checkbox" id="copy-delete-checked"> <span data-t="export.checked"></span></label>
    <div class="dialog-actions"><button class="secondary-button" type="button" data-copy-later data-t="export.later"></button><button class="primary-button" type="button" id="copy-delete-confirm" disabled></button></div></div>`;
  applyTexts(dialog);
  document.body.append(dialog);
  let pending = null,
    offered = null;
  function openDelete(target) {
    pending = target;
    const n = target.entries.length;
    applyTexts(dialog);
    $("copy-delete-summary").textContent = t("export.dialogSummary", {
      kopien: copiesText(n),
      zeitraum: periodText(target.period),
      groesse: formatSize(target.bytes),
    });
    $("copy-delete-never").hidden = periodExported(exportLog(), target.period);
    $("copy-delete-step-count").textContent = t("export.stepCount", { anzahl: n });
    $("copy-delete-step-open").textContent = target.zip
      ? t("export.stepOpenFile", { datei: target.zip })
      : t("export.stepOpen");
    $("copy-delete-checked").checked = false;
    $("copy-delete-confirm").disabled = true;
    $("copy-delete-confirm").textContent = t("export.deleteCount", { anzahl: n });
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
      n = target.entries.length;
    if (!window.confirm(t("export.lastQuestion", { kopien: copiesText(n), zeitraum: periodText(target.period) }))) return;
    pending = null;
    dialog.close();
    // Only exactly what was confirmed: every entry unchanged, still in the period, copy still kept.
    const ok = allowedIds(),
      now = new Map(records().map((r) => [r.id, r]));
    const unchanged = target.entries.every(({ id, updatedAt }) => {
      const r = now.get(id);
      return r && r.updatedAt === updatedAt && r.date >= target.period.from && r.date <= target.period.to && ok.has(id);
    });
    try {
      if (!unchanged) throw Error(t("export.changedNothingDeleted"));
      await removeCopies(target.entries);
      notify(t("export.deleted", { kopien: copiesText(n) }));
      if (offered === target) {
        offered = null;
        $("export-offer").hidden = true;
      }
    } catch (error) {
      notify(t("export.deleteFailed", { fehler: error.message }));
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
      openDelete({ entries: prepared.copyEntries, period: prepared.period, bytes: prepared.copyBytes });
  });

  return {
    view,
    preview,
    usage,
    // Copies in the app, from the last sync; the income list reads it synchronously.
    // Read from the store itself, not from this window's last sync.
    hasCopy: async (id) => allowed(id) && (await archive.keys()).includes(id),
    copies: () => {
      const ok = allowedIds();
      return new Set([...archived].filter((id) => ok.has(id)));
    },
    // Kept after the owner confirmed the filing; asks the browser not to evict the app's storage.
    // An entry removed or marked while the PDF was being written loses the copy right away.
    async keep(id, blob) {
      navigator.storage?.persist?.().catch(() => {});
      await archive.put(id, blob);
      if (allowed(id)) archived.add(id);
      else await archive.delete(id);
    },
    // An entry is re-read before its copy is deleted: a PDF kept meanwhile (also by another window)
    // belongs to an entry that already exists, so it is never deleted.
    async sync() {
      const ok = allowedIds();
      for (const key of await archive.keys())
        if (ok.has(key) || allowed(key)) archived.add(key);
        else {
          await archive.delete(key);
          archived.delete(key);
        }
      // Entries marked while the keys were read lose their copy in the same run.
      const now = allowedIds();
      for (const key of [...archived])
        if (!now.has(key) && !allowed(key)) {
          await archive.delete(key);
          archived.delete(key);
        }
      if ($("export-preview")) preview();
      usage();
    },
    // From the last sync; the overview reads it synchronously.
    unexportedMonths: (log) => unexportedMonths(records(), archived, log, today()),
    async pdfs() {
      const out = [],
        ok = allowedIds();
      for (const id of await archive.keys()) {
        const blob = ok.has(id) ? await archive.get(id) : null;
        if (blob) out.push({ id, bytes: new Uint8Array(await blob.arrayBuffer()) });
      }
      // Checked again at the end: an entry marked meanwhile must not end up in a backup.
      const now = allowedIds();
      return out.filter((p) => now.has(p.id));
    },
    // Restore writes the PDFs before the entries exist; the sync after the restore removes the rest.
    async restore(pdfs) {
      for (const { id, bytes } of pdfs) await archive.put(id, new Blob([bytes], { type: "application/pdf" }));
    },
  };
}
