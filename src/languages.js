// Languages of a studio: the language its own texts are written in (content), the language the
// app starts in (studio), the languages customers may choose and the currency. Texts of the form
// in other languages live in settings.translations; a language is offered to customers only when
// every text the form shows exists in it, never with German as a stand-in.
import { BASE_LANGUAGE, builtinLanguage, hasLanguage, isBuiltinLanguage, languageTexts, t, translator } from "./i18n.js";

export const TRANSLATED = {
  app: ["documentTitle", "eyebrow", "headline", "description", "photoText", "photoDeniedText", "signatureText", "privacyTemplate"],
  studio: ["retention", "recipients"],
  medical: ["title", "hint"],
  legal: ["title", "text"],
};
const NOTE_MAX = 500;
// Flags of the customer language buttons; a language without one shows its code (the language
// part only, at most three letters, e.g. "SR" for sr-Latn-RS).
const FLAGS = {
  de: `<svg viewBox="0 0 5 3" aria-hidden="true"><path fill="#000" d="M0 0h5v1H0z"/><path fill="#d00" d="M0 1h5v1H0z"/><path fill="#ffce00" d="M0 2h5v1H0z"/></svg>`,
  en: `<svg viewBox="0 0 60 30" aria-hidden="true"><path fill="#012169" d="M0 0h60v30H0z"/><path stroke="#fff" stroke-width="6" d="M0 0l60 30M60 0L0 30"/><path stroke="#c8102e" stroke-width="2" d="M0 0l60 30M60 0L0 30"/><path stroke="#fff" stroke-width="10" d="M30 0v30M0 15h60"/><path stroke="#c8102e" stroke-width="6" d="M30 0v30M0 15h60"/></svg>`,
};
// Other languages show the flag of their country as an emoji (Apple devices draw every country
// flag): the region in the code ("pt-BR", "sr-Latn-RS") or the country most associated with the
// language. Languages spoken across many countries (Arabic, Spanish, ...) keep their code unless
// the code names a region.
const REGIONS = {
  en: "GB", de: "DE", fr: "FR", it: "IT", pt: "PT", nl: "NL", pl: "PL", tr: "TR", ru: "RU", uk: "UA",
  cs: "CZ", sk: "SK", hu: "HU", ro: "RO", bg: "BG", el: "GR", hr: "HR", sr: "RS", sl: "SI", bs: "BA",
  mk: "MK", sq: "AL", da: "DK", sv: "SE", nb: "NO", nn: "NO", no: "NO", fi: "FI", is: "IS", et: "EE",
  lv: "LV", lt: "LT", ga: "IE", mt: "MT", ka: "GE", hy: "AM", az: "AZ", kk: "KZ", uz: "UZ", he: "IL",
  fa: "IR", zh: "CN", ja: "JP", ko: "KR", vi: "VN", th: "TH", id: "ID", ms: "MY", tl: "PH", hi: "IN",
  bn: "BD", ur: "PK", ne: "NP", si: "LK", km: "KH", lo: "LA", my: "MM", mn: "MN", am: "ET", sw: "KE",
};
export function languageRegion(code) {
  const parts = String(code).split("-");
  const region = parts.slice(1).find((part) => /^[A-Z]{2}$/i.test(part));
  return (region ?? REGIONS[parts[0].toLowerCase()] ?? "").toUpperCase() || null;
}
export const flagEmoji = (region) => String.fromCodePoint(...[...region].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
export function languageMark(code) {
  if (FLAGS[code]) return FLAGS[code];
  const region = languageRegion(code);
  return region
    ? `<span class="language-flag" aria-hidden="true">${flagEmoji(region)}</span>`
    : `<span class="language-code">${String(code).split("-")[0].replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase()}</span>`;
}
// Name of a language in itself: from its file, otherwise from the browser.
export function languageName(code) {
  if (hasLanguage(code)) return translator(code).name;
  try {
    return new Intl.DisplayNames([code], { type: "language" }).of(code) || code;
  } catch (_) {
    return code;
  }
}

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

// Every translatable text of the settings, as "part.key" or "part.id.key" -> base text.
export function translatedFields(settings) {
  const out = new Map();
  for (const part of ["app", "studio"]) for (const key of TRANSLATED[part]) out.set(`${part}.${key}`, settings[part]?.[key] ?? "");
  for (const part of ["medical", "legal"])
    for (const item of settings[part] ?? []) for (const key of TRANSLATED[part]) out.set(`${part}.${item.id}.${key}`, item[key] ?? "");
  return out;
}
export function fieldOf(tr, field) {
  const [part, a, b] = field.split(".");
  return b === undefined ? tr?.[part]?.[a] : tr?.[part]?.[a]?.[b];
}
export function setField(tr, field, value) {
  const [part, a, b] = field.split(".");
  tr[part] ??= {};
  if (b === undefined) tr[part][a] = value;
  else (tr[part][a] ??= {})[b] = value;
}
export function dropField(tr, field) {
  const [part, a, b] = field.split(".");
  if (b === undefined) delete tr[part]?.[a];
  else if (tr[part]?.[a]) {
    delete tr[part][a][b];
    if (!Object.keys(tr[part][a]).length) delete tr[part][a];
  }
}
export const emptyTranslation = () => ({ app: {}, studio: {}, medical: {}, legal: {} });
const FIELD_LABELS = {
  "app.eyebrow": "content.eyebrow",
  "app.documentTitle": "content.documentTitle",
  "app.headline": "content.headline",
  "app.description": "content.description",
  "app.photoText": "content.photoText",
  "app.photoDeniedText": "content.photoDenied",
  "app.signatureText": "content.signatureText",
  "app.privacyTemplate": "privacyPage.template",
  "studio.retention": "privacyPage.retentionField",
  "studio.recipients": "privacyPage.recipients",
};
// A translated field as the admin area names it: the field label, or the item's base title.
export function fieldLabel(field, base) {
  if (FIELD_LABELS[field]) return t(FIELD_LABELS[field]);
  const [part, id] = field.split(".");
  return base[part]?.find((item) => item.id === id)?.title || field;
}
export const fieldLimit = (field) => (/^(app|studio)\./.test(field) ? 18000 : 8000);

// One language of settings.translations with the fields of base only; `text` checks each value.
// stale lists translated fields whose base text changed since; staleBase keeps that earlier text.
export function readTranslation(tr, base, text) {
  const own = emptyTranslation();
  for (const field of translatedFields(base).keys()) {
    const v = text(fieldOf(tr, field), fieldLimit(field), field);
    if (v !== undefined) setField(own, field, v);
  }
  if (tr.draft === true) own.draft = true;
  const stale = [...new Set(Array.isArray(tr.stale) ? tr.stale : [])].filter((f) => typeof f === "string" && fieldOf(own, f) !== undefined);
  if (stale.length) {
    own.stale = stale;
    own.staleBase = Object.fromEntries(
      stale.map((f) => {
        const old = tr.staleBase?.[f];
        return [f, typeof old === "string" && old.length <= fieldLimit(f) ? old.normalize("NFC") : ""];
      }),
    );
  }
  return own;
}

export function validateTranslations(value, base, content) {
  const output = {};
  if (!value || typeof value !== "object") return output;
  for (const [code, tr] of Object.entries(value)) {
    if (!hasLanguage(code) || code === content || !tr || typeof tr !== "object") continue;
    output[code] = readTranslation(tr, base, (input, max, field) => {
      if (input === undefined || input === "") return undefined;
      if (typeof input !== "string" || input.length > max || /[<>]/.test(input))
        throw Object.assign(new Error(t("languages.badTranslation", { sprache: translator(code).name, feld: fieldLabel(field, base) })), {
          translation: { code, field },
        });
      return input.normalize("NFC").trim() || undefined;
    });
  }
  return output;
}

// Puts a field on the stale list with the base text its translation was made from.
export function markField(tr, field, base) {
  if (tr.stale?.includes(field)) return;
  tr.stale = [...(tr.stale ?? []), field];
  tr.staleBase = { ...tr.staleBase, [field]: base };
}
// Takes a field off the stale list: its translation was edited or confirmed as still fitting.
export function settleField(tr, field) {
  if (!tr?.stale?.includes(field)) return;
  tr.stale = tr.stale.filter((f) => f !== field);
  delete tr.staleBase?.[field];
  if (!tr.stale.length) {
    delete tr.stale;
    delete tr.staleBase;
  }
}

const same = (a, b) => String(a).normalize("NFC").trim() === String(b).normalize("NFC").trim();

// A translation that stayed the same while its base text changed may no longer say the same thing.
// It is kept but marked stale, with the base text it was translated from, until it is edited or
// confirmed; a language with stale texts is not offered to customers. A field is not stale where
// base text and translation are the pair it was made from again: the text it was marked against,
// or the profile's own text with the profile's translation.
export function markStale(next, previous, defaults = null) {
  const before = translatedFields(previous),
    shipped = defaults?.locale.content === next.locale.content ? translatedFields(defaults) : new Map(),
    translations = structuredClone(next.translations ?? {});
  for (const [code, tr] of Object.entries(translations)) {
    const old = previous.translations?.[code];
    for (const [field, text] of translatedFields(next)) {
      const value = fieldOf(tr, field),
        paired =
          (tr.staleBase && Object.hasOwn(tr.staleBase, field) && same(tr.staleBase[field], text)) ||
          (shipped.has(field) && same(shipped.get(field), text) && value === fieldOf(defaults.translations?.[code], field));
      if (value === undefined || !text || value !== fieldOf(old, field) || paired) settleField(tr, field);
      else if (before.has(field) && before.get(field) !== text) markField(tr, field, before.get(field));
    }
  }
  return { ...next, translations };
}

// Missing translated texts come from the profile's default translations wherever the base text is
// still the profile's own, so an installation from before a language was shipped gets it too.
// Own translations and the stale list are never touched.
export function withDefaultTranslations(settings, defaults) {
  if (settings.locale.content !== defaults.locale.content) return settings;
  const shippedBase = translatedFields(defaults),
    translations = structuredClone(settings.translations);
  for (const [code, shipped] of Object.entries(defaults.translations ?? {})) {
    if (code === settings.locale.content || !hasLanguage(code)) continue;
    const tr = translations[code] ?? emptyTranslation();
    let added = false;
    for (const [field, text] of translatedFields(settings)) {
      const value = fieldOf(shipped, field);
      if (value === undefined || fieldOf(tr, field) !== undefined || !shippedBase.has(field) || !same(shippedBase.get(field), text)) continue;
      setField(tr, field, value);
      added = true;
    }
    if (!added) continue;
    if (shipped.draft) tr.draft = true;
    translations[code] = tr;
  }
  return { ...settings, translations };
}

function filledIn(settings, code) {
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

// Every text of the form exists in this language, stale or not.
export const hasAllTexts = (settings, code) => formReady(code) && (code === settings.locale.content || !!filledIn(settings, code));
export const staleCount = (settings, code) => settings.translations?.[code]?.stale?.length ?? 0;

// The settings as the form shows them in one language, or null if a text is missing or stale there.
export function contentIn(settings, code) {
  if (!formReady(code)) return null;
  if (code === settings.locale.content) return settings;
  return staleCount(settings, code) ? null : filledIn(settings, code);
}

// The form starts in the studio language, or in the content language while that cannot be shown.
export const startLanguage = (settings) => (contentIn(settings, settings.locale.studio) ? settings.locale.studio : settings.locale.content);
export const offeredLanguages = (settings) => [
  ...new Set([startLanguage(settings), ...settings.locale.customer.filter((code) => contentIn(settings, code))]),
];

// Language packs: a language that is not built in, loaded from the app's own site (sprachen/),
// added and translated in the admin area, or taken from a backup, and kept on the device. A pack
// has the shape of a language file; every text in it passes the same rules as the built-in ones:
// only keys of the base language, the same placeholders, the plural forms of its locale, no markup
// but <b>, <strong> and <code>. Texts may be missing while a language is being translated: the
// admin area then shows them in English, and customers get the language only once every text of
// the form (formKeys) exists in it.
export const PACK_CODE = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2})?$/;
export const PACKS_MAX = 30;
export const PACK_TEXT_MAX = 4000;
const PLURAL_FORMS = ["zero", "one", "two", "few", "many", "other"];
const packForms = (value) => (typeof value === "string" ? [value] : Object.values(value));
const packPlaceholders = (value) =>
  [...new Set(packForms(value).flatMap((text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[0])))].sort().join(" ");
