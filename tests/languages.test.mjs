import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { buildProfile, root } from "../scripts/build.mjs";
import { languagesForApp, loadLanguages } from "../scripts/sprachen.mjs";
import { registerLanguages } from "../src/i18n.js";
import { contentIn, offeredLanguages, validCurrency, validateLocale, validateTranslations } from "../src/languages.js";
import { PSEUDO, writePseudoLanguages } from "./lib/pseudo.mjs";

const FALLBACK = { content: "de", studio: "de", customer: ["de"], currency: "EUR", note: {} };
const base = {
  app: { documentTitle: "Titel", eyebrow: "E", headline: "H", description: "D", photoText: "F", photoDeniedText: "N", signatureText: "S", privacyTemplate: "P", brand: "B" },
  studio: { name: "Studio", retention: "R", recipients: "" },
  medical: [{ id: "allergies", title: "Allergien", hint: "z. B." }],
  legal: [{ id: "privacy", title: "Datenschutz", text: "Text", review: true }],
};
const full = {
  app: { documentTitle: "Title", eyebrow: "E", headline: "H", description: "D", photoText: "P", photoDeniedText: "N", signatureText: "S", privacyTemplate: "P" },
  studio: { retention: "R" },
  medical: { allergies: { title: "Allergies", hint: "e.g." } },
  legal: { privacy: { title: "Privacy", text: "Text" } },
};

async function withPseudo(run) {
  const dir = await mkdtemp(path.join(tmpdir(), "inkform-sprachen-"));
  const real = languagesForApp(await loadLanguages(path.join(root, "src/sprachen")), (t) => t);
  try {
    await writePseudoLanguages(dir);
    registerLanguages(languagesForApp(await loadLanguages(dir), (t) => t));
    await run(dir);
  } finally {
    registerLanguages(real);
    await rm(dir, { recursive: true, force: true });
  }
}

test("locale: missing settings use the profile, unknown languages are dropped", async () => {
  assert.deepEqual(validateLocale(undefined, FALLBACK), FALLBACK);
  await withPseudo(() => {
    const locale = validateLocale({ content: "de", studio: PSEUDO, customer: ["xx", "de"], currency: " chf ", note: { [PSEUDO]: " Hinweis ", de: "eigene", xx: "x" } }, FALLBACK);
    assert.deepEqual(locale, { content: "de", studio: PSEUDO, customer: [PSEUDO, "de"], currency: "CHF", note: { [PSEUDO]: "Hinweis" } });
    assert.throws(() => validateLocale({ ...FALLBACK, note: { [PSEUDO]: "x".repeat(501) } }, FALLBACK), /500/);
  });
  assert.deepEqual(validateLocale({ studio: "xx", customer: [] }, FALLBACK).customer, ["de"]);
  assert.throws(() => validateLocale({ ...FALLBACK, currency: "EURO" }, FALLBACK), /kein bekannter Währungscode/);
  assert.ok(validCurrency("JPY") && !validCurrency("ABC") && !validCurrency("eur"));
});

test("locale: an explicit content language this build does not know is an error, not a relabel", () => {
  // Restoring a backup whose real base texts are in a language this build has no file for must
  // not silently call them German: that would show the wrong texts under the wrong language.
  assert.throws(() => validateLocale({ ...FALLBACK, content: "fr", studio: "fr", customer: ["fr"] }, FALLBACK), /„fr“/);
  // No locale at all (a pre-multilingual backup) still falls back to the profile, as before.
  assert.deepEqual(validateLocale({}, FALLBACK), FALLBACK);
});

