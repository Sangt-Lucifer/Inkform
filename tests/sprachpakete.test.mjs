// Language packs: the app's check of a pack (src/languages.js), packs in the backup (src/backup.js)
// and the pack files the build publishes next to the app (scripts/build.mjs). Synthetic data: the
// pseudo language "qaa" as a pack.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createFullBackup, createStudioSettings, readFullBackup, readStudioSettings } from "../src/backup.js";
import { builtinLanguage } from "../src/i18n.js";
import { PACKS_MAX, validatePack, validatePacks } from "../src/languages.js";
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
  refuse(PSEUDO, (v) => delete v.texts[firstPlain]);
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
  delete broken.languages[PSEUDO].texts[Object.keys(pack.texts)[0]];
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
