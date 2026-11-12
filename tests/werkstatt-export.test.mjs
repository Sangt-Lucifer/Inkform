// Werkstatt: export. Everything happens in temporary folders (studios, exports, state);
// never in ../Inkform-Studios or ../Inkform-Exporte. The core's own Git state is replaced by a fake
// "clean" state, so the tests do not depend on uncommitted work in the core.
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildProfile, defaultOut, root } from "../scripts/build.mjs";
import { exportStudio, listExports, nextVersion, publish, readiness } from "../werkstatt/export.mjs";
import { commitStudio, createStudio, pendingChanges, readEditable, saveDraft } from "../werkstatt/profile.mjs";
import { gitInfo, listStudios } from "../werkstatt/status.mjs";
import { startWerkstatt } from "../werkstatt/server.mjs";
import { callApi, ensureBlankoBuild, fakeGit, neutralTexts, solidPng } from "./lib/werkstatt.mjs";

const base = await mkdtemp(path.join(tmpdir(), "inkform-export-"));
const studiosDir = path.join(base, "studios"),
  stateDir = path.join(base, "state"),
  exportsDir = path.join(base, "exporte");
const env = { ...process.env, INKFORM_STUDIOS: studiosDir, INKFORM_EXPORTE: exportsDir };
test.after(async () => {
  execFileSync("chmod", ["-R", "u+w", base]);
  await rm(base, { recursive: true, force: true });
});
const NOW = new Date("2026-11-20T10:00:00Z");


// A ready studio: own texts, own logo and guide PDF, committed, built (made once before the tests).
// The tests below run in order and build on each other: every export adds a version number.
const dir = path.join(studiosDir, "atelier-nord");
async function prepare() {
  await createStudio({ id: "atelier-nord", name: "Atelier Nord", env, stateDir });
  const { draft, version } = await readEditable(dir);
  const saved = await saveDraft({
    dir,
    id: "atelier-nord",
    draft: { ...draft, name: "Atelier Nord", description: "Test", markers: ["Atelier Nord"], text: neutralTexts(draft.text, "Atelier Nord") },
    logoBase64: solidPng(512, 512, 0x30).toString("base64"),
    expectedVersion: version,
    env,
  });
  assert.deepEqual(saved.errors, []);
  await writeFile(path.join(dir, "Anleitung-iPad-und-Admin.pdf"), "%PDF-1.4\n% Anleitung Atelier Nord (Test)\n%%EOF\n");
  await commitAll("Erstes Profil");
  await build();
}
test.before(prepare);
async function commitAll(message) {
  const { files } = await pendingChanges(dir);
  const done = await commitStudio({ dir, message, files: files.map((f) => f.path) });
  assert.ok(done.commit, done.error);
}
async function build() {
  const out = defaultOut(dir);
  await rm(out, { recursive: true, force: true });
  for (const [name, contents] of (await buildProfile(dir)).files) {
    await mkdir(path.dirname(path.join(out, name)), { recursive: true });
    await writeFile(path.join(out, name), contents);
  }
}
const entry = async () => (await listStudios({ env, stateDir })).find((s) => s.key === "s-atelier-nord");
async function greenRuns(core = "c0ffee1") {
  const studio = await gitInfo(dir);
  const r = (text) => ({ ok: true, text, at: NOW.toISOString(), core: { commit: core, clean: true }, profile: { commit: studio.commit, clean: true } });
  return { "s-atelier-nord:test": r("132 von 132 Tests bestanden."), "s-atelier-nord:browser": r("7 von 7 Browser-Prüfungen bestanden.") };
}

test("version: -p<n> counts distinct states per core version; the same state keeps its number", () => {
  const existing = [
    { name: "a", version: "1.2.0-p1", core: "k1", profile: "s1" },
    { name: "b", version: "1.2.0-p2", core: "k1", profile: "s2" },
    { name: "c", version: "1.1.0-p5", core: "k0", profile: "s0" },
  ];
  assert.deepEqual(nextVersion("1.2.0", existing, { core: "k1", profile: "s3" }), { version: "1.2.0-p3", already: null });
  assert.deepEqual(nextVersion("1.2.0", existing, { core: "k1", profile: "s2" }), { version: "1.2.0-p2", already: "b" });
  assert.deepEqual(nextVersion("1.3.0", existing, { core: "k2", profile: "s3" }), { version: "1.3.0-p1", already: null });
});

