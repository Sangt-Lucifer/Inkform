import { createAdminAccess } from "./access.js";
import { createIncomeFeature, incomeId } from "./income.js";
import { STUDIO_DEFAULTS, DEFAULT_SETTINGS } from "./defaults.js";
import { PDF_FONT, createPdfDocument, unsupportedPdfChars } from "./pdf-fonts.js";
import { createIndexedDbFiles, createPendingStore } from "./pending.js";
import { birthDateValid, fileSlug, moneyCents, studioInitials } from "./consent.js";
import {
  LAST_BACKUP_KEY,
  PENDING_REMINDER_DAYS,
  daysBetween,
  dueForPdfDeletion,
  readRetention,
} from "./retention.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
// Capture before input so HTML exports never include customer values.
const APP_SOURCE_HTML = "<!DOCTYPE html>\n" + document.documentElement.outerHTML;
let studio = { ...STUDIO_DEFAULTS };
let adminAccess = null,
  incomeFeature = null,
  pendingStore = null,
  consentIncomeId = incomeId();
const MEDICAL = clone(DEFAULT_SETTINGS.medical);
const LEGAL = clone(DEFAULT_SETTINGS.legal);
const SETTINGS_KEY = "inkform.settings.v1";
const OWNER_GUIDE_BASE64 = "__OWNER_GUIDE__";
const THEME_KEY = "inkform.theme.v1";
function validateSettings(value) {
  if (
    !value ||
    typeof value !== "object" ||
    value.schemaVersion !== 1 ||
    !value.studio ||
    !value.app
  )
    throw new Error("Diese Datei ist keine unterstützte INKFORM-Konfiguration (Version 1).");
  function string(input, label, max, required = false) {
    if (typeof input !== "string" || input.length > max)
      throw new Error(`${label}: Bitte Text mit maximal ${max} Zeichen angeben.`);
    const result = input.normalize("NFC").trim();
    if (required && !result) throw new Error(`${label}: Der Text darf nicht leer sein.`);
    return result;
  }
  const studio = Object.fromEntries(
    Object.keys(STUDIO_DEFAULTS).map((key) => [
      key,
      string(
        value.studio[key],
        `Studio / ${key}`,
        key === "retention" || key === "recipients"
          ? 2000
          : key === "address"
            ? 300
            : key === "location"
              ? 100
              : 160,
      ),
    ]),
  );
  if (studio.contact && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(studio.contact))
    throw new Error("Bitte eine gültige E-Mail-Adresse für den Datenschutzkontakt eingeben.");
  const maxLengths = {
    brand: 24,
    formVersion: 50,
    documentTitle: 120,
    eyebrow: 120,
    headline: 160,
    description: 1200,
    defaultArtist: 100,
    photoText: 8000,
    photoDeniedText: 4000,
    signatureText: 2000,
    privacyTemplate: 18000,
  };
  const app = Object.fromEntries(
    Object.keys(DEFAULT_SETTINGS.app).map((key) => [
      key,
      string(value.app[key], `Formular / ${key}`, maxLengths[key], key !== "defaultArtist"),
    ]),
  );
  function items(key) {
    const input = value[key],
      base = DEFAULT_SETTINGS[key];
    if (!Array.isArray(input) || input.length < base.length || input.length > 40)
      throw new Error(
        `${key === "medical" ? "Gesundheitsfragen" : "Einwilligungen"}: Standardfragen erhalten, maximal 40 Einträge.`,
      );
    const seen = new Set();
    const output = input.map((item) => {
      if (
        !item ||
        typeof item.id !== "string" ||
        (!base.some((b) => b.id === item.id) &&
          !/^custom(?:Medical|Legal)_[a-zA-Z0-9]+$/.test(item.id)) ||
        seen.has(item.id)
      )
        throw new Error("Eine Frage enthält eine ungültige oder doppelte Kennung.");
      seen.add(item.id);
      const result = { id: item.id, title: string(item.title, "Überschrift", 250, true) };
      if (key === "medical") result.hint = string(item.hint, "Erläuterung", 3000, true);
      else {
        result.text = string(item.text, "Erklärungstext", 8000, true);
        result.review = item.id === "privacy" ? true : !!item.review;
      }
      return result;
    });
    if (base.some((item) => !seen.has(item.id)))
      throw new Error("Die Konfiguration muss alle Standardfragen enthalten.");
    return output;
  }
  const medical = items("medical"),
    legal = items("legal");
  const ids = [...medical, ...legal].map((item) => item.id);
  if (new Set(ids).size !== ids.length)
    throw new Error("Fragen und Erklärungen benötigen eindeutige Kennungen.");
  return {
    schemaVersion: 1,
    savedAt:
      typeof value.savedAt === "string" && Number.isFinite(Date.parse(value.savedAt))
        ? value.savedAt
        : null,
    studio,
    app,
    medical,
    legal,
  };
}
let embeddedConfig = null,
  settings = clone(DEFAULT_SETTINGS),
  configLoadError = "";
try {
  embeddedConfig = JSON.parse(document.getElementById("inkform-config").textContent);
  if (embeddedConfig) settings = validateSettings(embeddedConfig);
} catch (_) {
  configLoadError = "Eingebettete Konfiguration ungültig. Standardvorlage wurde geladen.";
}
try {
  const saved = localStorage.getItem(SETTINGS_KEY);
  if (saved) {
    settings = validateSettings(JSON.parse(saved));
    // Adopt the studio profile only for a completely unconfigured older installation.
    // Existing studio details and individually edited form texts keep their values.
    const profileKeys = ["name", "address", "contact", "location"];
    if (profileKeys.every((key) => !settings.studio[key])) {
      for (const key of profileKeys) settings.studio[key] = STUDIO_DEFAULTS[key];
    }
  }
} catch (_) {
  configLoadError =
    "Lokale Einstellungen konnten nicht geladen werden. Die eingebettete Vorlage wird verwendet.";
}

const $ = (id) => document.getElementById(id);
const form = $("consent-form");
const localDate = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const dateFormat = (value) =>
  value
    ? new Intl.DateTimeFormat("de-DE").format(new Date(value + "T12:00:00"))
    : "Nicht angegeben";
const timeFormat = (date) =>
  new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "long" }).format(date);
const fieldValue = (id) => $(id).value.trim();
const choiceValue = (name) => form.querySelector(`input[name="${name}"]:checked`)?.value || "";
const normalizeText = (value) =>
  String(value ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .trim();
let toastTimer,
  pdfArtifact = null,
  pendingConsent = null,
  dirty = false;

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch],
  );
}
function renderQuestionnaire() {
  $("medical-questions").innerHTML = MEDICAL.map(
    (q) =>
      /* HTML */ `<fieldset class="question" id="q-${q.id}" aria-labelledby="title-${q.id}">
        <div class="question-top">
          <h3 class="question-title" id="title-${q.id}">
            ${escapeHtml(q.title)}<small>${escapeHtml(q.hint)}</small>
          </h3>
          <div class="radio-pair">
            <label class="choice"
              ><input
                type="radio"
                name="${q.id}"
                value="yes"
                required
                aria-label="${escapeHtml(q.title)}: Ja"
              /><span>Ja</span></label
            ><label class="choice"
              ><input
                type="radio"
                name="${q.id}"
                value="no"
                required
                aria-label="${escapeHtml(q.title)}: Nein"
              /><span>Nein</span></label
            >
          </div>
        </div>
        <div class="field details-field" id="details-${q.id}" hidden>
          <label for="note-${q.id}"
            >Falls bekannt, bitte ergänzen <span class="optional">optional</span></label
          ><textarea
            id="note-${q.id}"
            name="note-${q.id}"
            rows="2"
            maxlength="2000"
            placeholder="Welche Besonderheiten sind für deinen Artist wichtig?"
          ></textarea>
        </div>
      </fieldset>`,
  ).join("");
  $("legal-confirmations").innerHTML = LEGAL.map(
    (item) =>
      /* HTML */ `<label class="check-row legal-row${item.review ? " review-row" : ""}"
        ><input type="checkbox" name="${item.id}" id="${item.id}" required /><span
          class="check-text"
          >${
            item.review ? '<span class="inline-review">Vor Einsatz rechtlich prüfen</span>' : ""
          }<strong>${escapeHtml(item.title)}<span class="required">*</span></strong
          ><small>${escapeHtml(item.text)}</small></span
        ></label
      >`,
  ).join("");
}
renderQuestionnaire();
$("photo-text").textContent = settings.app.photoText;
$("appointment").value = localDate();
$("birthDate").max = localDate();

