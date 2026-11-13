import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { buildProfile, root } from "../scripts/build.mjs";
import { languagesForApp, loadLanguages } from "../scripts/sprachen.mjs";
import { registerLanguages } from "../src/i18n.js";
import {
  contentIn,
  hasAllTexts,
  markStale,
  offeredLanguages,
  settleField,
  startLanguage,
  validCurrency,
  validateLocale,
  validateTranslations,
  withDefaultTranslations,
} from "../src/languages.js";
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
    assert.equal(translations[PSEUDO].draft, undefined);
    assert.equal(validateTranslations({ [PSEUDO]: { ...full, draft: true } }, base, "de")[PSEUDO].draft, true);
    assert.equal(validateTranslations({ [PSEUDO]: { ...full, draft: "yes" } }, base, "de")[PSEUDO].draft, undefined);
    assert.throws(() => validateTranslations({ [PSEUDO]: { app: { headline: 5 } } }, base, "de"), /ungültig, zu lang/);

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

test("profiles: shipped English drafts are complete but only offered once the owner enables them", async () => {
  const { DEFAULT_SETTINGS } = await import("../src/defaults.js");
  for (const name of ["beispiel", "blanko"]) {
    const json = JSON.parse(await readFile(path.join(root, "profiles", name, "profile.json"), "utf8"));
    assert.ok(!json.languages?.customer?.includes("en"), `${name}: English must not be enabled by default`);
    const translations = validateTranslations(json.translations, DEFAULT_SETTINGS, "de");
    assert.equal(translations.en.draft, true, `${name}: English must be marked as an unreviewed draft`);
    const settings = { ...DEFAULT_SETTINGS, locale: { ...FALLBACK }, translations };
    assert.ok(contentIn(settings, "en"), `${name}: English draft is incomplete`);
    assert.deepEqual(offeredLanguages(settings), ["de"]);
    assert.deepEqual(offeredLanguages({ ...settings, locale: { ...FALLBACK, customer: ["de", "en"] } }), ["de", "en"]);
  }
});

test("translations: a base text edited while its translation stayed the same marks it stale, nothing is deleted", async () => {
  await withPseudo(() => {
    const previous = { ...base, locale: { ...FALLBACK, customer: ["de", PSEUDO] }, translations: validateTranslations({ [PSEUDO]: full }, base, "de") };
    assert.ok(contentIn(previous, PSEUDO));
    const edited = { ...previous, legal: [{ ...base.legal[0], text: "Neuer Text" }] };
    const next = markStale(edited, previous);
    const tr = next.translations[PSEUDO];
    assert.equal(tr.legal.privacy.text, "Text", "the old translation stays");
    assert.deepEqual(tr.stale, ["legal.privacy.text"]);
    assert.deepEqual(tr.staleBase, { "legal.privacy.text": "Text" });
    assert.equal(previous.translations[PSEUDO].stale, undefined, "the previous settings are not changed");

    // Stale texts are never shown to customers, but the language still has every text.
    assert.equal(contentIn(next, PSEUDO), null);
    assert.ok(hasAllTexts(next, PSEUDO));
    assert.deepEqual(offeredLanguages(next), ["de"]);

    // A second change keeps the text the translation was made from.
    const again = markStale({ ...next, legal: [{ ...base.legal[0], text: "Dritter Text" }] }, next);
    assert.deepEqual(again.translations[PSEUDO].staleBase, { "legal.privacy.text": "Text" });

    // Survives validation, as in a backup and its restore.
    const restored = validateTranslations(JSON.parse(JSON.stringify(again.translations)), again, "de");
    assert.deepEqual(restored[PSEUDO].stale, ["legal.privacy.text"]);
    assert.deepEqual(restored[PSEUDO].staleBase, { "legal.privacy.text": "Text" });

    // Confirming the translation takes it off the list; the language is offered again.
    const confirmed = structuredClone(again);
    settleField(confirmed.translations[PSEUDO], "legal.privacy.text");
    assert.equal(confirmed.translations[PSEUDO].stale, undefined);
    assert.deepEqual(offeredLanguages(confirmed), ["de", PSEUDO]);

    // Editing the translation in the same save, or later, also clears it.
    const retranslated = { ...edited, translations: { [PSEUDO]: { ...full, legal: { privacy: { title: "Privacy", text: "New text" } } } } };
    assert.equal(markStale(retranslated, previous).translations[PSEUDO].stale, undefined);
    const later = { ...next, translations: { [PSEUDO]: { ...tr, legal: { privacy: { title: "Privacy", text: "New text" } } } } };
    assert.equal(markStale(later, next).translations[PSEUDO].stale, undefined);
    assert.deepEqual(markStale(previous, previous), previous);
  });
});

