// Language packs: the app's check of a pack (src/languages.js), packs in the backup (src/backup.js)
// and the pack files the build publishes next to the app (scripts/build.mjs). Synthetic data: the
// pseudo language "qaa" as a pack.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createFullBackup, createStudioSettings, readFullBackup, readStudioSettings } from "../src/backup.js";
import { addLanguages, builtinLanguage, translator } from "../src/i18n.js";
import {
  PACKS_MAX,
  baseKeys,
  formKeys,
  formReady,
  hasAllTexts,
  isFormKey,
  languageProgress,
  newPack,
  packTextProblem,
  readTranslationFile,
  TRANSLATION_KIND,
  translationFile,
  usePrintableCheck,
  validatePack,
  validatePacks,
  withPackTranslations,
} from "../src/languages.js";
import { DEFAULT_SETTINGS } from "../src/defaults.js";
import { buildProfile, readLanguages, readPacks } from "../scripts/build.mjs";
import { loadLanguages } from "../scripts/sprachen.mjs";
import { PSEUDO, pseudoLanguageSource, writePseudoPack } from "./lib/pseudo.mjs";

const dir = await mkdtemp(path.join(tmpdir(), "inkform-pakete-"));
await writePseudoPack(dir);
const { [PSEUDO]: loaded } = await loadLanguages(dir);
const { source, ...pack } = loaded;
const copy = () => JSON.parse(JSON.stringify(pack));
test.after(() => rm(dir, { recursive: true, force: true }));

test("a complete pack passes and comes back clean", () => {
  const clean = validatePack(PSEUDO, { ...copy(), extra: "weg" });
  assert.deepEqual(Object.keys(clean).sort(), ["dir", "locale", "name", "pdfFont", "texts"]);
  assert.equal(Object.keys(clean.texts).length, Object.keys(builtinLanguage("de").texts).length);
});

test("a pack that breaks a rule is refused as a whole", () => {
  const refuse = (code, change) => {
    const value = copy();
    change(value);
    assert.throws(() => validatePack(code, value), /Sprachpaket/);
  };
  const firstPlain = Object.keys(pack.texts).find((k) => typeof pack.texts[k] === "string" && !/\{\w+\}/.test(pack.texts[k]));
  const withPlaceholder = Object.keys(pack.texts).find((k) => typeof pack.texts[k] === "string" && /\{\w+\}/.test(pack.texts[k]));
  const plural = Object.keys(pack.texts).find((k) => typeof pack.texts[k] === "object");
  refuse("en", () => {}); // built in: never replaced by a pack
  refuse("Klingonisch", () => {});
  refuse(PSEUDO, (v) => (v.texts["gibt.esNicht"] = "x"));
  refuse(PSEUDO, (v) => (v.texts[withPlaceholder] = "ohne Platzhalter"));
  refuse(PSEUDO, (v) => (v.texts[firstPlain] = "<img src=x onerror=alert(1)>"));
  refuse(PSEUDO, (v) => (v.texts[firstPlain] = " "));
  refuse(PSEUDO, (v) => (v.texts[firstPlain] = "x".repeat(4001)));
  refuse(PSEUDO, (v) => (v.texts[plural] = { other: "{anzahl}" }) && (v.locale = "ru"));
  refuse(PSEUDO, (v) => (v.texts[plural] = "kein Objekt"));
  refuse(PSEUDO, (v) => (v.dir = "ttb"));
  refuse(PSEUDO, (v) => (v.locale = "nicht gültig!"));
  refuse(PSEUDO, (v) => (v.pdfFont = "Comic"));
  refuse(PSEUDO, (v) => (v.name = ""));
  refuse(PSEUDO, (v) => (v.texts = []));
  assert.throws(() => validatePack(PSEUDO, null), /Sprachpaket/);
});

test("a pack being translated may lack texts; what it has is checked", () => {
  const value = copy(),
    keys = Object.keys(value.texts);
  for (const key of keys.slice(1)) delete value.texts[key];
  assert.deepEqual(Object.keys(validatePack(PSEUDO, value).texts), keys.slice(0, 1));
  assert.deepEqual(validatePack(PSEUDO, { ...value, texts: {} }).texts, {});
});