function privacyText() {
  return settings.app.privacyTemplate.replace(
    /\{\{studio\.(name|address|contact|location|retention|recipients)\}\}/g,
    (_, key) => studio[key] || "[Studioangabe ergänzen]",
  );
}
function renderStudio() {
  $("privacy-text").textContent = privacyText();
  $("studio-button-label").textContent = "Admin-Konsole";
  $("customer-studio-name").textContent = studio.name.split(" · ")[0];
  $("customer-studio-contact").textContent = [studio.name, studio.address]
    .filter(Boolean)
    .join(" · ");
}
renderStudio();
const canvas = $("signature-canvas");
const ctx = canvas.getContext("2d");
const ink = { strokes: [], active: null, signedAt: null, width: 1, height: 1, ratio: 1 };
function hasSignature() {
  return ink.strokes.some(
    (stroke) =>
      stroke.length > 1 &&
      stroke.some(
        (p, i) =>
          i &&
          Math.hypot((p.x - stroke[i - 1].x) * ink.width, (p.y - stroke[i - 1].y) * ink.height) > 1,
      ),
  );
}
function point(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    pressure: event.pointerType === "pen" ? Math.max(0.15, event.pressure || 0.5) : 0.5,
  };
}
function drawStroke(context, stroke, width, height) {
  if (!stroke.length) return;
  context.strokeStyle = "#242825";
  context.fillStyle = "#242825";
  context.lineCap = "round";
  context.lineJoin = "round";
  const scale = Math.min(width / ink.width, height / ink.height);
  if (stroke.length === 1) {
    const p = stroke[0];
    context.beginPath();
    context.arc(p.x * width, p.y * height, 1.05 * scale, 0, Math.PI * 2);
    context.fill();
    return;
  }
  for (let i = 1; i < stroke.length; i++) {
    const a = stroke[i - 1],
      b = stroke[i];
    context.lineWidth = (1.25 + (a.pressure + b.pressure) * 1.25) * scale;
    context.beginPath();
    context.moveTo(a.x * width, a.y * height);
    context.lineTo(b.x * width, b.y * height);
    context.stroke();
  }
}
function redraw() {
  ctx.clearRect(0, 0, ink.width, ink.height);
  ink.strokes.forEach((stroke) => drawStroke(ctx, stroke, ink.width, ink.height));
  $("signature-placeholder").hidden = ink.strokes.length > 0;
}
// Store normalized strokes so rotating the iPad does not erase the signature.
function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  ink.width = rect.width;
  ink.height = rect.height;
  ink.ratio = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(rect.width * ink.ratio);
  canvas.height = Math.round(rect.height * ink.ratio);
  ctx.setTransform(ink.ratio, 0, 0, ink.ratio, 0, 0);
  redraw();
}
new ResizeObserver(resizeCanvas).observe(canvas);
// Safari may reopen the blob URL after sharing; release it only on the next form.
function invalidatePdf() {
  if (!pdfArtifact) return;
  $("pdf-preview").removeAttribute("src");
  $("pdf-dialog").close();
  // Helper documents may be replaced; an unconfirmed consent stays available.
  if (pdfArtifact !== pendingConsent || pdfArtifact.confirmed) URL.revokeObjectURL(pdfArtifact.url);
  pdfArtifact = null;
  $("pdf-open").removeAttribute("href");
  $("pdf-download").removeAttribute("href");
}
function clearSignature(message = "") {
  ink.strokes = [];
  ink.active = null;
  ink.signedAt = null;
  redraw();
  $("signature-time").textContent = "Datum & Uhrzeit werden automatisch erfasst.";
  $("signature-error").textContent = message;
  $("signature-wrap").removeAttribute("aria-invalid");
  invalidatePdf();
  updateProgress();
}
canvas.addEventListener("pointerdown", (event) => {
  if (
    ink.active !== null ||
    (event.pointerType === "mouse" && event.button !== 0) ||
    !event.isPrimary
  )
    return;
  event.preventDefault();
  ink.active = event.pointerId;
  canvas.setPointerCapture(event.pointerId);
  ink.strokes.push([point(event)]);
  $("signature-error").textContent = "";
  dirty = true;
  invalidatePdf();
  redraw();
});
canvas.addEventListener("pointermove", (event) => {
  if (event.pointerId !== ink.active) return;
  event.preventDefault();
  const samples = event.getCoalescedEvents?.() || [event];
  const stroke = ink.strokes[ink.strokes.length - 1];
  (samples.length ? samples : [event]).forEach((sample) => stroke.push(point(sample)));

  const count = (samples.length || 1) + 1;
  drawStroke(ctx, stroke.slice(-count), ink.width, ink.height);
});
function finishStroke(event) {
  if (event.pointerId !== ink.active) return;
  if (event.type === "pointerup") ink.strokes[ink.strokes.length - 1].push(point(event));
  ink.active = null;
  if (hasSignature()) {
    ink.signedAt = new Date();
    $("signature-time").textContent = timeFormat(ink.signedAt);
    $("signature-wrap").removeAttribute("aria-invalid");
  }
  redraw();
  updateProgress();
}
["pointerup", "pointercancel", "lostpointercapture"].forEach((type) =>
  canvas.addEventListener(type, finishStroke),
);
$("clear-signature").addEventListener("click", () => clearSignature());
function signatureImage() {
  const output = document.createElement("canvas");
  output.width = 1500;
  output.height = Math.round((1500 * ink.height) / ink.width);
  const context = output.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, output.width, output.height);
  ink.strokes.forEach((stroke) => drawStroke(context, stroke, output.width, output.height));
  return { data: output.toDataURL("image/png"), ratio: output.height / output.width };
}
function birthValid() {
  return birthDateValid(fieldValue("birthDate"), localDate(), fieldValue("appointment"));
}
function isSectionComplete(id) {
  if (id === "signature") return hasSignature() && !!ink.signedAt;
  const section = $(id);
  const inputs = [
    ...section.querySelectorAll('input[required],textarea[required],input[type="email"]'),
  ];
  return (
    inputs.every((input) => {
      if (input.type === "radio") return !!choiceValue(input.name);
      if (input.type === "checkbox") return input.checked;
      return input.checkValidity() && (!input.required || !!input.value.trim());
    }) &&
    (id !== "personal" || (birthValid() && priceErrors().length === 0))
  );
}
const formatMoney = (cents) =>
  new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
function priceErrors() {
  const total = moneyCents(fieldValue("totalPrice"));
  const deposit = moneyCents(fieldValue("depositPaid"));
  const errors = [];
  if (Number.isNaN(total))
    errors.push({
      id: "totalPrice",
      message:
        "Gesamtkosten bitte als positiven Eurobetrag mit höchstens zwei Nachkommastellen ohne Tausendertrennzeichen eingeben, z. B. 450,00.",
    });
  if (Number.isNaN(deposit))
    errors.push({
      id: "depositPaid",
      message:
        "Anzahlung bitte als positiven Eurobetrag mit höchstens zwei Nachkommastellen ohne Tausendertrennzeichen eingeben, z. B. 100,00.",
    });
  if (deposit !== null && total === null)
    errors.push({
      id: "totalPrice",
      message: "Bitte zur Anzahlung auch die vereinbarten Gesamtkosten eintragen.",
    });
  if (Number.isFinite(total) && Number.isFinite(deposit) && deposit > total)
    errors.push({
      id: "depositPaid",
      message: "Die Anzahlung darf die Gesamtkosten nicht überschreiten.",
    });
  return errors;
}
function updatePriceBalance() {
  const total = moneyCents(fieldValue("totalPrice"));
  const deposit = moneyCents(fieldValue("depositPaid"));
  const valid = Number.isFinite(total) && Number.isFinite(deposit) && deposit <= total;
  $("price-balance").hidden = !valid;
  $("price-balance").textContent = valid
    ? `Offener Restbetrag: ${formatMoney(total - deposit)}`
    : "";
}
function updateProgress() {
  updatePriceBalance();
  let complete = 0;
  ["personal", "health", "consent", "signature"].forEach((id) => {
    const done = isSectionComplete(id);
    if (done) complete++;
    const status = document.querySelector(`[data-status="${id}"]`);
    status.textContent = done ? "Vollständig" : "Offen";
    status.classList.toggle("complete", done);
    document
      .querySelectorAll(`[data-step="${id}"]`)
      .forEach((link) => link.classList.toggle("done", done));
  });
  $("overall-label").textContent = `${complete} von 4 Abschnitten vollständig`;
  $("progress-fill").style.width = `${complete * 25}%`;
  $("progress").setAttribute("aria-valuenow", complete);
  $("export-status").textContent =
    complete === 4
      ? "Bereit zum Erstellen und Speichern."
      : `${complete} von 4 Abschnitten vollständig`;
  $("signature-name").textContent =
    [fieldValue("firstName"), fieldValue("lastName")].filter(Boolean).join(" ") ||
    "Dein Name erscheint hier";
}
form.addEventListener("input", (event) => {
  dirty = true;
  if (ink.strokes.length)
    clearSignature("Deine Angaben wurden geändert. Bitte unterschreibe erneut.");
  invalidatePdf();
  event.target.removeAttribute("aria-invalid");
  const q = event.target.closest(".question");
  q?.removeAttribute("aria-invalid");
  if (event.target.name === "photo") $("photo-fieldset").removeAttribute("aria-invalid");
  if (MEDICAL.some((q) => q.id === event.target.name)) {
    const value = choiceValue(event.target.name);
    const notes = $(`details-${event.target.name}`);
    notes.hidden = value !== "yes";

    if (value !== "yes") $(`note-${event.target.name}`).value = "";
  }
  $("medical-notice").hidden = !MEDICAL.some((q) => choiceValue(q.id) === "yes");
  updateProgress();
});