test("readiness: every missing precondition is named", async () => {
  await createStudio({ id: "roh", name: "Roh Ost", env, stateDir });
  const e = (await listStudios({ env, stateDir })).find((s) => s.key === "s-roh");
  const { ok, reasons } = await readiness(e, { latest: {}, git: fakeGit });
  assert.equal(ok, false);
  const text = reasons.join("\n");
  assert.match(text, /noch keinen Commit/);
  assert.match(text, /Unit- und Leak-Tests: noch nicht gelaufen/);
  assert.match(text, /Browser-Prüfungen: noch nicht gelaufen/);
  assert.match(text, /noch nicht gebaut/);
  await rm(path.join(studiosDir, "roh"), { recursive: true, force: true });
});

test("export: complete, checked, read-only package from exactly the build files", async () => {
  const e = await entry();
  const latest = await greenRuns();
  assert.deepEqual((await readiness(e, { latest, git: fakeGit })).reasons, []);
  const result = await exportStudio(e, { latest, env, git: fakeGit, now: NOW, zip: true });
  assert.ok(result.folder, JSON.stringify(result));
  assert.equal(result.name, "inkform-atelier-nord-1.2.0-p1-2026-11-20");
  assert.equal(path.dirname(result.folder), path.join(exportsDir, "atelier-nord"));
  const listed = (await readdir(result.folder, { recursive: true })).sort();
  const expected = [...(await buildProfile(dir)).files.keys(), "PRUEFBERICHT.txt", "SHA256SUMS"];
  const filesOnly = [];
  for (const n of listed) if ((await stat(path.join(result.folder, n))).isFile()) filesOnly.push(n);
  assert.deepEqual(filesOnly.sort(), expected.sort());
  for (const [name, contents] of (await buildProfile(dir)).files) assert.ok(Buffer.from(contents).equals(await readFile(path.join(result.folder, name))), name);
  assert.match(execFileSync("shasum", ["-a", "256", "-c", "SHA256SUMS"], { cwd: result.folder, encoding: "utf8" }), /index\.html: OK/);
  const report = await readFile(path.join(result.folder, "PRUEFBERICHT.txt"), "utf8");
  assert.match(report, /Kern-Commit: c0ffee1/);
  assert.match(report, new RegExp(`Studio-Commit: ${(await gitInfo(dir)).commit}`));
  assert.match(report, /Leak-Prüfung: keine Funde; geprüft gegen 1 anderes Profil/);
  assert.doesNotMatch(report, /beispiel/, "no ids of other profiles in the report");
  assert.equal((await stat(path.join(result.folder, "index.html"))).mode & 0o222, 0, "read-only");
  assert.equal((await stat(result.folder)).mode & 0o222, 0, "folder read-only");
  assert.ok((await stat(result.zip)).size > 1000);
  assert.deepEqual((await readdir(path.join(exportsDir, "atelier-nord"))).filter((n) => n.startsWith(".")), [], "no temporary folder left");
  assert.equal((await listExports("atelier-nord", env)).at(-1).name, result.name);
});

test("export: the same state is never exported twice; a new studio commit gets the next number", async () => {
  const e = await entry();
  assert.match((await exportStudio(e, { latest: await greenRuns(), env, git: fakeGit, now: NOW })).error, /bereits exportiert/);
  const report = JSON.parse(await readFile(path.join(dir, "profile.json"), "utf8"));
  await writeFile(path.join(dir, "profile.json"), JSON.stringify({ ...report, description: "Zweite Fassung" }, null, 2) + "\n");
  // Tests from before the change no longer count.
  const stale = await greenRuns();
  await commitAll("Zweite Fassung");
  await build();
  const old = await readiness(e, { latest: stale, git: fakeGit });
  assert.match(old.reasons.join("\n"), /anderen Stand/);
  const second = await exportStudio(e, { latest: await greenRuns(), env, git: fakeGit, now: NOW });
  assert.equal(second.name, "inkform-atelier-nord-1.2.0-p2-2026-11-20");
});

