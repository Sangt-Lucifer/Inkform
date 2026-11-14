// Settings migration (src/defaults.js): fixtures of today's and older formats load unchanged,
// missing fields and default questions are added, the steps run one after another. The fixtures
// in tests/fixtures/ hold an invented studio with an invented logo and icon; they are never
// regenerated, so every older format stays readable.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BACKUP_KIND, STUDIO_KIND, readFullBackup, readStudioSettings } from "../src/backup.js";
import { DEFAULT_SETTINGS, SETTINGS_VERSION, migrateSettings } from "../src/defaults.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8"));
const ids = (items) => items.map((item) => item.id);
const validate = (value) => {
  const result = migrateSettings(value);
  if (result?.schemaVersion !== SETTINGS_VERSION || !result.studio || !result.app) throw Error("unsupported");
  return result;
};

test("today's settings: migration changes nothing and leaves its input alone", () => {
  const settings = fixture("einstellungen-v1.json"),
    before = structuredClone(settings);
  assert.deepEqual(migrateSettings(settings), settings);
  assert.deepEqual(settings, before);
});

test("missing fields get their defaults, missing default questions are added in their place", () => {
  const gaps = fixture("einstellungen-v1-luecken.json"),
    full = fixture("einstellungen-v1.json"),
    result = migrateSettings(gaps);
  assert.equal(result.studio.location, DEFAULT_SETTINGS.studio.location);
  assert.equal(result.app.photoDeniedText, DEFAULT_SETTINGS.app.photoDeniedText);
  assert.deepEqual(ids(result.medical), ids(full.medical));
  assert.deepEqual(ids(result.legal), ids(full.legal));
  assert.deepEqual(result.medical[1], DEFAULT_SETTINGS.medical[1]);
  assert.deepEqual(result.legal[0], DEFAULT_SETTINGS.legal[0]);
  for (const key of ["name", "address", "contact"]) assert.equal(result.studio[key], gaps.studio[key]);
  assert.equal(result.app.headline, gaps.app.headline);
  assert.deepEqual(result.medical[0], gaps.medical[0], "own title of a default question");
  assert.deepEqual(result.medical.at(-1), gaps.medical.at(-1), "own question");
  assert.deepEqual(result.legal.at(-1), gaps.legal.at(-1), "own declaration");
  assert.equal(result.locale, undefined, "language settings are completed by the validation");
});

test("settings in another language than the default texts get no default texts mixed in", () => {
  const gaps = { ...fixture("einstellungen-v1-luecken.json"), locale: { content: "en", studio: "en", customer: ["en"], currency: "EUR", note: {} } };
  const result = migrateSettings(gaps);
  assert.deepEqual(result, gaps, "left to the validation, which rejects the missing questions");
});

test("unknown versions and non-settings come back unchanged, so the validation rejects them", () => {
  for (const value of [null, "text", [], {}, { schemaVersion: 0, studio: {}, app: {} }, { schemaVersion: SETTINGS_VERSION + 1, studio: {}, app: {} }, { schemaVersion: "1", studio: {}, app: {} }])
    assert.equal(migrateSettings(value), value);
  const noApp = { schemaVersion: 1, studio: {} };
  assert.deepEqual(migrateSettings(noApp), noApp);
});

test("migration steps run one after another from the file's version on", () => {
  const steps = [
    (value) => ({ ...value, schemaVersion: 2, app: { ...value.app, trail: "1>2" } }),
    (value) => ({ ...value, schemaVersion: 3, app: { ...value.app, trail: value.app.trail + ",2>3" } }),
  ];
  const settings = fixture("einstellungen-v1.json");
  const fromOne = migrateSettings(settings, DEFAULT_SETTINGS, steps);
  assert.equal(fromOne.schemaVersion, 3);
  assert.equal(fromOne.app.trail, "1>2,2>3");
  const fromTwo = migrateSettings({ ...settings, schemaVersion: 2, app: { ...settings.app, trail: "x" } }, DEFAULT_SETTINGS, steps);
  assert.equal(fromTwo.app.trail, "x,2>3");
  assert.equal(migrateSettings({ ...settings, schemaVersion: 4 }, DEFAULT_SETTINGS, steps).schemaVersion, 4);
});

test("full backups of every older format version are read with their settings unchanged", () => {
  const settings = fixture("einstellungen-v1.json");
  for (const version of [1, 2, 3]) {
    const value = fixture(`gesamtsicherung-v${version}.json`);
    assert.equal(value.kind, BACKUP_KIND);
    assert.equal(value.schemaVersion, version);
    const data = readFullBackup(value, validate);
    assert.deepEqual(data.settings, settings, `version ${version}`);
    assert.equal(data.logo === undefined, version < 2, `logo in version ${version}`);
    assert.equal(data.icon === undefined, version < 3, `icon in version ${version}`);
    assert.equal(data.records.length, 1);
  }
});

test("studio settings of every format version and the older settings-only file are read unchanged", () => {
  const settings = fixture("einstellungen-v1.json");
  for (const version of [2, 3]) {
    const value = fixture(`studio-einstellungen-v${version}.json`);
    assert.equal(value.kind, STUDIO_KIND);
    const data = readStudioSettings(value, validate);
    assert.deepEqual(data.settings, settings, `version ${version}`);
    assert.ok(data.logo instanceof Uint8Array);
    assert.equal(data.icon === undefined, version < 3);
  }
  const old = readStudioSettings(fixture("einstellungen-alt-mit-farbschema.json"), validate);
  assert.equal(old.theme, "light");
  assert.deepEqual(old.settings, { ...settings, theme: "light" });
});

test("a backup whose settings lack fields is migrated when read", () => {
  const value = fixture("gesamtsicherung-v3.json");
  value.settings = fixture("einstellungen-v1-luecken.json");
  const data = readFullBackup(value, validate);
  assert.deepEqual(ids(data.settings.medical), ids(fixture("einstellungen-v1.json").medical));
});