form.addEventListener("change", (event) => {
  if (event.target.type === "date") {
    if (ink.strokes.length)
      clearSignature("Deine Angaben wurden geändert. Bitte unterschreibe erneut.");
    dirty = true;
    invalidatePdf();
    updateProgress();
  }
});
function validate() {
  const errors = priceErrors();
  form.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
  const requireText = (id, label) => {
    if (!fieldValue(id)) errors.push({ id, message: `${label} bitte ausfüllen.` });
  };
  requireText("firstName", "Vorname");
  requireText("lastName", "Nachname");
  if (!fieldValue("birthDate"))
    errors.push({ id: "birthDate", message: "Geburtsdatum bitte angeben." });
  else if (!birthValid())
    errors.push({
      id: "birthDate",
      message:
        "Bitte prüfe das Geburtsdatum. Du musst heute und am Tattoo-Termin mindestens 18 Jahre alt sein (Geburtsjahr ab 1900).",
    });
  requireText("appointment", "Datum des Termins");
  requireText("artist", "Tätowierer / Artist");
  requireText("placement", "Körperstelle");
  requireText("motif", "Motiv / Beschreibung");
  if (fieldValue("email") && !$("email").checkValidity())
    errors.push({ id: "email", message: "Bitte eine gültige E-Mail-Adresse eingeben." });
  if (!$("sober").checked)
    errors.push({
      id: "sober",
      message: "Bitte bestätige, dass du aktuell nicht unter Alkohol- oder Drogeneinfluss stehst.",
    });
  MEDICAL.forEach((q) => {
    if (!choiceValue(q.id))
      errors.push({
        id: `q-${q.id}`,
        message: `Gesundheit: „${q.title}“ bitte mit Ja oder Nein beantworten.`,
      });
  });
  LEGAL.forEach((item) => {
    if (!$(item.id).checked)
      errors.push({ id: item.id, message: `Bitte bestätigen: ${item.title}` });
  });
  if (!choiceValue("photo"))
    errors.push({
      id: "photo-fieldset",
      message: "Bitte entscheide dich für oder gegen die Fotoverwendung.",
    });
  if (!hasSignature() || !ink.signedAt || ink.active !== null)
    errors.push({
      id: "signature-canvas",
      message: "Bitte unterschreibe mit einem vollständigen Schriftzug.",
    });
  const box = $("error-summary");
  box.replaceChildren();
  if (errors.length) {
    const title = document.createElement("strong");
    title.textContent = "Noch ein paar Angaben, bevor wir das PDF erstellen:";
    box.append(title);
    const list = document.createElement("ul");
    errors.forEach((error) => {
      const target = $(error.id);
      target.setAttribute("aria-invalid", "true");
      const li = document.createElement("li"),
        a = document.createElement("a");
      a.href = "#" + error.id;
      a.textContent = error.message;
      a.addEventListener("click", (event) => {
        event.preventDefault();
        const focus = target.matches("fieldset") ? target.querySelector("input") : target;
        focus.focus({ preventScroll: true });
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      li.append(a);
      list.append(li);
    });
    box.append(list);
    box.hidden = false;
    box.focus();
    box.scrollIntoView({ block: "start", behavior: "smooth" });
    return false;
  }
  box.hidden = true;
  return true;
}
const sections = [...form.querySelectorAll("section.card")];
const observer = new IntersectionObserver(
  (entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (!visible.length) return;
    document.querySelectorAll("[data-step]").forEach((link) => {
      if (link.dataset.step === visible[0].target.id) link.setAttribute("aria-current", "step");
      else link.removeAttribute("aria-current");
    });
  },
  { rootMargin: "-10% 0px -55% 0px", threshold: 0 },
);
sections.forEach((section) => observer.observe(section));
updateProgress();
function showDialog(id) {
  if (id === "reset-dialog")
    $("reset-save-warning").hidden = !pdfArtifact || pdfArtifact.isTest || pdfArtifact.confirmed;
  $(id).showModal();
}
document
  .querySelectorAll("[data-open]")
  .forEach((button) => button.addEventListener("click", () => showDialog(button.dataset.open)));
document
  .querySelectorAll("[data-close]")
  .forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
$("studio-open").addEventListener("click", openStudio);
function openStudio() {
  openAdmin("studio");
}
function toast(message) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").hidden = false;
  toastTimer = setTimeout(() => ($("toast").hidden = true), 5000);
}
function resetCustomerForm() {
  if (pendingConsent && !pendingConsent.confirmed) {
    showCompletion();
    return;
  }
  if (pendingConsent) {
    if (pdfArtifact === pendingConsent) invalidatePdf();
    else URL.revokeObjectURL(pendingConsent.url);
    pendingConsent = null;
  }
  consentIncomeId = incomeId();
  form.reset();
  $("appointment").value = localDate();
  clearSignature();
  dirty = false;
  MEDICAL.forEach((q) => ($(`details-${q.id}`).hidden = true));
  $("medical-notice").hidden = true;
  $("error-summary").hidden = true;
  form.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
  $("reset-dialog").close();
  updateProgress();
  window.scrollTo({ top: 0, behavior: "smooth" });
  toast("Neues Formular ist bereit.");
}
$("reset-confirm").addEventListener("click", resetCustomerForm);
window.addEventListener("beforeunload", (event) => {
  // A submitted consent whose PDF is stored on this device survives the reload: no warning.
  const safe = pendingConsent && !pendingConsent.keepError && (pendingConsent.restored || pendingConsent.keptOk);
  if ((dirty && !safe) || adminChanged() || incomeFeature?.hasUnsavedChanges()) {
    event.preventDefault();
    event.returnValue = "";
  }
});
function gatherData() {
  const ids = [
    "firstName",
    "lastName",
    "birthDate",
    "street",
    "postalCode",
    "city",
    "phone",
    "email",
    "appointment",
    "artist",
    "placement",
    "motif",
    "size",
    "medicationNotes",
    "totalPrice",
    "depositPaid",
  ];
  return {
    fields: Object.fromEntries(ids.map((id) => [id, normalizeText(fieldValue(id))])),
    medical: MEDICAL.map((q) => ({
      ...q,
      value: choiceValue(q.id),
      note: choiceValue(q.id) === "yes" ? normalizeText(fieldValue(`note-${q.id}`)) : "",
    })),
    legal: LEGAL.map((item) => ({ ...item, checked: $(item.id).checked })),
    photo: choiceValue("photo"),
    sober: $("sober").checked,
    studio: { ...studio },
    template: { ...settings.app },
    privacy: privacyText(),
    signedAt: new Date(ink.signedAt),
    createdAt: new Date(),
    signature: signatureImage(),
  };
}
function createPdf(data) {
  const doc = createPdfDocument(window.jspdf.jsPDF, {
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    compress: true,
    putOnlyUsedFonts: true,
  });
  const margin = 18,
    width = 174,
    bottom = 274;
  let y = 0;
  const red = [177, 48, 51],
    black = [36, 36, 36],
    grey = [106, 111, 124];
  const f = data.fields;
  const version = data.template?.formVersion || settings.app.formVersion;
  const fullName = `${f.firstName} ${f.lastName}`;
  const stamp = `${timeFormat(data.createdAt)} | UTC ${data.createdAt.toISOString()}`;
  const reference = `IF-${data.createdAt.toISOString().replace(/\D/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  doc.setProperties({
    title: `Tattoo-Einwilligung – ${fullName}`,
    subject: `Formular ${version} · ${reference}`,
    author: data.studio.name,
    creator: "INKFORM · lokale PDF-Erstellung",
  });
  doc.setCreationDate(data.createdAt);
  function font(size = 10, bold = false, color = black) {
    doc.setFont(PDF_FONT, bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
  }
  function header() {
    doc.setFillColor(244, 245, 248);
    doc.rect(0, 0, 210, 32, "F");
    font(16, true);
    doc.text(data.template?.brand || settings.app.brand, margin, 15);
    font(8, false, grey);
    doc.text("TATTOO-EINWILLIGUNG", margin, 22);
    font(8, false, grey);
    doc.text(reference, 192, 15, { align: "right" });
    doc.text(`Formularversion ${version}`, 192, 22, { align: "right" });
    y = 42;
  }
  function ensure(height) {
    if (y + height > bottom) {
      doc.addPage();
      header();
    }
  }
  function paragraph(text, { size = 10, bold = false, color = black, indent = 0, after = 3 } = {}) {
    font(size, bold, color);
    const lines = doc.splitTextToSize(normalizeText(text), width - indent);
    const lineHeight = size * 0.352778 * 1.4;
    for (const line of lines) {
      ensure(lineHeight + 1);
      font(size, bold, color);
      doc.text(line, margin + indent, y);
      y += lineHeight;
    }
    y += after;
  }
  function title(text) {
    ensure(17);
    y += 4;
    paragraph(text, { size: 12, bold: true, after: 4 });
  }
  function labelValue(label, value) {
    paragraph(`${label}: ${value || "Nicht angegeben"}`, { size: 10, after: 2 });
  }
  function review(text) {
    paragraph("VOR EINSATZ RECHTLICH PRÜFEN", { size: 8, bold: true, color: red, after: 1 });
    paragraph(text, { size: 9, color: red, after: 4 });
  }
  header();
  paragraph(data.template?.documentTitle || settings.app.documentTitle, {
    size: 20,
    bold: true,
    after: 5,
  });
  paragraph(`Studio: ${data.studio.name}`, { size: 10, bold: true });
  paragraph(`${data.studio.address} | ${data.studio.contact}`, { size: 9, color: grey });
  review(
    "ENTWURF: Haftungs-, Foto- und Datenschutzpassagen sind an das konkrete Studio anzupassen und vor Verwendung rechtlich zu prüfen. Das Unterschreiben dieses Entwurfs ersetzt diese Prüfung nicht.",
  );
  title("01 / Kundenangaben & Tattoo");
  labelValue("Vor- und Nachname", fullName);
  labelValue("Geburtsdatum", dateFormat(f.birthDate));
  labelValue(
    "Anschrift",
    [f.street, [f.postalCode, f.city].filter(Boolean).join(" ")].filter(Boolean).join(", "),
  );
  labelValue("Telefon", f.phone);
  labelValue("E-Mail", f.email);
  labelValue("Termin", dateFormat(f.appointment));
  labelValue("Tätowierer / Artist", f.artist);
  labelValue("Körperstelle", f.placement);
  labelValue("Ungefähre Größe", f.size);
  labelValue("Motiv / Beschreibung", f.motif);
  const total = moneyCents(f.totalPrice),
    deposit = moneyCents(f.depositPaid);
  if (Number.isFinite(total)) {
    ensure(30);
    paragraph("Preisvereinbarung", { size: 11, bold: true });
    labelValue("Vereinbarte Gesamtkosten (inkl. ggf. USt.)", formatMoney(total));
    if (Number.isFinite(deposit)) {
      labelValue("Bereits angezahlt", formatMoney(deposit));
      labelValue("Offener Restbetrag", formatMoney(total - deposit));
    }
  }
  title("02 / Medizinische Anamnese");
  paragraph(
    "Bestätigt: Ich stehe aktuell nicht unter Alkohol- oder Drogeneinfluss und kann frei über die Tätowierung entscheiden.",
    { size: 10, bold: true },
  );
  data.medical.forEach((q) => {
    ensure(19);
    paragraph(`${q.title}: ${q.value === "yes" ? "JA" : "NEIN"}`, {
      size: 10,
      bold: true,
      after: 1,
    });
    paragraph(q.hint, { size: 9, color: grey, after: 2 });
    if (q.note) paragraph(`Ergänzung: ${q.note}`, { size: 9, indent: 3 });
  });
  labelValue("Weitere Medikamente / Hinweise", f.medicationNotes);
  if (data.medical.some((q) => q.value === "yes"))
    paragraph(
      "Hinweis: Mindestens eine Gesundheitsfrage wurde mit Ja beantwortet. Vor Beginn persönlich mit dem Studio klären. Dieses Dokument erteilt keine medizinische Freigabe.",
      { size: 10, bold: true },
    );
  title("03 / Erklärungen & Einwilligungen");
  data.legal.forEach((item) => {
    ensure(22);
    paragraph(`BESTÄTIGT: ${item.title}`, {
      size: 10,
      bold: true,
      color: item.review ? red : black,
      after: 2,
    });
    if (item.review) review(item.text);
    else paragraph(item.text, { size: 10, after: 5 });
  });
  ensure(22);
  paragraph(
    `Fotoverwendung: ${data.photo === "yes" ? "JA, freiwillige Einwilligung erteilt" : "NEIN, keine Einwilligung zur Veröffentlichung"}`,
    { size: 11, bold: true, color: red },
  );
  review(
    data.photo === "yes"
      ? data.template?.photoText || settings.app.photoText
      : data.template?.photoDeniedText || settings.app.photoDeniedText,
  );
  title("Datenschutzhinweise / Entwurf");
  review(data.privacy);
  const imageWidth = 150,
    imageHeight = Math.min(60, imageWidth * data.signature.ratio);

  // Keep the consent statement and signature on the same PDF page.
  ensure(imageHeight + 100);
  title("04 / Digitale Unterschrift");
  paragraph(data.template?.signatureText || settings.app.signatureText, { size: 10 });

  ensure(imageHeight + 48);
  labelValue("Ort", data.studio.location);
  doc.setDrawColor(218, 225, 209);
  doc.roundedRect(margin, y, width, imageHeight + 3, 2, 2, "S");
  const actualWidth = imageHeight / data.signature.ratio;
  doc.addImage(
    data.signature.data,
    "PNG",
    margin + (width - actualWidth) / 2,
    y + 1,
    actualWidth,
    imageHeight,
    undefined,
    "FAST",
  );
  y += imageHeight + 9;
  paragraph(fullName, { size: 11, bold: true, after: 2 });
  paragraph(`Unterzeichnet: ${timeFormat(data.signedAt)}`, { size: 9, after: 2 });
  paragraph(`Unterzeichnet (UTC): ${data.signedAt.toISOString()}`, {
    size: 8,
    color: grey,
    after: 4,
  });
  paragraph(`PDF erstellt: ${stamp}`, { size: 8, color: grey, after: 2 });
  paragraph(
    "Zeitangaben stammen von der Geräteuhr. Gezeichnete Unterschrift; keine qualifizierte elektronische Signatur und kein vertrauenswürdiger externer Zeitstempel.",
    { size: 8, color: grey },
  );
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setDrawColor(224, 228, 217);
    doc.line(margin, 282, 192, 282);
    font(7, false, grey);
    doc.text(`${reference} | Vertrauliche Kundendaten`, margin, 287);
    doc.text(`Seite ${page} von ${pages}`, 192, 287, { align: "right" });
    font(7, true, red);
    doc.text(
      "ENTWURF: Haftungs-, Foto- und Datenschutztexte vor Einsatz rechtlich prüfen.",
      margin,
      292,
    );
  }
  return { doc, pages };
}
function libraryAvailable() {
  const ok = !!window.jspdf?.jsPDF;
  $("dependency-error").hidden = ok;
  return ok;
}
$("pdf-library").addEventListener("error", () => libraryAvailable());
window.addEventListener("load", libraryAvailable);
$("retry-library").addEventListener("click", () => {
  if (libraryAvailable()) return;
  toast(
    "Die eingebettete PDF-Bibliothek ist nicht verfügbar. Eingaben vor dem Schließen sichern und die vollständige App-Datei erneut öffnen.",
  );
});
form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!validate()) return;
  if (Object.values(studio).some((value) => !value.trim())) {
    toast("Bitte zuerst die Studio- und Datenschutzhinweise ergänzen.");
    openStudio();
    return;
  }
  if (!libraryAvailable()) {
    $("dependency-error").scrollIntoView({ block: "center" });
    return;
  }
  const button = $("export-button");
  button.disabled = true;
  try {
    invalidatePdf();
    const data = gatherData();

    const userText = [
      ...Object.values(data.fields),
      ...Object.values(data.studio),
      ...Object.values(data.template),
      ...data.medical.flatMap((q) => [q.title, q.hint, q.note]),
      ...data.legal.flatMap((item) => [item.title, item.text]),
      data.privacy,
    ].join("\n");
    const missing = unsupportedPdfChars(userText);
    if (missing.length) {
      toast(
        `Diese Zeichen kann die PDF-Schrift nicht darstellen: ${missing.join(" ")} Bitte ersetzen oder weglassen.`,
      );
      return;
    }
    const result = createPdf(data),
      blob = result.doc.output("blob");
    const slug = fileSlug(normalizeText(`${data.fields.lastName}_${data.fields.firstName}`));
    const clock = data.createdAt.toTimeString().slice(0, 8).replaceAll(":", "");
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    const filename = `Tattoo_Einwilligung_${slug}_${data.fields.appointment}_${clock}_${suffix}.pdf`;
    // Prepared now, booked only when the owner confirms the filing (pdf-next).
    const incomeEntry = incomeFeature.capture(data, filename, consentIncomeId);
    presentPdfArtifact(blob, filename, result.pages, { autoSave: true, incomeEntry });
    showCompletion();
    keepPending(pendingConsent);
  } catch (error) {
    console.error("PDF-Erstellung fehlgeschlagen:", error);
    toast(
      "Das PDF konnte nicht erstellt werden. Deine Eingaben bleiben erhalten. Bitte versuche es erneut.",
    );
  } finally {
    button.disabled = false;
  }
});
let nativeShareInFlight = false;
function canSharePdf(file) {
  try {
    return !!(window.isSecureContext && navigator.share && navigator.canShare?.({ files: [file] }));
  } catch (_) {
    return false;
  }
}
function presentPdfArtifact(
  blob,
  filename,
  pages,
  {
    autoSave = false,
    isTest = false,
    isReport = false,
    incomeEntry = null,
    reportTitle = "Einnahmenübersicht als PDF",
  } = {},
) {
  if (!isTest && !isReport && pendingConsent && !pendingConsent.confirmed)
    throw Error("Bitte zuerst die offene Einwilligung ablegen und als Inhaber bestätigen.");
  invalidatePdf();
  const artifact = {
    blob,
    filename,
    url: URL.createObjectURL(blob),
    pages,
    isTest,
    isReport,
    reportTitle,
    incomeEntry,
    confirmed: false,
  };
  if (!isTest && !isReport) pendingConsent = artifact;
  const native = renderPdfArtifact(artifact);
  if (autoSave) {
    if (native) savePdfToFiles();
    else $("pdf-download").click();
  }
}
function renderPdfArtifact(artifact) {
  if (pdfArtifact && pdfArtifact !== artifact) invalidatePdf();
  pdfArtifact = artifact;
  const { blob, filename, pages, isTest, isReport, reportTitle } = artifact;
  // A consent restored after a reload whose PDF could not be read back from this device.
  const missing = !blob;
  $("pdf-title").textContent = isReport
    ? reportTitle
    : isTest
      ? "Speichertest für dein iPad"
      : missing
        ? "PDF nicht mehr verfügbar"
        : "Dein PDF ist bereit.";
  $("pdf-filename").textContent = filename;
  $("pdf-meta").textContent = missing
    ? "Die App wurde vor der Bestätigung neu geladen und konnte das PDF nicht wiederherstellen."
    : `${pages} ${pages === 1 ? "Seite" : "Seiten"} · DIN A4 · ${Math.ceil(blob.size / 1024)} KB${isReport ? " · Dokument" : isTest ? " · Test ohne Kundendaten" : " · mit Unterschrift"}`;
  if (missing) {
    $("pdf-preview").removeAttribute("src");
    $("pdf-open").removeAttribute("href");
    $("pdf-download").removeAttribute("href");
  } else {
    $("pdf-preview").src = artifact.url;
    $("pdf-open").href = artifact.url;
    $("pdf-download").href = artifact.url;
    $("pdf-download").download = filename;
  }
  const consent = !isTest && !isReport;
  for (const id of ["pdf-preview-details", "pdf-open", "pdf-download", "pdf-archive-note"])
    $(id).hidden = missing;
  document.querySelector("#pdf-dialog .files-instructions").hidden = missing;
  $("pdf-next").hidden = !consent || missing;
  $("pdf-missing").hidden = !consent || !missing;
  $("pdf-review-notice").hidden = !consent || missing;
  $("income-capture-note").hidden = !consent;
  $("income-capture-note").textContent = missing
    ? "Bitte die Einwilligung erneut ausfüllen lassen, falls sie gebraucht wird. Die vorbereitete Einnahme (Name, Termin, Artist, Preise) kannst du hier mit dem Vermerk „PDF fehlt“ buchen; der Vermerk lässt sich später in der Einnahmenliste entfernen."
    : "Sobald du als Inhaber die Ablage bestätigst, werden Name, Termin, Artist und Preise in der lokalen Einnahmenliste gebucht. Gesundheitsangaben und Unterschrift werden dort nicht gespeichert.";
  if (consent && artifact.keepError)
    $("income-capture-note").textContent =
      `Achtung: ${artifact.keepError} Bitte das PDF jetzt ablegen und die App bis zur Bestätigung nicht neu laden. ` +
      $("income-capture-note").textContent;
  $("pdf-preview-details").open = false;
  const native =
    !missing && canSharePdf(new File([blob], filename, { type: "application/pdf" }));
  $("pdf-share").hidden = !native;
  $("share-status").textContent = missing
    ? ""
    : native
      ? "Wähle im iPad-Systemdialog „In Dateien sichern“ und bestätige dort mit „Sichern“."
      : "Das PDF kann über den Safari-Download oder „PDF öffnen“ abgelegt werden. Prüfe danach den gewählten Speicherort in der Dateien-App.";
  showDialog("pdf-dialog");
  return native;
}

async function savePdfToFiles() {
  if (!pdfArtifact || nativeShareInFlight) return;
  const artifact = pdfArtifact,
    file = new File([artifact.blob], artifact.filename, { type: "application/pdf" });
  nativeShareInFlight = true;
  $("pdf-share").disabled = true;
  try {
    // Invoke before the first await to retain Safari user activation.
    await navigator.share({
      files: [file],
      title: artifact.isReport
        ? artifact.reportTitle
        : artifact.isTest
          ? "INKFORM Speichertest"
          : "Tattoo-Einwilligung",
    });
    if (pdfArtifact === artifact)
      $("share-status").textContent =
        "Systemdialog abgeschlossen. Prüfe in der Dateien-App, ob das PDF im gewählten Ordner liegt. Die App kann die Ablage im Systemordner nicht selbst überprüfen.";
  } catch (error) {
    if (pdfArtifact === artifact)
      $("share-status").textContent =
        error.name === "AbortError"
          ? "Speichern abgebrochen. Das PDF und alle Eingaben bleiben erhalten. Über „In Dateien sichern“ erneut versuchen."
          : "Der Systemdialog konnte nicht geöffnet werden. Tippe erneut auf „In Dateien sichern“ oder nutze „PDF öffnen“ und das Teilen-Menü von Safari.";
  } finally {
    nativeShareInFlight = false;
    $("pdf-share").disabled = false;
  }
}
$("pdf-share").addEventListener("click", savePdfToFiles);
$("pdf-download").addEventListener("click", () => {
  $("share-status").textContent =
    "Download an den Browser übergeben. Prüfe das Dokument anschließend in der Dateien-App im Downloadordner. Falls Safari das PDF öffnet, verwende dort Teilen → In Dateien sichern.";
});
// Keeps the unconfirmed consent on this device until the owner confirms the filing.
// Until the PDF is stored (keptOk), leaving the page asks for confirmation; if storing fails, the
// thank-you screen and the owner's PDF dialog say so: the consent then exists only in memory.
function keepPending(artifact) {
  if (!artifact?.incomeEntry || !pendingStore) return;
  const failed = (message) => {
    artifact.keepError = message;
    if (pendingConsent === artifact && !$("completion-screen").hidden)
      $("completion-copy").textContent =
        "Bitte gib das iPad an das Studio zurück. Hinweis für das Studio: Diese Einwilligung ist nicht auf dem Gerät zwischengespeichert. Bitte nicht neu laden, sondern jetzt entsperren und ablegen.";
    // Only refresh a dialog the unlocked owner already has open; never open it for the customer.
    if (pdfArtifact === artifact && $("pdf-dialog").open && adminAccess.isUnlocked())
      renderPdfArtifact(artifact);
  };
  try {
    artifact.kept = pendingStore
      .save({
        id: artifact.incomeEntry.id,
        filename: artifact.filename,
        pages: artifact.pages,
        income: artifact.incomeEntry,
        blob: artifact.blob,
      })
      .then((stored) => {
        artifact.keptOk = stored;
        if (!stored) failed("Das PDF konnte nicht auf dem Gerät zwischengespeichert werden.");
        return stored;
      });
  } catch (error) {
    console.error("Offene Einwilligung nicht gesichert:", error);
    artifact.kept = Promise.resolve(false);
    failed(`Die Einwilligung konnte nicht auf dem Gerät zwischengespeichert werden (${error.message}).`);
  }
}
async function restorePending() {
  let saved;
  try {
    // Every start: delete PDFs left without metadata (e.g. interrupted cleanup).
    await pendingStore.sweep().catch((error) => console.error("Aufräumen fehlgeschlagen:", error));
    saved = await pendingStore.load();
  } catch (error) {
    toast(error.message);
    return false;
  }
  if (!saved) return false;
  pendingConsent = {
    blob: saved.blob,
    filename: saved.filename,
    url: saved.blob ? URL.createObjectURL(saved.blob) : "",
    pages: saved.pages,
    isTest: false,
    isReport: false,
    reportTitle: "",
    incomeEntry: saved.income,
    confirmed: false,
    restored: true,
  };
  consentIncomeId = saved.income.id;
  return true;
}
function bookPendingConsent(pdfMissing) {
  const artifact = pdfArtifact;
  if (!artifact || artifact !== pendingConsent || nativeShareInFlight) return;
  if (!adminAccess.isUnlocked()) {
    adminAccess.request(() => bookPendingConsent(pdfMissing));
    return;
  }
  try {
    if (!artifact.incomeEntry)
      throw Error("Der Einnahmeneintrag fehlt. Bitte das PDF erneut erstellen.");
    // Booking is idempotent per consent: a repeated confirmation never adds a second entry.
    incomeFeature.book(artifact.incomeEntry, { pdfMissing });
  } catch (error) {
    $("share-status").textContent =
      "Einnahmen konnten nicht lokal gespeichert werden: " +
      error.message +
      " Das PDF bleibt erhalten. Bitte Browser-Speicher prüfen und erneut versuchen.";
    toast("Einnahme nicht gebucht. PDF bleibt erhalten.");
    return;
  }
  artifact.confirmed = true;
  // Booking is written: remove this consent's device copy. The metadata goes at once, so the next
  // customer can start; the PDF is deleted once a write still in progress has finished. If that
  // fails, the start-up sweep removes it.
  pendingStore
    .clear(artifact.incomeEntry.id)
    .catch((error) => console.error("PDF-Kopie nicht entfernt, wird beim nächsten Start gelöscht:", error));
  resetCustomerForm();
  finishAdminLeave();
}
// Used by the service-worker registration: an app update may take over only while nothing is in
// progress (empty customer form, no unconfirmed consent, no unsaved admin changes, no open dialog).
window.inkformIdle = () =>
  !dirty &&
  !pendingConsent &&
  !adminChanged() &&
  !incomeFeature?.hasUnsavedChanges() &&
  !document.querySelector("dialog[open]");
$("pdf-next").addEventListener("click", () => bookPendingConsent(false));
$("pdf-missing").addEventListener("click", () => bookPendingConsent(true));
function runFilesTest() {
  if (!libraryAvailable()) {
    toast(
      "Die eingebettete PDF-Funktion ist nicht verfügbar. Bitte die vollständige App-Datei verwenden.",
    );
    return;
  }
  const doc = createPdfDocument(window.jspdf.jsPDF, { unit: "mm", format: "a4" });
  doc.setFont(PDF_FONT, "bold");
  doc.setFontSize(22);
  doc.text("INKFORM / Speichertest", 20, 30);
  doc.setFont(PDF_FONT, "normal");
  doc.setFontSize(12);
  doc.text("Dieses Testdokument enthält keine Kundendaten.", 20, 48);
  doc.text("Wenn du diese Datei in der Dateien-App öffnen kannst,", 20, 61);
  doc.text("ist die PDF-Ablage für dein iPad eingerichtet.", 20, 69);
  doc.setFontSize(10);
  doc.text(timeFormat(new Date()), 20, 88);
  const clock = new Date().toTimeString().slice(0, 8).replaceAll(":", "");
  presentPdfArtifact(doc.output("blob"), `INKFORM_Speichertest_${localDate()}_${clock}.pdf`, 1, {
    autoSave: true,
    isTest: true,
  });
}
const ADMIN_PAGES = {
  overview: {
    label: "Übersicht",
    icon: "grid",
    title: "Übersicht",
    description: "Studioangaben, Formulartexte und Geräteeinstellungen verwalten.",
  },
  studio: {
    label: "Studio & Kontakt",
    icon: "building",
    title: "Studio & Kontakt",
    description:
      "Studioangaben für das Kundenformular, die Datenschutzhinweise und jedes exportierte PDF.",
  },
  content: {
    label: "Formular & Texte",
    icon: "pen",
    title: "Formulartexte",
    description:
      "Gestalte den Einstieg, deine Fotoeinwilligung und die Texte rund um die Unterschrift.",
  },
  medical: {
    label: "Gesundheitsfragen",
    icon: "heart",
    title: "Gesundheitsfragen",
    description:
      "Bearbeite die Gesundheitsfragen und ergänze eigene Fragen. Jede Frage wird mit Ja oder Nein beantwortet.",
  },
  legal: {
    label: "Einwilligungen",
    icon: "doc",
    title: "Einwilligungen",
    description:
      "Bearbeite die Erklärungen, die deine Kundinnen und Kunden vor der Unterschrift bestätigen.",
  },
  income: {
    label: "Einnahmen",
    icon: "doc",
    title: "Einnahmenübersicht",
    description:
      "Gesamtpreise je Termin und Artist auswerten, fehlende Preise ergänzen und Listen ausgeben.",
  },
  retention: {
    label: "Aufbewahrung",
    icon: "lock",
    title: "Aufbewahrung & Löschung",
    description:
      "Fristen festlegen, fällige Einwilligungs-PDFs löschen und alte Namen in der Einnahmenliste anonymisieren.",
  },
  privacy: {
    label: "Datenschutz",
    icon: "lock",
    title: "Datenschutzhinweise",
    description:
      "Passe die Datenschutzhinweise an deine tatsächlichen Abläufe, die Ablage und das Löschkonzept an.",
  },
  ipad: {
    label: "iPad & Dateien",
    icon: "tablet",
    title: "iPad einrichten",
    description: "Einmal einrichten, die Ablage testen und dann direkt mit dem iPad arbeiten.",
  },
  appearance: {
    label: "Design & Sicherung",
    icon: "sliders",
    title: "Darstellung & Sicherung",
    description: "Farbschema wählen und Einstellungen übertragen.",
  },
};
let adminDraft = null,
  adminPage = "overview",
  adminOpen = false,
  storageWorking = true;
const adminIcon = (name) =>
  /* HTML */ `<svg class="icon" aria-hidden="true"><use href="#i-${name}" /></svg>`;
function adminChanged() {
  return !!adminDraft && JSON.stringify(adminDraft) !== JSON.stringify(settings);
}
function getDraft(path) {
  return path.split(".").reduce((value, key) => value[key], adminDraft);
}
function adminField(
  path,
  label,
  { area = false, rows = 3, placeholder = "", help = "", type = "text", max = 3000 } = {},
) {
  const id = "admin-" + path.replaceAll(".", "-"),
    value = escapeHtml(getDraft(path));
  return /* HTML */ `<div class="ad-field${area ? " full" : ""}">
    <label for="${id}">${escapeHtml(label)}</label>${
      area
        ? /* HTML */ `<textarea
            id="${id}"
            data-config-path="${path}"
            rows="${rows}"
            maxlength="${max}"
            placeholder="${escapeHtml(placeholder)}"
          >
${value}</textarea>`
        : /* HTML */ `<input
            id="${id}"
            data-config-path="${path}"
            type="${type}"
            maxlength="${max}"
            value="${value}"
            placeholder="${escapeHtml(placeholder)}"
          />`
    }${help ? /* HTML */ `<small>${help}</small>` : ""}
  </div>`;
}
function adminPanel(title, content, note = "") {
  return /* HTML */ `<section class="ad-panel">
    <div class="ad-panel-header">
      <h2>${title}</h2>
      ${note ? /* HTML */ `<small>${note}</small>` : ""}
    </div>
    <div class="ad-panel-body">${content}</div>
  </section>`;
}
function adminPreview() {
  const a = adminDraft.app;
  return /* HTML */ `<aside class="ad-preview-sticky">
    ${adminPanel(
      "Formular-Vorschau",
      /* HTML */ `<div class="ad-preview">
          <div class="ad-preview-brand">
            <img
              class="studio-logo"
              src="${document.querySelector(".studio-logo").src}"
              alt="%%logoAlt%%"
              width="48"
              height="48"
            /><span data-preview="brand">${escapeHtml(a.brand)}</span>
          </div>
          <div class="ad-preview-kicker" data-preview="eyebrow">${escapeHtml(a.eyebrow)}</div>
          <h3 data-preview="headline">${escapeHtml(a.headline)}</h3>
          <p data-preview="description">${escapeHtml(a.description)}</p>
          <div class="ad-preview-field">Vorname</div>
          <div class="ad-preview-field">Nachname</div>
          <div class="ad-preview-field">Geburtsdatum</div>
          <div class="ad-preview-field" data-preview="defaultArtist">
            ${escapeHtml(a.defaultArtist || "Dein Artist")}
          </div>
          <div class="ad-preview-button">Einwilligung ausfüllen ${adminIcon("arrow")}</div>
        </div>
        <p class="ad-preview-note">
          Vorschau deines Entwurfs. Änderungen erscheinen nach dem Speichern im Kundenformular.
        </p>`,
      "Entwurf",
    )}
    <div class="ad-notice review">
      <strong>Rechtstexte zur Prüfung</strong><br />Haftung, Fotoeinwilligung und Datenschutz
      bleiben im Formular und PDF rot gekennzeichnet.
    </div>
  </aside>`;
}
function shortcuts() {
  return [
    ["studio", "building", "Studio & Kontakt", "Name, Anschrift und Ansprechpartner"],
    ["content", "pen", "Formular & Texte", "Begrüßung, Fotoeinwilligung und Unterschrift"],
    [
      "medical",
      "heart",
      "Gesundheitsfragen",
      `${adminDraft.medical.length} Fragen für ein gutes Vorgespräch`,
    ],
    ["legal", "doc", "Einwilligungen", "Aufklärung und Bestätigungen bearbeiten"],
    ["privacy", "lock", "Datenschutzhinweise", "Zwecke, Aufbewahrung und Rechte"],
  ]
    .map(
      ([page, icon, title, note]) =>
        /* HTML */ `<button class="ad-shortcut" type="button" data-admin-page="${page}">
          <span class="ad-shortcut-icon">${adminIcon(icon)}</span
          ><span><strong>${title}</strong><small>${note}</small></span
          >${adminIcon("arrow")}
        </button>`,
    )
    .join("");
}
// Overview: reminders about data that should not stay on the device unnoticed.
function privacyReminders() {
  const notes = [],
    buttons = [];
  try {
    const pending = pendingStore?.read();
    const age = pending ? daysBetween(pending.savedAt) : 0;
    if (pending && age >= PENDING_REMINDER_DAYS && pendingConsent && !pendingConsent.confirmed) {
      notes.push(
        `Eine unterschriebene Einwilligung ist seit ${age} Tagen nicht als abgelegt bestätigt. Das PDF mit Gesundheitsangaben liegt so lange zusätzlich im Browser-Speicher. Bitte ablegen und bestätigen.`,
      );
      buttons.push('<button class="ad-button primary" type="button" data-admin-action="pending">Offene Einwilligung ablegen</button>');
    }
  } catch (_) {}
  try {
    const { pdfYears } = readRetention(localStorage);
    const open = dueForPdfDeletion(incomeFeature.list(), pdfYears, localDate()).length;
    if (open) {
      notes.push(`${open} Einwilligungs-PDFs haben die eingetragene Aufbewahrungsfrist überschritten.`);
      buttons.push('<button class="ad-button" type="button" data-admin-page="retention">Löschliste öffnen</button>');
    }
  } catch (_) {}
  return notes.length
    ? `<div class="ad-notice ad-reminder" role="status">${notes.map((n) => `<p>${escapeHtml(n)}</p>`).join("")}<div class="ad-actions-row">${buttons.join("")}</div></div>`
    : "";
}
function securityChecklist() {
  let last = null;
  try {
    last = localStorage.getItem(LAST_BACKUP_KEY);
  } catch (_) {}
  const age = last ? daysBetween(last) : null;
  const backup =
    age === null
      ? "Noch keine Einnahmen-Sicherung auf diesem Gerät erstellt."
      : `Letzte Einnahmen-Sicherung vor ${age} ${age === 1 ? "Tag" : "Tagen"}${age > 7 ? " – bitte neu sichern." : "."}`;
  const items = [
    "Gerätecode mit mindestens 6 Ziffern: erst damit verschlüsselt das iPad seine Daten (Einstellungen → Face ID & Code: „Datenschutz ist aktiviert“).",
    "Geführter Zugriff für die Kundenübergabe, mit eigenem Code (Einstellungen → Bedienungshilfen → Geführter Zugriff).",
    "PDFs nur unter „Auf meinem iPad“ ablegen, nicht in iCloud Drive.",
    "iCloud-Backup für dieses iPad aus; stattdessen verschlüsseltes Backup über den Mac (Finder → „Lokales Backup verschlüsseln“).",
    "Wöchentlich sichern: Einnahmen und Einstellungen als JSON, den PDF-Ordner auf den Mac.",
    "Safari-Websitedaten löschen oder die Home-Bildschirm-App entfernen löscht Einnahmen, PIN und offene Einwilligung – vorher sichern.",
  ];
  return adminPanel(
    "Sicherheit dieses iPads",
    `<p class="ad-section-copy${age === null || age > 7 ? " ad-warn" : ""}">${escapeHtml(backup)}</p><ul class="ad-checklist">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul><div class="ad-actions-row"><button class="ad-button" type="button" data-admin-page="income">Einnahmen sichern</button><button class="ad-button" type="button" data-admin-page="retention">Aufbewahrung</button></div>`,
    "Diese Punkte kann die App nicht selbst prüfen. Details in der Anleitung.",
  );
}
function renderAdminSection() {
  const page = ADMIN_PAGES[adminPage];
  $("admin-page-title").textContent = page.title;
  $("admin-page-description").textContent = page.description;
  $("admin-breadcrumb").textContent = page.label;
  $("admin-error").hidden = true;
  $("admin-nav").innerHTML = Object.entries(ADMIN_PAGES)
    .map(
      ([id, p]) =>
        /* HTML */ `<button
          type="button"
          data-admin-page="${id}"
          ${id === adminPage ? 'aria-current="page"' : ""}
        >
          ${adminIcon(p.icon)}${p.label}
        </button>`,
    )
    .join("");
  let content = "";
  if (adminPage === "income") {
    content = `<div id="income-content">${incomeFeature.view()}</div>`;
  } else if (adminPage === "retention") {
    content = `<div id="retention-content">${incomeFeature.retentionView()}</div>`;
  } else if (adminPage === "overview") {
    const filled = Object.values(adminDraft.studio).filter((v) => v.trim()).length;
    content = /* HTML */ `<div class="ad-stats">
        <div class="ad-stat">
          <div class="ad-stat-top">Studio-Profil ${adminIcon("building")}</div>
          <strong>${filled}<span style="font-size:14px;color:var(--ad-muted)"> / 6</span></strong
          ><small
            ><span class="ad-dot"></span>${
              filled === 6 ? "Bereit für den PDF-Export" : "Studioangaben vervollständigen"
            }</small
          >
        </div>
        <div class="ad-stat">
          <div class="ad-stat-top">Gesundheitsfragen ${adminIcon("heart")}</div>
          <strong>${adminDraft.medical.length}</strong><small>Individuell anpassbar</small>
        </div>
        <div class="ad-stat">
          <div class="ad-stat-top">Einwilligungen ${adminIcon("doc")}</div>
          <strong>${adminDraft.legal.length}</strong><small>Mit roten Prüfvermerken</small>
        </div>
      </div>
      ${privacyReminders()}
      <div class="ad-columns">
        <div>
          ${securityChecklist()}
          <section class="ad-panel">
            <div class="ad-panel-header">
              <h2>Dein Formular konfigurieren</h2>
              <span class="ad-chip">4 Formularabschnitte</span>
            </div>
            ${shortcuts()}
          </section>
          ${adminPanel(
            "Einstellungen übertragen",
            /* HTML */ `<p class="ad-section-copy">
                Die Einstellungen gelten für diesen Browser. Übertrage sie auf ein weiteres Gerät
                per JSON oder als konfigurierte HTML-Datei.
              </p>
              <div class="ad-actions-row">
                <button class="ad-button" type="button" data-admin-page="appearance">
                  ${adminIcon("download")}Sicherung & Export</button
                ><button class="ad-button" type="button" data-admin-action="preview">
                  ${adminIcon("external")}Formular ansehen
                </button>
              </div>`,
          )}
        </div>
        ${adminPreview()}
      </div>`;
  } else if (adminPage === "studio") {
    content = /* HTML */ `<div class="ad-columns">
      <div>
        ${adminPanel(
          "Studio & Kontakt",
          /* HTML */ `<div class="ad-fields">
            ${adminField("studio.name", "Studio / verantwortliche Person", {
              placeholder: "Studio und vollständiger Name / Firma",
              max: 160,
              help: "Wird auf jedem PDF als verantwortliches Studio angegeben.",
            })}${adminField("studio.contact", "Datenschutzkontakt / E-Mail", {
              type: "email",
              placeholder: "kontakt@dein-studio.de",
              max: 160,
            })}${adminField("studio.address", "Vollständige Anschrift", {
              area: true,
              rows: 2,
              placeholder: "Straße, Hausnummer, Postleitzahl und Ort",
              max: 300,
            })}${adminField("studio.location", "Ort der Unterschrift", {
              placeholder: "%%locationPlaceholder%%",
              max: 100,
            })}${adminField("app.defaultArtist", "Standard-Artist", {
              placeholder: "Name oder Kürzel",
              max: 100,
              help: "Wird in neuen Formularen vorausgefüllt; kann dort geändert werden.",
            })}
          </div>`,
        )}
        <div class="ad-notice">
          Die sechs Studioangaben für den PDF-Export umfassen auch Speicherdauer und Empfänger.
          Diese bearbeitest du unter
          <button
            class="text-button"
            type="button"
            data-admin-page="privacy"
            style="color:var(--ad-blue);min-height:30px"
          >
            Datenschutz ${adminIcon("arrow")}</button
          >.
        </div>
      </div>
      ${adminPreview()}
    </div>`;
  } else if (adminPage === "content") {
    content = /* HTML */ `<div class="ad-columns">
      <div>
        ${adminPanel(
          "Identität & Begrüßung",
          /* HTML */ `<div class="ad-fields">
            ${adminField("app.brand", "Name im Formularkopf", {
              max: 24,
              placeholder: "INKFORM",
            })}${adminField("app.formVersion", "Formularversion", {
              max: 50,
              help: "Wird zur Dokumentation in jedes PDF übernommen.",
            })}${adminField("app.eyebrow", "Kleine Überschrift", { max: 120 })}${adminField(
              "app.documentTitle",
              "Titel des PDFs",
              { max: 120 },
            )}${adminField("app.headline", "Hauptüberschrift", {
              area: true,
              rows: 2,
              max: 160,
            })}${adminField("app.description", "Einleitung", { area: true, rows: 3, max: 1200 })}
          </div>`,
        )}${adminPanel(
          "Fotoeinwilligung",
          /* HTML */ `<div class="ad-notice review">
              Entwurf zur rechtlichen Prüfung. Fotoverwendung bleibt eine freiwillige
              Ja/Nein-Auswahl.
            </div>
            <div class="ad-fields">
              ${adminField("app.photoText", "Angebotene Fotoeinwilligung", {
                area: true,
                rows: 7,
                max: 8000,
              })}${adminField("app.photoDeniedText", "PDF-Text bei Ablehnung", {
                area: true,
                rows: 4,
                max: 4000,
                help: "Steht im PDF, wenn die Fotoeinwilligung abgelehnt wurde.",
              })}
            </div>`,
        )}${adminPanel(
          "Digitale Unterschrift",
          adminField("app.signatureText", "Bestätigung über dem Unterschriftsfeld", {
            area: true,
            rows: 4,
            max: 2000,
            help: "Dieser Wortlaut erscheint auch im PDF.",
          }),
        )}
      </div>
      ${adminPreview()}
    </div>`;
  } else if (adminPage === "medical" || adminPage === "legal") {
    const medical = adminPage === "medical",
      key = medical ? "medical" : "legal",
      items = adminDraft[key];
    content = `${!medical ? '<div class="ad-notice review">Rechtliche Entwürfe bearbeiten und vor Einsatz fachlich prüfen lassen. Die Prüfvermerke für Haftung und Datenschutz bleiben aktiv.</div>' : ""}<div class="ad-panel"><div class="ad-panel-header"><h2>${medical ? "Fragen zur Gesundheit" : "Erklärungen & Bestätigungen"}</h2><span class="ad-chip">${items.length} ${medical ? "Fragen" : "Erklärungen"}</span></div><div class="ad-panel-body">${items
      .map(
        (item, index) =>
          /* HTML */ `<details class="ad-editor" ${index === 0 ? "open" : ""}>
            <summary>
              <span class="ad-editor-num">${String(index + 1).padStart(2, "0")}</span
              ><span class="ad-editor-name">${escapeHtml(item.title)}</span>${adminIcon("chevron")}
            </summary>
            <div class="ad-editor-body">
              <div class="ad-fields">
                ${adminField(`${key}.${index}.title`, medical ? "Frage / Thema" : "Überschrift", {
                  area: true,
                  rows: 2,
                  max: 250,
                })}${adminField(
                  `${key}.${index}.${medical ? "hint" : "text"}`,
                  medical ? "Erläuterung & Beispiele" : "Vollständiger Erklärungstext",
                  { area: true, rows: medical ? 3 : 5, max: medical ? 3000 : 8000 },
                )}
              </div>
              <div class="ad-editor-footer">
                ${
                  medical
                    ? "<span>Antwortformat: Ja / Nein · Pflichtangabe</span>"
                    : /* HTML */ `<label
                        ><input
                          type="checkbox"
                          data-config-path="${key}.${index}.review"
                          ${item.review ? "checked" : ""}
                          ${["privacy", "liability"].includes(item.id) ? "disabled" : ""}
                        />Roter Prüfvermerk</label
                      >`
                }${
                  item.id.startsWith("custom")
                    ? /* HTML */ `<button
                        class="ad-button danger"
                        type="button"
                        data-remove-kind="${key}"
                        data-remove-index="${index}"
                      >
                        ${adminIcon("trash")}Entfernen
                      </button>`
                    : "<span>Standardfrage</span>"
                }
              </div>
            </div>
          </details>`,
      )
      .join(
        "",
      )}<button class="ad-button" type="button" data-add-kind="${key}">${adminIcon("plus")}${medical ? "Gesundheitsfrage hinzufügen" : "Erklärung hinzufügen"}</button></div></div>`;
  } else if (adminPage === "privacy") {
    content = /* HTML */ `<div class="ad-notice review">
        <strong>Vor Einsatz rechtlich prüfen.</strong> Die Vorlage muss zum konkreten Studio, den
        verwendeten Diensten und den tatsächlichen Abläufen passen. Die rote Markierung bleibt auch
        nach dem Bearbeiten erhalten.
      </div>
      ${adminPanel(
        "Aufbewahrung & Datenempfänger",
        /* HTML */ `<div class="ad-fields">
          ${adminField("studio.retention", "Speicherdauer / Löschkriterien", {
            area: true,
            rows: 4,
            max: 2000,
            placeholder: "Konkrete Fristen oder nachvollziehbare Löschkriterien",
          })}${adminField("studio.recipients", "Empfänger & mögliche Drittlandübermittlungen", {
            area: true,
            rows: 4,
            max: 2000,
            placeholder: "Zugriffsberechtigte Personen, Ablage und Dienstleister",
          })}
        </div>`,
      )}${adminPanel(
        "Datenschutzhinweise bearbeiten",
        `${adminField("app.privacyTemplate", "Vollständiger Datenschutzhinweis", { area: true, rows: 20, max: 18000, help: "Platzhalter werden durch deine Studioangaben ersetzt: <code>{{studio.name}}</code>, <code>{{studio.address}}</code>, <code>{{studio.contact}}</code>, <code>{{studio.retention}}</code> und <code>{{studio.recipients}}</code>." })}<div class="ad-notice" style="margin:20px 0 0">Speichere hier ausschließlich allgemeine Studioinformationen. Angaben zu Kundinnen und Kunden gehören in das Kundenformular.</div>`,
      )}`;
  } else if (adminPage === "ipad") {
    const secure = window.isSecureContext,
      ready = !!window.jspdf?.jsPDF;
    const testFile = new File(["INKFORM"], "Speichertest.pdf", { type: "application/pdf" });
    const native = canSharePdf(testFile),
      standalone =
        !!navigator.standalone || window.matchMedia("(display-mode: standalone)").matches;
    content =
      adminPanel(
        "Dein iPad-Check",
        /* HTML */ `<div class="ipad-checks">
          <div>
            <span>Start der App</span
            ><strong
              >${location.protocol === "file:" ? "Lokale HTML-Datei" : secure ? "Geschützter Weblink" : "Lokale Vorschau"}</strong
            >
          </div>
          <div>
            <span>PDF-Erstellung</span><strong>${ready ? "Bereit" : "Bibliothek lädt noch"}</strong>
          </div>
          <div>
            <span>Systemdialog für Dateien</span
            ><strong>${native ? "Verfügbar" : "PDF-Download als Alternative"}</strong>
          </div>
          <div>
            <span>Offline-Verfügbarkeit</span>
            <strong data-offline-status
              >${location.protocol === "file:" ? "Lokale Datei bereit" : document.documentElement.dataset.offlineReady === "true" ? "Offline bereit – im Flugmodus testen" : "Wird nach dem Laden geprüft"}</strong
            >
          </div>
          <div>
            <span>Start vom Home-Bildschirm</span
            ><strong>${standalone ? "Aktiv" : "Über Teilen einrichten"}</strong>
          </div>
        </div>`,
      ) +
      adminPanel(
        "1. App auf dem Home-Bildschirm ablegen",
        /* HTML */ `<p class="ad-section-copy">
            Öffne den später eingerichteten HTTPS-Link auf deinem iPad einmal in Safari. Wähle
            „Teilen“ → „Zum Home-Bildschirm“ und öffne INKFORM über dieses Symbol. Warte auf die
            Offline-Bestätigung und teste anschließend im Flugmodus. Formular, Unterschrift und
            PDF-Erstellung laufen auf dem Gerät; es gibt keinen Upload.
          </p>
          <div class="ad-actions-row">
            <button class="ad-button" type="button" data-admin-action="copy-link">
              ${adminIcon("external")}App-Link kopieren
            </button>
            <button class="ad-button" type="button" data-admin-action="install">
              ${adminIcon("tablet")}Zum Home-Bildschirm
            </button>
          </div>`,
      ) +
      adminPanel(
        "2. Einen Studioordner in Dateien anlegen",
        /* HTML */ `<p class="ad-section-copy">
            Öffne die Dateien-App und lege unter <strong>„Auf meinem iPad“</strong> zum Beispiel den
            Ordner <strong>%%filesFolder%% / Einwilligungen</strong> an. Verwende keine iCloud-Ablage,
            wenn die Dokumente ausschließlich auf diesem Gerät bleiben sollen. Diesen Ordner wählst
            du beim ersten Speichern im Systemdialog aus.
          </p>
          <div class="ad-notice" style="margin:0">
            Safari erlaubt dieser Webseite nicht, einen beliebigen Dateien-Ordner ohne Auswahl zu
            beschreiben. Bei jedem Dokument bestätigst du die Ablage im iPad-Systemdialog.
          </div>`,
      ) +
      adminPanel(
        "3. Speicherung jetzt ausprobieren",
        /* HTML */ `<p class="ad-section-copy">
            Erzeuge eine Test-PDF ohne Kundendaten. Im Systemdialog „In Dateien sichern“ wählen,
            deinen Studioordner öffnen und auf „Sichern“ tippen. Prüfe danach in der Dateien-App, ob
            der Speichertest dort liegt.
          </p>
          <button class="ad-button primary" type="button" data-admin-action="test-files">
            ${adminIcon("download")}iPad-Speicherung testen
          </button>`,
      ) +
      adminPanel(
        "Danach bei jedem Kunden",
        /* HTML */ `<ol class="ipad-steps">
            <li>Formular ausfüllen und mit Finger oder Apple Pencil unterschreiben.</li>
            <li>
              „PDF erstellen & sichern“ wählen; je nach Browser öffnet sich der Systemdialog oder
              ein Download.
            </li>
            <li>„In Dateien sichern“ → Studioordner → „Sichern“.</li>
            <li>
              Auf dem Vielen-Dank-Bildschirm als Inhaber mit PIN entsperren und die PDF-Ablage
              prüfen.
            </li>
            <li>Erst danach „PDF ist gespeichert · Nächster Kunde“ bestätigen.</li>
          </ol>
          <p class="ad-preview-note">
            Kundeneingaben und Unterschriften werden nicht im Browser archiviert.
            Studio-Einstellungen bleiben lokal in diesem Browser gespeichert; Geräte synchronisieren
            sie nicht automatisch.
          </p>`,
      );
  } else if (adminPage === "appearance") {
    content = `${adminPanel(
      "Erscheinungsbild",
      /* HTML */ `<p class="ad-section-copy">
          Helles oder dunkles Farbschema wählen. Das Farbschema gilt für Admin-Konsole und
          Kundenformular. PDFs bleiben auf weißem Papier.
        </p>
        <div class="ad-theme-options">
          <button class="ad-theme-card" data-set-theme="light" type="button">
            <span class="ad-theme-swatch light"></span><strong>Light Mode</strong
            ><small>Heller Hintergrund</small></button
          ><button class="ad-theme-card" data-set-theme="dark" type="button">
            <span class="ad-theme-swatch dark"></span><strong>Dark Mode</strong
            ><small>Anthrazit mit blauen Akzenten</small>
          </button>
        </div>`,
    )}${adminPanel(
      "Sicherung & Gerätewechsel",
      /* HTML */ `<p class="ad-section-copy">
          Exportiere deine gespeicherten Einstellungen. Die Sicherung enthält Studioangaben und
          Formulartexte – keine ausgefüllten Kundenformulare und keine Unterschriften.
        </p>
        <div class="ad-actions-row">
          <button class="ad-button" type="button" data-admin-action="export-json">
            ${adminIcon("download")}Einstellungen exportieren</button
          ><button class="ad-button" type="button" data-admin-action="import-json">
            ${adminIcon("upload")}JSON importieren</button
          ><button class="ad-button primary" type="button" data-admin-action="export-html">
            ${adminIcon("doc")}App als HTML exportieren
          </button>
        </div>
        <p class="ad-preview-note">
          JSON: In dieser Konsole auf einem weiteren Gerät importieren. HTML: Eine vollständige
          App-Datei mit eingebetteter Konfiguration. Ein Import wird zunächst als Entwurf geöffnet.
        </p>`,
    )}${adminPanel(
      "Standardvorlage",
      /* HTML */ `<div class="ad-reset-row">
        <div>
          <strong>Mit der ursprünglichen Vorlage neu beginnen</strong>
          <p>
            Lädt die Originaltexte als Entwurf. Deine gespeicherte Konfiguration bleibt bis zum
            nächsten Speichern bestehen.
          </p>
        </div>
        <button class="ad-button danger" type="button" data-admin-action="defaults">
          ${adminIcon("reset")}Vorlage zurücksetzen
        </button>
      </div>`,
    )}<div class="ad-notice">Die Admin-Oberfläche ist durch die lokale Inhaber-PIN geschützt. Die PIN verschlüsselt weder Browserdaten noch die im HTML enthaltene Studio-Konfiguration. Studioexporte enthalten keine Einnahmenliste oder PIN. Es gibt keine Server-Benutzerverwaltung.</div>`;
  }
  $("admin-section").innerHTML = content;
  updateAdminChrome();
  updateThemeButtons();
}
function updateAdminChrome() {
  const changed = adminChanged();
  $("admin-savebar").hidden = (adminPage === "income" || adminPage === "retention") && !changed;
  $("admin-savebar").classList.toggle("unsaved", changed);
  $("admin-save-state").textContent = changed
    ? "Ungespeicherte Änderungen"
    : "Alles auf dem aktuellen Stand";
  $("admin-save-detail").textContent = changed
    ? "Speichern übernimmt deinen Entwurf ins Formular."
    : storageWorking
      ? settings.savedAt
        ? `Zuletzt gespeichert: ${timeFormat(new Date(settings.savedAt))}`
        : "Studio-Einstellungen werden lokal gespeichert."
      : "Nur in dieser Sitzung. Bitte JSON oder HTML exportieren.";
  $("admin-discard").disabled = !changed;
  const name = (adminDraft?.studio.name || settings.studio.name).trim();
  $("admin-workspace-name").textContent = name || "Dein Tattoo-Studio";
  $("admin-avatar").textContent = studioInitials(name);
}
function configError(message) {
  $("admin-error").textContent = message;
  $("admin-error").hidden = false;
  $("admin-error").focus();
  $("admin-error").scrollIntoView({ block: "center" });
}
function applySettings(next, { initial = false } = {}) {
  const previous = settings;
  const medicalAnswers = new Map(
    MEDICAL.map((q) => [
      q.id,
      {
        definition: JSON.stringify(q),
        value: choiceValue(q.id),
        note: $(`note-${q.id}`)?.value || "",
      },
    ]),
  );
  const legalAnswers = new Map(
    LEGAL.map((item) => [
      item.id,
      {
        definition: JSON.stringify({ ...item, review: !!item.review }),
        checked: !!$(item.id)?.checked,
      },
    ]),
  );
  const privacyChanged =
    JSON.stringify(previous.studio) !== JSON.stringify(next.studio) ||
    previous.app.privacyTemplate !== next.app.privacyTemplate;
  if (!initial) {
    clearSignature(
      "Die Formulareinstellungen wurden geändert. Bitte prüfe die Erklärungen und unterschreibe erneut.",
    );
    invalidatePdf();
  }
  settings = next;
  studio = { ...next.studio };
  MEDICAL.splice(0, MEDICAL.length, ...clone(next.medical));
  LEGAL.splice(0, LEGAL.length, ...clone(next.legal));
  renderQuestionnaire();
  renderStudio();
  $("customer-brand").textContent = next.app.brand;
  document.title = `${studio.name.split(" · ")[0]} · ${next.app.brand} — Tattoo-Einwilligung`;
  $("customer-headline").textContent = next.app.headline;
  $("customer-description").textContent = next.app.description;
  $("customer-eyebrow").textContent = next.app.eyebrow;
  $("signature-confirmation").textContent = next.app.signatureText;
  $("photo-text").textContent = next.app.photoText;
  if (initial || !dirty || $("artist").value === previous.app.defaultArtist)
    $("artist").value = next.app.defaultArtist;
  $("artist").defaultValue = next.app.defaultArtist;
  if (!initial) {
    MEDICAL.forEach((q) => {
      const answer = medicalAnswers.get(q.id);
      if (answer && answer.definition === JSON.stringify(q) && answer.value) {
        form.querySelector(`input[name="${q.id}"][value="${answer.value}"]`).checked = true;
        $(`note-${q.id}`).value = answer.note;
        $(`details-${q.id}`).hidden = answer.value !== "yes";
      }
    });
    LEGAL.forEach((item) => {
      const answer = legalAnswers.get(item.id);
      if (
        answer &&
        answer.definition === JSON.stringify({ ...item, review: !!item.review }) &&
        !(item.id === "privacy" && privacyChanged)
      )
        $(item.id).checked = answer.checked;
    });
    if (previous.app.photoText !== next.app.photoText)
      form.querySelectorAll('input[name="photo"]').forEach((input) => (input.checked = false));
    $("error-summary").hidden = true;
    $("medical-notice").hidden = !MEDICAL.some((q) => choiceValue(q.id) === "yes");
    updateProgress();
  }
}
function saveAdmin() {
  let next;
  try {
    next = validateSettings(adminDraft);
  } catch (error) {
    configError(error.message);
    return false;
  }
  const changed = JSON.stringify(next) !== JSON.stringify(settings);
  if (changed) next.savedAt = new Date().toISOString();
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    storageWorking = true;
  } catch (_) {
    storageWorking = false;
  }
  if (changed) applySettings(next);
  else settings = next;
  adminDraft = clone(settings);
  updateAdminChrome();
  $("admin-error").hidden = true;
  toast(
    storageWorking
      ? "Einstellungen gespeichert und ins Formular übernommen."
      : "Für diese Sitzung übernommen. Browser-Speicher nicht verfügbar: Bitte JSON oder HTML exportieren.",
  );
  return true;
}
function openAdmin(page = "overview") {
  adminAccess.request(() => openAdminAuthorized(page));
}
function openAdminAuthorized(page = "overview") {
  if (!adminAccess.isUnlocked()) return;
  $("completion-screen").hidden = true;
  if (!adminOpen) adminDraft = clone(settings);
  adminPage = ADMIN_PAGES[page] ? page : "overview";
  adminOpen = true;
  $("customer-app").hidden = true;
  $("admin-app").hidden = false;
  document.title = `${studio.name.split(" · ")[0]} · INKFORM — Admin-Konsole`;
  history.replaceState(null, "", "#admin");
  renderAdminSection();
  window.scrollTo(0, 0);
  $("admin-page-title").tabIndex = -1;
  $("admin-page-title").focus({ preventScroll: true });
}
function finishAdminLeave() {
  if (pendingConsent && !pendingConsent.confirmed) {
    showCompletion();
    return;
  }
  try {
    sessionStorage.removeItem("inkform.completion");
  } catch (_) {}
  $("completion-screen").hidden = true;
  adminAccess?.lock();
  incomeFeature?.lock();
  adminOpen = false;
  $("admin-app").hidden = true;
  $("customer-app").hidden = false;
  adminDraft = null;
  history.replaceState(null, "", "#start");
  document.title = `${studio.name.split(" · ")[0]} · ${settings.app.brand} — Tattoo-Einwilligung`;
  window.scrollTo(0, 0);
  resizeCanvas();
  $("studio-open").focus({ preventScroll: true });
}
function showCompletion(setup = false) {
  document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
  adminOpen = false;
  adminDraft = null;
  adminAccess?.lock();
  incomeFeature?.lock();
  $("customer-app").hidden = true;
  $("admin-app").hidden = true;
  $("completion-screen").hidden = false;
  $("completion-title").textContent = setup ? "Studio einrichten" : "Vielen Dank";
  $("completion-copy").textContent = setup
    ? "Bitte richte als Inhaber zuerst die PIN für den Admin-Bereich ein."
    : "Bitte gib das iPad an das Studio zurück.";
  $("completion-unlock").textContent = setup ? "PIN festlegen" : "Studio entsperren";
  if (!setup)
    try {
      sessionStorage.setItem("inkform.completion", "true");
    } catch (_) {}
  $("completion-title").focus();
}
$("completion-unlock").addEventListener("click", () => {
  adminAccess.request(() =>
    restoring.then(() => {
      openAdminAuthorized("overview");
      if (pendingConsent && !pendingConsent.confirmed) renderPdfArtifact(pendingConsent);
    }),
  );
});
function requestAdminLeave() {
  if (adminChanged()) showDialog("admin-leave-dialog");
  else finishAdminLeave();
}
function downloadFile(blob, name) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function exportSettings(kind) {
  if (adminChanged()) {
    configError(
      "Bitte speichere deine Änderungen vor dem Export. Exportiert wird der gespeicherte Stand.",
    );
    return;
  }
  const payload = { ...clone(settings), theme: document.documentElement.dataset.theme };
  if (kind === "json")
    downloadFile(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
      `INKFORM_Einstellungen_${localDate()}.json`,
    );
  else {
    const doc = new DOMParser().parseFromString(APP_SOURCE_HTML, "text/html");
    doc.getElementById("inkform-config").textContent = JSON.stringify(payload).replace(
      /</g,
      "\\u003c",
    );
    doc.documentElement.dataset.theme = payload.theme;
    doc.querySelectorAll("[data-hosted-only]").forEach((node) => node.remove());
    downloadFile(
      new Blob(["<!DOCTYPE html>\n" + doc.documentElement.outerHTML], {
        type: "text/html;charset=utf-8",
      }),
      `INKFORM_Studio_${localDate()}.html`,
    );
  }
  toast(
    kind === "json"
      ? "Einstellungen als JSON zum Download bereitgestellt."
      : "Konfigurierte Single-File-App zum Download bereitgestellt.",
  );
}
function setTheme(theme, persist = true) {
  if (!["light", "dark"].includes(theme)) theme = "dark";
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content =
    theme === "dark" ? "#141414" : "#f6f6f6";
  if (persist)
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (_) {}
  updateThemeButtons();
}
function updateThemeButtons() {
  const theme = document.documentElement.dataset.theme || "dark";
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.innerHTML =
      adminIcon(theme === "dark" ? "sun" : "moon") +
      /* HTML */ `<span>${theme === "dark" ? "Light Mode" : "Dark Mode"}</span>`;
    button.setAttribute(
      "aria-label",
      theme === "dark" ? "Light Mode aktivieren" : "Dark Mode aktivieren",
    );
  });
  document
    .querySelectorAll("[data-set-theme]")
    .forEach((button) =>
      button.setAttribute("aria-pressed", String(button.dataset.setTheme === theme)),
    );
}
document
  .querySelectorAll("[data-theme-toggle]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"),
    ),
  );
$("admin-preview").addEventListener("click", requestAdminLeave);
$("admin-save").addEventListener("click", saveAdmin);
$("admin-discard").addEventListener("click", () => {
  adminDraft = clone(settings);
  renderAdminSection();
  toast("Entwurf verworfen. Gespeicherter Stand wiederhergestellt.");
});
$("admin-leave-discard").addEventListener("click", () => {
  $("admin-leave-dialog").close();
  finishAdminLeave();
});
$("admin-leave-save").addEventListener("click", () => {
  if (saveAdmin()) {
    $("admin-leave-dialog").close();
    finishAdminLeave();
  } else $("admin-leave-dialog").close();
});
$("admin-defaults-confirm").addEventListener("click", () => {
  adminDraft = clone(DEFAULT_SETTINGS);
  $("admin-defaults-dialog").close();
  renderAdminSection();
  toast("Standardvorlage als Entwurf geladen. Zum Übernehmen speichern.");
});
$("admin-app").addEventListener("input", (event) => {
  const path = event.target.dataset.configPath;
  if (!path) return;
  const keys = path.split("."),
    last = keys.pop();
  let target = adminDraft;
  for (const key of keys) target = target[key];
  target[last] = event.target.type === "checkbox" ? event.target.checked : event.target.value;
  const editor = event.target.closest(".ad-editor");
  if (editor && last === "title")
    editor.querySelector(".ad-editor-name").textContent = event.target.value;
  if (path.startsWith("app."))
    document
      .querySelectorAll(`[data-preview="${last}"]`)
      .forEach(
        (node) =>
          (node.textContent =
            event.target.value || (last === "defaultArtist" ? "Dein Artist" : "")),
      );
  updateAdminChrome();
  $("admin-error").hidden = true;
});
$("admin-app").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.adminPage) {
    adminPage = button.dataset.adminPage;
    renderAdminSection();
    window.scrollTo(0, 0);
  }
  if (button.dataset.setTheme) setTheme(button.dataset.setTheme);
  if (button.dataset.addKind) {
    const key = button.dataset.addKind;
    if (adminDraft[key].length >= 40) {
      configError("Es sind maximal 40 Einträge pro Bereich möglich.");
      return;
    }
    const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    adminDraft[key].push(
      key === "medical"
        ? {
            id: "customMedical_" + suffix,
            title: "Weitere Gesundheitsfrage",
            hint: "Bitte erläutere hier deine Frage.",
          }
        : {
            id: "customLegal_" + suffix,
            title: "Weitere Einwilligung",
            text: "Erklärungstext ergänzen.",
            review: true,
          },
    );
    renderAdminSection();
    const editor = $("admin-section").querySelector(".ad-editor:last-of-type");
    editor.open = true;
    editor.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  if (button.dataset.removeKind) {
    const key = button.dataset.removeKind,
      index = Number(button.dataset.removeIndex);
    if (adminDraft[key][index]?.id.startsWith("custom")) {
      adminDraft[key].splice(index, 1);
      renderAdminSection();
    }
  }
  switch (button.dataset.adminAction) {
    case "pending":
      if (pendingConsent && !pendingConsent.confirmed) renderPdfArtifact(pendingConsent);
      break;
    case "guide": {
      const bytes = Uint8Array.from(atob(OWNER_GUIDE_BASE64), (ch) => ch.charCodeAt(0));
      presentPdfArtifact(
        new Blob([bytes], { type: "application/pdf" }),
        "Inkform-Anleitung-iPad-und-Admin.pdf",
        7,
        { isReport: true, reportTitle: "Anleitung für iPad und Admin" },
      );
      break;
    }
    case "preview":
      requestAdminLeave();
      break;
    case "test-files":
      runFilesTest();
      break;
    case "install":
      showDialog("install-dialog");
      break;
    case "copy-link":
      if (location.protocol === "https:")
        navigator.clipboard
          ?.writeText(location.origin + location.pathname)
          .then(() => toast("App-Link kopiert."))
          .catch(() => toast("Bitte den Link aus der Safari-Adresszeile kopieren."));
      else
        toast(
          "Diese lokale Testdatei hat noch keinen Weblink. Die iPad-Adresse wird später eingerichtet.",
        );
      break;
    case "export-json":
      exportSettings("json");
      break;
    case "export-html":
      exportSettings("html");
      break;
    case "import-json":
      $("admin-import-file").click();
      break;
    case "defaults":
      showDialog("admin-defaults-dialog");
      break;
  }
});
$("admin-import-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 1024 * 1024)
      throw new Error("Die Konfigurationsdatei darf maximal 1 MB groß sein.");
    const data = JSON.parse(await file.text());
    adminDraft = validateSettings(data);
    renderAdminSection();
    toast("Einstellungen als Entwurf importiert. Bitte prüfen und speichern.");
  } catch (error) {
    configError(
      "Import nicht möglich: " +
        (error instanceof SyntaxError ? "Die Datei enthält kein gültiges JSON." : error.message),
    );
  } finally {
    event.target.value = "";
  }
});
window.addEventListener("keydown", (event) => {
  if (adminOpen && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveAdmin();
  }
});
window.addEventListener("hashchange", () => {
  if (location.hash === "#admin" && !adminOpen) openAdmin();
  else if (adminOpen && location.hash !== "#admin") {
    history.replaceState(null, "", "#admin");
    requestAdminLeave();
  }
});
adminAccess = createAdminAccess({
  storage: {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
  },
  onExternalLock: () => {
    if (adminOpen) showCompletion();
  },
});
incomeFeature = createIncomeFeature({
  isUnlocked: () => adminAccess.isUnlocked(),
  createPdf: (options) => createPdfDocument(window.jspdf.jsPDF, options),
  unsupportedChars: unsupportedPdfChars,
  storage: {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
  },
  escape: escapeHtml,
  money: formatMoney,
  parseMoney: moneyCents,
  today: localDate,
  notify: toast,
  download: downloadFile,
  showReport: (blob, name, pages) => presentPdfArtifact(blob, name, pages, { isReport: true }),
});
applySettings(settings, { initial: true });
let initialTheme = embeddedConfig?.theme || "dark";
try {
  initialTheme = localStorage.getItem(THEME_KEY) || initialTheme;
} catch (_) {}
setTheme(initialTheme, false);
if (configLoadError) toast(configLoadError);
pendingStore = createPendingStore({
  storage: {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: (key) => localStorage.removeItem(key),
  },
  files: createIndexedDbFiles(),
});
let hasPending = false,
  restoring = Promise.resolve(false);
try {
  hasPending = !!pendingStore.read();
} catch (error) {
  toast(error.message);
}
try {
  if (!adminAccess.configured()) {
    showCompletion(true);
    openAdmin("overview");
  } else if (hasPending || sessionStorage.getItem("inkform.completion")) showCompletion();
  else if (location.hash === "#admin") openAdmin();
} catch (error) {
  showCompletion(true);
  toast(error.message);
}
// An unconfirmed consent from before a reload: keep the thank-you screen and restore it for
// the owner (PDF from this device, or "PDF fehlt" if it cannot be read back).
restoring = restorePending();