export const pluralForms = (locale) => new Intl.PluralRules(locale).resolvedOptions().pluralCategories;

// Texts the customer sees: the form, its messages, the thank-you screen and the consent PDF.
const FORM_PREFIXES = ["common", "completion", "consent", "customer", "health", "offline", "pdf", "personal", "price", "reset", "save", "share", "side", "signature", "size", "status", "tattoo", "theme", "validate"];
const FORM_KEYS = new Set([
  "export.button", "export.fillAll", "export.format", "export.title", "file.consent", "meta.customerTitle", "meta.customerTitleBare",
  "meta.description", "meta.title", "privacy.missingStudio", "settingsLocked.customerCopy", "settingsLocked.customerTitle",
]);
export const isFormKey = (key) => FORM_KEYS.has(key) || FORM_PREFIXES.includes(key.split(".")[0]);
// Texts that can end up in the consent PDF, which only prints what its font has.
const PDF_PREFIXES = ["common", "health", "pdf", "personal", "tattoo"];
const inPdf = (key) => key === "file.consent" || PDF_PREFIXES.includes(key.split(".")[0]);
export const baseKeys = () => Object.keys(builtinLanguage(BASE_LANGUAGE)?.texts ?? {});
export const formKeys = () => baseKeys().filter(isFormKey);

