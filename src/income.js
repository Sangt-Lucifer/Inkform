// Only financial references are persisted. No health answers, signatures or PDFs.
import { BASE_LANGUAGE, language, markup, t, th, translator } from "./i18n.js";
import { validCurrency } from "./languages.js";
import {
  ANONYMIZED,
  anonymizeRecord,
  dueForAnonymization,
  dueForPdfDeletion,
  readRetention,
  waitingForPdfDeletion,
  writeRetention,
  yearsBefore,
} from "./retention.js";
export const INCOME_KEY = "inkform.income.v1";
const incomeFields = [
  "id",
  "date",
  "artist",
  "customer",
  "totalCents",
  "depositCents",
  // Optional: the currency the amounts above were recorded in, so a later change to the studio's
  // currency does not relabel earlier entries. Missing on entries from before this field existed.
  "currency",
  "source",
  "updatedAt",
  // Optional: true when the income was booked although the signed PDF was not filed.
  "pdfMissing",
  // Optional dates (YYYY-MM-DD): PDF deleted in the Files app after the retention period;
  // name and PDF reference removed from this list.
  "pdfDeletedAt",
  "anonymizedAt",
  // Optional date: the copy kept in the app for the ZIP export was deleted on purpose. The PDF in
  // the Files app or elsewhere is not affected.
  "pdfRemovedAt",
];
export function incomeId() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `income_${Date.now()}_${Math.random().toString(36).slice(2)}`
  );
}
export function validateIncomeRecord(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !incomeFields.includes(k))
  )
    throw Error(t("income.invalidEntry"));
  const text = (key, max, required = false) => {
    const input = value[key];
    if (typeof input !== "string" || input.length > max || /[\u0000-\u001f\u007f]/.test(input))
      throw Error(t("income.invalidField", { feld: key }));
    const result = input.normalize("NFC").trim();
    if (required && !result)
      throw Error(key === "customer" ? t("income.nameMissing") : t("income.fieldMissing", { feld: key }));
    return result;
  };
  const row = {
    id: text("id", 100, true),
    date: text("date", 10, true),
    artist: text("artist", 100),
    customer: text("customer", 250, true),
    source: text("source", 400),
    updatedAt: text("updatedAt", 40, true),
  };
  if (
    !/^[a-zA-Z0-9_-]+$/.test(row.id) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
    !Number.isFinite(Date.parse(row.date)) ||
    new Date(row.date).toISOString().slice(0, 10) !== row.date ||
    !Number.isFinite(Date.parse(row.updatedAt))
  )
    throw Error(t("income.invalidIdDate"));
  for (const key of ["totalCents", "depositCents"]) {
    const amount = value[key];
    if (amount !== null && (!Number.isSafeInteger(amount) || amount < 0 || amount > 999999999))
      throw Error(t("income.invalidAmount"));
    row[key] = amount;
  }
  if (row.totalCents !== null && row.depositCents !== null && row.depositCents > row.totalCents)
    throw Error(t("price.depositTooHigh"));
  if ("pdfMissing" in value && typeof value.pdfMissing !== "boolean")
    throw Error(t("income.invalidPdfMissing"));
  // Stored only when set, so existing entries and backups stay unchanged.
  if (value.pdfMissing === true) row.pdfMissing = true;
  if (value.currency !== undefined) {
    if (typeof value.currency !== "string" || !validCurrency(value.currency))
      throw Error(t("income.invalidField", { feld: "currency" }));
    row.currency = value.currency;
  }
  for (const key of ["pdfDeletedAt", "anonymizedAt", "pdfRemovedAt"]) {
    if (value[key] === undefined || value[key] === null || value[key] === "") continue;
    if (
      typeof value[key] !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value[key]) ||
      !Number.isFinite(Date.parse(value[key]))
    )
      throw Error(t("income.invalidField", { feld: key }));
    row[key] = value[key];
  }
  // An anonymized entry stays anonymized: no name or PDF reference can be put back.
  if (row.anonymizedAt && (row.customer !== ANONYMIZED || row.source))
    throw Error(t("income.anonymizedNamed"));
  return row;
}
export function validateIncomeBackup(value) {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.records) ||
    value.records.length > 10000
  )
    throw Error(t("income.unsupportedBackup"));
  const records = value.records.map(validateIncomeRecord);
  if (new Set(records.map((r) => r.id)).size !== records.length)
    throw Error(t("income.duplicateIds"));
  return records;
}
// Anonymization is one-way: no write may turn an anonymized entry back into a named one.
function keepAnonymized(old, row) {
  if (old?.anonymizedAt && !row.anonymizedAt)
    throw Error(t("income.anonymizedRestore"));
  if (old?.pdfRemovedAt && !row.pdfRemovedAt)
    throw Error(t("income.copyRestore"));
}
export function createIncomeStore(storage) {
  function read() {
    const raw = storage.getItem(INCOME_KEY);
    if (!raw) return { raw, records: [] };
    return { raw, records: validateIncomeBackup(JSON.parse(raw)) };
  }
  function mutate(change) {
    const before = read();
    const records = change(before.records);
    const checked = validateIncomeBackup({ schemaVersion: 1, records });
    if (storage.getItem(INCOME_KEY) !== before.raw)
      throw Error(t("income.otherWindow"));
    storage.setItem(INCOME_KEY, JSON.stringify({ schemaVersion: 1, records: checked }));
    return checked;
  }
  return {
    list: () => read().records,
    add: (record) =>
      mutate((records) => {
        const row = validateIncomeRecord(record);
        // Confirming the same generated consent twice must not duplicate turnover.
        const old = records.find((r) => r.id === row.id);
        if (old && JSON.stringify(old) !== JSON.stringify(row))
          throw Error(
            t("income.conflict"),
          );
        return old ? records : [...records, row];
      }),
    update: (record, expectedTime) =>
      mutate((records) => {
        const row = validateIncomeRecord(record),
          old = records.find((r) => r.id === row.id);
        if (!old || old.updatedAt !== expectedTime)
          throw Error(t("income.changedOrRemoved"));
        keepAnonymized(old, row);
        return records.map((r) => (r.id === row.id ? row : r));
      }),
    // Several entries at once, all or nothing (retention actions). Each change names the
    // updatedAt it was based on; if any entry changed meanwhile (e.g. in another window), nothing
    // is written.
    updateMany: (changes) =>
      mutate((records) => {
        const changed = new Map();
        for (const { record, expected } of changes) {
          const row = validateIncomeRecord(record),
            old = records.find((r) => r.id === row.id);
          if (!old || old.updatedAt !== expected)
            throw Error(t("income.oneChanged"));
          keepAnonymized(old, row);
          changed.set(row.id, row);
        }
        return records.map((r) => changed.get(r.id) ?? r);
      }),
    remove: (id, expectedTime) =>
      mutate((records) => {
        const old = records.find((r) => r.id === id);
        if (!old || old.updatedAt !== expectedTime)
          throw Error(t("income.changed"));
        return records.filter((r) => r.id !== id);
      }),
    removeMany: (ids) => mutate((records) => records.filter((r) => !ids.includes(r.id))),
    merge: (backup) => {
      const incoming = validateIncomeBackup(backup);
      return mutate((records) => {
        const existing = new Map(records.map((r) => [r.id, r]));
        for (const row of incoming) {
          const old = existing.get(row.id);
          if (old && JSON.stringify(old) !== JSON.stringify(row))
            throw Error(
              t("income.mergeConflict"),
            );
          existing.set(row.id, row);
        }
        return [...existing.values()];
      });
    },
  };
}
function normalizeArtist(value) {
  return value.normalize("NFC").trim().toLowerCase();
}
export function selectIncome(
  records,
  { artist = "", unassigned = false, year = "", month = "" } = {},
) {
  return records
    .filter(
      (r) =>
        (unassigned
          ? !r.artist.trim()
          : !artist || normalizeArtist(r.artist) === normalizeArtist(artist)) &&
        (!year || r.date.slice(0, 4) === year) &&
        (!month || r.date.slice(5, 7) === month),
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.artist.localeCompare(b.artist, translator(BASE_LANGUAGE).locale) ||
        a.customer.localeCompare(b.customer, translator(BASE_LANGUAGE).locale),
    );
}

