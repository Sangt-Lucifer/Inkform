// Only financial references are persisted. No health answers, signatures or PDFs.
import {
  ANONYMIZED,
  LAST_BACKUP_KEY,
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
  "source",
  "updatedAt",
  // Optional: true when the income was booked although the signed PDF was not filed.
  "pdfMissing",
  // Optional dates (YYYY-MM-DD): PDF deleted in the Files app after the retention period;
  // name and PDF reference removed from this list.
  "pdfDeletedAt",
  "anonymizedAt",
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
    throw Error("Ungültiger Einnahmeneintrag; es sind nur die vorgesehenen Finanzangaben erlaubt.");
  const text = (key, max, required = false) => {
    const input = value[key];
    if (typeof input !== "string" || input.length > max || /[\u0000-\u001f\u007f]/.test(input))
      throw Error(`Ungültige Angabe: ${key}.`);
    const result = input.normalize("NFC").trim();
    if (required && !result)
      throw Error(`Bitte ${key === "customer" ? "den Namen" : key} ergänzen.`);
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
    throw Error("Kennung, Datum oder Änderungszeit ist ungültig.");
  for (const key of ["totalCents", "depositCents"]) {
    const amount = value[key];
    if (amount !== null && (!Number.isSafeInteger(amount) || amount < 0 || amount > 999999999))
      throw Error("Beträge müssen gültige Eurobeträge mit höchstens zwei Nachkommastellen sein.");
    row[key] = amount;
  }
  if (row.totalCents !== null && row.depositCents !== null && row.depositCents > row.totalCents)
    throw Error("Die Anzahlung darf die Gesamtkosten nicht überschreiten.");
  if ("pdfMissing" in value && typeof value.pdfMissing !== "boolean")
    throw Error("Ungültige Angabe: pdfMissing.");
  // Stored only when set, so existing entries and backups stay unchanged.
  if (value.pdfMissing === true) row.pdfMissing = true;
  for (const key of ["pdfDeletedAt", "anonymizedAt"]) {
    if (value[key] === undefined || value[key] === null || value[key] === "") continue;
    if (
      typeof value[key] !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value[key]) ||
      !Number.isFinite(Date.parse(value[key]))
    )
      throw Error(`Ungültige Angabe: ${key}.`);
    row[key] = value[key];
  }
  // An anonymized entry stays anonymized: no name or PDF reference can be put back.
  if (row.anonymizedAt && (row.customer !== ANONYMIZED || row.source))
    throw Error(`Ein anonymisierter Eintrag darf keinen Namen und keinen PDF-Dateinamen enthalten.`);
  return row;
}
export function validateIncomeBackup(value) {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.records) ||
    value.records.length > 10000
  )
    throw Error("Keine unterstützte Einnahmensicherung (Version 1, maximal 10.000 Einträge).");
  const records = value.records.map(validateIncomeRecord);
  if (new Set(records.map((r) => r.id)).size !== records.length)
    throw Error("Die Sicherung enthält doppelte Eintragskennungen.");
  return records;
}
// Anonymization is one-way: no write may turn an anonymized entry back into a named one.
function keepAnonymized(old, row) {
  if (old?.anonymizedAt && !row.anonymizedAt)
    throw Error("Ein anonymisierter Eintrag kann nicht wiederhergestellt werden.");
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
      throw Error("Die Liste wurde in einem anderen Fenster geändert. Bitte erneut öffnen.");
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
            "Für diese Einwilligung ist bereits ein abweichender Eintrag gespeichert. Bitte den vorhandenen Eintrag bearbeiten.",
          );
        return old ? records : [...records, row];
      }),
    update: (record, expectedTime) =>
      mutate((records) => {
        const row = validateIncomeRecord(record),
          old = records.find((r) => r.id === row.id);
        if (!old || old.updatedAt !== expectedTime)
          throw Error("Dieser Eintrag wurde inzwischen geändert oder entfernt. Bitte neu öffnen.");
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
            throw Error("Ein Eintrag wurde inzwischen geändert oder entfernt. Bitte neu öffnen.");
          keepAnonymized(old, row);
          changed.set(row.id, row);
        }
        return records.map((r) => changed.get(r.id) ?? r);
      }),
    remove: (id, expectedTime) =>
      mutate((records) => {
        const old = records.find((r) => r.id === id);
        if (!old || old.updatedAt !== expectedTime)
          throw Error("Dieser Eintrag wurde inzwischen geändert. Bitte neu öffnen.");
        return records.filter((r) => r.id !== id);
      }),
    merge: (backup) => {
      const incoming = validateIncomeBackup(backup);
      return mutate((records) => {
        const existing = new Map(records.map((r) => [r.id, r]));
        for (const row of incoming) {
          const old = existing.get(row.id);
          if (old && JSON.stringify(old) !== JSON.stringify(row))
            throw Error(
              "Die Sicherung enthält einen inzwischen abweichenden Eintrag. Es wurde nichts überschrieben.",
            );
          existing.set(row.id, row);
        }
        return [...existing.values()];
      });
    },
  };
}
function normalizeArtist(value) {
  return value.normalize("NFC").trim().toLocaleLowerCase("de");
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
        a.artist.localeCompare(b.artist, "de") ||
        a.customer.localeCompare(b.customer, "de"),
    );
}

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
  const euros = (cents) => (cents === null ? "" : (cents / 100).toFixed(2).replace(".", ","));
  const rows = [
    [
      "Datum",
      "Artist",
      "Name",
      "Gesamtkosten EUR",
      "Anzahlung EUR (nicht zusätzlich summiert)",
      "Status",
      "PDF-Referenz",
    ],
    ...records.map((r) => [
      r.date,
      r.artist || "Nicht zugeordnet",
      r.customer,
      euros(r.totalCents),
      euros(r.depositCents),
      (r.totalCents === null ? "Preis offen" : "Preis erfasst") +
        (r.pdfMissing ? " · PDF fehlt" : "") +
        (r.pdfDeletedAt ? ` · PDF gelöscht ${r.pdfDeletedAt}` : "") +
        (r.anonymizedAt ? ` · anonymisiert ${r.anonymizedAt}` : ""),
      r.source,
    ]),
  ];
  const summary = summarizeIncome(records);
  rows.push([
    "Summe der bekannten Gesamtpreise EUR",
    "",
    "",
    euros(summary.totalCents),
    "",
    `${summary.open} Preise offen`,
    "",
  ]);
  return "\uFEFF" + rows.map((row) => row.map(cell).join(";")).join("\r\n");
}