// Why one text of a pack is not usable, or null: model is the base text, categories the plural
// forms of the pack's locale.
export function packTextProblem(own, model, categories) {
  if (typeof model === "string") {
    if (typeof own !== "string") return "form";
  } else {
    if (!own || typeof own !== "object" || Array.isArray(own)) return "form";
    const forms = Object.keys(own);
    if (forms.some((f) => !PLURAL_FORMS.includes(f) || typeof own[f] !== "string") || categories.some((f) => !forms.includes(f))) return "plural";
  }
  for (const text of packForms(own)) {
    if (!text.trim()) return "empty";
    if (text.length > PACK_TEXT_MAX) return "long";
    if (/[<>]/.test(text.replace(/<\/?(?:b|strong|code)>/g, ""))) return "markup";
  }
  if (packPlaceholders(own) !== packPlaceholders(model)) return "placeholders";
  return null;
}
export function validatePack(code, value) {
  const fail = () => {
    throw Error(t("pack.invalid", { sprache: String(code).slice(0, 20) }));
  };
  const base = builtinLanguage(BASE_LANGUAGE);
  if (typeof code !== "string" || !PACK_CODE.test(code) || isBuiltinLanguage(code) || !base) fail();
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const { name, locale, dir, pdfFont, texts } = value;
  if (typeof name !== "string" || !name.trim() || name.length > 80) fail();
  let categories;
  try {
    if (typeof locale !== "string" || Intl.getCanonicalLocales(locale)[0] !== locale) fail();
    categories = pluralForms(locale);
  } catch (_) {
    fail();
  }
  if (!["ltr", "rtl"].includes(dir) || pdfFont !== base.pdfFont) fail();
  if (!texts || typeof texts !== "object" || Array.isArray(texts)) fail();
  const clean = {};
  for (const [key, own] of Object.entries(texts)) {
    if (!Object.hasOwn(base.texts, key) || packTextProblem(own, base.texts[key], categories)) fail();
    clean[key] = typeof own === "string" ? own : { ...own };
  }
  return { name: name.trim(), locale, dir, pdfFont, texts: clean };
}
// Several packs, e.g. from a backup: { code: pack }.
export function validatePacks(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error(t("pack.invalid", { sprache: "?" }));
  const entries = Object.entries(value);
  if (entries.length > PACKS_MAX) throw Error(t("pack.tooMany", { anzahl: PACKS_MAX }));
  return Object.fromEntries(entries.map(([code, pack]) => [code, validatePack(code, pack)]));
}