test("one text: the reason it is refused", () => {
  const de = builtinLanguage("de").texts,
    plural = "backup.days",
    placeholder = Object.keys(de).find((k) => typeof de[k] === "string" && /\{anzahl\}/.test(de[k]));
  const forms = ["one", "many", "other"];
  assert.equal(packTextProblem("Nuevo formulario", de["customer.newForm"], forms), null);
  assert.equal(packTextProblem("<b>ok</b> sí", de["customer.newForm"], forms), null);
  assert.equal(packTextProblem("<i>no</i>", de["customer.newForm"], forms), "markup");
  assert.equal(packTextProblem("x".repeat(4001), de["customer.newForm"], forms), "long");
  assert.equal(packTextProblem("sin número", de[placeholder], forms), "placeholders");
  assert.equal(packTextProblem({ one: "{anzahl}", other: "{anzahl}" }, de[plural], forms), "plural");
  assert.equal(packTextProblem({ one: "{anzahl} día", many: "{anzahl} días", other: "{anzahl} días" }, de[plural], forms), null);
  assert.equal(packTextProblem("texto", de[plural], forms), "form");
});

test("form texts, progress and when customers get a language", () => {
  const all = baseKeys(),
    form = formKeys();
  assert.ok(form.length > 200 && form.length < all.length / 2, `${form.length} von ${all.length}`);
  for (const key of ["personal.firstName", "pdf.headerLabel", "validate.signature", "export.button", "meta.customerTitle"]) assert.ok(isFormKey(key), key);
  for (const key of ["income.title", "backup.create", "appLanguages.add", "export.save"]) assert.ok(!isFormKey(key), key);
  const pack = newPack("es-MX");
  assert.deepEqual([pack.locale, pack.dir, pack.texts], ["es-MX", "ltr", {}]);
  assert.match(pack.name, /^Español/);
  assert.equal(newPack("ar").dir, "rtl");
  const en = builtinLanguage("en").texts,
    texts = {};
  for (const key of form) texts[key] = typeof en[key] === "string" ? en[key] : { one: en[key].one, many: en[key].other, other: en[key].other };
  addLanguages({ "es-MX": { ...pack, texts: { "customer.newForm": "Nuevo formulario" } } });
  try {
    assert.deepEqual(
      { ...languageProgress("es-MX"), unprintable: undefined },
      { form: 1, formTotal: form.length, admin: 0, adminTotal: all.length - form.length, unprintable: undefined },
    );
    assert.equal(formReady("es-MX"), false);
    const settings = { locale: { content: "de", studio: "de", customer: ["de"] }, translations: {} };
    assert.equal(hasAllTexts(settings, "es-MX"), false);
    const es = translator("es-MX");
    assert.equal(es.t("customer.newForm"), "Nuevo formulario");
    assert.equal(es.t("income.title"), translator("en").t("income.title"), "Fehlendes auf Englisch");
    addLanguages({ "es-MX": { ...pack, texts } });
    assert.equal(formReady("es-MX"), true);
    usePrintableCheck((text) => !/[\u4e00-\u9fff]/.test(text));
    addLanguages({ "es-MX": { ...pack, texts: { ...texts, "pdf.headerLabel": "纹身", "customer.newForm": "新" } } });
    assert.deepEqual(languageProgress("es-MX").unprintable, ["pdf.headerLabel"], "nur Texte fürs PDF zählen");
    assert.equal(formReady("es-MX"), false);
  } finally {
    usePrintableCheck(() => true);
    addLanguages({});
  }
});