export function createIncomeFeature({
  storage,
  createPdf,
  unsupportedChars,
  escape,
  money,
  parseMoney,
  today,
  notify,
  download,
  showReport,
  isUnlocked,
}) {
  const store = createIncomeStore(storage);
  const filters = { artist: "", unassigned: false, year: today().slice(0, 4), month: "" };
  let editing = null,
    originalForm = "";
  const e = escape;
  const editor = document.createElement("dialog");
  editor.id = "income-editor";
  editor.setAttribute("aria-labelledby", "income-editor-title");
  editor.innerHTML = `<div class="dialog-head"><h2 id="income-editor-title">Eintrag bearbeiten</h2><button type="button" class="close-button" data-income-cancel aria-label="Dialog schließen">×</button></div>
    <form id="income-edit-form" class="dialog-body" novalidate>
    <div class="ad-error" id="income-edit-error" role="alert" tabindex="-1" hidden></div>
    <div class="ad-fields">
      <div class="ad-field"><label for="income-date">Tattoo-Termin</label><input id="income-date" name="date" type="date" required></div>
      <div class="ad-field"><label for="income-artist">Artist</label><input id="income-artist" name="artist" maxlength="100" list="income-artists"><datalist id="income-artists"></datalist></div>
      <div class="ad-field full"><label for="income-customer">Name laut Einwilligung</label><input id="income-customer" name="customer" maxlength="250" required></div>
      <div class="ad-field"><label for="income-total">Gesamtkosten (€), optional</label><input id="income-total" name="total" inputmode="decimal" maxlength="10" placeholder="Preis noch offen"></div>
      <div class="ad-field"><label for="income-deposit">Anzahlung (€), optional</label><input id="income-deposit" name="deposit" inputmode="decimal" maxlength="10"></div>
      <div class="ad-field full"><label for="income-source">PDF-Dateiname / Referenz, optional</label><input id="income-source" name="source" maxlength="400"></div>
      <div class="ad-field full"><label class="income-check"><input id="income-pdf-missing" name="pdfMissing" type="checkbox"> PDF fehlt (unterschriebene Einwilligung nicht abgelegt)</label></div>
      <p class="ad-notice full" id="income-anonymized-note" hidden>Dieser Eintrag ist anonymisiert. Name und PDF-Dateiname lassen sich nicht wieder eintragen.</p>
    </div><p class="ad-section-copy">Die Änderung betrifft nur diese Übersicht. Ein bereits unterschriebenes PDF bleibt unverändert. Kein Gesamtpreis bedeutet „Preis offen“, nicht 0 €.</p>
    <div class="dialog-actions"><button type="button" class="secondary-button" data-income-cancel>Abbrechen</button><button type="submit" class="primary-button">Eintrag speichern</button></div></form>`;
  document.body.append(editor);
  const editForm = editor.querySelector("form");
  const input = (key) => editor.querySelector(`[name="${key}"]`);
  const snapshot = () => JSON.stringify([...new FormData(editForm)]);
  editor
    .querySelectorAll("[data-income-cancel]")
    .forEach((b) => b.addEventListener("click", () => editor.close()));
  function failure(error) {
    const node = editor.querySelector("#income-edit-error");
    node.textContent = "Nicht gespeichert: " + error.message;
    node.hidden = false;
    node.focus();
  }
  function openEdit(record) {
    editing = record || null;
    editor.querySelector("#income-editor-title").textContent = record
      ? "Eintrag bearbeiten"
      : "Ältere Einwilligung nachtragen";
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
  editForm.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      if (!isUnlocked()) throw Error("Bitte zuerst die Einnahmenansicht entsperren.");
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
        // Retention marks are kept when an entry is edited.
        pdfDeletedAt: editing?.pdfDeletedAt,
        anonymizedAt: editing?.anonymizedAt,
      });
      if (editing) store.update(row, editing.updatedAt);
      else store.add(row);
      originalForm = snapshot();
      editor.close();
      refresh();
      notify("Eintrag lokal gespeichert.");
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
      if (!isUnlocked()) throw Error("Bitte zuerst die Einnahmenansicht entsperren.");
      const file = picker.files[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) throw Error("Die Sicherung darf maximal 10 MB groß sein.");
      const backup = JSON.parse(await file.text()),
        rows = validateIncomeBackup(backup);
      if (
        !window.confirm(
          `${rows.length} Einträge aus der lokalen Einnahmensicherung übernehmen? Bestehende abweichende Einträge werden nicht überschrieben.`,
        )
      )
        return;
      store.merge(backup);
      refresh();
      notify("Einnahmensicherung lokal übernommen.");
    } catch (error) {
      notify("Import nicht möglich: " + error.message);
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
  function view() {
    try {
      if (!isUnlocked())
        return '<p class="ad-notice">Bitte den Admin-Bereich mit der Inhaber-PIN entsperren.</p>';
      const all = store.list(),
        rows = selectIncome(all, filters),
        summary = summarizeIncome(rows);
      const artistNames = new Map();
      for (const row of all)
        if (!artistNames.has(normalizeArtist(row.artist)))
          artistNames.set(normalizeArtist(row.artist), row.artist.trim());
      if (filters.artist && !artistNames.has(normalizeArtist(filters.artist)))
        artistNames.set(normalizeArtist(filters.artist), filters.artist);
      const artists = [...artistNames.values()].sort((a, b) => a.localeCompare(b, "de"));
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
      return `<section class="ad-panel"><div class="ad-panel-header"><h2>Einnahmen nach Gesamtpreis</h2></div><div class="ad-panel-body">
      <p class="ad-section-copy">Summiert wird der vereinbarte Gesamtpreis am Tattoo-Termin. Anzahlungen werden nicht zusätzlich gezählt. Dies ist eine Umsatzübersicht laut Einwilligungen, kein Nachweis tatsächlicher Zahlungseingänge oder des Artist-Gewinns.</p>
      <div class="income-filters">
      <label>Artist<select id="income-filter-artist">${option("", "Alle Artists", artistSelection)}${artists
        .filter(Boolean)
        .map((a) => option("artist:" + a, a, artistSelection))
        .join(
          "",
        )}${artists.includes("") ? option("unassigned", "Nicht zugeordnet", artistSelection) : ""}</select></label>
      <label>Jahr<select id="income-filter-year">${option("", "Alle Jahre", filters.year)}${years.map((y) => option(y, y, filters.year)).join("")}</select></label>
      <label>Monat<select id="income-filter-month">${option("", "Ganzes Jahr", filters.month)}${Array.from(
        { length: 12 },
        (_, i) => {
          const n = String(i + 1).padStart(2, "0");
          return option(
            n,
            new Intl.DateTimeFormat("de", { month: "long" }).format(new Date(2000, i, 1)),
            filters.month,
          );
        },
      ).join("")}</select></label></div>
      <div class="income-summary"><strong>${money(summary.totalCents)}<small>Summe bekannter Gesamtpreise</small></strong><strong>${summary.count}<small>Einwilligungen</small></strong><strong>${summary.open}<small>Preise offen – nicht in der Summe</small></strong></div>
      <div class="ad-actions-row income-actions"><button class="ad-button primary" data-income-action="add">Einwilligung nachtragen</button><button class="ad-button" data-income-action="pdf"${rows.length ? "" : " disabled"}>Gefilterte Liste als PDF</button><button class="ad-button" data-income-action="csv"${rows.length ? "" : " disabled"}>Gefilterte Liste als CSV</button></div>
      <p class="ad-preview-note">Neue Einwilligungen werden übernommen, sobald du als Inhaber die Ablage des unterschriebenen PDFs bestätigst. Ältere PDFs hier nachtragen; die App durchsucht keine Dateien-Ordner.</p>
      <div class="income-table-wrap"><table class="income-table"><caption>Einwilligungen im gewählten Zeitraum</caption><thead><tr><th>Termin</th><th>Artist</th><th>Name</th><th>Gesamtkosten</th><th>Anzahlung</th><th>Bearbeiten</th></tr></thead><tbody>${rows.length ? rows.map((r) => `<tr><td>${e(r.date.split("-").reverse().join("."))}</td><td>${e(r.artist || "Nicht zugeordnet")}</td><td>${e(r.customer)}${r.pdfMissing ? ' <span class="income-open">PDF fehlt</span>' : ""}${r.source ? `<small>${e(r.source)}</small>` : ""}${r.pdfDeletedAt ? `<small>PDF gelöscht am ${e(r.pdfDeletedAt.split("-").reverse().join("."))}</small>` : ""}</td><td>${r.totalCents === null ? '<span class="income-open">Preis offen</span>' : money(r.totalCents)}</td><td>${r.depositCents === null ? "–" : money(r.depositCents)}</td><td><button class="ad-button" data-income-edit="${e(r.id)}" aria-label="Eintrag für ${e(r.customer)} bearbeiten">Bearbeiten</button><button class="ad-button danger" data-income-remove="${e(r.id)}" aria-label="Eintrag für ${e(r.customer)} entfernen">Entfernen</button></td></tr>`).join("") : '<tr><td colspan="6">Keine Einwilligungen für diese Auswahl.</td></tr>'}</tbody></table></div>
      <details class="income-daily"><summary>Tagessummen je Artist</summary><ul>${
        [...daily.values()]
          .map((day) => {
            const s = summarizeIncome(day.records);
            return `<li>${e(day.date)} · ${e(day.artist || "Nicht zugeordnet")}: <strong>${money(s.totalCents)}</strong> · ${s.count} Termine${s.open ? ` · ${s.open} Preise offen` : ""}</li>`;
          })
          .join("") || "<li>Keine Einträge.</li>"
      }</ul></details>
      <div class="ad-notice">Diese Liste wird nur lokal in diesem Browser gespeichert. Browserdaten löschen oder ein Gerätewechsel können sie entfernen. Regelmäßig separat sichern. JSON- und HTML-Exporte der Studioeinstellungen enthalten diese Einnahmenliste nicht.</div>
      <div class="ad-actions-row income-actions"><button class="ad-button" data-income-action="backup">Alle Einnahmen als JSON sichern</button><button class="ad-button" data-income-action="import">Einnahmensicherung importieren</button></div>
      </div></section>`;
    } catch (error) {
      return `<div class="ad-error" role="alert">Einnahmenliste nicht verfügbar: ${e(error.message)} Vorhandene Daten werden nicht überschrieben.</div>`;
    }
  }
  function refresh() {
    const host = document.getElementById("income-content");
    if (host) host.innerHTML = view();
    const retention = document.getElementById("retention-content");
    if (retention) retention.innerHTML = retentionView();
  }
  const dateDe = (iso) => iso.split("-").reverse().join(".");
  // Admin page "Aufbewahrung": deadlines, deletion list for consent PDFs, anonymization.
  function retentionView() {
    try {
      if (!isUnlocked())
        return '<p class="ad-notice">Bitte den Admin-Bereich mit der Inhaber-PIN entsperren.</p>';
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
        `<div class="ad-field"><label for="${id}">${label}</label><input id="${id}" type="number" inputmode="numeric" min="1" max="50" step="1" placeholder="keine Frist" value="${value ?? ""}"><small>${help}</small></div>`;
      const pdfRows = pdfDue
        .map(
          (r) =>
            `<tr><td>${e(dateDe(r.date))}</td><td>${e(r.customer)}</td><td>${r.source ? e(r.source) : "<em>kein Dateiname</em>"}</td><td><button class="ad-button" data-retention-deleted="${e(r.id)}" aria-label="PDF für ${e(r.customer)} als gelöscht markieren">Gelöscht</button></td></tr>`,
        )
        .join("");
      const anonRows = anonDue
        .slice(0, 50)
        .map(
          (r) =>
            `<tr><td>${e(dateDe(r.date))}</td><td>${e(r.artist || "Nicht zugeordnet")}</td><td>${e(r.customer)}</td><td>${r.totalCents === null ? "Preis offen" : money(r.totalCents)}</td></tr>`,
        )
        .join("");
      return `<section class="ad-panel"><div class="ad-panel-header"><h2>Fristen</h2></div><div class="ad-panel-body">
      <p class="ad-section-copy">Die Fristen legt das Studio selbst fest, im Zweifel mit Datenschutz- oder Steuerberatung. Die App gibt keine Fristen vor und löscht nichts von selbst. Gezählt wird ab dem Tattoo-Termin. Ohne Frist wird nichts angezeigt.</p>
      <div class="ad-fields">${field("retention-pdf-years", "Einwilligungs-PDFs aufbewahren (Jahre)", pdfYears, "Danach erscheint das PDF in der Löschliste.")}${field("retention-income-years", "Namen in der Einnahmenliste behalten (Jahre)", incomeYears, "Danach können Name und PDF-Dateiname entfernt werden; Datum, Artist und Beträge bleiben.")}</div>
      <div class="ad-actions-row"><button class="ad-button primary" data-retention-action="save">Fristen speichern</button></div>
      <p class="ad-preview-note">Die Fristen gelten nur auf diesem Gerät und sind nicht Teil der Einstellungs-Sicherung.</p>
      </div></section>
      <section class="ad-panel"><div class="ad-panel-header"><h2>Löschliste: Einwilligungs-PDFs</h2><small>${deleted} bereits als gelöscht markiert</small></div><div class="ad-panel-body">
      ${
        pdfYears === null
          ? '<p class="ad-notice">Keine Frist eingetragen. Es wird nichts zur Löschung angezeigt.</p>'
          : `<p class="ad-section-copy">Termine vor dem ${e(dateDe(yearsBefore(day, pdfYears)))}. Die App kann Dateien in der Dateien-App nicht sehen und nicht löschen: Bitte jedes PDF dort löschen (auch in Sicherungen auf dem Mac) und erst dann hier als gelöscht markieren.</p>
      <div class="income-table-wrap"><table class="income-table" id="retention-pdf-list"><caption>Fällige Einwilligungs-PDFs</caption><thead><tr><th>Termin</th><th>Name</th><th>PDF-Dateiname</th><th>Erledigt</th></tr></thead><tbody>${pdfRows || '<tr><td colspan="4">Keine PDFs fällig.</td></tr>'}</tbody></table></div>`
      }
      </div></section>
      <section class="ad-panel"><div class="ad-panel-header"><h2>Einnahmenliste anonymisieren</h2><small>${anonymized} Einträge bereits anonymisiert</small></div><div class="ad-panel-body">
      ${
        incomeYears === null
          ? '<p class="ad-notice">Keine Frist eingetragen. Es wird nichts anonymisiert.</p>'
          : `<p class="ad-section-copy">${anonDue.length} Einträge mit Termin vor dem ${e(dateDe(yearsBefore(day, incomeYears)))}. Beim Anonymisieren werden Name und PDF-Dateiname durch „${ANONYMIZED}“ bzw. leer ersetzt; Datum, Artist und Beträge bleiben für Summen erhalten. Das lässt sich nicht rückgängig machen. Ältere JSON-Sicherungen enthalten die Namen weiterhin und müssen separat gelöscht werden.</p>
      ${
        waiting
          ? `<p class="ad-notice">${waiting} weitere Einträge warten, bis ihr PDF als gelöscht markiert ist. Bis dahin bleiben Name und Dateiname erhalten, damit das PDF in der Dateien-App auffindbar ist.</p>
      <div class="income-table-wrap"><table class="income-table"><caption>Warten auf PDF-Löschung${waiting > 50 ? " (erste 50)" : ""}</caption><thead><tr><th>Termin</th><th>Name</th><th>PDF-Dateiname</th><th>Erledigt</th></tr></thead><tbody>${waitingRows
            .slice(0, 50)
            .map(
              (r) =>
                `<tr><td>${e(dateDe(r.date))}</td><td>${e(r.customer)}</td><td>${r.source ? e(r.source) : "<em>kein Dateiname</em>"}</td><td><button class="ad-button" data-retention-deleted="${e(r.id)}" aria-label="PDF für ${e(r.customer)} als gelöscht markieren">PDF gelöscht</button></td></tr>`,
            )
            .join("")}</tbody></table></div>`
          : ""
      }
      ${anonRows ? `<div class="income-table-wrap"><table class="income-table"><caption>Vorschau${anonDue.length > 50 ? " (erste 50)" : ""}</caption><thead><tr><th>Termin</th><th>Artist</th><th>Name</th><th>Gesamtkosten</th></tr></thead><tbody>${anonRows}</tbody></table></div>` : ""}
      <div class="ad-actions-row"><button class="ad-button" data-income-action="backup">Vorher alle Einnahmen als JSON sichern</button><button class="ad-button danger" data-retention-action="anonymize"${anonDue.length ? "" : " disabled"}>${anonDue.length} Einträge anonymisieren</button></div>`
      }
      </div></section>`;
    } catch (error) {
      return `<div class="ad-error" role="alert">Aufbewahrung nicht verfügbar: ${e(error.message)}</div>`;
    }
  }
  function report(rows) {
    const missing = unsupportedChars(rows.map((r) => r.artist + r.customer).join(""));
    if (missing.length)
      throw Error(
        `Ein Name enthält Zeichen, die die PDF-Schrift nicht darstellen kann (${missing.join(" ")}). Bitte für diese Liste den CSV-Export verwenden.`,
      );
    const doc = createPdf({ unit: "mm", format: "a4" });
    let y = 20;
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
    line("%%reportStudio%% · Einnahmenübersicht", true);
    line(
      `Artist: ${filters.unassigned ? "Nicht zugeordnet" : filters.artist || "Alle"} | Jahr: ${filters.year || "Alle"} | Monat: ${filters.month || "Alle"}`,
    );
    line("Gesamtpreise laut Einwilligungen; keine Zahlungseingangs- oder Gewinnabrechnung.");
    y += 4;
    for (const r of rows) {
      line(
        `${r.date} | ${r.artist || "Nicht zugeordnet"} | ${r.customer}${r.pdfMissing ? " | PDF fehlt" : ""}`,
        true,
      );
      line(
        `Gesamtkosten: ${r.totalCents === null ? "Preis offen" : money(r.totalCents)} | Anzahlung (nur Info): ${r.depositCents === null ? "nicht angegeben" : money(r.depositCents)}`,
      );
      y += 3;
    }
    const s = summarizeIncome(rows);
    line(`Summe bekannter Gesamtpreise: ${money(s.totalCents)} | ${s.open} Preise offen`, true);
    const pages = doc.getNumberOfPages();
    for (let n = 1; n <= pages; n++) {
      doc.setPage(n);
      doc.setFontSize(8);
      doc.text(`Vertraulich · nur für den Inhaber | Seite ${n} von ${pages}`, 19, 289);
    }
    showReport(
      doc.output("blob"),
      `Inkform_Einnahmen_${filters.year || "alle-Jahre"}_${filters.month || "alle-Monate"}.pdf`,
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
            `Ist das PDF ${row.source ? `„${row.source}“` : `für ${row.customer}`} in der Dateien-App und in allen Sicherungen gelöscht?`,
          )
        ) {
          store.updateMany([
            {
              record: { ...row, pdfDeletedAt: today(), updatedAt: new Date().toISOString() },
              expected: row.updatedAt,
            },
          ]);
          refresh();
          notify("Als gelöscht markiert.");
        }
      }
      if (button.dataset.retentionAction === "save") {
        writeRetention(storage, {
          pdfYears: document.getElementById("retention-pdf-years").value,
          incomeYears: document.getElementById("retention-income-years").value,
        });
        refresh();
        notify("Fristen gespeichert.");
      }
      if (button.dataset.retentionAction === "anonymize") {
        const day = today(),
          rows = dueForAnonymization(store.list(), readRetention(storage).incomeYears, day);
        if (
          rows.length &&
          window.confirm(
            `${rows.length} Einträge anonymisieren? Name und PDF-Dateiname werden entfernt, Beträge bleiben. Das lässt sich nicht rückgängig machen. Hast du vorher eine Sicherung erstellt?`,
          )
        ) {
          store.updateMany(rows.map((r) => ({ record: anonymizeRecord(r, day), expected: r.updatedAt })));
          refresh();
          notify(`${rows.length} Einträge anonymisiert.`);
        }
      }
      if (button.dataset.incomeEdit)
        openEdit(store.list().find((r) => r.id === button.dataset.incomeEdit));
      if (button.dataset.incomeRemove) {
        const row = store.list().find((r) => r.id === button.dataset.incomeRemove);
        if (
          row &&
          window.confirm(
            `Eintrag für ${row.customer} vom ${row.date} aus der lokalen Übersicht entfernen? Das PDF bleibt erhalten.`,
          )
        ) {
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
            `Inkform_Einnahmen_Sicherung_${today()}.json`,
          );
          try {
            storage.setItem(LAST_BACKUP_KEY, new Date().toISOString());
          } catch (_) {}
          break;
        case "import":
          picker.click();
          break;
        case "csv":
          download(
            new Blob([incomeCsv(filtered())], { type: "text/csv;charset=utf-8" }),
            `Inkform_Einnahmen_${filters.year || "alle"}_${filters.month || "alle"}.csv`,
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