// A new, still empty pack for a language the studio translates itself.
export function newPack(code) {
  const locale = Intl.getCanonicalLocales(code)[0];
  const script = (() => {
    try {
      return new Intl.Locale(locale).maximize().script;
    } catch (_) {
      return "";
    }
  })();
  return {
    name: languageName(locale).replace(/^./, (ch) => ch.toLocaleUpperCase(locale)).slice(0, 80),
    locale,
    dir: ["Arab", "Hebr", "Thaa", "Syrc", "Nkoo", "Adlm"].includes(script) ? "rtl" : "ltr",
    pdfFont: builtinLanguage(BASE_LANGUAGE).pdfFont,
    texts: {},
  };
}
// Can the PDF font print a text? The app sets the check; without one (tests) every text can.
let printable = () => true;
export const usePrintableCheck = (check) => (printable = check);
// How far a language is: texts of the form and of the admin area that exist in it, and the texts
// for the PDF its font cannot print.
export function languageProgress(code) {
  const keys = baseKeys(),
    builtin = isBuiltinLanguage(code),
    texts = builtin ? builtinLanguage(code).texts : (languageTexts(code) ?? {});
  const has = (key) => builtin || Object.hasOwn(texts, key);
  const form = keys.filter(isFormKey),
    admin = keys.filter((key) => !isFormKey(key));
  const unprintable = builtin ? [] : form.filter((key) => inPdf(key) && has(key) && !packForms(texts[key]).every((text) => printable(text)));
  return {
    form: form.filter(has).length,
    formTotal: form.length,
    admin: admin.filter(has).length,
    adminTotal: admin.length,
    unprintable,
  };
}
// Customers get a language once every text of the form exists in it and the PDF can print it.
export function formReady(code) {
  if (isBuiltinLanguage(code)) return true;
  const p = languageProgress(code);
  return p.form === p.formTotal && !p.unprintable.length;
}

