// Language files: src/sprachen/<code>.js, each `export default { name, locale, dir, pdfFont, texts }`.
// The set of languages is whatever files are there; nothing else names a language. German (de) is
// the base: every other language must have exactly its keys, the same placeholders ({wert} and
// %%profiltext%%) and the plural forms its locale needs. Build and tests stop on any error.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PDF_FONT_NAMES } from "./fonts.mjs";

export const BASE_LANGUAGE = "de";
export const KEY = /^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+$/;
const CODE = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2})?$/;
const PLURAL_FORMS = ["zero", "one", "two", "few", "many", "other"];
const PLACEHOLDER = /\{(\w+)\}|%%(\w+)%%/g;

export async function loadLanguages(dir) {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".js")).sort();
  const languages = {};
  for (const file of files) {
    const code = file.slice(0, -3);
    const source = await readFile(path.join(dir, file), "utf8");
    const { default: lang } = await import(`${pathToFileURL(path.join(dir, file)).href}?${Date.now()}`);
    languages[code] = { ...lang, source };
  }
  return languages;
}

const forms = (value) => (typeof value === "string" ? [value] : Object.values(value));
const placeholders = (value) =>
  [...new Set(forms(value).flatMap((text) => [...text.matchAll(PLACEHOLDER)].map((m) => m[0])))].sort().join(" ");

// Returns a list of error messages (empty: everything is fine).
export function checkLanguages(languages) {
  const errors = [];
  const base = languages[BASE_LANGUAGE];
  if (!base) return [`Grundsprache fehlt: src/sprachen/${BASE_LANGUAGE}.js`];
  for (const [code, lang] of Object.entries(languages)) {
    const where = `${code}.js`;
    if (!CODE.test(code)) errors.push(`${where}: Dateiname ist kein Sprachcode (z. B. de, en, pt-BR).`);
    if (typeof lang.name !== "string" || !lang.name.trim()) errors.push(`${where}: "name" fehlt.`);
    let pluralCategories = ["other"];
    try {
      if (typeof lang.locale !== "string" || Intl.getCanonicalLocales(lang.locale)[0] !== lang.locale)
        throw Error();
      pluralCategories = new Intl.PluralRules(lang.locale).resolvedOptions().pluralCategories;
    } catch {
      errors.push(`${where}: "locale" ist keine gültige Sprachangabe (z. B. de-DE).`);
    }
    if (!["ltr", "rtl"].includes(lang.dir)) errors.push(`${where}: "dir" muss "ltr" oder "rtl" sein.`);
    if (!PDF_FONT_NAMES.includes(lang.pdfFont))
      errors.push(`${where}: "pdfFont" muss eine eingebettete Schrift sein (${PDF_FONT_NAMES.join(", ")}).`);
    if (!lang.texts || typeof lang.texts !== "object") {
      errors.push(`${where}: "texts" fehlt.`);
      continue;
    }
    const keys = Object.keys(lang.texts);
    // JavaScript keeps only the last of two equal keys, so duplicates are found in the file text.
    if (lang.source !== undefined) {
      const written = [...lang.source.matchAll(/^\s*"([^"]+)"\s*:/gm)].map((m) => m[1]);
      const twice = written.filter((k, i) => written.indexOf(k) !== i);
      if (twice.length) errors.push(`${where}: doppelte Schlüssel: ${[...new Set(twice)].join(", ")}`);
      else if (written.length !== keys.length)
        errors.push(`${where}: jeder Schlüssel gehört in Anführungszeichen auf eine eigene Zeile.`);
    }
    for (const key of keys) {
      const value = lang.texts[key];
      if (!KEY.test(key)) errors.push(`${where}: Schlüssel "${key}" hat nicht die Form bereich.name.`);
      const plural = value && typeof value === "object";
      if (typeof value !== "string" && !plural) {
        errors.push(`${where}: ${key} muss Text oder Mehrzahl-Objekt sein.`);
        continue;
      }
      if (plural) {
        const own = Object.keys(value);
        if (own.some((f) => !PLURAL_FORMS.includes(f) || typeof value[f] !== "string"))
          errors.push(`${where}: ${key} hat ungültige Mehrzahlformen (${PLURAL_FORMS.join(", ")}).`);
        const missing = pluralCategories.filter((f) => !own.includes(f));
        if (missing.length) errors.push(`${where}: ${key} braucht die Mehrzahlformen ${missing.join(", ")}.`);
        if (!own.length || !forms(value).some((text) => text.includes("{anzahl}")))
          errors.push(`${where}: ${key} ist eine Mehrzahl und braucht {anzahl}.`);
      }
      for (const text of forms(value)) {
        if (/[<>]/.test(text.replace(/<\/?(?:b|strong|code)>/g, "")))
          errors.push(`${where}: ${key} enthält < oder > (erlaubt sind nur <b>, <strong> und <code>).`);
        if (text !== text.trim() || !text) errors.push(`${where}: ${key} ist leer oder hat Leerraum am Rand.`);
      }
      if (code === BASE_LANGUAGE) continue;
      if (!Object.hasOwn(base.texts, key)) {
        errors.push(`${where}: Schlüssel ${key} gibt es in der Grundsprache nicht.`);
        continue;
      }
      if ((typeof base.texts[key] === "object") !== plural)
        errors.push(`${where}: ${key} muss wie in der Grundsprache ${plural ? "einfacher Text" : "eine Mehrzahl"} sein.`);
      if (placeholders(value) !== placeholders(base.texts[key]))
        errors.push(
          `${where}: ${key} hat andere Platzhalter (${placeholders(value) || "keine"}) als die Grundsprache (${placeholders(base.texts[key]) || "keine"}).`,
        );
    }
    if (code !== BASE_LANGUAGE) {
      const missing = Object.keys(base.texts).filter((k) => !Object.hasOwn(lang.texts, k));
      if (missing.length) errors.push(`${where}: fehlende Schlüssel: ${missing.join(", ")}`);
    }
  }
  return errors;
}

