import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { LANGUAGE_DIR, buildProfile, readLanguages, root } from "../scripts/build.mjs";
import { checkKeyUsage, checkLanguages, languagesForApp, loadLanguages } from "../scripts/sprachen.mjs";
import { languageCodes, markup, registerLanguages, setCurrency, setLanguage, t, textsInAllLanguages, th, translator } from "../src/i18n.js";
import { PSEUDO, writePseudoLanguages } from "./lib/pseudo.mjs";

const real = await loadLanguages(LANGUAGE_DIR);
const lang = (texts, extra = {}) => ({ name: "Test", locale: "en-GB", dir: "ltr", pdfFont: "NotoSans", texts, ...extra });
const base = (texts) => ({ de: { ...lang(texts), locale: "de-DE" } });

test("the language files are complete and every key is used in the code", async () => {
  assert.deepEqual(checkLanguages(real), []);
  await readLanguages();
  for (const [code, l] of Object.entries(real)) {
    assert.ok(l.name.trim(), code);
    assert.ok(["ltr", "rtl"].includes(l.dir), code);
  }
});

test("language files: missing, extra and mismatched texts are errors", () => {
  const de = { "a.one": "Eins {x}", "a.two": "Zwei", "a.count": { one: "{anzahl} Eintrag", other: "{anzahl} Einträge" } };
  const ok = { "a.one": "One {x}", "a.two": "Two", "a.count": { one: "{anzahl} entry", other: "{anzahl} entries" } };
  assert.deepEqual(checkLanguages({ ...base(de), en: lang(ok) }), []);
  const errors = (texts, extra) => checkLanguages({ ...base(de), en: lang(texts, extra) }).join("\n");
  assert.match(errors({ "a.one": "One {x}", "a.count": ok["a.count"] }), /fehlende Schlüssel: a\.two/);
  assert.match(errors({ ...ok, "a.three": "Three" }), /a\.three gibt es in der Grundsprache nicht/);
  assert.match(errors({ ...ok, "a.one": "One {y}" }), /a\.one hat andere Platzhalter/);
  assert.match(errors({ ...ok, "a.one": "One {x} %%studio%%" }), /a\.one hat andere Platzhalter/);
  assert.match(errors({ ...ok, "a.count": { other: "{anzahl} entries" } }), /braucht die Mehrzahlformen one/);
  assert.match(errors({ ...ok, "a.count": { one: "entry", other: "entries" } }), /braucht \{anzahl\}/);
  assert.match(errors({ ...ok, "a.two": { one: "{anzahl}", other: "{anzahl}" } }), /wie in der Grundsprache einfacher Text/);
  assert.match(errors({ ...ok, "a.two": "Two <i>x</i>" }), /nur <b>, <strong> und <code>/);
  assert.match(errors({ ...ok, "a.two": " Two" }), /Leerraum am Rand/);
  assert.match(errors(ok, { dir: "down" }), /"dir" muss/);
  assert.match(errors(ok, { locale: "not a locale" }), /"locale" ist keine gültige/);
  assert.match(errors(ok, { pdfFont: "Comic" }), /"pdfFont" muss/);
  assert.match(checkLanguages({ ...base({ Bad: "x" }) }).join(), /Schlüssel "Bad" hat nicht die Form/);
  assert.match(checkLanguages({ en: lang(ok) }).join(), /Grundsprache fehlt/);
  assert.match(checkLanguages({ ...base(de), "Englisch!": lang(ok) }).join(), /kein Sprachcode/);
  assert.match(errors({ ...ok, "a.count": { one: 1, other: "{anzahl} entries" } }), /ungültige Mehrzahlformen/);
});

test("language files: a key written twice is an error, even though JavaScript keeps the last one", () => {
  const source = `export default { texts: {\n  "a.one": "Eins",\n  "a.one": "Noch mal",\n} };\n`;
  assert.match(checkLanguages({ de: { ...lang({ "a.one": "Noch mal" }), source } }).join(), /doppelte Schlüssel: a\.one/);
});

test("key usage: unknown keys in the code and unused keys in the base language", () => {
  const texts = { "a.used": "x", "a.listed": "y", "a.unused": "z" };
  const sources = {
    "x.js": `t("a.used"); const MAP = { k: "a.listed", typo: "a.lsted" }; th("a.missing"); <p data-t="b.missing"></p> load("other.v1")`,
  };
  const errors = checkKeyUsage(texts, sources).join("\n");
  assert.match(errors, /nicht in de\.js: a\.lsted, a\.missing, b\.missing$/m);
  assert.match(errors, /Ungenutzte Schlüssel in de\.js: a\.unused$/m);
});