// Translation file: the texts of one language to translate outside the app, each with the German
// and English text as reference. Read back, it is checked text by text like the editor does; empty
// translations leave the device's texts as they are, so file and editor can take turns.
export const TRANSLATION_KIND = "inkform-uebersetzung";
export function translationFile(code, pack, note) {
  const base = builtinLanguage(BASE_LANGUAGE).texts,
    english = builtinLanguage("en")?.texts ?? {},
    forms = pluralForms(pack.locale),
    texts = {};
  for (const key of baseKeys()) {
    const own = pack.texts[key],
      translation = typeof base[key] === "string" ? (own ?? "") : Object.fromEntries(forms.map((f) => [f, own?.[f] ?? ""]));
    texts[key] = { de: base[key], ...(english[key] !== undefined && { en: english[key] }), translation, ...(isFormKey(key) && { form: true }) };
  }
  return { kind: TRANSLATION_KIND, schemaVersion: 1, note, code, name: pack.name, locale: pack.locale, dir: pack.dir, texts };
}
const cleanText = (value) => (typeof value === "string" ? value.normalize("NFC").trim() : value);
// What a file would change in a language: target is the language it is loaded into (null: the one
// the file names), existing its pack on this device (null: a new language). Takes the file format
// above or a language pack file ({ name, locale, dir, texts }, e.g. sprachen/fr.json).
export function readTranslationFile(value, target, existing) {
  const fail = (key, vars) => {
    throw Error(t(key, vars));
  };
  if (!value || typeof value !== "object" || Array.isArray(value) || !value.texts || typeof value.texts !== "object" || Array.isArray(value.texts))
    fail("translationFile.invalid");
  const own = value.kind === TRANSLATION_KIND;
  if (own && value.schemaVersion !== 1) fail("translationFile.invalid");
  if (value.kind !== undefined && !own) fail("translationFile.invalid");
  const named = typeof value.code === "string" ? value.code : null,
    code = target ?? named;
  if (!code) fail("translationFile.noCode");
  if (target && named && named !== target) fail("translationFile.otherLanguage", { sprache: languageName(named) });
  if (!PACK_CODE.test(code) || isBuiltinLanguage(code)) fail("translationFile.builtin", { sprache: languageName(code) });
  let pack = existing;
  if (!pack) {
    pack = newPack(code);
    if (typeof value.name === "string" && value.name.trim() && value.name.length <= 80) pack.name = value.name.trim();
    if (["ltr", "rtl"].includes(value.dir)) pack.dir = value.dir;
  }
  const base = builtinLanguage(BASE_LANGUAGE).texts,
    forms = pluralForms(pack.locale),
    texts = { ...pack.texts },
    result = { code, isNew: !existing, added: [], changed: [], same: 0, refused: [], unknown: 0 };
  for (const [key, entry] of Object.entries(value.texts)) {
    if (!Object.hasOwn(base, key)) {
      result.unknown++;
      continue;
    }
    let text = own ? entry?.translation : entry;
    if (text && typeof text === "object" && !Array.isArray(text)) {
      text = Object.fromEntries(Object.entries(text).map(([f, v]) => [f, cleanText(v)]));
      if (Object.values(text).every((v) => !v)) continue;
    } else {
      text = cleanText(text);
      if (!text) continue;
    }
    const problem = packTextProblem(text, base[key], forms);
    if (problem) {
      result.refused.push({ key, problem });
      continue;
    }
    if (JSON.stringify(texts[key]) === JSON.stringify(text)) result.same++;
    else (Object.hasOwn(texts, key) ? result.changed : result.added).push({ key, before: texts[key], after: text });
    texts[key] = typeof text === "string" ? text : { ...text };
  }
  result.pack = { ...pack, texts };
  return result;
}