test("export: uncommitted changes, red runs and an outdated build block the export", async () => {
  const e = await entry();
  await writeFile(path.join(dir, "Dokumente", "Notiz.md"), "neu\n");
  let r = await exportStudio(e, { latest: await greenRuns(), env, git: fakeGit, now: NOW });
  assert.match(r.reasons.join("\n"), /ungespeicherte Änderungen/);
  await rm(path.join(dir, "Dokumente", "Notiz.md"));
  const red = await greenRuns();
  red["s-atelier-nord:browser"].ok = false;
  r = await exportStudio(e, { latest: red, env, git: fakeGit, now: NOW });
  assert.match(r.reasons.join("\n"), /Browser-Prüfungen: zuletzt rot/);
  await writeFile(path.join(defaultOut(dir), "index.html"), "alt");
  r = await exportStudio(e, { latest: await greenRuns(), env, git: fakeGit, now: NOW });
  assert.match(r.reasons.join("\n"), /Build: veraltet/);
  await build();
});

test("export: data of another profile in the package stops the export; nothing is written", async () => {
  const other = path.join(studiosDir, "fremd");
  await cp(path.join(root, "profiles", "beispiel"), other, { recursive: true });
  const p = JSON.parse(await readFile(path.join(other, "profile.json"), "utf8"));
  await writeFile(path.join(other, "profile.json"), JSON.stringify({ ...p, id: "fremd", markers: ["Nordstadt"] }));
  const current = JSON.parse(await readFile(path.join(dir, "profile.json"), "utf8"));
  await writeFile(path.join(dir, "profile.json"), JSON.stringify({ ...current, description: "Dritte Fassung" }, null, 2) + "\n");
  await commitAll("Dritte Fassung");
  await build();
  const before = await readdir(path.join(exportsDir, "atelier-nord"));
  try {
    const r = await exportStudio(await entry(), { latest: await greenRuns(), env, git: fakeGit, now: new Date("2026-11-21T10:00:00Z") });
    assert.match(r.error, /Leak-Prüfung/);
    assert.ok(r.reasons.some((x) => /Kennzeichen Nordstadt von „fremd“/.test(x)), r.reasons.join("\n"));
    assert.deepEqual(await readdir(path.join(exportsDir, "atelier-nord")), before);
  } finally {
    await rm(other, { recursive: true, force: true });
  }
});

test("export: never into the core or into a studio folder", async () => {
  const e = await entry();
  const inCore = path.join(root, "exporte-test-darf-nicht-entstehen");
  let r = await exportStudio(e, { latest: await greenRuns(), env: { ...env, INKFORM_EXPORTE: inCore }, git: fakeGit, now: NOW });
  assert.match(r.error, /im Kern/);
  assert.equal(await stat(inCore).then(() => true, () => false), false);
  r = await exportStudio(e, { latest: await greenRuns(), env: { ...env, INKFORM_EXPORTE: path.join(dir, "Exporte") }, git: fakeGit, now: NOW });
  assert.match(r.error, /Studio-Ordner/);
});

test("server: protected studios cannot be exported; Blanko readiness is shown", async () => {
  const protectedDir = path.join(studiosDir, "bestand");
  await cp(path.join(root, "profiles", "beispiel"), protectedDir, { recursive: true });
  const p = JSON.parse(await readFile(path.join(protectedDir, "profile.json"), "utf8"));
  await writeFile(path.join(protectedDir, "profile.json"), JSON.stringify({ ...p, id: "bestand", name: "Bestand" }));
  const { server, token } = await startWerkstatt({ port: 0, env, stateDir, certDir: path.join(base, "keine"), git: fakeGit });
  try {
    assert.equal((await callApi(server, token, "GET", "/api/export?key=s-bestand")).status, 403);
    assert.equal((await callApi(server, token, "POST", "/api/export", { studio: "s-bestand" })).status, 403);
    assert.equal(await stat(path.join(exportsDir, "bestand")).then(() => true, () => false), false);
    const blanko = await callApi(server, token, "GET", "/api/export?key=blanko");
    assert.equal(blanko.status, 200);
    assert.equal(blanko.json.ok, false, "no runs yet");
    const overview = await callApi(server, token, "GET", "/api/overview");
    assert.match(overview.json.studios.find((s) => s.key === "s-atelier-nord").lastExport.name, /-p2-/);
  } finally {
    server.close();
    await rm(protectedDir, { recursive: true, force: true });
  }
});