test("translation file: every text with German and English, round trip and preview", () => {
  const pack = { ...newPack("es-MX"), texts: { "customer.newForm": "Nuevo formulario" } };
  const file = JSON.parse(JSON.stringify(translationFile("es-MX", pack, "Hinweis")));
  assert.equal(file.kind, TRANSLATION_KIND);
  assert.equal(file.code, "es-MX");
  assert.equal(Object.keys(file.texts).length, baseKeys().length);
  assert.deepEqual(file.texts["customer.newForm"], { de: builtinLanguage("de").texts["customer.newForm"], en: builtinLanguage("en").texts["customer.newForm"], translation: "Nuevo formulario", form: true });
  assert.equal(file.texts["income.title"].form, undefined);
  const plural = baseKeys().find((k) => typeof builtinLanguage("de").texts[k] === "object");
  assert.deepEqual(Object.keys(file.texts[plural].translation), ["one", "many", "other"]);

  const placeholder = baseKeys().find((k) => typeof builtinLanguage("de").texts[k] === "string" && /\{anzahl\}/.test(builtinLanguage("de").texts[k]));
  file.texts["customer.newForm"].translation = " Formulario nuevo ";
  file.texts["customer.admin"].translation = "Consola";
  file.texts[placeholder].translation = "sin número";
  file.texts["gibt.esNicht"] = { translation: "x" };
  const r = readTranslationFile(file, "es-MX", pack);
  assert.deepEqual(r.added.map((x) => x.key), ["customer.admin"]);
  assert.deepEqual(r.changed.map((x) => [x.key, x.before, x.after]), [["customer.newForm", "Nuevo formulario", "Formulario nuevo"]]);
  assert.deepEqual(r.refused, [{ key: placeholder, problem: "placeholders" }]);
  assert.equal(r.unknown, 1);
  assert.equal(r.isNew, false);
  assert.deepEqual(r.pack.texts, { "customer.newForm": "Formulario nuevo", "customer.admin": "Consola" });
  assert.deepEqual(pack.texts, { "customer.newForm": "Nuevo formulario" }, "nichts vorher geändert");
  assert.equal(readTranslationFile(file, "es-MX", r.pack).same, 2, "noch einmal: alles gleich");

  // A file for a language not on the device yet: added with its name; a pack file needs a target.
  const fresh = readTranslationFile({ ...file, code: "pt-BR", name: "Português (Brasil)", locale: "pt-BR" }, null, null);
  assert.deepEqual([fresh.isNew, fresh.code, fresh.pack.name, fresh.pack.locale], [true, "pt-BR", "Português (Brasil)", "pt-BR"]);
  const packFile = { name: "Español", locale: "es-MX", dir: "ltr", texts: { "customer.newForm": "Otro" } };
  assert.equal(readTranslationFile(packFile, "es-MX", pack).changed.length, 1);
  assert.throws(() => readTranslationFile(packFile, null, null), /translationFile\.noCode|keine Sprache/);
  assert.throws(() => readTranslationFile(file, "fr", null), /translationFile\.otherLanguage|ist für/);
  assert.throws(() => readTranslationFile({ ...file, code: "en" }, null, null), /eingebaut|builtin/);
  assert.throws(() => readTranslationFile({ kind: "inkform-studio", texts: {} }, "es-MX", pack), /translationFile\.invalid|keine Übersetzungsdatei/);
  assert.throws(() => readTranslationFile([], "es-MX", pack), /translationFile\.invalid|keine Übersetzungsdatei/);
});

test("several packs: each checked, at most the limit", () => {
  assert.deepEqual(Object.keys(validatePacks({ [PSEUDO]: copy() })), [PSEUDO]);
  assert.deepEqual(validatePacks({}), {});
  assert.throws(() => validatePacks([]), /Sprachpaket/);
  const many = Object.fromEntries(Array.from({ length: PACKS_MAX + 1 }, (_, i) => [`q${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`, copy()]));
  assert.throws(() => validatePacks(many), /Zu viele Sprachpakete/);
});

const settings = { schemaVersion: 1, studio: { name: "Musterstudio" }, app: {}, locale: { customer: ["de", PSEUDO] } };
const asJson = (value) => JSON.parse(JSON.stringify(value));
const part = { settings, theme: "dark", retention: { pdfYears: 10, incomeYears: null }, backupDays: 7, now: new Date("2026-11-18T10:00:00.000Z") };

test("backup and studio settings carry the packs; the settings are checked with them", () => {
  const seen = [];
  const check = (value, packs) => (seen.push(Object.keys(packs ?? {})), value);
  const full = readFullBackup(asJson(createFullBackup({ ...part, packs: { [PSEUDO]: pack }, exports: [], records: [], pdfs: [], removed: new Set() })), check);
  assert.equal(full.version, 4);
  assert.deepEqual(Object.keys(full.languages), [PSEUDO]);
  assert.deepEqual(seen.pop(), [PSEUDO]);
  const studio = readStudioSettings(asJson(createStudioSettings({ ...part, packs: { [PSEUDO]: pack } })), check);
  assert.deepEqual(studio.languages[PSEUDO].texts, pack.texts);
  assert.deepEqual(seen.pop(), [PSEUDO]);
  assert.deepEqual(readStudioSettings(asJson(createStudioSettings(part)), check).languages, {});
});

