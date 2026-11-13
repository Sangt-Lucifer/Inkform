import { LANGUAGE_KEY, applyTexts, language, markup, setLanguage, t, th } from "./i18n.js";
import { createAdminAccess } from "./access.js";
import { INCOME_KEY, createIncomeFeature, incomeId } from "./income.js";
import { STUDIO_DEFAULTS, DEFAULT_SETTINGS } from "./defaults.js";
import { PDF_FONT, createPdfDocument, unsupportedPdfChars } from "./pdf-fonts.js";
import { createIndexedDbFiles, createPendingStore } from "./pending.js";
import { birthDateValid, fileSlug, moneyCents, studioInitials } from "./consent.js";
import {
  ARCHIVE_DB,
  EXPORT_LOG_KEY,
  PDF_REMOVED_KEY,
  addRemovedIds,
  createExportFeature,
  formatSize,
  readExportLog,
  readRemovedIds,
} from "./export.js";
import { isSample, sampleRecords } from "./sample.js";
import {
  BACKUP_INTERVALS,
  BACKUP_INTERVAL_KEY,
  applyRemovals,
  createFullBackup,
  readBackupDays,
  readFullBackup,
} from "./backup.js";
import {
  LAST_BACKUP_KEY,
  PENDING_REMINDER_DAYS,
  daysBetween,
  dueForPdfDeletion,
  readRetention,
  validateRetention,
  writeRetention,
} from "./retention.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
// Capture before input so HTML exports never include customer values.
const APP_SOURCE_HTML = "<!DOCTYPE html>\n" + document.documentElement.outerHTML;
let studio = { ...STUDIO_DEFAULTS };
let adminAccess = null,
  incomeFeature = null,
  exportFeature = null,
  pendingStore = null,
  consentIncomeId = incomeId();