// ---------- stray files, changes and folder swaps during an export ----------

async function bump(text) {
  const current = JSON.parse(await readFile(path.join(dir, "profile.json"), "utf8"));
  await writeFile(path.join(dir, "profile.json"), JSON.stringify({ ...current, description: text }, null, 2) + "\n");
  await commitAll(text);
  await build();
}
const exportNames = async () => (await readdir(path.join(exportsDir, "atelier-nord"))).sort();

test("export: a stray file in icons/ (even if git ignores it) stops the export", async () => {
  await bump("Fassung Icons");
  await writeFile(path.join(dir, "icons", "Inkform_Einnahmen_2026.csv"), "Datum;Betrag\n");
  await build();
  try {
    const before = await exportNames();
    const r = await exportStudio(await entry(), { latest: await greenRuns(), env, git: fakeGit, now: NOW });
    assert.match(r.error, /Unerwartete Dateien/);
    assert.deepEqual(r.reasons, ["dist/icons/Inkform_Einnahmen_2026.csv"]);
    assert.deepEqual(await exportNames(), before);
  } finally {
    await rm(path.join(dir, "icons", "Inkform_Einnahmen_2026.csv"));
    await build();
  }
});

test("export: a commit during the export stops it; no folder with the final name remains", async () => {
  await bump("Fassung Wechsel");
  const before = await exportNames();
  let calls = 0;
  const changing = async (d) => {
    const info = await fakeGit(d);
    if (path.resolve(d) === path.resolve(root) && ++calls > 1) return { ...info, commit: "c0ffee2" };
    return info;
  };
  const r = await exportStudio(await entry(), { latest: await greenRuns(), env, git: changing, now: NOW });
  assert.match(r.error, /während des Exports geändert/);
  assert.deepEqual(await exportNames(), before);
});

test("export: the export folder swapped for a link into a studio during the export receives nothing", async () => {
  const parent = path.join(exportsDir, "atelier-nord");
  const trap = path.join(dir, "Falle");
  const before = await exportNames();
  let calls = 0;
  const swapping = async (d) => {
    if (path.resolve(d) === path.resolve(root) && ++calls === 2) {
      await rename(parent, `${parent}-weg`);
      await mkdir(trap);
      await symlink(trap, parent);
    }
    return fakeGit(d);
  };
  try {
    const r = await exportStudio(await entry(), { latest: await greenRuns(), env, git: swapping, now: NOW });
    assert.match(r.error, /Exportordner/);
    assert.deepEqual(await readdir(trap), [], "nothing left in the studio folder");
  } finally {
    await rm(parent);
    await rm(trap, { recursive: true, force: true });
    await rename(`${parent}-weg`, parent);
  }
  assert.deepEqual(await exportNames(), before);
});

test("export: damaged or incomplete packages block further exports and are not shown as latest", async () => {
  const fake = path.join(exportsDir, "atelier-nord", "inkform-atelier-nord-1.2.0-p9-2026-11-22");
  await mkdir(fake);
  try {
    const r = await exportStudio(await entry(), { latest: await greenRuns(), env, git: fakeGit, now: NOW });
    assert.match(r.error, /unvollständige oder veränderte/);
    assert.ok(r.reasons[0].startsWith(`${fake}: `), r.reasons[0]);
    const listed = await listExports("atelier-nord", env);
    assert.equal(listed.find((e) => e.name.endsWith("p9-2026-11-22")).valid, false);
  } finally {
    await rm(fake, { recursive: true });
  }
});

