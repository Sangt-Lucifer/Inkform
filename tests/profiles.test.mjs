// Profile tests for the built-in sample profile and every studio profile found next to the core
// (../Inkform-Studios/* or INKFORM_STUDIOS). Each profile lists its own markers in profile.json;
// no build may contain another studio's markers or embedded logo, icon or guide files.
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildProfile, discoverStudioProfiles, listBuiltinProfiles, root } from "../scripts/build.mjs";
import { compileMarkers, filesBelow, findFingerprints, findMarkers, fingerprints, scanText } from "./lib/leaks.mjs";

const builtin = await listBuiltinProfiles();
const studios = await discoverStudioProfiles();
const dirs = [...builtin, ...studios];
if (!studios.length)
  console.log("Hinweis: keine Studio-Profile neben dem Kern gefunden; geprüft wird nur das Beispiel.");

async function load(dir) {
  const profile = JSON.parse(await readFile(path.join(dir, "profile.json"), "utf8"));
  const { files, bundledJs } = await buildProfile(dir);
  return {
    dir,
    id: profile.id,
    profile,
    files,
    bundledJs,
    markers: compileMarkers(profile.markers),
    prints: await fingerprints(dir, profile.logo),
  };
}
const profiles = await Promise.all(dirs.map(load));

function leaks(name, contents, other) {
  const hits = findMarkers(scanText(contents) + "\n" + name, other.markers).map((m) => `${name}: Kennzeichen ${m}`);
  for (const f of findFingerprints(contents, other.prints)) hits.push(`${name}: Datei ${f}`);
  return hits;
}

test("the built-in sample profile exists and lives in the core", () => {
  assert.deepEqual(
    builtin.map((d) => path.relative(root, d)),
    [path.join("profiles", "beispiel")],
  );
});

for (const p of profiles) {
  test(`${p.id}: builds without placeholders; the bundled script parses`, () => {
    for (const [name, contents] of p.files)
      if (/\.(html|js|webmanifest)$/.test(name)) assert.doesNotMatch(String(contents), /%%\w+%%/, name);
    assert.doesNotThrow(() => new vm.Script(p.bundledJs));
  });

  test(`${p.id}: manifest uses standalone display for the home-screen app`, () => {
    assert.equal(JSON.parse(String(p.files.get("dist/manifest.webmanifest"))).display, "standalone");
  });

  test(`${p.id}: own markers are found in its own build (scan is not vacuous)`, () => {
    const text = scanText(p.files.get("dist/index.html"));
    assert.ok(findMarkers(text, p.markers).length > 0, "keines der eigenen Kennzeichen gefunden");
    assert.ok(findFingerprints(p.files.get("dist/index.html"), p.prints).length > 0, "eigenes Logo nicht gefunden");
  });
}

test("all profiles define exactly the same texts", () => {
  const keys = (p) => Object.keys(p.profile.text).sort();
  for (const p of profiles) assert.deepEqual(keys(p), keys(profiles[0]), p.id);
});

for (const p of profiles)
  for (const q of profiles.filter((x) => x !== p)) {
    test(`${p.id}: build and profile folder contain nothing from ${q.id}`, async () => {
      const hits = [];
      for (const [name, contents] of p.files) hits.push(...leaks(`build/${name}`, contents, q));
      for (const file of await filesBelow(p.dir, new Set([".git", "node_modules", "build", "test-results"])))
        hits.push(...leaks(path.relative(p.dir, file), await readFile(file), q));
      assert.deepEqual(hits, []);
    });
  }

test("cross-profile scan flags injected markers and embedded files", () => {
  // Counter-test without any studio data in the core: inject one profile's marker and logo into
  // another profile's build and make sure the scanner reports both.
  if (profiles.length < 2) return;
  const [p, q] = profiles;
  const marker = q.profile.markers.find((m) => typeof m === "string") ?? "";
  const logo = q.prints.find((f) => f.label === q.profile.logo);
  const html = String(p.files.get("dist/index.html")).replace(
    "</body>",
    `<p>${marker}</p><img src="data:image/png;base64,${logo.base64}"></body>`,
  );
  const hits = leaks("dist/index.html", html, q);
  assert.ok(hits.some((h) => h.includes("Kennzeichen")), hits.join());
  assert.ok(hits.some((h) => h.includes(`Datei ${q.profile.logo}`)), hits.join());
});
