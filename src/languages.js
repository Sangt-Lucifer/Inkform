// Languages of a studio: the language its own texts are written in (content), the language the
// app starts in (studio), the languages customers may choose and the currency. Texts of the form
// in other languages live in settings.translations; a language is offered to customers only when
// every text the form shows exists in it, never with German as a stand-in.
import { BASE_LANGUAGE, hasLanguage, t } from "./i18n.js";

export const TRANSLATED = {
  app: ["documentTitle", "eyebrow", "headline", "description", "photoText", "photoDeniedText", "signatureText", "privacyTemplate"],
  studio: ["retention", "recipients"],
  medical: ["title", "hint"],
  legal: ["title", "text"],
};
const NOTE_MAX = 500;

export function validCurrency(code) {
  if (typeof code !== "string" || !/^[A-Z]{3}$/.test(code)) return false;
  if (typeof Intl.supportedValuesOf === "function") return Intl.supportedValuesOf("currency").includes(code);
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions().currency === code;
  } catch {
    return false;
  }
}

// Languages missing in this build are dropped, so settings from a build with more languages load.
// An explicitly named content language that is missing is an error instead: the base texts are
// actually written in it, so relabeling them as another language would show the wrong texts under
// the wrong language, without the note for it, and never offer the correct translation for it.
export function validateLocale(value, fallback) {
  const input = value && typeof value === "object" ? value : fallback;
  const known = (code) => hasLanguage(code);
  if (typeof input.content === "string" && input.content && !known(input.content))
    throw new Error(t("languages.unknownContent", { sprache: input.content.slice(0, 20) }));
  const content = known(input.content) ? input.content : known(fallback.content) ? fallback.content : BASE_LANGUAGE;
  const studio = known(input.studio) ? input.studio : content;
  const customer = [...new Set([studio, ...(Array.isArray(input.customer) ? input.customer : []).filter(known)])];
  const currency = String(input.currency ?? fallback.currency ?? "EUR").trim().toUpperCase();
  if (!validCurrency(currency)) throw new Error(t("languages.badCurrency", { waehrung: String(currency).slice(0, 10) }));
  const note = {};
  for (const [code, text] of Object.entries(input.note && typeof input.note === "object" ? input.note : {})) {
    if (!known(code) || code === content) continue;
    if (typeof text !== "string" || text.length > NOTE_MAX)
      throw new Error(t("settings.tooLong", { feld: t("languages.note"), max: NOTE_MAX }));
    if (text.trim()) note[code] = text.normalize("NFC").trim();
  }
  return { content, studio, customer, currency, note };
}

// Keeps only known parts, ids of the base texts and strings within the base limits.
export function validateTranslations(value, base, content) {
  const output = {};
  if (!value || typeof value !== "object") return output;
  const text = (input, max) => {
    if (input === undefined || input === "") return undefined;
    if (typeof input !== "string" || input.length > max) throw new Error(t("languages.badTranslation"));
    return input.normalize("NFC").trim() || undefined;
  };
  for (const [code, tr] of Object.entries(value)) {
    if (!hasLanguage(code) || code === content || !tr || typeof tr !== "object") continue;
    const own = { app: {}, studio: {}, medical: {}, legal: {} };
    for (const part of ["app", "studio"])
      for (const key of TRANSLATED[part]) {
        const v = text(tr[part]?.[key], 18000);
        if (v !== undefined) own[part][key] = v;
      }
    for (const part of ["medical", "legal"])
      for (const item of base[part]) {
        const entry = {};
        for (const key of TRANSLATED[part]) {
          const v = text(tr[part]?.[item.id]?.[key], 8000);
          if (v !== undefined) entry[key] = v;
        }
        if (Object.keys(entry).length) own[part][item.id] = entry;
      }
    if (tr.draft === true) own.draft = true;
    output[code] = own;
  }
  return output;
}

// The settings as the form shows them in one language, or null if a text is missing there.
export function contentIn(settings, code) {
  if (code === settings.locale.content) return settings;
  const tr = settings.translations?.[code];
  if (!tr) return null;
  const filled = (part, base, keys) => keys.every((key) => !base[key] || tr[part]?.[key]);
  if (!filled("app", settings.app, TRANSLATED.app) || !filled("studio", settings.studio, TRANSLATED.studio)) return null;
  const items = (part) => {
    const out = settings[part].map((item) => ({ ...item, ...tr[part]?.[item.id] }));
    return out.every((item, i) => TRANSLATED[part].every((key) => !settings[part][i][key] || tr[part]?.[item.id]?.[key]))
      ? out
      : null;
  };
  const medical = items("medical"),
    legal = items("legal");
  if (!medical || !legal) return null;
  return { ...settings, app: { ...settings.app, ...tr.app }, studio: { ...settings.studio, ...tr.studio }, medical, legal };
}

export const offeredLanguages = (settings) => settings.locale.customer.filter((code) => contentIn(settings, code));