test("export: an existing ZIP is never replaced or deleted", async () => {
  const listed = await listExports("atelier-nord", env);
  const next = Math.max(...listed.map((e) => Number(e.version.split("-p")[1]))) + 1;
  const zip = path.join(exportsDir, "atelier-nord", `inkform-atelier-nord-1.2.0-p${next}-2026-11-20.zip`);
  await writeFile(zip, "schon da");
  const r = await exportStudio(await entry(), { latest: await greenRuns(), env, git: fakeGit, now: NOW, zip: true });
  assert.ok(r.folder, r.error);
  assert.match(r.warning, /gab es schon/);
  assert.equal(await readFile(zip, "utf8"), "schon da");
  assert.deepEqual((await exportNames()).filter((n) => n.startsWith(".")), []);
});

test("export: Blanko's unchanged state is not exported twice", async () => {
  await ensureBlankoBuild();
  const blanko = (await listStudios({ env, stateDir })).find((s) => s.key === "blanko");
  const r = (text) => ({ ok: true, text, at: NOW.toISOString(), core: { commit: "c0ffee1", clean: true }, profile: null });
  const latest = { "blanko:test": r("ok"), "blanko:browser": r("ok") };
  const first = await exportStudio(blanko, { latest, env, git: fakeGit, now: NOW });
  assert.ok(first.folder, JSON.stringify(first));
  assert.match(await readFile(path.join(first.folder, "PRUEFBERICHT.txt"), "utf8"), /Studio-Commit: keiner/);
  assert.match((await exportStudio(blanko, { latest, env, git: fakeGit, now: NOW })).error, /bereits exportiert/);
});

// ---------- package validity and exclusive publishing ----------

const lastValid = async () => (await listExports("atelier-nord", env)).filter((e) => e.valid).at(-1);

test("a truncated checksum list or a changed file makes a package invalid (also in the overview)", async () => {
  const pkg = await lastValid();
  execFileSync("chmod", ["-R", "u+w", pkg.folder]);
  const sums = await readFile(path.join(pkg.folder, "SHA256SUMS"), "utf8");
  const index = await readFile(path.join(pkg.folder, "index.html"));
  try {
    await writeFile(path.join(pkg.folder, "SHA256SUMS"), sums.split("\n")[0] + "\n");
    await rm(path.join(pkg.folder, "index.html"));
    let entry = (await listExports("atelier-nord", env)).find((e) => e.name === pkg.name);
    assert.equal(entry.valid, false);
    await writeFile(path.join(pkg.folder, "SHA256SUMS"), sums);
    await writeFile(path.join(pkg.folder, "index.html"), Buffer.concat([index, Buffer.from("<!-- x -->")]));
    entry = (await listExports("atelier-nord", env)).find((e) => e.name === pkg.name);
    assert.equal(entry.valid, false);
    assert.match(entry.reason, /index\.html wurde verändert/);
    assert.match((await exportStudio(await entry_(), { latest: await greenRuns(), env, git: fakeGit, now: NOW })).error, /unvollständige oder veränderte/);
  } finally {
    await writeFile(path.join(pkg.folder, "index.html"), index);
    await writeFile(path.join(pkg.folder, "SHA256SUMS"), sums);
  }
  assert.equal((await listExports("atelier-nord", env)).find((e) => e.name === pkg.name).valid, true);
});
const entry_ = entry;

test("an empty folder created with the final name just before publishing is never taken over", async () => {
  await bump("Fassung Platzhalter");
  const listed = await listExports("atelier-nord", env);
  const next = Math.max(...listed.map((e) => Number(e.version.split("-p")[1]))) + 1;
  const placeholder = path.join(exportsDir, "atelier-nord", `inkform-atelier-nord-1.2.0-p${next}-2026-11-20`);
  let calls = 0;
  const sneaky = async (d) => {
    if (path.resolve(d) === path.resolve(root) && ++calls === 2) await mkdir(placeholder);
    return fakeGit(d);
  };
  const r = await exportStudio(await entry(), { latest: await greenRuns(), env, git: sneaky, now: NOW });
  assert.match(r.error, /EEXIST/);
  assert.deepEqual(await readdir(placeholder), [], "the foreign folder is left as it was");
  await rm(placeholder, { recursive: true });
});