test("older files have no packs; a damaged pack refuses the whole file", () => {
  const old = { ...asJson(createStudioSettings(part)), schemaVersion: 3 };
  delete old.languages;
  assert.equal(readStudioSettings(old, (s) => s).languages, undefined);
  const broken = asJson(createStudioSettings({ ...part, packs: { [PSEUDO]: pack } }));
  broken.languages[PSEUDO].texts[Object.keys(pack.texts)[0]] = "<i>kaputt</i>";
  assert.throws(() => readStudioSettings(broken, (s) => s), /Sprachpaket/);
  assert.throws(() => readStudioSettings({ ...broken, languages: "x" }, (s) => s), /Sprachpaket/);
});

test("build: packs are checked like language files and published next to the app", async () => {
  const builtins = await readLanguages();
  assert.deepEqual(Object.keys(await readPacks(builtins, dir)), [PSEUDO]);
  assert.deepEqual(await readPacks(builtins, path.join(dir, "fehlt")), {});
  const bad = await mkdtemp(path.join(tmpdir(), "inkform-pakete-falsch-"));
  try {
    await writeFile(path.join(bad, "en.js"), await pseudoLanguageSource());
    await assert.rejects(readPacks(builtins, bad), /en\.js: ist schon in src\/sprachen\/ eingebaut/);
    await rm(path.join(bad, "en.js"));
    await writeFile(path.join(bad, `${PSEUDO}.js`), (await pseudoLanguageSource()).replace(/\{anzahl\}/, "{zahl}"));
    await assert.rejects(readPacks(builtins, bad), /Sprachpakete in .*qaa\.js/s);
  } finally {
    await rm(bad, { recursive: true, force: true });
  }
  const { files } = await buildProfile("blanko", { packs: dir });
  const index = JSON.parse(files.get("dist/sprachen/index.json"));
  assert.deepEqual(index, { schemaVersion: 1, packs: { [PSEUDO]: { name: pack.name } } });
  const published = JSON.parse(files.get(`dist/sprachen/${PSEUDO}.json`));
  assert.ok(!JSON.stringify(published).includes("%%"), "Profiltexte eingesetzt");
  assert.doesNotThrow(() => validatePack(PSEUDO, published));
  assert.ok(!files.get("dist/sw.js").includes("sprachen/"), "Pakete nicht im Offline-Cache der App");
  const none = (await buildProfile("blanko", { packs: path.join(dir, "fehlt") })).files;
  assert.deepEqual(JSON.parse(none.get("dist/sprachen/index.json")), { schemaVersion: 1, packs: {} });
});

test("shipped language packs bring complete draft form translations and keep own edits", async () => {
  const builtins = await readLanguages();
  const shipped = await readPacks(builtins);
  const codes = Object.keys(shipped).sort();
  assert.ok(codes.length >= 6, `erwartet mindestens 6 Sprachpakete, gefunden: ${codes.join(", ")}`);
  const validated = validatePacks(shipped);
  addLanguages(validated);
  try {
    const base = structuredClone(DEFAULT_SETTINGS);
    base.translations = { es: { app: { headline: "Propio título del estudio" }, studio: {}, medical: {}, legal: {} } };
    const filled = withPackTranslations(base, validated);
    assert.equal(filled.translations.es.app.headline, "Propio título del estudio", "eigene Übersetzung bleibt");
    for (const code of codes) {
      assert.ok(validated[code].form, `${code} hat vorübersetzte Formulartexte`);
      assert.equal(filled.translations[code]?.draft, true, `${code} ist als Entwurf markiert`);
      assert.equal(hasAllTexts(filled, code), true, `${code} hat alle Formulartexte vollständig`);
      assert.ok(filled.translations[code].app.privacyTemplate.includes("{{studio.name}}"), `${code} behält Platzhalter`);
    }
  } finally {
    addLanguages({});
  }
});