test("t() and th(): placeholders, plurals, markup and the fallback to German", () => {
  registerLanguages({
    de: { name: "Deutsch", locale: "de-DE", dir: "ltr", texts: { "x.hi": "Hallo {name}", "x.n": { one: "{anzahl} Datei", other: "{anzahl} Dateien" }, "x.b": "<b>Fett</b> {wert}", "x.only": "Nur deutsch", "x.cur": "Preis ({waehrungszeichen}) in {waehrung}" } },
    en: { name: "English", locale: "en-GB", dir: "ltr", texts: { "x.hi": "Hello {name}", "x.n": { one: "{anzahl} file", other: "{anzahl} files" }, "x.b": "<b>Bold</b> {wert}", "x.cur": "Price ({waehrungszeichen}) in {waehrung}" } },
  });
  try {
    setLanguage("en");
    assert.equal(t("x.hi", { name: "<Ann>" }), "Hello <Ann>");
    assert.equal(th("x.hi", { name: "<Ann>" }), "Hello &lt;Ann&gt;");
    assert.equal(t("x.n", { anzahl: 1 }), "1 file");
    assert.equal(t("x.n", { anzahl: 3 }), "3 files");
    assert.equal(t("x.b", { wert: 1 }), "Bold 1");
    assert.equal(t("x.hi", { name: "<b>Ann</b>" }), "Hello <b>Ann</b>");
    assert.equal(t("x.cur"), "Price (€) in EUR");
    assert.deepEqual(textsInAllLanguages("x.hi"), ["Hallo {name}", "Hello {name}"]);
    assert.equal(th("x.b", { wert: markup("<button>ok</button>") }), "<b>Bold</b> <button>ok</button>");
    assert.equal(t("x.only"), "Nur deutsch");
    assert.equal(translator("en").money(123456), "€1,234.56");
    assert.equal(translator("de").money(123456), "1.234,56\u00a0€");
    assert.equal(translator("de").date("2026-03-05", { day: "2-digit", month: "2-digit", year: "numeric" }), "05.03.2026");
    assert.equal(setLanguage("xx").code, "de");
    setCurrency("CHF");
    assert.equal(t("x.cur"), "Preis (CHF) in CHF");
    assert.equal(translator("de").money(1050), "10,50\u00a0CHF");
  } finally {
    setCurrency("EUR");
    registerLanguages(languagesForApp(real, (text) => text));
    setLanguage("de");
  }
});

test("pseudo language: a new file is found, checked, built and used without any code change", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "inkform-sprachen-"));
  try {
    await writePseudoLanguages(dir);
    const languages = await readLanguages(dir);
    assert.deepEqual(Object.keys(languages).sort(), [...Object.keys(real), PSEUDO].sort());
    registerLanguages(languagesForApp(languages, (text) => text));
    assert.ok(languageCodes().includes(PSEUDO));
    const pseudo = translator(PSEUDO);
    assert.equal(pseudo.dir, "rtl");
    assert.match(pseudo.t("common.cancel"), /^\[Ábbréçhéñ ŵ+/);
    assert.match(pseudo.t("export.copies", { anzahl: 2 }), /^\[2 /);
    const { bundledJs } = await buildProfile("beispiel", { languages: dir });
    assert.ok(bundledJs.includes(`"${PSEUDO}":{"name":"Pséúdó"`));
  } finally {
    registerLanguages(languagesForApp(real, (text) => text));
    await rm(dir, { recursive: true, force: true });
  }
});

test("a real build contains exactly the languages in src/sprachen, never the pseudo language", async () => {
  const codes = Object.keys(real);
  for (const profile of await readdir(path.join(root, "profiles"))) {
    if (profile.startsWith(".")) continue;
    const { bundledJs } = await buildProfile(profile);
    const embedded = JSON.parse(bundledJs.match(/^registerLanguages\((.*)\);$/m)[1]);
    assert.deepEqual(Object.keys(embedded), codes, profile);
    const built = await readFile(path.join(root, "build", profile, "index.html"), "utf8");
    assert.ok(!built.includes(`"${PSEUDO}":`), profile);
  }
});