test("bytes are bound to the tested state: a change and rebuild while exporting stops it (A → B → A)", async () => {
  // Git always reports the tested state; meanwhile the build changes. The package must not be finished.
  const studio = await gitInfo(dir);
  let calls = 0;
  const lying = async (d) => {
    const resolved = path.resolve(d);
    if (resolved === path.resolve(root) && ++calls === 3) {
      const current = JSON.parse(await readFile(path.join(dir, "profile.json"), "utf8"));
      await writeFile(path.join(dir, "profile.json"), JSON.stringify({ ...current, text: { ...current.text, studioLocation: "Heimlich B" } }, null, 2) + "\n");
      await build();
    }
    if (resolved === path.resolve(root)) return fakeGit(d);
    return { ...studio, clean: true, changes: 0 };
  };
  const before = await exportNames();
  try {
    const r = await exportStudio(await entry(), { latest: await greenRuns(), env, git: lying, now: NOW });
    assert.match(r.error, /während des Exports geändert/);
    assert.deepEqual(await exportNames(), before, "nothing published, nothing left");
  } finally {
    execFileSync("git", ["-C", dir, "checkout", "--", "profile.json"]);
    await build();
  }
});

test("a package folder moved away while its files are written is cleaned up where it went", async () => {
  await bump("Fassung Umzug");
  const parent = path.join(exportsDir, "atelier-nord");
  const moved = `${parent}-verschoben`;
  let calls = 0;
  const moving = async (d) => {
    if (path.resolve(d) === path.resolve(root) && ++calls === 3) {
      await rename(parent, moved);
      await mkdir(parent);
    }
    return fakeGit(d);
  };
  const before = await exportNames();
  try {
    const r = await exportStudio(await entry(), { latest: await greenRuns(), env, git: moving, now: NOW });
    assert.match(r.error, /verändert/);
    const left = (await readdir(moved)).sort();
    assert.deepEqual(left, before, "the moved folder holds no new package");
    assert.deepEqual(await readdir(parent), []);
  } finally {
    await rm(parent, { recursive: true, force: true });
    await rename(moved, parent);
  }
});

// ---------- publisher (publish.py): no links, only export folders ----------

const job = async (parent, extra = {}) => ({
  root: await (await import("node:fs/promises")).realpath(path.dirname(parent)),
  id: path.basename(parent),
  staging: ".inkform-" + "a".repeat(32) + ".tmp",
  zipTmp: ".inkform-" + "b".repeat(32) + ".zip.tmp",
  final: "inkform-test-1.0.0-p1-2026-11-20",
  zip: false,
  started: Date.now() / 1000,
  files: [["dist/index.html", Buffer.from("x").toString("base64")]],
  ...extra,
});

test("publisher: never follows a link, neither in the folder path nor at the work name", async () => {
  const realParent = path.join(base, "pub-echt");
  const foreign = path.join(base, "pub-fremd");
  await mkdir(realParent);
  await mkdir(foreign);
  await writeFile(path.join(foreign, "wichtig.txt"), "fremd");
  // A link at the hidden work name: mkdir fails, nothing is written through it.
  const j = await job(realParent);
  await symlink(foreign, path.join(realParent, j.staging));
  let r = await publish(j, async () => true);
  assert.match(r.error, /File exists|EEXIST|Errno 17/);
  assert.deepEqual(await readdir(foreign), ["wichtig.txt"]);
  await rm(path.join(realParent, j.staging));
  // A link anywhere in the folder path: opening without following fails.
  const linked = path.join(base, "pub-link");
  await symlink(realParent, linked);
  r = await publish({ ...(await job(realParent)), root: linked, id: "." }, async () => true);
  assert.ok(r.error, "a linked path is refused");
  assert.deepEqual(await readdir(realParent), []);
});

test("publisher: only writes into a real export folder (no foreign entries such as a studio's files)", async () => {
  const studioLike = path.join(base, "pub-studio");
  await mkdir(studioLike);
  await writeFile(path.join(studioLike, "profile.json"), "{}");
  const r = await publish(await job(studioLike), async () => true);
  assert.match(r.error, /fremde Einträge/);
  assert.deepEqual(await readdir(studioLike), ["profile.json"]);
});