const MEDICAL = clone(DEFAULT_SETTINGS.medical);
const LEGAL = clone(DEFAULT_SETTINGS.legal);
const SETTINGS_KEY = "inkform.settings.v1";
const OWNER_GUIDE_BASE64 = "__OWNER_GUIDE__";
const OWNER_GUIDE_PAGES = Number("__OWNER_GUIDE_PAGES__");
// Neutral edition without a studio: setup assistant, sample data, no owner guide.
const BLANK_EDITION = "__BLANK_EDITION__" === "true";
const THEME_KEY = "inkform.theme.v1";
try {
  setLanguage(localStorage.getItem(LANGUAGE_KEY));
} catch (_) {}
function applyLanguage() {
  document.documentElement.lang = language().code;
  document.documentElement.dir = language().dir;
  applyTexts(document);
}
applyLanguage();
function validateSettings(value) {
  if (
    !value ||
    typeof value !== "object" ||
    value.schemaVersion !== 1 ||
    !value.studio ||
    !value.app
  )
    throw new Error(t("settings.unsupported"));
  function string(input, label, max, required = false) {
    if (typeof input !== "string" || input.length > max)
      throw new Error(t("settings.tooLong", { feld: label, max }));
    const result = input.normalize("NFC").trim();
    if (required && !result) throw new Error(t("settings.empty", { feld: label }));
    return result;
  }
  const studio = Object.fromEntries(
    Object.keys(STUDIO_DEFAULTS).map((key) => [
      key,
      string(
        value.studio[key],
        t("settings.studioField", { key }),
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
    throw new Error(t("settings.contactEmail"));
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
      string(value.app[key], t("settings.formField", { key }), maxLengths[key], key !== "defaultArtist"),
    ]),
  );
  function items(key) {
    const input = value[key],
      base = DEFAULT_SETTINGS[key];
    if (!Array.isArray(input) || input.length < base.length || input.length > 40)
      throw new Error(t(key === "medical" ? "settings.medicalCount" : "settings.legalCount"));
    const seen = new Set();
    const output = input.map((item) => {
      if (
        !item ||
        typeof item.id !== "string" ||
        (!base.some((b) => b.id === item.id) &&
          !/^custom(?:Medical|Legal)_[a-zA-Z0-9]+$/.test(item.id)) ||
        seen.has(item.id)
      )
        throw new Error(t("settings.badId"));
      seen.add(item.id);
      const result = { id: item.id, title: string(item.title, t("settings.itemTitle"), 250, true) };
      if (key === "medical") result.hint = string(item.hint, t("settings.itemHint"), 3000, true);
      else {
        result.text = string(item.text, t("settings.itemText"), 8000, true);
        result.review = item.id === "privacy" ? true : !!item.review;
      }
      return result;
    });
    if (base.some((item) => !seen.has(item.id)))
      throw new Error(t("settings.missingDefaults"));
    return output;
  }
  const medical = items("medical"),
    legal = items("legal");
  const ids = [...medical, ...legal].map((item) => item.id);
  if (new Set(ids).size !== ids.length)
    throw new Error(t("settings.duplicateIds"));
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
  configLoadError = t("settings.embeddedInvalid");
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
  configLoadError = t("settings.localInvalid");
}

const $ = (id) => document.getElementById(id);
const form = $("consent-form");
const localDate = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const dateFormat = (value) => (value ? language().date(value) : t("common.notGiven"));
const timeFormat = (date) => language().dateTime(date, { dateStyle: "medium", timeStyle: "long" });
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
                aria-label="${th("health.answerYesLabel", { frage: q.title })}"
              /><span>${th("common.yes")}</span></label
            ><label class="choice"
              ><input
                type="radio"
                name="${q.id}"
                value="no"
                required
                aria-label="${th("health.answerNoLabel", { frage: q.title })}"
              /><span>${th("common.no")}</span></label
            >
          </div>
        </div>
        <div class="field details-field" id="details-${q.id}" hidden>
          <label for="note-${q.id}"
            >${th("health.detailsLabel")} <span class="optional">${th("common.optional")}</span></label
          ><textarea
            id="note-${q.id}"
            name="note-${q.id}"
            rows="2"
            maxlength="2000"
            placeholder="${th("health.detailsPlaceholder")}"
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
            item.review ? `<span class="inline-review">${th("common.inlineReview")}</span>` : ""
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
    (_, key) => studio[key] || t("privacy.missingStudio"),
  );
}
function renderStudio() {
  $("privacy-text").textContent = privacyText();
  $("studio-button-label").textContent = t("customer.admin");
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
  $("signature-time").textContent = t("signature.timeAuto");
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
const formatMoney = (cents) => language().money(cents);
function priceErrors() {
  const total = moneyCents(fieldValue("totalPrice"));
  const deposit = moneyCents(fieldValue("depositPaid"));
  const errors = [];
  if (Number.isNaN(total))
    errors.push({
      id: "totalPrice",
      message: t("price.totalInvalid"),
    });
  if (Number.isNaN(deposit))
    errors.push({
      id: "depositPaid",
      message: t("price.depositInvalid"),
    });
  if (deposit !== null && total === null)
    errors.push({
      id: "totalPrice",
      message: t("price.depositWithoutTotal"),
    });
  if (Number.isFinite(total) && Number.isFinite(deposit) && deposit > total)
    errors.push({
      id: "depositPaid",
      message: t("price.depositTooHigh"),
    });
  return errors;
}
function updatePriceBalance() {
  const total = moneyCents(fieldValue("totalPrice"));
  const deposit = moneyCents(fieldValue("depositPaid"));
  const valid = Number.isFinite(total) && Number.isFinite(deposit) && deposit <= total;
  $("price-balance").hidden = !valid;
  $("price-balance").textContent = valid
    ? t("price.balance", { betrag: formatMoney(total - deposit) })
    : "";
}
function updateProgress() {
  updatePriceBalance();
  let complete = 0;
  ["personal", "health", "consent", "signature"].forEach((id) => {
    const done = isSectionComplete(id);
    if (done) complete++;
    const status = document.querySelector(`[data-status="${id}"]`);
    status.textContent = t(done ? "status.complete" : "status.open");
    status.classList.toggle("complete", done);
    document
      .querySelectorAll(`[data-step="${id}"]`)
      .forEach((link) => link.classList.toggle("done", done));
  });
  $("overall-label").textContent = t("customer.progressLabel", { anzahl: complete });
  $("progress-fill").style.width = `${complete * 25}%`;
  $("progress").setAttribute("aria-valuenow", complete);
  $("export-status").textContent =
    complete === 4 ? t("export.ready") : t("customer.progressLabel", { anzahl: complete });
  $("signature-name").textContent =
    [fieldValue("firstName"), fieldValue("lastName")].filter(Boolean).join(" ") ||
    t("signature.namePlaceholder");
}
form.addEventListener("input", (event) => {
  dirty = true;
  if (ink.strokes.length)
    clearSignature(t("signature.changed"));
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
      clearSignature(t("signature.changed"));
    dirty = true;
    invalidatePdf();
    updateProgress();
  }
});
function validate() {
  const errors = priceErrors();
  form.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
  const requireText = (id, label) => {
    if (!fieldValue(id)) errors.push({ id, message: t("validate.required", { feld: t(label) }) });
  };
  requireText("firstName", "personal.firstName");
  requireText("lastName", "personal.lastName");
  if (!fieldValue("birthDate"))
    errors.push({ id: "birthDate", message: t("validate.birthDate") });
  else if (!birthValid())
    errors.push({
      id: "birthDate",
      message: t("validate.birthDateInvalid"),
    });
  requireText("appointment", "tattoo.appointment");
  requireText("artist", "tattoo.artist");
  requireText("placement", "tattoo.placement");
  requireText("motif", "tattoo.motif");
  if (fieldValue("email") && !$("email").checkValidity())
    errors.push({ id: "email", message: t("validate.email") });
  if (!$("sober").checked)
    errors.push({
      id: "sober",
      message: t("validate.sober"),
    });
  MEDICAL.forEach((q) => {
    if (!choiceValue(q.id))
      errors.push({
        id: `q-${q.id}`,
        message: t("validate.medical", { frage: q.title }),
      });
  });
  LEGAL.forEach((item) => {
    if (!$(item.id).checked)
      errors.push({ id: item.id, message: t("validate.legal", { erklaerung: item.title }) });
  });
  if (!choiceValue("photo"))
    errors.push({
      id: "photo-fieldset",
      message: t("validate.photo"),
    });
  if (!hasSignature() || !ink.signedAt || ink.active !== null)
    errors.push({
      id: "signature-canvas",
      message: t("validate.signature"),
    });
  const box = $("error-summary");
  box.replaceChildren();
  if (errors.length) {
    const title = document.createElement("strong");
    title.textContent = t("validate.summary");
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
  toast(t("customer.newFormReady"));
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
    title: t("pdf.docTitle", { name: fullName }),
    subject: t("pdf.docSubject", { version, referenz: reference }),
    author: data.studio.name,
    creator: t("pdf.docCreator"),
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
    doc.text(t("pdf.headerLabel"), margin, 22);
    font(8, false, grey);
    doc.text(reference, 192, 15, { align: "right" });
    doc.text(t("pdf.formVersion", { version }), 192, 22, { align: "right" });
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
    paragraph(t("pdf.labelValue", { feld: label, wert: value || t("common.notGiven") }), { size: 10, after: 2 });
  }
  function review(text) {
    paragraph(t("common.reviewLabel"), { size: 8, bold: true, color: red, after: 1 });
    paragraph(text, { size: 9, color: red, after: 4 });
  }
  header();
  paragraph(data.template?.documentTitle || settings.app.documentTitle, {
    size: 20,
    bold: true,
    after: 5,
  });
  paragraph(t("pdf.studio", { studio: data.studio.name }), { size: 10, bold: true });
  paragraph(`${data.studio.address} | ${data.studio.contact}`, { size: 9, color: grey });
  review(t("pdf.draftNotice"));
  title(t("pdf.section1"));
  labelValue(t("pdf.fullName"), fullName);
  labelValue(t("personal.birthDate"), dateFormat(f.birthDate));
  labelValue(
    t("pdf.address"),
    [f.street, [f.postalCode, f.city].filter(Boolean).join(" ")].filter(Boolean).join(", "),
  );
  labelValue(t("pdf.phone"), f.phone);
  labelValue(t("pdf.email"), f.email);
  labelValue(t("pdf.appointment"), dateFormat(f.appointment));
  labelValue(t("tattoo.artist"), f.artist);
  labelValue(t("tattoo.placement"), f.placement);
  labelValue(t("tattoo.size"), f.size);
  labelValue(t("tattoo.motif"), f.motif);
  const total = moneyCents(f.totalPrice),
    deposit = moneyCents(f.depositPaid);
  if (Number.isFinite(total)) {
    ensure(30);
    paragraph(t("pdf.price"), { size: 11, bold: true });
    labelValue(t("pdf.priceTotal"), formatMoney(total));
    if (Number.isFinite(deposit)) {
      labelValue(t("pdf.priceDeposit"), formatMoney(deposit));
      labelValue(t("pdf.priceBalance"), formatMoney(total - deposit));
    }
  }
  title(t("pdf.section2"));
  paragraph(t("pdf.sober"), { size: 10, bold: true });
  data.medical.forEach((q) => {
    ensure(19);
    paragraph(t("pdf.answer", { frage: q.title, antwort: t(q.value === "yes" ? "pdf.yes" : "pdf.no") }), {
      size: 10,
      bold: true,
      after: 1,
    });
    paragraph(q.hint, { size: 9, color: grey, after: 2 });
    if (q.note) paragraph(t("pdf.note", { text: q.note }), { size: 9, indent: 3 });
  });
  labelValue(t("pdf.medication"), f.medicationNotes);
  if (data.medical.some((q) => q.value === "yes")) paragraph(t("pdf.yesNotice"), { size: 10, bold: true });
  title(t("pdf.section3"));
  data.legal.forEach((item) => {
    ensure(22);
    paragraph(t("pdf.confirmed", { erklaerung: item.title }), {
      size: 10,
      bold: true,
      color: item.review ? red : black,
      after: 2,
    });
    if (item.review) review(item.text);
    else paragraph(item.text, { size: 10, after: 5 });
  });
  ensure(22);
  paragraph(t(data.photo === "yes" ? "pdf.photoYes" : "pdf.photoNo"), { size: 11, bold: true, color: red });
  review(
    data.photo === "yes"
      ? data.template?.photoText || settings.app.photoText
      : data.template?.photoDeniedText || settings.app.photoDeniedText,
  );
  title(t("pdf.privacy"));
  review(data.privacy);
  const imageWidth = 150,
    imageHeight = Math.min(60, imageWidth * data.signature.ratio);

  // Keep the consent statement and signature on the same PDF page.
  ensure(imageHeight + 100);
  title(t("pdf.section4"));
  paragraph(data.template?.signatureText || settings.app.signatureText, { size: 10 });

  ensure(imageHeight + 48);
  labelValue(t("pdf.place"), data.studio.location);
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
  paragraph(t("pdf.signed", { zeit: timeFormat(data.signedAt) }), { size: 9, after: 2 });
  paragraph(t("pdf.signedUtc", { zeit: data.signedAt.toISOString() }), {
    size: 8,
    color: grey,
    after: 4,
  });
  paragraph(t("pdf.created", { zeit: stamp }), { size: 8, color: grey, after: 2 });
  paragraph(t("pdf.clockNotice"), { size: 8, color: grey });
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setDrawColor(224, 228, 217);
    doc.line(margin, 282, 192, 282);
    font(7, false, grey);
    doc.text(t("pdf.footer", { referenz: reference }), margin, 287);
    doc.text(t("pdf.page", { seite: page, seiten: pages }), 192, 287, { align: "right" });
    font(7, true, red);
    doc.text(t("pdf.footerDraft"), margin, 292);
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
  toast(t("customer.libraryMissingToast"));
});
form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!validate()) return;
  if (Object.values(studio).some((value) => !value.trim())) {
    toast(t("customer.studioMissing"));
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
      toast(t("pdf.unsupportedChars", { zeichen: missing.join(" ") }));
      return;
    }
    const result = createPdf(data),
      blob = result.doc.output("blob");
    const slug = fileSlug(normalizeText(`${data.fields.lastName}_${data.fields.firstName}`));
    const clock = data.createdAt.toTimeString().slice(0, 8).replaceAll(":", "");
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    const filename = `${t("file.consent")}_${slug}_${data.fields.appointment}_${clock}_${suffix}.pdf`;
    // Prepared now, booked only when the owner confirms the filing (pdf-next).
    const incomeEntry = incomeFeature.capture(data, filename, consentIncomeId);
    presentPdfArtifact(blob, filename, result.pages, { autoSave: true, incomeEntry });
    showCompletion();
    keepPending(pendingConsent);
  } catch (error) {
    console.error("PDF-Erstellung fehlgeschlagen:", error);
    toast(t("pdf.createFailed"));
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
    reportTitle = t("pdf.reportTitle"),
  } = {},
) {
  if (!isTest && !isReport && pendingConsent && !pendingConsent.confirmed)
    throw Error(t("pdf.pendingFirst"));
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
      ? t("pdf.testTitle")
      : missing
        ? t("pdf.missingTitle")
        : t("pdf.ready");
  $("pdf-filename").textContent = filename;
  $("pdf-meta").textContent = missing
    ? t("pdf.missingMeta")
    : t(isReport ? "pdf.metaReport" : isTest ? "pdf.metaTest" : "pdf.metaConsent", {
        anzahl: pages,
        kb: Math.ceil(blob.size / 1024),
      });
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
  $("income-capture-note").textContent = t(missing ? "pdf.captureMissing" : "pdf.capture");
  if (consent && artifact.keepError)
    $("income-capture-note").textContent = t("pdf.keepWarning", {
      fehler: artifact.keepError,
      hinweis: $("income-capture-note").textContent,
    });
  $("pdf-preview-details").open = false;
  const native =
    !missing && canSharePdf(new File([blob], filename, { type: "application/pdf" }));
  $("pdf-share").hidden = !native;
  $("share-status").textContent = missing
    ? ""
    : native
      ? t("share.native")
      : t("share.fallback");
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
          ? t("share.testTitle")
          : t("share.consentTitle"),
    });
    if (pdfArtifact === artifact)
      $("share-status").textContent = t("share.done");
  } catch (error) {
    if (pdfArtifact === artifact)
      $("share-status").textContent =
        error.name === "AbortError"
          ? t("share.aborted")
          : t("share.failed");
  } finally {
    nativeShareInFlight = false;
    $("pdf-share").disabled = false;
  }
}
$("pdf-share").addEventListener("click", savePdfToFiles);
$("pdf-download").addEventListener("click", () => {
  $("share-status").textContent = t("share.download");
});
// Keeps the unconfirmed consent on this device until the owner confirms the filing.
// Until the PDF is stored (keptOk), leaving the page asks for confirmation; if storing fails, the
// thank-you screen and the owner's PDF dialog say so: the consent then exists only in memory.
function keepPending(artifact) {
  if (!artifact?.incomeEntry || !pendingStore) return;
  const failed = (message) => {
    artifact.keepError = message;
    if (pendingConsent === artifact && !$("completion-screen").hidden)
      $("completion-copy").textContent = t("completion.notKept");
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
        if (!stored) failed(t("pending.pdfNotKept"));
        return stored;
      });
  } catch (error) {
    console.error("Offene Einwilligung nicht gesichert:", error);
    artifact.kept = Promise.resolve(false);
    failed(t("pending.notKept", { fehler: error.message }));
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
      throw Error(t("pending.entryMissing"));
    // Booking is idempotent per consent: a repeated confirmation never adds a second entry.
    incomeFeature.book(artifact.incomeEntry, { pdfMissing });
  } catch (error) {
    $("share-status").textContent = t("pending.bookFailed", { fehler: error.message });
    toast(t("pending.bookFailedToast"));
    return;
  }
  artifact.confirmed = true;
  // Booking is written: the PDF is kept for the ZIP export, and this consent's pending copy is
  // removed. The metadata goes at once, so the next customer can start; the pending PDF is deleted
  // once a write still in progress has finished. If that fails, the start-up sweep removes it.
  if (!pdfMissing && artifact.blob)
    exportFeature.keep(artifact.incomeEntry.id, artifact.blob).catch((error) => {
      console.error("PDF nicht für den Export gespeichert:", error);
      toast(t("pending.archiveFailed"));
    });
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
    toast(t("filesTest.libraryMissing"));
    return;
  }
  const doc = createPdfDocument(window.jspdf.jsPDF, { unit: "mm", format: "a4" });
  doc.setFont(PDF_FONT, "bold");
  doc.setFontSize(22);
  doc.text(t("filesTest.title"), 20, 30);
  doc.setFont(PDF_FONT, "normal");
  doc.setFontSize(12);
  doc.text(t("filesTest.line1"), 20, 48);
  doc.text(t("filesTest.line2"), 20, 61);
  doc.text(t("filesTest.line3"), 20, 69);
  doc.setFontSize(10);
  doc.text(timeFormat(new Date()), 20, 88);
  const clock = new Date().toTimeString().slice(0, 8).replaceAll(":", "");
  presentPdfArtifact(doc.output("blob"), `${t("file.filesTest")}_${localDate()}_${clock}.pdf`, 1, {
    autoSave: true,
    isTest: true,
  });
}
// Texts are keys of the language files.
const ADMIN_PAGES = {
  ...(BLANK_EDITION && {
    setup: {
      label: "admin.page.setup.label",
      icon: "settings",
      title: "admin.page.setup.title",
      description: "admin.page.setup.description",
    },
  }),
  overview: {
    label: "admin.page.overview.label",
    icon: "grid",
    title: "admin.page.overview.title",
    description: "admin.page.overview.description",
  },
  studio: {
    label: "admin.page.studio.label",
    icon: "building",
    title: "admin.page.studio.title",
    description: "admin.page.studio.description",
  },
  content: {
    label: "admin.page.content.label",
    icon: "pen",
    title: "admin.page.content.title",
    description: "admin.page.content.description",
  },
  medical: {
    label: "admin.page.medical.label",
    icon: "heart",
    title: "admin.page.medical.title",
    description: "admin.page.medical.description",
  },
  legal: {
    label: "admin.page.legal.label",
    icon: "doc",
    title: "admin.page.legal.title",
    description: "admin.page.legal.description",
  },
  income: {
    label: "admin.page.income.label",
    icon: "doc",
    title: "admin.page.income.title",
    description: "admin.page.income.description",
  },
  export: {
    label: "admin.page.export.label",
    icon: "download",
    title: "admin.page.export.title",
    description: "admin.page.export.description",
  },
  retention: {
    label: "admin.page.retention.label",
    icon: "lock",
    title: "admin.page.retention.title",
    description: "admin.page.retention.description",
  },
  privacy: {
    label: "admin.page.privacy.label",
    icon: "lock",
    title: "admin.page.privacy.title",
    description: "admin.page.privacy.description",
  },
  ipad: {
    label: "admin.page.ipad.label",
    icon: "tablet",
    title: "admin.page.ipad.title",
    description: "admin.page.ipad.description",
  },
  appearance: {
    label: "admin.page.appearance.label",
    icon: "sliders",
    title: "admin.page.appearance.title",
    description: "admin.page.appearance.description",
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
      th("preview.title"),
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
          <div class="ad-preview-field">${th("personal.firstName")}</div>
          <div class="ad-preview-field">${th("personal.lastName")}</div>
          <div class="ad-preview-field">${th("personal.birthDate")}</div>
          <div class="ad-preview-field" data-preview="defaultArtist">
            ${escapeHtml(a.defaultArtist || t("preview.artist"))}
          </div>
          <div class="ad-preview-button">${th("preview.button")} ${adminIcon("arrow")}</div>
        </div>
        <p class="ad-preview-note">${th("preview.note")}</p>`,
      th("preview.draft"),
    )}
    <div class="ad-notice review">
      <strong>${th("preview.legalTitle")}</strong><br />${th("preview.legalText")}
    </div>
  </aside>`;
}
function shortcuts() {
  return [
    ["studio", "building", th("admin.page.studio.label"), th("shortcut.studio")],
    ["content", "pen", th("admin.page.content.label"), th("shortcut.content")],
    ["medical", "heart", th("admin.page.medical.label"), th("shortcut.medical", { anzahl: adminDraft.medical.length })],
    ["legal", "doc", th("admin.page.legal.label"), th("shortcut.legal")],
    ["privacy", "lock", th("admin.page.privacy.title"), th("shortcut.privacy")],
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
  // Only the storage reads may fail (blocked or damaged storage); then there is simply no reminder.
  let pending = null;
  try {
    pending = pendingStore?.read() ?? null;
  } catch (_) {}
  const age = pending ? daysBetween(pending.savedAt) : 0;
  if (pending && age >= PENDING_REMINDER_DAYS && pendingConsent && !pendingConsent.confirmed) {
    notes.push(t("reminder.pending", { anzahl: age }));
    buttons.push(`<button class="ad-button primary" type="button" data-admin-action="pending">${th("reminder.pendingButton")}</button>`);
  }
  let pdfYears = null,
    records = [];
  try {
    ({ pdfYears } = readRetention(localStorage));
    records = incomeFeature.list();
  } catch (_) {}
  const open = dueForPdfDeletion(records, pdfYears, localDate()).length;
  if (open) {
    notes.push(t("reminder.retention", { anzahl: open }));
    buttons.push(`<button class="ad-button" type="button" data-admin-page="retention">${th("reminder.retentionButton")}</button>`);
  }
  const backup = backupState();
  if (records.length && (backup.age === null || backup.age >= backup.days)) {
    notes.push(
      backup.age === null ? t("reminder.noBackup") : t("reminder.backupAge", { anzahl: backup.age }),
    );
    buttons.push(`<button class="ad-button" type="button" data-admin-action="backup-create">${th("reminder.backupButton")}</button>`);
  }
  let log = [];
  try {
    log = readExportLog(localStorage);
  } catch (_) {}
  const months = exportFeature.unexportedMonths(log);
  if (months.length) {
    const name = (month) => language().date(`${month}-15`, { month: "long", year: "numeric" });
    notes.push(t("reminder.unexported", { monate: months.map(name).join(", ") }));
    buttons.push(`<button class="ad-button" type="button" data-admin-page="export">${th("reminder.exportButton")}</button>`);
  }
  return notes.length
    ? `<div class="ad-notice ad-reminder" role="status">${notes.map((n) => `<p>${escapeHtml(n)}</p>`).join("")}<div class="ad-actions-row">${buttons.join("")}</div></div>`
    : "";
}
function backupState() {
  let last = null,
    days = 7;
  try {
    last = localStorage.getItem(LAST_BACKUP_KEY);
    days = readBackupDays(localStorage);
  } catch (_) {}
  return { age: last ? daysBetween(last) : null, days };
}
let preparedBackup = null;
function backupPanel() {
  const { age, days } = backupState();
  const status =
    age === null
      ? t("backup.none")
      : t(age >= days ? "backup.ageDue" : "backup.age", { anzahl: age });
  return adminPanel(
    th("backup.title"),
    `<p class="ad-section-copy${age === null || age >= days ? " ad-warn" : ""}">${escapeHtml(status)}</p>
    <p class="ad-section-copy">${th("backup.copy")}</p>
    <div class="income-filters"><label>${th("backup.interval")}<select id="backup-interval">${BACKUP_INTERVALS.map((d) => `<option value="${d}"${d === days ? " selected" : ""}>${th("backup.days", { anzahl: d })}</option>`).join("")}</select></label></div>
    <div class="ad-actions-row"><button class="ad-button primary" type="button" data-admin-action="backup-create">${adminIcon("download")}${th("backup.create")}</button><button class="ad-button primary" type="button" data-admin-action="backup-save" hidden>${adminIcon("share")}${th("pdf.share")}</button><button class="ad-button" type="button" data-admin-action="backup-restore">${adminIcon("upload")}${th("backup.restore")}</button></div>
    <p class="ad-preview-note" id="backup-note" role="status"></p>`,
  );
}
async function createBackup() {
  const note = $("backup-note");
  preparedBackup = null;
  document.querySelector('[data-admin-action="backup-save"]').hidden = true;
  note.textContent = t("backup.creating");
  try {
    // PDFs first: entries and the list are read afterwards, so a copy deleted meanwhile is marked.
    const pdfs = await exportFeature.pdfs(),
      backup = createFullBackup({
        settings,
        theme: document.documentElement.dataset.theme,
        retention: readRetention(localStorage),
        backupDays: readBackupDays(localStorage),
        exports: readExportLog(localStorage),
        pdfs,
        records: incomeFeature.list(),
        removed: readRemovedIds(localStorage),
      });
    preparedBackup = new File([JSON.stringify(backup)], `${t("file.backup")}_${localDate()}.json`, { type: "application/json" });
    note.textContent = t("backup.ready", {
      eintraege: backup.income.records.length,
      pdfs: backup.pdfs.length,
      groesse: formatSize(preparedBackup.size),
    });
    document.querySelector('[data-admin-action="backup-save"]').hidden = false;
  } catch (error) {
    note.textContent = t("backup.failed", { fehler: error.message });
  }
}
function saveBackup() {
  const file = preparedBackup;
  if (!file) return;
  saveFile(file).then(
    (way) => {
      localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString());
      preparedBackup = null;
      if (adminPage === "overview") renderAdminSection();
      $("backup-note").textContent =
        way === "download"
          ? t("backup.downloaded", { datei: file.name })
          : t("backup.shared", { datei: file.name });
    },
    (error) =>
      ($("backup-note").textContent =
        error.name === "AbortError"
          ? t("save.aborted")
          : t("save.failed")),
  );
}
const backupPicker = document.createElement("input");
backupPicker.type = "file";
backupPicker.accept = ".json,application/json";
backupPicker.hidden = true;
backupPicker.id = "backup-file";
document.body.append(backupPicker);
// Everything is checked first; the PDFs are written before the entries, so a failure leaves the
// current data in place (PDFs without an entry are removed by the next sync).
backupPicker.addEventListener("change", async () => {
  const file = backupPicker.files[0];
  backupPicker.value = "";
  if (!file || !adminAccess.isUnlocked()) return;
  try {
    if ((pendingConsent && !pendingConsent.confirmed) || pendingStore.read())
      throw Error(t("restore.pendingFirst"));
    if (adminChanged()) throw Error(t("restore.unsaved"));
    const data = readFullBackup(JSON.parse(await file.text()), validateSettings),
      { removed, records, pdfs, skipped } = applyRemovals(data, readRemovedIds(localStorage), incomeFeature.list(), localDate());
    if (
      !window.confirm(
        [
          t("restore.question", { datum: timeFormat(new Date(data.createdAt)) }),
          t("restore.contents", { eintraege: data.records.length, pdfs: data.pdfs.length }) +
            (skipped ? " " + t("restore.skipped", { anzahl: skipped }) : ""),
          t("restore.replaces", { eintraege: incomeFeature.list().length }),
        ].join("\n\n"),
      )
    )
      return;
    // The PDFs first: if writing them fails, nothing else (also not the list of deleted copies)
    // has changed yet.
    await exportFeature.restore(pdfs);
    localStorage.setItem(PDF_REMOVED_KEY, JSON.stringify([...removed]));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(data.settings));
    localStorage.setItem(THEME_KEY, data.theme);
    writeRetention(localStorage, data.retention);
    localStorage.setItem(BACKUP_INTERVAL_KEY, String(data.backupDays));
    localStorage.setItem(EXPORT_LOG_KEY, JSON.stringify(data.exports));
    localStorage.setItem(INCOME_KEY, JSON.stringify({ schemaVersion: 1, records }));
    localStorage.setItem(LAST_BACKUP_KEY, data.createdAt);
    await exportFeature.sync();
    sessionStorage.setItem("inkform.restored", data.createdAt);
    location.reload();
  } catch (error) {
    toast(t("restore.failed", { fehler: error.message }));
  }
});
const SETUP_FIELDS = ["name", "contact", "address", "location"];
// The neutral edition is set up once all four studio details are saved.
// Deletes copies in the app only (entries: { id, updatedAt } as confirmed). The ids are recorded for
// good and the entries marked, both synchronously; if marking fails, the list is put back and
// nothing is deleted. Only then does the sync remove the PDFs (also at the next start if it fails).
async function removePdfCopies(entries) {
  recordRemoved(
    entries.map((e) => e.id),
    () => incomeFeature.markCopiesRemoved(entries, localDate()),
  );
  incomeFeature.refresh();
  await exportFeature.sync();
}
// Adds the ids to the permanent list, then runs write(); if write fails, the list is put back.
function recordRemoved(ids, write) {
  const before = localStorage.getItem(PDF_REMOVED_KEY);
  addRemovedIds(localStorage, ids);
  try {
    write();
  } catch (error) {
    if (before === null) localStorage.removeItem(PDF_REMOVED_KEY);
    else localStorage.setItem(PDF_REMOVED_KEY, before);
    throw error;
  }
}
// Entries marked "PDF nicht mehr in der App", also from an income import, are recorded for good.
function rememberRemoved() {
  const known = readRemovedIds(localStorage),
    marked = incomeFeature.list().filter((r) => r.pdfRemovedAt && !known.has(r.id));
  if (marked.length) addRemovedIds(localStorage, marked.map((r) => r.id));
}
function needsSetup() {
  return BLANK_EDITION && SETUP_FIELDS.some((key) => !settings.studio[key].trim());
}
// Deadlines typed in the assistant; kept across re-renders until the setup is finished.
let setupYears = null;
function setupYearsShown() {
  if (setupYears) return setupYears;
  const { pdfYears, incomeYears } = readRetention(localStorage);
  return { pdfYears: pdfYears ?? "", incomeYears: incomeYears ?? "" };
}
function finishSetup() {
  if (SETUP_FIELDS.some((key) => !adminDraft.studio[key].trim())) {
    configError(t("setup.missing"));
    return;
  }
  let years;
  try {
    years = validateRetention(setupYearsShown());
  } catch (error) {
    configError(error.message);
    return;
  }
  if (!saveAdmin()) return;
  if (!storageWorking) {
    configError(t("setup.noStorage"));
    return;
  }
  writeRetention(localStorage, years);
  setupYears = null;
  adminPage = "overview";
  renderAdminSection();
  toast(t("setup.done"));
}
function samplePanel() {
  const loaded = incomeFeature.list().some(isSample);
  return adminPanel(
    th("sample.title"),
    `<p class="ad-section-copy">${th(loaded ? "sample.loaded" : "sample.offer")}</p><div class="ad-actions-row">${
      loaded
        ? `<button class="ad-button danger" type="button" data-admin-action="sample-remove">${adminIcon("trash")}${th("sample.remove")}</button>`
        : `<button class="ad-button" type="button" data-admin-action="sample-load">${adminIcon("plus")}${th("sample.load")}</button>`
    }</div>`,
  );
}
function samplePdf(record) {
  const doc = createPdfDocument(window.jspdf.jsPDF, { unit: "mm", format: "a4" });
  doc.setFont(PDF_FONT, "bold");
  doc.setFontSize(20);
  doc.text(t("sample.pdfTitle"), 20, 30);
  doc.setFont(PDF_FONT, "normal");
  doc.setFontSize(12);
  doc.text(t("sample.pdfName", { name: record.customer }), 20, 48);
  doc.text(t("sample.pdfDate", { datum: dateFormat(record.date) }), 20, 56);
  doc.text(t("sample.pdfArtist", { artist: record.artist || t("common.unassigned") }), 20, 64);
  doc.text(t("sample.pdfNote"), 20, 80);
  return doc.output("blob");
}
async function loadSamples() {
  if (!libraryAvailable()) return toast(t("sample.libraryMissing"));
  if (incomeFeature.list().some(isSample)) return;
  // All or nothing: after a failure every sample entry and PDF written so far is removed again.
  const records = sampleRecords(localDate());
  try {
    const pdfs = records.map(samplePdf);
    for (const record of records) incomeFeature.book(record);
    for (const [i, record] of records.entries()) await exportFeature.keep(record.id, pdfs[i]);
    toast(t("sample.loadedToast"));
  } catch (error) {
    try {
      incomeFeature.removeMany(records.map((r) => r.id));
      await exportFeature.sync();
    } catch (_) {}
    toast(t("sample.loadFailed", { fehler: error.message }));
  }
  renderAdminSection();
}
async function removeSamples() {
  try {
    incomeFeature.removeMany(incomeFeature.list().filter(isSample).map((r) => r.id));
    await exportFeature.sync();
    toast(t("sample.removedToast"));
  } catch (error) {
    toast(t("sample.removeFailed", { fehler: error.message }));
  }
  renderAdminSection();
}
function securityChecklist() {
  const items = [
    "security.passcode",
    "security.guidedAccess",
    "security.onMyIpad",
    "security.icloudBackup",
    "security.backup",
    "security.websiteData",
  ];
  return adminPanel(
    th("security.title"),
    `<ul class="ad-checklist">${items.map((key) => `<li>${th(key)}</li>`).join("")}</ul><div class="ad-actions-row"><button class="ad-button" type="button" data-admin-page="retention">${th("admin.page.retention.label")}</button></div>`,
    th("security.note"),
  );
}
function renderAdminSection() {
  const page = ADMIN_PAGES[adminPage];
  $("admin-page-title").textContent = t(page.title);
  $("admin-page-description").textContent = t(page.description);
  $("admin-breadcrumb").textContent = t(page.label);
  $("admin-error").hidden = true;
  $("admin-nav").innerHTML = Object.entries(ADMIN_PAGES)
    .map(
      ([id, p]) =>
        /* HTML */ `<button
          type="button"
          data-admin-page="${id}"
          ${id === adminPage ? 'aria-current="page"' : ""}
        >
          ${adminIcon(p.icon)}${th(p.label)}
        </button>`,
    )
    .join("");
  let content = "";
  if (adminPage === "income") {
    content = `<div id="income-content">${incomeFeature.view()}</div>`;
  } else if (adminPage === "setup") {
    content = `${adminPanel(
      th("setup.welcome"),
      `<p class="ad-section-copy">${th("setup.copy")}</p>
      <div class="ad-fields">${adminField("studio.name", t("studio.name"), { placeholder: t("studio.namePlaceholder"), max: 160 })}${adminField("studio.contact", t("studio.contact"), { type: "email", placeholder: t("studio.contactPlaceholder"), max: 160 })}${adminField("studio.address", t("studio.address"), { area: true, rows: 2, placeholder: t("studio.addressPlaceholder"), max: 300 })}${adminField("studio.location", t("studio.location"), { placeholder: t("studio.locationPlaceholder"), max: 100 })}
      <div class="ad-field"><label for="setup-pdf-years">${th("setup.pdfYears")}</label><input id="setup-pdf-years" inputmode="numeric" maxlength="2" value="${escapeHtml(String(setupYearsShown().pdfYears))}"></div>
      <div class="ad-field"><label for="setup-income-years">${th("setup.incomeYears")}</label><input id="setup-income-years" inputmode="numeric" maxlength="2" value="${escapeHtml(String(setupYearsShown().incomeYears))}"></div></div>
      <p class="ad-preview-note">${th("setup.note")}</p>
      <div class="ad-actions-row"><button class="ad-button primary" type="button" data-admin-action="setup-finish">${adminIcon("check")}${th("setup.finish")}</button></div>`,
    )}${samplePanel()}`;
  } else if (adminPage === "export") {
    content = `<div id="export-content">${exportFeature.view()}</div>`;
  } else if (adminPage === "retention") {
    content = `<div id="retention-content">${incomeFeature.retentionView()}</div>`;
  } else if (adminPage === "overview") {
    const filled = Object.values(adminDraft.studio).filter((v) => v.trim()).length;
    content = /* HTML */ `<div class="ad-stats">
        <div class="ad-stat">
          <div class="ad-stat-top">${th("overview.profile")} ${adminIcon("building")}</div>
          <strong>${filled}<span style="font-size:14px;color:var(--ad-muted)"> / 6</span></strong
          ><small
            ><span class="ad-dot"></span>${th(filled === 6 ? "overview.profileReady" : "overview.profileIncomplete")}</small
          >
        </div>
        <div class="ad-stat">
          <div class="ad-stat-top">${th("admin.page.medical.label")} ${adminIcon("heart")}</div>
          <strong>${adminDraft.medical.length}</strong><small>${th("overview.medicalNote")}</small>
        </div>
        <div class="ad-stat">
          <div class="ad-stat-top">${th("admin.page.legal.label")} ${adminIcon("doc")}</div>
          <strong>${adminDraft.legal.length}</strong><small>${th("overview.legalNote")}</small>
        </div>
      </div>
      ${privacyReminders()}${backupPanel()}${BLANK_EDITION ? samplePanel() : ""}
      <div class="ad-columns">
        <div>
          ${securityChecklist()}
          <section class="ad-panel">
            <div class="ad-panel-header">
              <h2>${th("overview.configure")}</h2>
              <span class="ad-chip">${th("overview.sections")}</span>
            </div>
            ${shortcuts()}
          </section>
          ${adminPanel(
            th("overview.transfer"),
            /* HTML */ `<p class="ad-section-copy">${th("overview.transferCopy")}</p>
              <div class="ad-actions-row">
                <button class="ad-button" type="button" data-admin-page="appearance">
                  ${adminIcon("download")}${th("overview.backupExport")}</button
                ><button class="ad-button" type="button" data-admin-action="preview">
                  ${adminIcon("external")}${th("overview.viewForm")}
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
          th("admin.page.studio.title"),
          /* HTML */ `<div class="ad-fields">
            ${adminField("studio.name", t("studio.name"), {
              placeholder: t("studio.namePlaceholder"),
              max: 160,
              help: th("studio.nameHelp"),
            })}${adminField("studio.contact", t("studio.contact"), {
              type: "email",
              placeholder: t("studio.contactPlaceholder"),
              max: 160,
            })}${adminField("studio.address", t("studio.address"), {
              area: true,
              rows: 2,
              placeholder: t("studio.addressPlaceholder"),
              max: 300,
            })}${adminField("studio.location", t("studio.location"), {
              placeholder: t("studio.locationPlaceholder"),
              max: 100,
            })}${adminField("app.defaultArtist", t("studio.defaultArtist"), {
              placeholder: t("tattoo.artistPlaceholder"),
              max: 100,
              help: th("studio.defaultArtistHelp"),
            })}
          </div>`,
        )}
        <div class="ad-notice">
          ${th("studio.privacyHint", {
            link: markup(`<button
            class="text-button"
            type="button"
            data-admin-page="privacy"
            style="color:var(--ad-blue);min-height:30px"
          >
            ${th("admin.page.privacy.label")} ${adminIcon("arrow")}</button
          >`),
          })}
        </div>
      </div>
      ${adminPreview()}
    </div>`;
  } else if (adminPage === "content") {
    content = /* HTML */ `<div class="ad-columns">
      <div>
        ${adminPanel(
          th("content.identity"),
          /* HTML */ `<div class="ad-fields">
            ${adminField("app.brand", t("content.brand"), {
              max: 24,
              placeholder: "INKFORM",
            })}${adminField("app.formVersion", t("content.formVersion"), {
              max: 50,
              help: th("content.formVersionHelp"),
            })}${adminField("app.eyebrow", t("content.eyebrow"), { max: 120 })}${adminField(
              "app.documentTitle",
              t("content.documentTitle"),
              { max: 120 },
            )}${adminField("app.headline", t("content.headline"), {
              area: true,
              rows: 2,
              max: 160,
            })}${adminField("app.description", t("content.description"), { area: true, rows: 3, max: 1200 })}
          </div>`,
        )}${adminPanel(
          th("content.photo"),
          /* HTML */ `<div class="ad-notice review">${th("content.photoNotice")}</div>
            <div class="ad-fields">
              ${adminField("app.photoText", t("content.photoText"), {
                area: true,
                rows: 7,
                max: 8000,
              })}${adminField("app.photoDeniedText", t("content.photoDenied"), {
                area: true,
                rows: 4,
                max: 4000,
                help: th("content.photoDeniedHelp"),
              })}
            </div>`,
        )}${adminPanel(
          th("content.signature"),
          adminField("app.signatureText", t("content.signatureText"), {
            area: true,
            rows: 4,
            max: 2000,
            help: th("content.signatureHelp"),
          }),
        )}
      </div>
      ${adminPreview()}
    </div>`;
  } else if (adminPage === "medical" || adminPage === "legal") {
    const medical = adminPage === "medical",
      key = medical ? "medical" : "legal",
      items = adminDraft[key];
    content = `${!medical ? `<div class="ad-notice review">${th("editor.legalNotice")}</div>` : ""}<div class="ad-panel"><div class="ad-panel-header"><h2>${th(medical ? "editor.medicalTitle" : "editor.legalTitle")}</h2><span class="ad-chip">${th(medical ? "editor.medicalCount" : "editor.legalCount", { anzahl: items.length })}</span></div><div class="ad-panel-body">${items
      .map(
        (item, index) =>
          /* HTML */ `<details class="ad-editor" ${index === 0 ? "open" : ""}>
            <summary>
              <span class="ad-editor-num">${String(index + 1).padStart(2, "0")}</span
              ><span class="ad-editor-name">${escapeHtml(item.title)}</span>${adminIcon("chevron")}
            </summary>
            <div class="ad-editor-body">
              <div class="ad-fields">
                ${adminField(`${key}.${index}.title`, t(medical ? "editor.question" : "settings.itemTitle"), {
                  area: true,
                  rows: 2,
                  max: 250,
                })}${adminField(
                  `${key}.${index}.${medical ? "hint" : "text"}`,
                  t(medical ? "editor.hint" : "editor.text"),
                  { area: true, rows: medical ? 3 : 5, max: medical ? 3000 : 8000 },
                )}
              </div>
              <div class="ad-editor-footer">
                ${
                  medical
                    ? `<span>${th("editor.answerFormat")}</span>`
                    : /* HTML */ `<label
                        ><input
                          type="checkbox"
                          data-config-path="${key}.${index}.review"
                          ${item.review ? "checked" : ""}
                          ${["privacy", "liability"].includes(item.id) ? "disabled" : ""}
                        />${th("editor.reviewMark")}</label
                      >`
                }${
                  item.id.startsWith("custom")
                    ? /* HTML */ `<button
                        class="ad-button danger"
                        type="button"
                        data-remove-kind="${key}"
                        data-remove-index="${index}"
                      >
                        ${adminIcon("trash")}${th("editor.remove")}
                      </button>`
                    : `<span>${th("editor.default")}</span>`
                }
              </div>
            </div>
          </details>`,
      )
      .join(
        "",
      )}<button class="ad-button" type="button" data-add-kind="${key}">${adminIcon("plus")}${th(medical ? "editor.addMedical" : "editor.addLegal")}</button></div></div>`;
  } else if (adminPage === "privacy") {
    content = /* HTML */ `<div class="ad-notice review">${th("privacyPage.notice")}</div>
      ${adminPanel(
        th("privacyPage.retention"),
        /* HTML */ `<div class="ad-fields">
          ${adminField("studio.retention", t("privacyPage.retentionField"), {
            area: true,
            rows: 4,
            max: 2000,
            placeholder: t("privacyPage.retentionPlaceholder"),
          })}${adminField("studio.recipients", t("privacyPage.recipients"), {
            area: true,
            rows: 4,
            max: 2000,
            placeholder: t("privacyPage.recipientsPlaceholder"),
          })}
        </div>`,
      )}${adminPanel(
        th("privacyPage.edit"),
        `${adminField("app.privacyTemplate", t("privacyPage.template"), { area: true, rows: 20, max: 18000, help: th("privacyPage.templateHelp") })}<div class="ad-notice" style="margin:20px 0 0">${th("privacyPage.generalOnly")}</div>`,
      )}`;
  } else if (adminPage === "ipad") {
    const secure = window.isSecureContext,
      ready = !!window.jspdf?.jsPDF;
    const testFile = new File(["INKFORM"], "test.pdf", { type: "application/pdf" });
    const native = canSharePdf(testFile),
      standalone =
        !!navigator.standalone || window.matchMedia("(display-mode: standalone)").matches;
    content =
      adminPanel(
        th("ipad.check"),
        /* HTML */ `<div class="ipad-checks">
          <div>
            <span>${th("ipad.start")}</span
            ><strong
              >${th(location.protocol === "file:" ? "ipad.startFile" : secure ? "ipad.startSecure" : "ipad.startPreview")}</strong
            >
          </div>
          <div>
            <span>${th("ipad.pdf")}</span><strong>${th(ready ? "ipad.pdfReady" : "ipad.pdfLoading")}</strong>
          </div>
          <div>
            <span>${th("ipad.share")}</span
            ><strong>${th(native ? "ipad.shareAvailable" : "ipad.shareFallback")}</strong>
          </div>
          <div>
            <span>${th("ipad.offline")}</span>
            <strong data-offline-status
              >${th(location.protocol === "file:" ? "ipad.offlineFile" : document.documentElement.dataset.offlineReady === "true" ? "offline.ready" : "ipad.offlinePending")}</strong
            >
          </div>
          <div>
            <span>${th("ipad.home")}</span
            ><strong>${th(standalone ? "ipad.homeActive" : "ipad.homeSetup")}</strong>
          </div>
        </div>`,
      ) +
      adminPanel(
        th("ipad.step1"),
        /* HTML */ `<p class="ad-section-copy">${th("ipad.step1Copy")}</p>
          <div class="ad-actions-row">
            <button class="ad-button" type="button" data-admin-action="copy-link">
              ${adminIcon("external")}${th("ipad.copyLink")}
            </button>
            <button class="ad-button" type="button" data-admin-action="install">
              ${adminIcon("tablet")}${th("admin.home")}
            </button>
          </div>`,
      ) +
      adminPanel(
        th("ipad.step2"),
        /* HTML */ `<p class="ad-section-copy">${th("ipad.step2Copy")}</p>
          <div class="ad-notice" style="margin:0">${th("ipad.step2Notice")}</div>`,
      ) +
      adminPanel(
        th("ipad.step3"),
        /* HTML */ `<p class="ad-section-copy">${th("ipad.step3Copy")}</p>
          <button class="ad-button primary" type="button" data-admin-action="test-files">
            ${adminIcon("download")}${th("ipad.test")}
          </button>`,
      ) +
      adminPanel(
        th("ipad.daily"),
        /* HTML */ `<ol class="ipad-steps">
            <li>${th("ipad.daily1")}</li>
            <li>${th("ipad.daily2")}</li>
            <li>${th("ipad.daily3")}</li>
            <li>${th("ipad.daily4")}</li>
            <li>${th("ipad.daily5")}</li>
          </ol>
          <p class="ad-preview-note">${th("ipad.dailyNote")}</p>`,
      );
  } else if (adminPage === "appearance") {
    content = `${adminPanel(
      th("appearance.title"),
      /* HTML */ `<p class="ad-section-copy">${th("appearance.copy")}</p>
        <div class="ad-theme-options">
          <button class="ad-theme-card" data-set-theme="light" type="button">
            <span class="ad-theme-swatch light"></span><strong>${th("theme.light")}</strong
            ><small>${th("appearance.lightNote")}</small></button
          ><button class="ad-theme-card" data-set-theme="dark" type="button">
            <span class="ad-theme-swatch dark"></span><strong>${th("theme.dark")}</strong
            ><small>${th("appearance.darkNote")}</small>
          </button>
        </div>`,
    )}${adminPanel(
      th("appearance.transfer"),
      /* HTML */ `<p class="ad-section-copy">${th("appearance.transferCopy")}</p>
        <div class="ad-actions-row">
          <button class="ad-button" type="button" data-admin-action="export-json">
            ${adminIcon("download")}${th("appearance.exportJson")}</button
          ><button class="ad-button" type="button" data-admin-action="import-json">
            ${adminIcon("upload")}${th("appearance.importJson")}</button
          ><button class="ad-button primary" type="button" data-admin-action="export-html">
            ${adminIcon("doc")}${th("appearance.exportHtml")}
          </button>
        </div>
        <p class="ad-preview-note">${th("appearance.transferNote")}</p>`,
    )}${adminPanel(
      th("appearance.defaults"),
      /* HTML */ `<div class="ad-reset-row">
        <div>
          <strong>${th("appearance.defaultsTitle")}</strong>
          <p>${th("appearance.defaultsCopy")}</p>
        </div>
        <button class="ad-button danger" type="button" data-admin-action="defaults">
          ${adminIcon("reset")}${th("appearance.defaultsButton")}
        </button>
      </div>`,
    )}<div class="ad-notice">${th("appearance.pinNotice")}</div>`;
  }
  $("admin-section").innerHTML = content;
  if (adminPage === "export") {
    exportFeature.preview();
    exportFeature.usage();
  }
  updateAdminChrome();
  updateThemeButtons();
}
function updateAdminChrome() {
  const changed = adminChanged();
  $("admin-savebar").hidden = (adminPage === "income" || adminPage === "retention") && !changed;
  $("admin-savebar").classList.toggle("unsaved", changed);
  $("admin-save-state").textContent = t(changed ? "savebar.unsaved" : "savebar.saved");
  $("admin-save-detail").textContent = changed
    ? t("savebar.unsavedDetail")
    : storageWorking
      ? settings.savedAt
        ? t("savebar.savedAt", { zeit: timeFormat(new Date(settings.savedAt)) })
        : t("savebar.local")
      : t("savebar.session");
  $("admin-discard").disabled = !changed;
  const name = (adminDraft?.studio.name || settings.studio.name).trim();
  $("admin-workspace-name").textContent = name || t("admin.workspaceDefault");
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
    clearSignature(t("signature.settingsChanged"));
    invalidatePdf();
  }
  settings = next;
  studio = { ...next.studio };
  MEDICAL.splice(0, MEDICAL.length, ...clone(next.medical));
  LEGAL.splice(0, LEGAL.length, ...clone(next.legal));
  renderQuestionnaire();
  renderStudio();
  $("customer-brand").textContent = next.app.brand;
  document.title = t("meta.customerTitle", { studio: studio.name.split(" · ")[0], marke: next.app.brand });
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
      ? t("savebar.savedToast")
      : t("savebar.sessionToast"),
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
  adminPage = needsSetup() ? "setup" : ADMIN_PAGES[page] ? page : "overview";
  adminOpen = true;
  $("customer-app").hidden = true;
  $("admin-app").hidden = false;
  document.title = t("meta.adminTitle", { studio: studio.name.split(" · ")[0] });
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
  document.title = t("meta.customerTitle", { studio: studio.name.split(" · ")[0], marke: settings.app.brand });
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
  $("completion-title").textContent = t(setup ? "completion.setupTitle" : "completion.title");
  $("completion-copy").textContent = t(setup ? "completion.setupCopy" : "completion.copy");
  $("completion-unlock").textContent = t(setup ? "completion.setupUnlock" : "completion.unlock");
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
// Share sheet ("In Dateien sichern") where available, otherwise a browser download. Call it
// synchronously from the tap, so Safari keeps the user activation.
function saveFile(file) {
  let native = false;
  try {
    native = !!(window.isSecureContext && navigator.share && navigator.canShare?.({ files: [file] }));
  } catch (_) {}
  if (!native) {
    downloadFile(file, file.name);
    return Promise.resolve("download");
  }
  return navigator.share({ files: [file], title: file.name }).then(() => "share");
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
    configError(t("exportSettings.unsaved"));
    return;
  }
  const payload = { ...clone(settings), theme: document.documentElement.dataset.theme };
  if (kind === "json")
    downloadFile(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
      `${t("file.settings")}_${localDate()}.json`,
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
      `${t("file.studioHtml")}_${localDate()}.html`,
    );
  }
  toast(
    kind === "json"
      ? t("exportSettings.json")
      : t("exportSettings.html"),
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
      /* HTML */ `<span>${th(theme === "dark" ? "theme.light" : "theme.dark")}</span>`;
    button.setAttribute("aria-label", t(theme === "dark" ? "theme.lightOn" : "theme.darkOn"));
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
  toast(t("savebar.discarded"));
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
  toast(t("defaults.loaded"));
});
$("admin-app").addEventListener("change", (event) => {
  if (event.target.id !== "backup-interval" || !adminAccess.isUnlocked()) return;
  localStorage.setItem(BACKUP_INTERVAL_KEY, event.target.value);
  renderAdminSection();
});
$("admin-app").addEventListener("input", (event) => {
  if (["setup-pdf-years", "setup-income-years"].includes(event.target.id))
    setupYears = { pdfYears: $("setup-pdf-years").value, incomeYears: $("setup-income-years").value };
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
            event.target.value || (last === "defaultArtist" ? t("preview.artist") : "")),
      );
  updateAdminChrome();
  $("admin-error").hidden = true;
});
$("admin-app").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.adminPage) {
    adminPage = needsSetup() ? "setup" : button.dataset.adminPage;
    renderAdminSection();
    window.scrollTo(0, 0);
  }
  if (button.dataset.setTheme) setTheme(button.dataset.setTheme);
  if (button.dataset.addKind) {
    const key = button.dataset.addKind;
    if (adminDraft[key].length >= 40) {
      configError(t("editor.max"));
      return;
    }
    const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    adminDraft[key].push(
      key === "medical"
        ? {
            id: "customMedical_" + suffix,
            title: t("editor.newMedicalTitle"),
            hint: t("editor.newMedicalHint"),
          }
        : {
            id: "customLegal_" + suffix,
            title: t("editor.newLegalTitle"),
            text: t("editor.newLegalText"),
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
    case "setup-finish":
      finishSetup();
      break;
    case "sample-load":
      loadSamples();
      break;
    case "sample-remove":
      removeSamples();
      break;
    case "backup-create":
      if (adminPage !== "overview") openAdminAuthorized("overview");
      createBackup();
      break;
    case "backup-save":
      saveBackup();
      break;
    case "backup-restore":
      backupPicker.click();
      break;
    case "pending":
      if (pendingConsent && !pendingConsent.confirmed) renderPdfArtifact(pendingConsent);
      break;
    case "guide": {
      const bytes = Uint8Array.from(atob(OWNER_GUIDE_BASE64), (ch) => ch.charCodeAt(0));
      presentPdfArtifact(
        new Blob([bytes], { type: "application/pdf" }),
        `${t("file.guide")}.pdf`,
        OWNER_GUIDE_PAGES,
        { isReport: true, reportTitle: t("guide.title") },
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
          .then(() => toast(t("ipad.linkCopied")))
          .catch(() => toast(t("ipad.linkManual")));
      else toast(t("ipad.noLink"));
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
      throw new Error(t("import.tooLarge"));
    const data = JSON.parse(await file.text());
    adminDraft = validateSettings(data);
    renderAdminSection();
    toast(t("import.done"));
  } catch (error) {
    configError(t("import.failed", { fehler: error instanceof SyntaxError ? t("import.badJson") : error.message }));
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
  onChange: () => {
    try {
      rememberRemoved();
    } catch (error) {
      toast(t("copies.recordFailed", { fehler: error.message }));
    }
    exportFeature?.sync().catch((error) => console.error("Export-Archiv nicht abgeglichen:", error));
  },
  copies: () => exportFeature?.copies() ?? new Set(),
  hasCopy: (id) => exportFeature.hasCopy(id),
  recordRemoved,
  // An entry marked "PDF nicht mehr in der App" is removed only once its id is in the permanent list.
  beforeRemove: (rows) => {
    const marked = rows.filter((r) => r.pdfRemovedAt).map((r) => r.id);
    if (marked.length) addRemovedIds(localStorage, marked);
  },
  removeCopy: (row) => {
    if (
      window.confirm(
        t("copies.removeOneQuestion", { name: row.customer, datum: dateFormat(row.date) }) +
          "\n\n" +
          t("copies.removeOneDetail"),
      )
    )
      removePdfCopies([{ id: row.id, updatedAt: row.updatedAt }]).then(
        () => toast(t("copies.removedOne")),
        (error) => toast(t("copies.removeOneFailed", { fehler: error.message })),
      );
  },
});
exportFeature = createExportFeature({
  archive: createIndexedDbFiles(globalThis.indexedDB, ARCHIVE_DB),
  records: () => incomeFeature.list(),
  incomeReport: (rows, scope) => incomeFeature.reportPdf(rows, scope),
  isUnlocked: () => adminAccess.isUnlocked(),
  escape: escapeHtml,
  notify: toast,
  save: saveFile,
  exportLog: () => readExportLog(localStorage),
  removedIds: () => readRemovedIds(localStorage),
  removeCopies: removePdfCopies,
  logExport: (entry) =>
    localStorage.setItem(EXPORT_LOG_KEY, JSON.stringify([...readExportLog(localStorage), entry].slice(-1000))),
  today: localDate,
});
try {
  rememberRemoved();
} catch (error) {
  console.error("Gelöschte PDF-Kopien nicht vermerkt:", error);
}
exportFeature.sync().catch((error) => console.error("Export-Archiv nicht abgeglichen:", error));
applySettings(settings, { initial: true });
let initialTheme = embeddedConfig?.theme || "dark";
try {
  initialTheme = localStorage.getItem(THEME_KEY) || initialTheme;
} catch (_) {}
setTheme(initialTheme, false);
if (configLoadError) toast(configLoadError);
if (BLANK_EDITION) document.querySelectorAll("[data-studio-only]").forEach((node) => (node.hidden = true));
if (!OWNER_GUIDE_BASE64) document.querySelectorAll('[data-admin-action="guide"]').forEach((node) => (node.hidden = true));
if (sessionStorage.getItem("inkform.restored")) {
  sessionStorage.removeItem("inkform.restored");
  toast(t("restore.done"));
}
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
  else if (location.hash === "#admin" || needsSetup()) openAdmin();
} catch (error) {
  showCompletion(true);
  toast(error.message);
}
// An unconfirmed consent from before a reload: keep the thank-you screen and restore it for
// the owner (PDF from this device, or "PDF fehlt" if it cannot be read back).
restoring = restorePending();