// Keys the code names but the base language lacks, and base keys nothing names. A key counts as
// used wherever it appears as a quoted string, so maps of keys are fine; built keys are not.
export function checkKeyUsage(baseTexts, sources) {
  const all = Object.values(sources).join("\n");
  const used = new Set([...all.matchAll(/["'`]([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)["'`]/g)].map((m) => m[1]));
  const named = new Set(
    [...all.matchAll(/(?:\bt|\bth|\.t|\.th|\.raw)\(\s*["'`]([^"'`]+)["'`]|\bdata-t(?:-[\w-]+)?="([^"]+)"/g)]
      .map((m) => m[1] ?? m[2])
      .filter((k) => KEY.test(k)),
  );
  const errors = [];
  const unknown = [...named].filter((k) => !Object.hasOwn(baseTexts, k));
  if (unknown.length) errors.push(`Im Code verwendet, aber nicht in ${BASE_LANGUAGE}.js: ${unknown.join(", ")}`);
  const unused = Object.keys(baseTexts).filter((k) => !used.has(k));
  if (unused.length) errors.push(`Ungenutzte Schlüssel in ${BASE_LANGUAGE}.js: ${unused.join(", ")}`);
  return errors;
}

// Language data for the app: the profile's texts filled in, the source text dropped.
export function languagesForApp(languages, fill) {
  return Object.fromEntries(
    Object.entries(languages).map(([code, { name, locale, dir, pdfFont, texts }]) => [
      code,
      {
        name,
        locale,
        dir,
        pdfFont,
        texts: Object.fromEntries(
          Object.entries(texts).map(([key, value]) => [
            key,
            typeof value === "string"
              ? fill(value)
              : Object.fromEntries(Object.entries(value).map(([form, text]) => [form, fill(text)])),
          ]),
        ),
      },
    ]),
  );
}