test("publisher: aborting after writing removes everything it created", async () => {
  const parent = path.join(base, "pub-abbruch");
  await mkdir(parent);
  const r = await publish(await job(parent, { files: [["dist/icons/icon-192.png", "eA=="], ["index.html", "eA=="]] }), async () => false);
  assert.match(r.error, /während des Exports geändert/);
  assert.deepEqual(await readdir(parent), []);
});

test("a package without the licence files is not valid", async () => {
  const pkg = (await listExports("atelier-nord", env)).filter((e) => e.valid).at(-1);
  execFileSync("chmod", ["-R", "u+w", pkg.folder]);
  const sums = await readFile(path.join(pkg.folder, "SHA256SUMS"), "utf8");
  const licences = path.join(pkg.folder, "dist", "licenses");
  const saved = path.join(base, "lizenzen-weg");
  try {
    await rename(licences, saved);
    await writeFile(path.join(pkg.folder, "SHA256SUMS"), sums.split("\n").filter((l) => !l.includes("dist/licenses/")).join("\n"));
    const entry = (await listExports("atelier-nord", env)).find((e) => e.name === pkg.name);
    assert.equal(entry.valid, false);
    assert.match(entry.reason, /Pflichtdateien/);
  } finally {
    await rename(saved, licences);
    await writeFile(path.join(pkg.folder, "SHA256SUMS"), sums);
  }
});

test("server: a relative state folder is fixed at start, the working directory does not matter later", async () => {
  const previous = process.cwd();
  const elsewhere = await mkdtemp(path.join(tmpdir(), "inkform-cwd-"));
  process.chdir(base);
  let server, token;
  try {
    ({ server, token } = await startWerkstatt({ port: 0, env, stateDir: "rel-state", certDir: "rel-cert", git: fakeGit }));
  } finally {
    process.chdir(previous);
  }
  try {
    process.chdir(elsewhere);
    assert.equal((await callApi(server, token, "GET", "/api/overview")).status, 200);
    assert.equal(await stat(path.join(base, "rel-state")).then((s) => s.isDirectory(), () => false), true);
    assert.deepEqual(await readdir(elsewhere), [], "nothing created in the current working directory");
  } finally {
    process.chdir(previous);
    server.close();
    await rm(elsewhere, { recursive: true, force: true });
  }
});

// ---------- publisher: bytes and folders ----------

test("publisher: staged bytes changed before the final rename are never published", async () => {
  const parent = path.join(base, "pub-bytes");
  await mkdir(parent);
  const j = await job(parent, { files: [["dist/index.html", Buffer.from("geprüft").toString("base64")], ["SHA256SUMS", Buffer.from("x").toString("base64")]] });
  const r = await publish(j, async () => {
    const staged = path.join(parent, j.staging);
    execFileSync("chmod", ["-R", "u+w", staged]);
    await writeFile(path.join(staged, "dist", "index.html"), "untergeschoben");
    return true;
  });
  assert.match(r.error, /verändert/);
  assert.deepEqual(await readdir(parent), [], "nothing published, staging removed");
});

test("publisher: export root that looks like a studio or repo is refused before anything is created", async () => {
  const root = path.join(base, "pub-root-studio");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "package.json"), "{}");
  const r = await publish({ ...(await job(path.join(root, "x"))), root: await (await import("node:fs/promises")).realpath(root) }, async () => true);
  assert.match(r.error, /Studio oder Repo/);
  assert.deepEqual(await readdir(root), ["package.json"], "no studio folder was created");
});

test("publisher: missing export folders are created by the publisher itself", async () => {
  const root = path.join(base, "pub-neu", "tief");
  const real = path.join(await (await import("node:fs/promises")).realpath(base), "pub-neu", "tief");
  const r = await publish({ ...(await job(path.join(base, "x"))), root: real, id: "studio-x" }, async () => true);
  assert.ok(r.ok, r.error);
  assert.deepEqual(await readdir(path.join(root, "studio-x")), ["inkform-test-1.0.0-p1-2026-11-20"]);
});