// The sum is shown in the current currency even if some entries were recorded under an earlier
// one (see validateIncomeRecord): changing currency is meant to happen before income exists.
export function summarizeIncome(records) {
  return {
    totalCents: records.reduce((sum, r) => sum + (r.totalCents ?? 0), 0),
    open: records.filter((r) => r.totalCents === null).length,
    count: records.length,
  };
}
export function incomeCsv(records) {
  const cell = (value) => {
    let text = String(value ?? "");
    if (/^\s*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const euros = (cents) =>
    cents === null ? "" : language().number(cents / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
  const rows = [
    [
      t("csv.date"),
      t("csv.artist"),
      t("csv.name"),
      t("csv.total"),
      t("csv.deposit"),
      t("csv.status"),
      t("csv.reference"),
    ],
    ...records.map((r) => [
      r.date,
      r.artist || t("common.unassigned"),
      r.customer,
      euros(r.totalCents),
      euros(r.depositCents),
      [
        t(r.totalCents === null ? "income.priceOpen" : "csv.priceSet"),
        r.pdfMissing && t("income.pdfMissing"),
        r.pdfDeletedAt && t("csv.pdfDeleted", { datum: r.pdfDeletedAt }),
        r.anonymizedAt && t("csv.anonymized", { datum: r.anonymizedAt }),
      ]
        .filter(Boolean)
        .join(" · "),
      r.source,
    ]),
  ];
  const summary = summarizeIncome(records);
  rows.push([t("csv.sum"), "", "", euros(summary.totalCents), "", t("income.pricesOpen", { anzahl: summary.open }), ""]);
  return "\uFEFF" + rows.map((row) => row.map(cell).join(";")).join("\r\n");
}

export function createIncomeFeature({
  storage,
  createPdf,
  drawLogo = () => false,
  unsupportedChars,
  escape,
  money,
  parseMoney,
  currency = () => undefined,
  today,
  notify,
  download,
  showReport,
  isUnlocked,
  onChange = () => {},
  copies = () => new Set(),
  removeCopy = () => {},
  hasCopy = async () => false,
  recordRemoved = (ids, write) => write(),
  beforeRemove = () => {},
}) {
  const store = createIncomeStore(storage);
  const filters = { artist: "", unassigned: false, year: today().slice(0, 4), month: "" };
  let editing = null,
    originalForm = "";
  const e = escape;
  const editor = document.createElement("dialog");
  editor.id = "income-editor";
  editor.setAttribute("aria-labelledby", "income-editor-title");
  editor.innerHTML = `<div class="dialog-head"><h2 id="income-editor-title">${th("income.editTitle")}</h2><button type="button" class="close-button" data-income-cancel aria-label="${th("common.closeDialog")}">×</button></div>
    <form id="income-edit-form" class="dialog-body" novalidate>
    <div class="ad-error" id="income-edit-error" role="alert" tabindex="-1" hidden></div>
    <div class="ad-fields">
      <div class="ad-field"><label for="income-date">${th("income.date")}</label><input id="income-date" name="date" type="date" required></div>
      <div class="ad-field"><label for="income-artist">${th("csv.artist")}</label><input id="income-artist" name="artist" maxlength="100" list="income-artists"><datalist id="income-artists"></datalist></div>
      <div class="ad-field full"><label for="income-customer">${th("income.customer")}</label><input id="income-customer" name="customer" maxlength="250" required></div>
      <div class="ad-field"><label for="income-total">${th("income.total")}</label><input id="income-total" name="total" inputmode="decimal" maxlength="10" placeholder="${th("income.totalPlaceholder")}"></div>
      <div class="ad-field"><label for="income-deposit">${th("income.deposit")}</label><input id="income-deposit" name="deposit" inputmode="decimal" maxlength="10"></div>
      <div class="ad-field full"><label for="income-source">${th("income.source")}</label><input id="income-source" name="source" maxlength="400"></div>
      <div class="ad-field full"><label class="income-check"><input id="income-pdf-missing" name="pdfMissing" type="checkbox"> ${th("income.pdfMissingLabel")}</label></div>
      <p class="ad-notice full" id="income-anonymized-note" hidden>${th("income.anonymizedNote")}</p>
    </div><p class="ad-section-copy">${th("income.editNote")}</p>
    <div class="dialog-actions"><button type="button" class="secondary-button" data-income-cancel>${th("common.cancel")}</button><button type="submit" class="primary-button">${th("income.save")}</button></div></form>`;
  document.body.append(editor);
  const editForm = editor.querySelector("form");
  const input = (key) => editor.querySelector(`[name="${key}"]`);
  const snapshot = () => JSON.stringify([...new FormData(editForm)]);
  editor
    .querySelectorAll("[data-income-cancel]")
    .forEach((b) => b.addEventListener("click", () => editor.close()));
  function failure(error) {
    const node = editor.querySelector("#income-edit-error");
    node.textContent = t("income.notSaved", { fehler: error.message });
    node.hidden = false;
    node.focus();
  }
  function openEdit(record) {
    editing = record || null;
    editor.querySelector("#income-editor-title").textContent = record
      ? t("income.editTitle")
      : t("income.addTitle");
    input("date").value = record?.date || today();
    for (const key of ["artist", "customer", "source"]) input(key).value = record?.[key] || "";
    input("pdfMissing").checked = !!record?.pdfMissing;
    const anonymized = !!record?.anonymizedAt;
    for (const key of ["customer", "source"]) input(key).readOnly = anonymized;
    editor.querySelector("#income-anonymized-note").hidden = !anonymized;
    for (const [key, field] of [
      ["total", "totalCents"],
      ["deposit", "depositCents"],
    ])
      input(key).value =
        record?.[field] == null ? "" : (record[field] / 100).toFixed(2).replace(".", ",");
    editor.querySelector("#income-artists").innerHTML = [
      ...new Set(
        store
          .list()
          .map((r) => r.artist)
          .filter(Boolean),
      ),
    ]
      .map((a) => `<option value="${e(a)}"></option>`)
      .join("");
    editor.querySelector("#income-edit-error").hidden = true;
    originalForm = snapshot();
    editor.showModal();
    input(record ? "total" : "date").focus();
  }
  editForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      if (!isUnlocked()) throw Error(t("income.locked"));
      const total = parseMoney(input("total").value),
        deposit = parseMoney(input("deposit").value);
      const row = validateIncomeRecord({
        id: editing?.id || incomeId(),
        date: input("date").value,
        artist: input("artist").value,
        customer: input("customer").value,
        totalCents: total,
        depositCents: deposit,
        source: input("source").value,
        updatedAt: new Date().toISOString(),
        pdfMissing: input("pdfMissing").checked,
        currency: editing?.currency ?? currency(),
        // Retention marks are kept when an entry is edited.
        pdfDeletedAt: editing?.pdfDeletedAt,
        anonymizedAt: editing?.anonymizedAt,
        pdfRemovedAt: editing?.pdfRemovedAt,
      });
      // "PDF fehlt" for an entry whose copy is in the app deletes that copy: warn, then record it
      // like any other deletion from the app (mark and permanent list), so no restore brings it back.
      const removesCopy = !!editing && row.pdfMissing && !editing.pdfMissing && !editing.pdfRemovedAt && (await hasCopy(row.id));
      if (
        removesCopy &&
        !window.confirm(
          t("income.missingRemovesCopy"),
        )
      )
        return;
      if (removesCopy) row.pdfRemovedAt = today();
      const write = () => (editing ? store.update(row, editing.updatedAt) : store.add(row));
      if (removesCopy) recordRemoved([row.id], write);
      else write();
      originalForm = snapshot();
      editor.close();
      refresh();
      notify(t("income.saved"));
    } catch (error) {
      failure(error);
    }
  });
  const picker = document.createElement("input");
  picker.id = "income-import-file";
  picker.type = "file";
  picker.accept = ".json,application/json";
  picker.hidden = true;
  document.body.append(picker);
  picker.addEventListener("change", async () => {
    try {
      if (!isUnlocked()) throw Error(t("income.locked"));
      const file = picker.files[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) throw Error(t("income.backupTooLarge"));
      const backup = JSON.parse(await file.text()),
        rows = validateIncomeBackup(backup);
      if (
        !window.confirm(
          t("income.importQuestion", { anzahl: rows.length }),
        )
      )
        return;
      store.merge(backup);
      refresh();
      notify(t("income.imported"));
    } catch (error) {
      notify(t("import.failed", { fehler: error.message }));
    } finally {
      picker.value = "";
    }
  });
  function filtered() {
    return selectIncome(store.list(), filters);
  }
  function option(value, label, selected) {
    return `<option value="${e(value)}"${value === selected ? " selected" : ""}>${e(label)}</option>`;
  }
  const dateDe = (iso) => language().date(iso, { day: "2-digit", month: "2-digit", year: "numeric" });
  function view() {
    try {
      if (!isUnlocked())
        return `<p class="ad-notice">${th("income.unlock")}</p>`;
      const all = store.list(),
        rows = selectIncome(all, filters),
        summary = summarizeIncome(rows),
        inApp = copies();
      const artistNames = new Map();
      for (const row of all)
        if (!artistNames.has(normalizeArtist(row.artist)))
          artistNames.set(normalizeArtist(row.artist), row.artist.trim());
      if (filters.artist && !artistNames.has(normalizeArtist(filters.artist)))
        artistNames.set(normalizeArtist(filters.artist), filters.artist);
      const artists = [...artistNames.values()].sort((a, b) => a.localeCompare(b, language().locale));
      const artistSelection = filters.unassigned
        ? "unassigned"
        : filters.artist
          ? "artist:" + artistNames.get(normalizeArtist(filters.artist))
          : "";
      const years = [...new Set([today().slice(0, 4), ...all.map((r) => r.date.slice(0, 4))])]
        .sort()
        .reverse();
      if (filters.year && !years.includes(filters.year)) years.push(filters.year);
      const daily = new Map();
      for (const r of rows) {
        const group = `${r.date}\0${normalizeArtist(r.artist)}`;
        const day = daily.get(group) || { date: r.date, artist: r.artist, records: [] };
        day.records.push(r);
        daily.set(group, day);
      }
      return `<section class="ad-panel"><div class="ad-panel-header"><h2>${th("income.title")}</h2></div><div class="ad-panel-body">
      <p class="ad-section-copy">${th("income.intro")}</p>
      <div class="income-filters">
      <label>${th("csv.artist")}<select id="income-filter-artist">${option("", t("income.allArtists"), artistSelection)}${artists
        .filter(Boolean)
        .map((a) => option("artist:" + a, a, artistSelection))
        .join(
          "",
        )}${artists.includes("") ? option("unassigned", t("common.unassigned"), artistSelection) : ""}</select></label>
      <label>${th("income.year")}<select id="income-filter-year">${option("", t("income.allYears"), filters.year)}${years.map((y) => option(y, y, filters.year)).join("")}</select></label>
      <label>${th("income.month")}<select id="income-filter-month">${option("", t("income.wholeYear"), filters.month)}${Array.from(
        { length: 12 },
        (_, i) => {
          const n = String(i + 1).padStart(2, "0");
          return option(
            n,
            language().dateTime(new Date(2000, i, 1), { month: "long" }),
            filters.month,
          );
        },
      ).join("")}</select></label></div>
      <div class="income-summary"><strong>${money(summary.totalCents)}<small>${th("income.sumKnown")}</small></strong><strong>${summary.count}<small>${th("income.consents")}</small></strong><strong>${summary.open}<small>${th("income.openNotInSum")}</small></strong></div>
      <div class="ad-actions-row income-actions"><button class="ad-button primary" data-income-action="add">${th("income.add")}</button><button class="ad-button" data-income-action="pdf"${rows.length ? "" : " disabled"}>${th("income.listPdf")}</button><button class="ad-button" data-income-action="csv"${rows.length ? "" : " disabled"}>${th("income.listCsv")}</button></div>
      <p class="ad-preview-note">${th("income.newNote")}</p>
      <div class="income-table-wrap"><table class="income-table"><caption>${th("income.tableCaption")}</caption><thead><tr><th>${th("pdf.appointment")}</th><th>${th("csv.artist")}</th><th>${th("csv.name")}</th><th>${th("income.colTotal")}</th><th>${th("income.colDeposit")}</th><th>${th("income.edit")}</th></tr></thead><tbody>${rows.length ? rows.map((r) => `<tr><td>${e(dateDe(r.date))}</td><td>${e(r.artist || t("common.unassigned"))}</td><td>${e(r.customer)}${r.pdfMissing ? ` <span class="income-open">${th("income.pdfMissing")}</span>` : ""}${r.source ? `<small>${e(r.source)}</small>` : ""}${r.pdfDeletedAt ? `<small>${th("income.pdfDeletedOn", { datum: dateDe(r.pdfDeletedAt) })}</small>` : ""}${r.pdfRemovedAt ? `<small>${th("income.pdfRemoved")}</small>` : ""}</td><td>${r.totalCents === null ? `<span class="income-open">${th("income.priceOpen")}</span>` : money(r.totalCents, r.currency)}</td><td>${r.depositCents === null ? "–" : money(r.depositCents, r.currency)}</td><td><button class="ad-button" data-income-edit="${e(r.id)}" aria-label="${th("income.editAria", { name: r.customer })}">${th("income.edit")}</button><button class="ad-button danger" data-income-remove="${e(r.id)}" aria-label="${th("income.removeAria", { name: r.customer })}">${th("editor.remove")}</button>${inApp.has(r.id) ? `<button class="ad-button" data-income-copy="${e(r.id)}" aria-label="${th("income.copyAria", { name: r.customer })}">${th("income.copyRemove")}</button>` : ""}</td></tr>`).join("") : `<tr><td colspan="6">${th("income.none")}</td></tr>`}</tbody></table></div>
      <details class="income-daily"><summary>${th("income.daily")}</summary><ul>${
        [...daily.values()]
          .map((day) => {
            const s = summarizeIncome(day.records);
            return `<li>${th(s.open ? "income.dayOpen" : "income.day", {
              datum: day.date,
              artist: day.artist || t("common.unassigned"),
              summe: markup(money(s.totalCents)),
              termine: s.count,
              anzahl: s.open,
            })}</li>`;
          })
          .join("") || `<li>${th("income.noEntries")}</li>`
      }</ul></details>
      <div class="ad-notice">${th("income.localNotice")}</div>
      <div class="ad-actions-row income-actions"><button class="ad-button" data-income-action="backup">${th("income.backupJson")}</button><button class="ad-button" data-income-action="import">${th("income.importBackup")}</button></div>
      </div></section>`;
    } catch (error) {
      return `<div class="ad-error" role="alert">${th("income.unavailable", { fehler: error.message })}</div>`;
    }
  }
  function refresh() {
    const host = document.getElementById("income-content");
    if (host) host.innerHTML = view();
    const retention = document.getElementById("retention-content");
    if (retention) retention.innerHTML = retentionView();
    onChange();
  }
  // Admin page "Aufbewahrung": deadlines, deletion list for consent PDFs, anonymization.
  function retentionView() {
    try {
      if (!isUnlocked())
        return `<p class="ad-notice">${th("income.unlock")}</p>`;
      const { pdfYears, incomeYears } = readRetention(storage),
        all = store.list(),
        day = today();
      const pdfDue = dueForPdfDeletion(all, pdfYears, day),
        anonDue = dueForAnonymization(all, incomeYears, day),
        waitingRows = waitingForPdfDeletion(all, incomeYears, day),
        waiting = waitingRows.length;
      const deleted = all.filter((r) => r.pdfDeletedAt).length,
        anonymized = all.filter((r) => r.anonymizedAt).length;
      const field = (id, label, value, help) =>
        `<div class="ad-field"><label for="${id}">${label}</label><input id="${id}" type="number" inputmode="numeric" min="1" max="50" step="1" placeholder="${th("retention.noDeadline")}" value="${value ?? ""}"><small>${help}</small></div>`;
      const pdfRows = pdfDue
        .map(
          (r) =>
            `<tr><td>${e(dateDe(r.date))}</td><td>${e(r.customer)}</td><td>${r.source ? e(r.source) : `<em>${th("retention.noFile")}</em>`}</td><td><button class="ad-button" data-retention-deleted="${e(r.id)}" aria-label="${th("retention.markAria", { name: r.customer })}">${th("retention.deleted")}</button></td></tr>`,
        )
        .join("");
      const anonRows = anonDue
        .slice(0, 50)
        .map(
          (r) =>
            `<tr><td>${e(dateDe(r.date))}</td><td>${e(r.artist || t("common.unassigned"))}</td><td>${e(r.customer)}</td><td>${r.totalCents === null ? th("income.priceOpen") : money(r.totalCents, r.currency)}</td></tr>`,
        )
        .join("");
      return `<section class="ad-panel"><div class="ad-panel-header"><h2>${th("retention.title")}</h2></div><div class="ad-panel-body">
      <p class="ad-section-copy">${th("retention.intro")}</p>
      <div class="ad-fields">${field("retention-pdf-years", th("retention.pdfYears"), pdfYears, th("retention.pdfYearsHelp"))}${field("retention-income-years", th("retention.incomeYears"), incomeYears, th("retention.incomeYearsHelp"))}</div>
      <div class="ad-actions-row"><button class="ad-button primary" data-retention-action="save">${th("retention.save")}</button></div>
      <p class="ad-preview-note">${th("retention.deviceOnly")}</p>
      </div></section>
      <section class="ad-panel"><div class="ad-panel-header"><h2>${th("retention.pdfList")}</h2><small>${th("retention.markedCount", { anzahl: deleted })}</small></div><div class="ad-panel-body">
      ${
        pdfYears === null
          ? `<p class="ad-notice">${th("retention.noPdfDeadline")}</p>`
          : `<p class="ad-section-copy">${th("retention.pdfDue", { datum: dateDe(yearsBefore(day, pdfYears)) })}</p>
      <div class="income-table-wrap"><table class="income-table" id="retention-pdf-list"><caption>${th("retention.dueCaption")}</caption><thead><tr><th>${th("pdf.appointment")}</th><th>${th("csv.name")}</th><th>${th("retention.fileName")}</th><th>${th("retention.done")}</th></tr></thead><tbody>${pdfRows || `<tr><td colspan="4">${th("retention.noneDue")}</td></tr>`}</tbody></table></div>`
      }
      </div></section>
      <section class="ad-panel"><div class="ad-panel-header"><h2>${th("retention.anonTitle")}</h2><small>${th("retention.anonCount", { anzahl: anonymized })}</small></div><div class="ad-panel-body">
      ${
        incomeYears === null
          ? `<p class="ad-notice">${th("retention.noAnonDeadline")}</p>`
          : `<p class="ad-section-copy">${th("retention.anonDue", { anzahl: anonDue.length, datum: dateDe(yearsBefore(day, incomeYears)), platzhalter: ANONYMIZED })}</p>
      ${
        waiting
          ? `<p class="ad-notice">${th("retention.waiting", { anzahl: waiting })}</p>
      <div class="income-table-wrap"><table class="income-table"><caption>${th(waiting > 50 ? "retention.waitingCaptionFirst" : "retention.waitingCaption")}</caption><thead><tr><th>${th("pdf.appointment")}</th><th>${th("csv.name")}</th><th>${th("retention.fileName")}</th><th>${th("retention.done")}</th></tr></thead><tbody>${waitingRows
            .slice(0, 50)
            .map(
              (r) =>
                `<tr><td>${e(dateDe(r.date))}</td><td>${e(r.customer)}</td><td>${r.source ? e(r.source) : `<em>${th("retention.noFile")}</em>`}</td><td><button class="ad-button" data-retention-deleted="${e(r.id)}" aria-label="${th("retention.markAria", { name: r.customer })}">${th("retention.pdfDeleted")}</button></td></tr>`,
            )
            .join("")}</tbody></table></div>`
          : ""
      }
      ${anonRows ? `<div class="income-table-wrap"><table class="income-table"><caption>${th(anonDue.length > 50 ? "retention.previewFirst" : "retention.preview")}</caption><thead><tr><th>${th("pdf.appointment")}</th><th>${th("csv.artist")}</th><th>${th("csv.name")}</th><th>${th("income.colTotal")}</th></tr></thead><tbody>${anonRows}</tbody></table></div>` : ""}
      <div class="ad-actions-row"><button class="ad-button" data-income-action="backup">${th("retention.backupFirst")}</button><button class="ad-button danger" data-retention-action="anonymize"${anonDue.length ? "" : " disabled"}>${th("retention.anonymize", { anzahl: anonDue.length })}</button></div>`
      }
      </div></section>`;
    } catch (error) {
      return `<div class="ad-error" role="alert">${th("retention.unavailable", { fehler: error.message })}</div>`;
    }
  }
  // Throws if a name contains characters the PDF font cannot print.
  function reportPdf(rows, scope) {
    const missing = unsupportedChars(rows.map((r) => r.artist + r.customer).join(""));
    if (missing.length)
      throw Error(t("report.unsupportedChars", { zeichen: missing.join(" ") }));
    const doc = createPdf({ unit: "mm", format: "a4" });
    let y = drawLogo(doc, 19, 10, 16) ? 34 : 20;
    const line = (text, bold = false) => {
      for (const part of doc.splitTextToSize(text, 172)) {
        if (y > 275) {
          doc.addPage();
          y = 20;
        }
        doc.setFont(doc.getFont().fontName, bold ? "bold" : "normal");
        doc.setFontSize(10);
        doc.text(part, 19, y);
        y += 6;
      }
    };
    line(t("report.title"), true);
    line(scope);
    line(t("report.basis"));
    y += 4;
    for (const r of rows) {
      line(
        [r.date, r.artist || t("common.unassigned"), r.customer, r.pdfMissing && t("income.pdfMissing")]
          .filter(Boolean)
          .join(" | "),
        true,
      );
      line(
        t("report.amounts", {
          gesamt: r.totalCents === null ? t("income.priceOpen") : money(r.totalCents, r.currency),
          anzahlung: r.depositCents === null ? t("report.notGiven") : money(r.depositCents, r.currency),
        }),
      );
      y += 3;
    }
    const s = summarizeIncome(rows);
    line(t("report.sum", { summe: money(s.totalCents), anzahl: s.open }), true);
    const pages = doc.getNumberOfPages();
    for (let n = 1; n <= pages; n++) {
      doc.setPage(n);
      doc.setFontSize(8);
      doc.text(t("report.footer", { seite: n, seiten: pages }), 19, 289);
    }
    return { blob: doc.output("blob"), pages };
  }
  function report(rows) {
    const { blob, pages } = reportPdf(
      rows,
      t("report.scope", {
        artist: filters.unassigned ? t("common.unassigned") : filters.artist || t("report.all"),
        jahr: filters.year || t("report.all"),
        monat: filters.month || t("report.all"),
      }),
    );
    showReport(
      blob,
      `${t("file.income")}_${filters.year || t("file.allYears")}_${filters.month || t("file.allMonths")}.pdf`,
      pages,
    );
  }
  document.getElementById("admin-app").addEventListener("change", (event) => {
    const key = {
      "income-filter-artist": "artist",
      "income-filter-year": "year",
      "income-filter-month": "month",
    }[event.target.id];
    if (key && isUnlocked()) {
      if (key === "artist") {
        filters.unassigned = event.target.value === "unassigned";
        filters.artist = event.target.value.startsWith("artist:")
          ? event.target.value.slice(7)
          : "";
      } else filters[key] = event.target.value;
      refresh();
    }
  });
  document.getElementById("admin-app").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || !isUnlocked()) return;
    try {
      if (button.dataset.retentionDeleted) {
        const row = store.list().find((r) => r.id === button.dataset.retentionDeleted);
        if (
          row &&
          window.confirm(
            row.source
              ? t("retention.confirmFile", { datei: row.source })
              : t("retention.confirmName", { name: row.customer }),
          )
        ) {
          store.updateMany([
            {
              record: { ...row, pdfDeletedAt: today(), updatedAt: new Date().toISOString() },
              expected: row.updatedAt,
            },
          ]);
          refresh();
          notify(t("retention.marked"));
        }
      }
      if (button.dataset.retentionAction === "save") {
        writeRetention(storage, {
          pdfYears: document.getElementById("retention-pdf-years").value,
          incomeYears: document.getElementById("retention-income-years").value,
        });
        refresh();
        notify(t("retention.saved"));
      }
      if (button.dataset.retentionAction === "anonymize") {
        const day = today(),
          rows = dueForAnonymization(store.list(), readRetention(storage).incomeYears, day);
        if (
          rows.length &&
          window.confirm(
            t("retention.anonQuestion", { anzahl: rows.length }),
          )
        ) {
          store.updateMany(rows.map((r) => ({ record: anonymizeRecord(r, day), expected: r.updatedAt })));
          refresh();
          notify(t("retention.anonDone", { anzahl: rows.length }));
        }
      }
      if (button.dataset.incomeCopy) {
        const row = store.list().find((r) => r.id === button.dataset.incomeCopy);
        if (row) removeCopy(row);
      }
      if (button.dataset.incomeEdit)
        openEdit(store.list().find((r) => r.id === button.dataset.incomeEdit));
      if (button.dataset.incomeRemove) {
        const row = store.list().find((r) => r.id === button.dataset.incomeRemove);
        if (
          row &&
          window.confirm(
            t("income.removeQuestion", { name: row.customer, datum: row.date }),
          )
        ) {
          beforeRemove([row]);
          store.remove(row.id, row.updatedAt);
          refresh();
        }
      }
      switch (button.dataset.incomeAction) {
        case "add":
          openEdit();
          break;
        case "backup":
          download(
            new Blob([JSON.stringify({ schemaVersion: 1, records: store.list() }, null, 2)], {
              type: "application/json",
            }),
            `${t("file.incomeBackup")}_${today()}.json`,
          );
          break;
        case "import":
          picker.click();
          break;
        case "csv":
          download(
            new Blob([incomeCsv(filtered())], { type: "text/csv;charset=utf-8" }),
            `${t("file.income")}_${filters.year || t("file.all")}_${filters.month || t("file.all")}.csv`,
          );
          break;
        case "pdf":
          report(filtered());
          break;
      }
    } catch (error) {
      notify("Einnahmen: " + error.message);
    }
  });
  window.addEventListener("storage", (event) => {
    if (event.key === INCOME_KEY) refresh();
  });
  return {
    view,
    retentionView,
    list: () => store.list(),
    reportPdf: (rows, scope) => reportPdf(rows, scope).blob,
    removeMany(ids) {
      beforeRemove(store.list().filter((r) => ids.includes(r.id)));
      store.removeMany(ids);
      refresh();
    },
    refresh,
    // Marks entries whose copy in the app is deleted: only in the confirmed state (entries:
    // { id, updatedAt }), all or nothing. The caller refreshes once everything is written.
    markCopiesRemoved(entries, day) {
      const now = new Date().toISOString(),
        list = store.list();
      store.updateMany(
        entries.map(({ id, updatedAt }) => {
          const r = list.find((row) => row.id === id);
          if (!r || r.pdfRemovedAt) throw Error(t("income.oneChanged"));
          return { record: { ...r, pdfRemovedAt: day, updatedAt: now }, expected: updatedAt };
        }),
      );
    },
    lock() {
      editor.close();
      refresh();
    },
    hasUnsavedChanges: () => editor.open && snapshot() !== originalForm,
    capture(data, source, id) {
      return validateIncomeRecord({
        id,
        date: data.fields.appointment,
        artist: data.fields.artist,
        customer: `${data.fields.firstName} ${data.fields.lastName}`.trim(),
        totalCents: parseMoney(data.fields.totalPrice),
        depositCents: parseMoney(data.fields.depositPaid),
        currency: currency(),
        source,
        updatedAt: new Date().toISOString(),
      });
    },
    // Books a prepared entry exactly once. Returns false if this consent was already booked
    // (e.g. confirmation repeated after a reload), without changing the existing entry.
    book(record, { pdfMissing = false } = {}) {
      if (store.list().some((r) => r.id === record.id)) return false;
      store.add(validateIncomeRecord({ ...record, pdfMissing }));
      refresh();
      return true;
    },
  };
}