test("translations: only known languages, parts and ids; a language is offered only when complete", async () => {
  await withPseudo(() => {
    const translations = validateTranslations({ [PSEUDO]: { ...full, medical: { ...full.medical, other: { title: "x" } } }, xx: full, de: full }, base, "de");
    assert.deepEqual(Object.keys(translations), [PSEUDO]);
    assert.deepEqual(Object.keys(translations[PSEUDO].medical), ["allergies"]);
    assert.throws(() => validateTranslations({ [PSEUDO]: { app: { headline: 5 } } }, base, "de"), /ungültig oder zu lang/);

    const settings = { ...base, locale: { ...FALLBACK, customer: ["de", PSEUDO] }, translations };
    const shown = contentIn(settings, PSEUDO);
    assert.equal(shown.app.headline, "H");
    assert.equal(shown.app.brand, "B");
    assert.equal(shown.medical[0].title, "Allergies");
    assert.equal(shown.legal[0].review, true);
    assert.equal(shown.studio.recipients, "", "an empty base text needs no translation");
    assert.deepEqual(offeredLanguages(settings), ["de", PSEUDO]);

    const partial = { ...settings, translations: { [PSEUDO]: { ...translations[PSEUDO], legal: {} } } };
    assert.equal(contentIn(partial, PSEUDO), null);
    assert.deepEqual(offeredLanguages(partial), ["de"]);
    assert.equal(contentIn(settings, "de"), settings);
  });
});

test("defaults: a studio language without default translations is corrected to the content language at startup", async () => {
  // A profile could set "studio" different from "content" in profile.json; today that never ships
  // default translations, so without this correction the app would start in a language missing
  // every text and crash instead of a settings page offering to add it (see languages.js).
  const dir = await mkdtemp(path.join(tmpdir(), "inkform-defaults-"));
  try {
    for (const file of ["defaults.js", "i18n.js", "languages.js"])
      await writeFile(path.join(dir, file), await readFile(path.join(root, "src", file), "utf8"));
    const locale = { content: "de", studio: PSEUDO, customer: [PSEUDO], currency: "EUR", note: {} };
    const defaultsSource = (await readFile(path.join(dir, "defaults.js"), "utf8")).replace(
      '"__PROFILE_LOCALE__"',
      JSON.stringify(JSON.stringify(locale)),
    );
    await writeFile(path.join(dir, "defaults.js"), defaultsSource);
    const i18n = await import(pathToFileURL(path.join(dir, "i18n.js")).href);
    await withPseudo(async (languages) => {
      i18n.registerLanguages(languagesForApp(await loadLanguages(languages), (t) => t));
      const { DEFAULT_SETTINGS } = await import(pathToFileURL(path.join(dir, "defaults.js")).href);
      assert.equal(DEFAULT_SETTINGS.locale.studio, "de");
      assert.deepEqual(DEFAULT_SETTINGS.locale.customer, ["de", PSEUDO]);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("profile: languages and currency are checked against the language files and the manifest", async () => {
  await withPseudo(async (languages) => {
    const dir = await mkdtemp(path.join(tmpdir(), "inkform-profil-"));
    const profile = path.join(dir, "beispiel");
    try {
      await cp(path.join(root, "profiles/beispiel"), profile, { recursive: true });
      const json = JSON.parse(await readFile(path.join(profile, "profile.json"), "utf8"));
      const build = async (extra) => {
        await writeFile(path.join(profile, "profile.json"), JSON.stringify({ ...json, ...extra }));
        return buildProfile(profile, { languages });
      };
      const { bundledJs } = await build({ languages: { customer: [PSEUDO], note: { [PSEUDO]: "Maßgeblich ist die deutsche Fassung." } }, currency: "CHF" });
      assert.ok(bundledJs.includes(`\\"customer\\":[\\"de\\",\\"${PSEUDO}\\"]`));
      assert.ok(bundledJs.includes(`\\"currency\\":\\"CHF\\"`));
      await assert.rejects(build({ languages: { customer: ["xx"] } }), /languages\.customer "xx" hat keine Sprachdatei/);
      await assert.rejects(build({ currency: "euro" }), /Währungscode/);
      await assert.rejects(build({ languages: { studio: PSEUDO } }), /manifest\.webmanifest "lang" \(de\) passt nicht/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