test("translations: a base text and translation that belong together again are not stale", async () => {
  await withPseudo(() => {
    const previous = { ...base, locale: FALLBACK, translations: validateTranslations({ [PSEUDO]: full }, base, "de") };
    const edited = { ...previous, legal: [{ ...base.legal[0], text: "Neuer Text" }] };
    const stale = markStale(edited, previous);
    assert.deepEqual(stale.translations[PSEUDO].stale, ["legal.privacy.text"]);
    // The base text set back to the one the translation was made from.
    assert.equal(markStale({ ...previous, translations: stale.translations }, stale).translations[PSEUDO].stale, undefined);

    // Loading the profile defaults: the profile's base text with the profile's translation.
    const defaults = { ...base, locale: FALLBACK, translations: validateTranslations({ [PSEUDO]: full }, base, "de") };
    const custom = { ...previous, legal: [{ ...base.legal[0], text: "Eigener Text" }] };
    assert.equal(markStale(defaults, custom, defaults).translations[PSEUDO].stale, undefined);
    // An own translation next to the profile's base text is still checked.
    const own = { ...custom, translations: { [PSEUDO]: { ...full, legal: { privacy: { title: "Privacy", text: "Own" } } } } };
    const back = { ...defaults, translations: own.translations };
    assert.deepEqual(markStale(back, own, defaults).translations[PSEUDO].stale, ["legal.privacy.text"]);
  });
});

test("translations: an invalid translation names its language and field", async () => {
  await withPseudo(() => {
    try {
      validateTranslations({ [PSEUDO]: { legal: { privacy: { text: "a < b" } } } }, base, "de");
      assert.fail("no error");
    } catch (error) {
      assert.deepEqual(error.translation, { code: PSEUDO, field: "legal.privacy.text" });
      assert.match(error.message, /Datenschutz/);
    }
  });
});

test("translations: with stale texts in the studio language the form starts in the content language", async () => {
  await withPseudo(() => {
    const settings = { ...base, locale: { ...FALLBACK, studio: PSEUDO, customer: [PSEUDO] }, translations: validateTranslations({ [PSEUDO]: full }, base, "de") };
    assert.equal(startLanguage(settings), PSEUDO);
    assert.deepEqual(offeredLanguages(settings), [PSEUDO]);
    const stale = markStale({ ...settings, legal: [{ ...base.legal[0], text: "Neu" }] }, settings);
    assert.equal(startLanguage(stale), "de");
    assert.deepEqual(offeredLanguages(stale), ["de"]);
    assert.equal(stale.locale.studio, PSEUDO, "the chosen studio language is kept");
  });
});

test("translations: < and > are refused at runtime too", async () => {
  await withPseudo(() => {
    assert.throws(() => validateTranslations({ [PSEUDO]: { app: { headline: "a <b> c" } } }, base, "de"), /spitze Klammern/);
  });
});

test("translations: missing texts come from the profile's defaults only where the base text is the profile's own", async () => {
  await withPseudo(() => {
    const defaults = { ...base, locale: FALLBACK, translations: { [PSEUDO]: { ...structuredClone(full), draft: true } } };
    const installed = { ...base, locale: FALLBACK, translations: {} };
    const filled = withDefaultTranslations(installed, defaults);
    assert.ok(contentIn(filled, PSEUDO));
    assert.equal(filled.translations[PSEUDO].draft, true);
    assert.deepEqual(installed.translations, {}, "the input is not changed");

    const edited = withDefaultTranslations({ ...installed, legal: [{ ...base.legal[0], text: "Eigener Text" }] }, defaults);
    assert.equal(edited.translations[PSEUDO].legal.privacy.text, undefined);
    assert.equal(contentIn(edited, PSEUDO), null);

    const own = { ...installed, translations: { [PSEUDO]: { ...structuredClone(full), app: { ...full.app, headline: "Own" } } } };
    const kept = withDefaultTranslations(own, defaults);
    assert.equal(kept.translations[PSEUDO].app.headline, "Own");
    assert.equal(kept.translations[PSEUDO].draft, undefined, "nothing added, so a reviewed translation stays reviewed");
    assert.equal(withDefaultTranslations({ ...installed, locale: { ...FALLBACK, content: PSEUDO } }, defaults).translations[PSEUDO], undefined);
    const staleOwn = { ...own, translations: { [PSEUDO]: { ...own.translations[PSEUDO], stale: ["app.headline"], staleBase: { "app.headline": "H" } } } };
    const afterDefaults = withDefaultTranslations(staleOwn, defaults).translations[PSEUDO];
    assert.equal(afterDefaults.app.headline, "Own");
    assert.deepEqual(afterDefaults.stale, ["app.headline"]);
  });
});

test("profile: default translations for other languages are validated and baked in, ids beyond the defaults are dropped", async () => {
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
      const translations = {
        de: { app: { headline: "Should be skipped: de is the content language" } },
        [PSEUDO]: {
          app: { headline: "[head]" },
          medical: { allergies: { title: "[allergy]" }, notReal: { title: "x" } },
          legal: { privacy: { text: "[privacy text]" } },
          basedOn: { healthStudio: json.text.healthStudio, revocationContact: json.text.revocationContact },
        },
      };
      const { bundledJs, warnings } = await build({ languages: { customer: [PSEUDO] }, translations });
      assert.deepEqual(warnings, []);
      assert.ok(!bundledJs.includes("Should be skipped"));
      assert.ok(bundledJs.includes("[head]"));
      assert.ok(bundledJs.includes("[allergy]"));
      assert.ok(!bundledJs.includes("notReal"));
      await assert.rejects(build({ translations: { xx: { app: { headline: "x" } } } }), /translations\.xx hat keine Sprachdatei/);
      await assert.rejects(build({ translations: { [PSEUDO]: { app: { headline: "x".repeat(18001) } } } }), /ungültig, zu lang/);
      await assert.rejects(build({ translations: { [PSEUDO]: { draft: "ja" } } }), /draft muss true oder false sein/);
      await assert.rejects(build({ translations: { [PSEUDO]: { app: { headline: "a <!-- <script> b" } } } }), /enthält < oder >/);
      await assert.rejects(build({ translations: { [PSEUDO]: { legal: { privacy: { text: "x" } } } } }), /basedOn fehlt für healthStudio, revocationContact/);

      // A profile text changed after translating: the fields that spell it out are left out, so the
      // language is no longer complete; the others stay.
      const changed = await build({ text: { ...json.text, revocationContact: "per Post" }, translations });
      assert.equal(changed.warnings.length, 1);
      assert.match(changed.warnings[0], /legal\.privacy\.text passt nicht mehr zu revocationContact/);
      assert.ok(!changed.bundledJs.includes("[privacy text]") && changed.bundledJs.includes("[allergy]"));
      assert.ok((await build({ translations: { [PSEUDO]: { draft: true } } })).bundledJs.includes(`\\"draft\\":true`));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
