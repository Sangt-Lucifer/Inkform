// Werkstatt: new studio, profile editor and commit. Everything happens in a temporary
// studios folder and a temporary state folder; never in ../Inkform-Studios. The first test creates
// the studio "atelier-nord" that the following tests edit and commit, so they run in order.
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildProfile, root } from "../scripts/build.mjs";
import { probeMarkers } from "../werkstatt/markers.mjs";
import { checkDraft, commitStudio, createStudio, editable, forbiddenPath, pendingChanges, readEditable, saveDraft, studioGuard } from "../werkstatt/profile.mjs";
import { listStudios } from "../werkstatt/status.mjs";
import { startWerkstatt } from "../werkstatt/server.mjs";
import { callApi, neutralTexts, snapshot, solidPng } from "./lib/werkstatt.mjs";

const base = await mkdtemp(path.join(tmpdir(), "inkform-werkstatt-p2-"));
const studiosDir = path.join(base, "studios"),
  stateDir = path.join(base, "state");
const env = { ...process.env, INKFORM_STUDIOS: studiosDir };
test.after(() => rm(base, { recursive: true, force: true }));

// A protected studio (not released) and a second studio whose markers must never be copied.
const protectedDir = path.join(studiosDir, "bestand");
await cp(path.join(root, "profiles", "beispiel"), protectedDir, { recursive: true });
const sample = JSON.parse(await readFile(path.join(root, "profiles", "beispiel", "profile.json"), "utf8"));
await writeFile(
  path.join(protectedDir, "profile.json"),
  JSON.stringify({ ...sample, id: "bestand", name: "Bestand Süd", markers: ["Bestand Süd"], text: neutralTexts(sample.text, "Bestand Süd") }, null, 2),
);
execFileSync("git", ["init", "-q", protectedDir]);

const cleanDraft = async (dir, name) => {
  const { draft } = await readEditable(dir);
  return { ...draft, name, description: "Testprofil", markers: [name], text: neutralTexts(draft.text, name) };
};

test("new studio: copy of the sample with its own id, .gitignore, own git repo without commit or remote; released", async () => {
  const result = await createStudio({ id: "atelier-nord", name: "Atelier Nord", env, stateDir });
  assert.equal(result.key, "s-atelier-nord");
  const dir = path.join(studiosDir, "atelier-nord");
  const profile = JSON.parse(await readFile(path.join(dir, "profile.json"), "utf8"));
  assert.equal(profile.id, "atelier-nord");
  assert.deepEqual(profile.markers, ["Atelier Nord"]);
  assert.match(await readFile(path.join(dir, ".gitignore"), "utf8"), /\/build\/[\s\S]*\*\.key[\s\S]*\*\.crt/);
  assert.equal(execFileSync("git", ["-C", dir, "remote"], { encoding: "utf8" }), "");
  assert.throws(() => execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { stdio: "ignore" }), "no commit yet");
  assert.equal(execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim(), await import("node:fs/promises").then((f) => f.realpath(dir)));
  // README of the sample is not copied: it names the sample studio.
  assert.doesNotMatch(await readFile(path.join(dir, "README.md"), "utf8"), /Musterstudio/);
  const entry = (await listStudios({ env, stateDir })).find((s) => s.key === "s-atelier-nord");
  assert.equal(entry.actionable, true);
  assert.equal(await editable(entry, stateDir, env), null);
  assert.equal((await readdir(studiosDir)).filter((n) => n.startsWith(".")).length, 0, "no temporary folder left");
});

test("new studio: existing folders, bad ids and reserved names are refused without touching anything", async () => {
  const before = await snapshot(protectedDir);
  assert.match((await createStudio({ id: "bestand", name: "X", env, stateDir })).error, /gibt es schon/);
  for (const id of ["A-b", "ab", "-abc", "abc-", "../x", "beispiel", "a".repeat(41), "x y z"])
    assert.ok((await createStudio({ id, name: "X", env, stateDir })).error, id);
  assert.ok((await createStudio({ id: "neu-eins", name: 'Name "mit" Anführung', env, stateDir })).error);
  assert.equal(await snapshot(protectedDir), before);
  const released = JSON.parse(await readFile(path.join(stateDir, "freigegeben.json"), "utf8")).studios;
  assert.ok(!released.some((p) => p.endsWith("bestand")), "protected studio was never released");
});

test("editor: Beispiel and display-only studios cannot be edited", async () => {
  const list = await listStudios({ env, stateDir });
  assert.match(await editable(list.find((s) => s.key === "beispiel"), stateDir, env), /Beispiel-Fassung/);
  assert.match(await editable(list.find((s) => s.key === "s-bestand"), stateDir, env), /Nur Anzeige/);
});

test("editor: a fresh studio still has sample texts; nothing is saved while errors are open", async () => {
  const dir = path.join(studiosDir, "atelier-nord");
  const { draft, version } = await readEditable(dir);
  const result = await checkDraft({ dir, id: "atelier-nord", draft, env });
  assert.ok(result.errors.some((e) => /Text studioName: enthält noch Text des Musterstudios/.test(e)), result.errors.join("\n"));
  assert.ok(result.warnings.some((w) => /Logo/.test(w)) && result.warnings.some((w) => /PDF/.test(w)));
  const before = await snapshot(dir);
  const saved = await saveDraft({ dir, id: "atelier-nord", draft, expectedVersion: version, env });
  assert.ok(saved.errors.length);
  assert.equal(await snapshot(dir), before);
});

test("editor: same character rules and text fields as build.mjs, marker rules across studios", async () => {
  const dir = path.join(studiosDir, "atelier-nord");
  const clean = await cleanDraft(dir, "Atelier Nord");
  const errorsOf = async (change) => (await checkDraft({ dir, id: "atelier-nord", draft: change(structuredClone(clean)), env })).errors.join("\n");
  assert.equal(await errorsOf((d) => d), "");
  assert.match(await errorsOf((d) => ((d.text.studioName = 'A "B"'), d)), /studioName: enthält nicht erlaubte Zeichen/);
  assert.match(await errorsOf((d) => ((d.text.studioName = "A ${x}"), d)), /nicht erlaubte Zeichen/);
  assert.match(await errorsOf((d) => (delete d.text.studioName, d)), /Texte fehlen: studioName/);
  assert.match(await errorsOf((d) => ((d.text.neu = "x"), d)), /Unbekannte Texte: neu/);
  assert.match(await errorsOf((d) => ((d.markers = [{ regex: "x*" }]), d)), /leeren Text/);
  assert.match(await errorsOf((d) => ((d.markers = [{ regex: "(" }]), d)), /ungültige Regex/);
  assert.match(await errorsOf((d) => ((d.markers = []), d)), /mindestens eines/);
  assert.match(await errorsOf((d) => ((d.markers = ["Atelier Nord", "Einwilligung"]), d)), /zu allgemein/);
  assert.match(await errorsOf((d) => ((d.markers = ["Bestand Süd"]), d)), /kommt auch im Studio „bestand“ vor/);
  assert.match(await errorsOf((d) => ((d.text.photoChannels = "auch bei Bestand Süd"), d)), /photoChannels: enthält Kennzeichen des Studios „bestand“/);
  assert.match(await errorsOf((d) => ((d.markers = ["Musterstudio"]), d)), /Musterstudio-Kennzeichen übernommen/);
  assert.match(await errorsOf((d) => ((d.markers = ["Nirgendwo Studio"]), d)), /keines kommt in deinem Build vor/);
  assert.match(await errorsOf((d) => ((d.manifest.theme_color = "red"), d)), /theme_color: Farbe/);
  assert.match(await errorsOf((d) => ((d.manifest.short_name = "Ein viel zu langer Name"), d)), /Kurzname: höchstens 15/);
  assert.match(await errorsOf((d) => ((d.guide.date = "2026-11-11"), d)), /TT\.MM\.JJJJ/);
  const probe = (await checkDraft({ dir, id: "atelier-nord", draft: clean, env })).probe;
  assert.ok(probe[0].inBuild.includes("dist/index.html") && !probe[0].inSample);
});

test("editor: save writes the profile files, refuses a stale version, and the studio builds", async () => {
  const dir = path.join(studiosDir, "atelier-nord");
  const { version } = await readEditable(dir);
  const draft = await cleanDraft(dir, "Atelier Nord");
  draft.manifest.theme_color = "#224466";
  draft.guideMd = "# Anleitung Atelier Nord\n";
  const logo = solidPng(600, 600).toString("base64");
  const saved = await saveDraft({ dir, id: "atelier-nord", draft, logoBase64: logo, expectedVersion: version, env });
  assert.deepEqual(saved.errors, []);
  assert.notEqual(saved.version, version);
  const profile = JSON.parse(await readFile(path.join(dir, "profile.json"), "utf8"));
  assert.equal(profile.id, "atelier-nord");
  assert.equal(profile.text.customerStudioName, "Atelier Nord");
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.webmanifest"), "utf8"));
  assert.equal(manifest.theme_color, "#224466");
  assert.equal(manifest.start_url, "./", "fixed fields stay as in the sample");
  assert.equal(manifest.display, "standalone");
  assert.equal(await readFile(path.join(dir, "Dokumente", "Anleitung.md"), "utf8"), "# Anleitung Atelier Nord\n");
  for (const size of [192, 512]) {
    const icon = await readFile(path.join(dir, "icons", `icon-${size}.png`));
    assert.equal(icon.readUInt32BE(16), size);
    assert.equal(icon.readUInt32BE(20), size);
  }
  assert.ok((await readEditable(dir)).icons[512]);
  await buildProfile(dir);
  const again = await saveDraft({ dir, id: "atelier-nord", draft, expectedVersion: version, env });
  assert.equal(again.conflict, true);
  assert.equal((await readdir(dir, { recursive: true })).filter((n) => n.endsWith(".tmp")).length, 0);
  const warnings = (await checkDraft({ dir, id: "atelier-nord", draft, env })).warnings;
  assert.ok(!warnings.some((w) => /Logo/.test(w)), "own logo: no warning");
});

test("editor: only square PNG logos between 512 and 4096 px", async () => {
  const dir = path.join(studiosDir, "atelier-nord");
  const draft = await cleanDraft(dir, "Atelier Nord");
  const errorsOf = async (bytes) => (await checkDraft({ dir, id: "atelier-nord", draft, logoBase64: bytes.toString("base64"), env })).errors.join("\n");
  assert.match(await errorsOf(Buffer.from("GIF89a nicht png")), /nur PNG/);
  assert.match(await errorsOf(solidPng(600, 512)), /quadratisch/);
  assert.match(await errorsOf(solidPng(256, 256)), /512 bis 4096/);
});

test("commit: shows the changes, commits exactly the confirmed list as Sven, refuses forbidden files", async () => {
  const dir = path.join(studiosDir, "atelier-nord");
  const { files } = await pendingChanges(dir);
  const paths = files.map((f) => f.path);
  assert.ok(paths.includes("profile.json") && paths.includes(".gitignore"));
  assert.ok(!paths.some((p) => p.startsWith("build/")));
  assert.equal((await commitStudio({ dir, message: "Erstes Profil", files: paths.slice(1) })).conflict, true);
  const done = await commitStudio({ dir, message: "Erstes Profil", files: paths });
  assert.ok(done.commit, done.error);
  assert.equal(execFileSync("git", ["-C", dir, "log", "-1", "--format=%an <%ae>|%cn <%ce>|%s"], { encoding: "utf8" }).trim(), "Sven <sven@inkform.invalid>|Sven <sven@inkform.invalid>|Erstes Profil");
  assert.deepEqual((await pendingChanges(dir)).files, []);
  await mkdir(path.join(dir, "Dokumente", "build"), { recursive: true });
  await writeFile(path.join(dir, "Dokumente", "build", "x.txt"), "x");
  const now = await pendingChanges(dir);
  assert.deepEqual(now.forbidden, ["Dokumente/build/x.txt"]);
  assert.match((await commitStudio({ dir, message: "x", files: now.files.map((f) => f.path) })).error, /gehören nicht ins Repo/);
  await rm(path.join(dir, "Dokumente", "build"), { recursive: true });
});

test("server: editor routes refuse the protected studio and leave its folder (and .git) unchanged", async () => {
  const { server, token } = await startWerkstatt({ port: 0, env, stateDir, certDir: path.join(base, "keine") });
  const before = await snapshot(protectedDir);
  try {
    assert.equal((await callApi(server, token, "GET", "/api/studio?key=s-bestand")).status, 403);
    assert.equal((await callApi(server, token, "GET", "/api/studio?key=beispiel")).status, 403);
    const draft = await cleanDraft(protectedDir, "Bestand Süd");
    for (const p of ["/api/studio/check", "/api/studio/save"])
      assert.equal((await callApi(server, token, "POST", p, { studio: "s-bestand", draft, version: "x" })).status, 403, p);
    assert.equal((await callApi(server, token, "GET", "/api/studio/changes?key=s-bestand")).status, 403);
    assert.equal((await callApi(server, token, "POST", "/api/studio/commit", { studio: "s-bestand", message: "x", files: [] })).status, 403);
    assert.equal((await callApi(server, token, "POST", "/api/studio/new", { id: "bestand", name: "X" })).status, 400);
    const ok = await callApi(server, token, "GET", "/api/studio?key=s-atelier-nord");
    assert.equal(ok.status, 200);
    assert.ok(ok.json.textKeys.includes("studioName"));
    const check = await callApi(server, token, "POST", "/api/studio/check", { studio: "s-atelier-nord", draft: ok.json.draft });
    assert.deepEqual(check.json.errors, []);
  } finally {
    server.close();
  }
  assert.equal(await snapshot(protectedDir), before);
});

// ---------- writes never leave the released studio ----------

test("logo path in profile.json can never lead a write out of the studio", async () => {
  await createStudio({ id: "logo-weg", name: "Logo Weg", env, stateDir });
  const dir = path.join(studiosDir, "logo-weg");
  const profile = JSON.parse(await readFile(path.join(dir, "profile.json"), "utf8"));
  await writeFile(path.join(dir, "profile.json"), JSON.stringify({ ...profile, logo: "../../ausbruch.png" }));
  const draft = await cleanDraft(dir, "Logo Weg");
  const result = await checkDraft({ dir, id: "logo-weg", draft, logoBase64: solidPng(512, 512).toString("base64"), env });
  assert.match(result.errors.join("\n"), /"logo" muss "logo.png" sein/);
  const escaped = await readdir(tmpdir()).then((names) => names.includes("ausbruch.png"));
  assert.equal(escaped, false);
  await rm(dir, { recursive: true, force: true });
});

test("links inside a released studio cannot redirect a save into a protected studio", async () => {
  await createStudio({ id: "verlinkt", name: "Verlinkt Ost", env, stateDir });
  const dir = path.join(studiosDir, "verlinkt");
  await rm(path.join(dir, "Dokumente"), { recursive: true });
  await symlink(path.join(protectedDir, "Dokumente"), path.join(dir, "Dokumente"));
  const before = await snapshot(protectedDir);
  const { version } = await readEditable(dir);
  const result = await saveDraft({ dir, id: "verlinkt", draft: await cleanDraft(dir, "Verlinkt Ost"), expectedVersion: version, env });
  assert.match(result.errors.join("\n"), /Dokumente\/ ist kein echter Ordner/);
  assert.equal(await snapshot(protectedDir), before);
  await rm(dir, { recursive: true, force: true });
});

test("a released path that is a link to a protected studio is not editable", async () => {
  const link = path.join(base, "link-auf-bestand");
  await symlink(protectedDir, link);
  const released = JSON.parse(await readFile(path.join(stateDir, "freigegeben.json"), "utf8"));
  await writeFile(path.join(stateDir, "freigegeben.json"), JSON.stringify({ studios: [...released.studios, link] }));
  try {
    const entry = { kind: "studio", actionable: true, dir: link };
    assert.match(await editable(entry, stateDir, env), /Verknüpfung/);
    const real = (await listStudios({ env, stateDir })).find((s) => s.key === "s-bestand");
    assert.ok(await editable(real, stateDir, env), "protected studio stays display-only");
  } finally {
    await writeFile(path.join(stateDir, "freigegeben.json"), JSON.stringify(released));
  }
});

test("a failing write restores the files already written (all or nothing)", async () => {
  await createStudio({ id: "halb-fertig", name: "Halb Fertig", env, stateDir });
  const dir = path.join(studiosDir, "halb-fertig");
  const before = await Promise.all(["manifest.webmanifest", "Dokumente/Anleitung.md", "profile.json"].map((f) => readFile(path.join(dir, f), "utf8")));
  const { version } = await readEditable(dir);
  const draft = await cleanDraft(dir, "Halb Fertig");
  draft.manifest.theme_color = "#010203";
  draft.guideMd = "# neu\n";
  await chmod(path.join(dir, "icons"), 0o555);
  try {
    const result = await saveDraft({ dir, id: "halb-fertig", draft, logoBase64: solidPng(512, 512).toString("base64"), expectedVersion: version, env });
    assert.match(result.errors.join("\n"), /Speichern fehlgeschlagen, nichts geändert/);
  } finally {
    await chmod(path.join(dir, "icons"), 0o755);
  }
  const after = await Promise.all(["manifest.webmanifest", "Dokumente/Anleitung.md", "profile.json"].map((f) => readFile(path.join(dir, f), "utf8")));
  assert.deepEqual(after, before);
  const tmp = (await readdir(dir, { recursive: true })).filter((n) => n.endsWith(".tmp"));
  assert.deepEqual(tmp, []);
  await rm(dir, { recursive: true, force: true });
});

test("regex markers that backtrack or run slowly are refused", async () => {
  const dir = path.join(studiosDir, "atelier-nord");
  const draft = await cleanDraft(dir, "Atelier Nord");
  const errorsOf = async (regex) => (await checkDraft({ dir, id: "atelier-nord", draft: { ...draft, markers: ["Atelier Nord", { regex }] }, env })).errors.join("\n");
  assert.match(await errorsOf("(a+)+$"), /wiederholten Gruppen/);
  assert.match(await errorsOf("(a)\\1"), /Rückverweise/);
  assert.match(await errorsOf("a*b*c*"), /höchstens zwei/);
  const started = Date.now();
  assert.match(await errorsOf("a*a*b"), /zu langsam/);
  assert.ok(Date.now() - started < 5000, "the Werkstatt does not hang");
  assert.equal(await errorsOf("atelier\\s+nord"), "");
});

test("forbidden paths match the generated .gitignore; only profile.json and the guide PDF are allowed", () => {
  for (const p of ["dist/index.html", "secrets/token.txt", "kunden.json", "einwilligung.pdf", "a/build/x", "server.key", "x.crt", "Exporte/a.txt", ".env.local", "INKFORM_Studio_1.json", "Tattoo_Einwilligung_x.txt"])
    assert.equal(forbiddenPath(p), true, p);
  for (const p of ["profile.json", "Anleitung-iPad-und-Admin.pdf", "manifest.webmanifest", "logo.png", "icons/icon-192.png", "Dokumente/Anleitung.md", ".gitignore", "README.md"])
    assert.equal(forbiddenPath(p), false, p);
});

test("new studio: a folder that appears is never used; commit leaves the real index clean", async () => {
  await mkdir(path.join(studiosDir, "schon-da"));
  assert.match((await createStudio({ id: "schon-da", name: "Schon Da", env, stateDir })).error, /gibt es schon/);
  assert.deepEqual(await readdir(path.join(studiosDir, "schon-da")), []);
  await rm(path.join(studiosDir, "schon-da"), { recursive: true });

  await createStudio({ id: "index-test", name: "Index Test", env, stateDir });
  const dir = path.join(studiosDir, "index-test");
  const { files } = await pendingChanges(dir);
  const done = await commitStudio({ dir, message: "Erstes Profil", files: files.map((f) => f.path) });
  assert.ok(done.commit, done.error);
  assert.equal(execFileSync("git", ["-C", dir, "status", "--porcelain"], { encoding: "utf8" }), "");
  // Rename: both sides are listed and committed together.
  execFileSync("git", ["-C", dir, "mv", "README.md", "LIESMICH.md"]);
  const renamed = await pendingChanges(dir);
  assert.deepEqual(renamed.files.map((f) => f.path).sort(), ["LIESMICH.md", "README.md"]);
  assert.ok((await commitStudio({ dir, message: "Umbenannt", files: renamed.files.map((f) => f.path) })).commit);
  assert.equal(execFileSync("git", ["-C", dir, "status", "--porcelain"], { encoding: "utf8" }), "");
  await rm(dir, { recursive: true, force: true });
});

// ---------- links further up, foreign .git, index ----------

test("a link further up cannot turn a released path into a protected studio", async () => {
  const a = path.join(base, "wurzel-a"),
    b = path.join(base, "wurzel-b");
  await mkdir(a);
  await cp(protectedDir, path.join(b, "doppel"), { recursive: true });
  const prof = JSON.parse(await readFile(path.join(b, "doppel", "profile.json"), "utf8"));
  await writeFile(path.join(b, "doppel", "profile.json"), JSON.stringify({ ...prof, id: "doppel" }));
  const env2 = { ...process.env, INKFORM_STUDIOS: [a, b].join(path.delimiter) };
  const state2 = path.join(base, "state-wurzel");
  await mkdir(state2);
  await writeFile(path.join(state2, "freigegeben.json"), JSON.stringify({ studios: [path.join(a, "doppel")] }));
  // Root A is replaced by a link to root B: "A/doppel" is now really the protected "B/doppel".
  await rm(a, { recursive: true });
  await symlink(b, a);
  const before = await snapshot(path.join(b, "doppel"));
  assert.match(await studioGuard(path.join(a, "doppel"), { env: env2, stateDir: state2 }), /geschütztes Studio/);
  const { version } = await readEditable(path.join(b, "doppel"));
  const result = await saveDraft({ dir: path.join(a, "doppel"), id: "doppel", draft: await cleanDraft(path.join(b, "doppel"), "Bestand Süd"), expectedVersion: version, env: env2, stateDir: state2 });
  assert.ok(result.errors.length);
  assert.equal(await snapshot(path.join(b, "doppel")), before);
});

test("commit: .git as a link to another repo and GIT_DIR from the shell are never used", async () => {
  await createStudio({ id: "git-link", name: "Git Link", env, stateDir });
  const dir = path.join(studiosDir, "git-link");
  const protectedGit = await snapshot(path.join(protectedDir, ".git"));
  await rename(path.join(dir, ".git"), path.join(dir, ".git-echt"));
  await symlink(path.join(protectedDir, ".git"), path.join(dir, ".git"));
  assert.match((await pendingChanges(dir)).error, /kein eigenes Git-Repo/);
  assert.match((await commitStudio({ dir, message: "x", files: ["profile.json"], env, stateDir })).error, /kein eigenes Git-Repo/);
  await rm(path.join(dir, ".git"));
  await rename(path.join(dir, ".git-echt"), path.join(dir, ".git"));
  process.env.GIT_DIR = path.join(protectedDir, ".git");
  try {
    const { files } = await pendingChanges(dir);
    const done = await commitStudio({ dir, message: "Erstes Profil", files: files.map((f) => f.path), env, stateDir });
    assert.ok(done.commit, done.error);
  } finally {
    delete process.env.GIT_DIR;
  }
  assert.equal(execFileSync("git", ["-C", dir, "log", "--format=%s"], { encoding: "utf8" }).trim(), "Erstes Profil");
  assert.equal(await snapshot(path.join(protectedDir, ".git")), protectedGit);
  await rm(dir, { recursive: true, force: true });
});

test("commit: a real index that cannot be updated is reported, not hidden", async () => {
  await createStudio({ id: "index-lock", name: "Index Lock", env, stateDir });
  const dir = path.join(studiosDir, "index-lock");
  const { files } = await pendingChanges(dir);
  await writeFile(path.join(dir, ".git", "index.lock"), "");
  const done = await commitStudio({ dir, message: "Erstes Profil", files: files.map((f) => f.path) });
  assert.ok(done.commit, done.error);
  assert.match(done.warning, /Git-Index ist nicht aktuell/);
  await rm(dir, { recursive: true, force: true });
});

test("regex probe: bounded repetitions are limited, a timeout is never reported as finished", async () => {
  const dir = path.join(studiosDir, "atelier-nord");
  const draft = await cleanDraft(dir, "Atelier Nord");
  const errors = (await checkDraft({ dir, id: "atelier-nord", draft: { ...draft, markers: ["Atelier Nord", { regex: "reviewä{0,3000}ä{0,3000}z" }] }, env })).errors.join("\n");
  assert.match(errors, /höchstens \{0,50\}/);
  // Same source, different flags: the fast one finishes, the slow one must stay unfinished.
  const results = await probeMarkers([{ regex: "A*A*A*B", flags: "" }, { regex: "A*A*A*B", flags: "i" }], {}, 1500);
  assert.ok(results[0], "case-sensitive version finishes");
  assert.equal(results[1], null, "the stopped one counts as too slow");
});

test("save: an unreadable profile file is never overwritten; icon changes count as a conflict", async () => {
  await createStudio({ id: "lesbar", name: "Lesbar West", env, stateDir });
  const dir = path.join(studiosDir, "lesbar");
  const draft = await cleanDraft(dir, "Lesbar West");
  let { version } = await readEditable(dir);
  await chmod(path.join(dir, "Dokumente", "Anleitung.md"), 0o000);
  try {
    const result = await saveDraft({ dir, id: "lesbar", draft, expectedVersion: version, env });
    assert.ok(result.errors.length);
  } finally {
    await chmod(path.join(dir, "Dokumente", "Anleitung.md"), 0o644);
  }
  assert.ok((await readFile(path.join(dir, "Dokumente", "Anleitung.md"), "utf8")).length > 0, "guide still there");
  ({ version } = await readEditable(dir));
  await writeFile(path.join(dir, "icons", "icon-192.png"), solidPng(192, 192));
  assert.equal((await saveDraft({ dir, id: "lesbar", draft, expectedVersion: version, env })).conflict, true);
  await rm(dir, { recursive: true, force: true });
});

test("check: a failing probe build leaves no temporary folder; .DS_Store is forbidden", async () => {
  await createStudio({ id: "ohne-logo", name: "Ohne Logo", env, stateDir });
  const dir = path.join(studiosDir, "ohne-logo");
  await rm(path.join(dir, "logo.png"));
  const count = async () => (await readdir(tmpdir())).filter((n) => n.startsWith("inkform-entwurf-")).length;
  const before = await count();
  const result = await checkDraft({ dir, id: "ohne-logo", draft: await cleanDraft(dir, "Ohne Logo"), env });
  assert.match(result.errors.join("\n"), /Probe-Build/);
  assert.equal(await count(), before);
  assert.equal(forbiddenPath(".DS_Store"), true);
  assert.equal(forbiddenPath("icons/Thumbs.db"), true);
  await rm(dir, { recursive: true, force: true });
});

// ---------- .git internals, hooks, studios folder, slow markers ----------

test("commit: links inside .git are refused; repo hooks never run", async () => {
  await createStudio({ id: "git-innen", name: "Git Innen", env, stateDir });
  const dir = path.join(studiosDir, "git-innen");
  const elsewhere = path.join(base, "fremde-objekte");
  await mkdir(elsewhere);
  await rename(path.join(dir, ".git", "objects"), path.join(dir, ".git", "objects-echt"));
  await symlink(elsewhere, path.join(dir, ".git", "objects"));
  assert.match((await pendingChanges(dir)).error, /kein eigenes Git-Repo/);
  assert.deepEqual(await readdir(elsewhere), []);
  await rm(path.join(dir, ".git", "objects"));
  await rename(path.join(dir, ".git", "objects-echt"), path.join(dir, ".git", "objects"));

  const ran = path.join(base, "hook-lief");
  const hook = path.join(dir, ".git", "hooks", "prepare-commit-msg");
  await mkdir(path.dirname(hook), { recursive: true });
  await writeFile(hook, `#!/bin/sh\ntouch "${ran}"\necho '{}' > kunden.json\ngit add -f kunden.json\n`, { mode: 0o755 });
  const { files } = await pendingChanges(dir);
  const done = await commitStudio({ dir, message: "Erstes Profil", files: files.map((f) => f.path) });
  assert.ok(done.commit, done.error);
  assert.equal(await stat(ran).then(() => true, () => false), false, "hook did not run");
  assert.doesNotMatch(execFileSync("git", ["-C", dir, "ls-tree", "-r", "--name-only", "HEAD"], { encoding: "utf8" }), /kunden\.json/);
  await rm(dir, { recursive: true, force: true });
});

test("new studio: a studios folder that really lies in an existing studio or in the core is refused", async () => {
  const intoStudio = path.join(base, "link-in-studio");
  await symlink(protectedDir, intoStudio);
  const before = await snapshot(protectedDir);
  const r1 = await createStudio({ id: "im-studio", name: "Im Studio", env: { ...process.env, INKFORM_STUDIOS: [intoStudio, studiosDir].join(path.delimiter) }, stateDir });
  assert.match(r1.error, /bestehenden Studio/);
  assert.equal(await snapshot(protectedDir), before);
  const intoCore = path.join(base, "link-in-kern");
  await symlink(path.join(root, "profiles"), intoCore);
  const r2 = await createStudio({ id: "im-kern", name: "Im Kern", env: { ...process.env, INKFORM_STUDIOS: path.join(intoCore, "neu") }, stateDir });
  assert.match(r2.error, /im Kern/);
  assert.equal(await stat(path.join(root, "profiles", "neu")).then(() => true, () => false), false);
});

test("check: another studio's slow regex marker cannot hang the Werkstatt", async () => {
  const slowDir = path.join(studiosDir, "langsam");
  await mkdir(slowDir);
  await writeFile(path.join(slowDir, "profile.json"), JSON.stringify({ id: "langsam", name: "Langsam", markers: [{ regex: "b*b*c" }], text: {} }));
  try {
    const dir = path.join(studiosDir, "atelier-nord");
    const draft = { ...(await cleanDraft(dir, "Atelier Nord")), guideMd: "b".repeat(30_000) + "!" };
    const started = Date.now();
    const result = await checkDraft({ dir, id: "atelier-nord", draft, env });
    assert.ok(Date.now() - started < 10_000);
    assert.match(result.errors.join("\n"), /zu langsam für die Prüfung/);
  } finally {
    await rm(slowDir, { recursive: true, force: true });
  }
});

test("commit: a studio repo that uses Git filters is not touched (no filter program runs)", async () => {
  await createStudio({ id: "filter-test", name: "Filter Test", env, stateDir });
  const dir = path.join(studiosDir, "filter-test");
  const ran = path.join(base, "filter-lief");
  await writeFile(path.join(dir, ".gitattributes"), "*.md filter=boese\n");
  execFileSync("git", ["-C", dir, "config", "filter.boese.clean", `touch "${ran}"; cat`]);
  const changes = await pendingChanges(dir);
  assert.match(changes.error, /Git-Filter/);
  assert.match((await commitStudio({ dir, message: "x", files: ["profile.json"] })).error, /Git-Filter/);
  assert.equal(await stat(ran).then(() => true, () => false), false, "filter program never ran");
  await rm(dir, { recursive: true, force: true });
});

test("server: invalid JSON gives 400 and the server keeps running; umlauts split across packets stay intact", async () => {
  const { request: raw } = await import("node:http");
  const { server, token } = await startWerkstatt({ port: 0, env, stateDir, certDir: path.join(base, "keine") });
  const port = server.address().port;
  const send = (pathname, parts) =>
    new Promise((resolve, reject) => {
      const req = raw(
        { host: "127.0.0.1", port, method: "POST", path: pathname, headers: { host: `127.0.0.1:${port}`, "x-werkstatt-token": token, "content-type": "application/json" } },
        (res) => {
          let t = "";
          res.on("data", (c) => (t += c));
          res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(t || "{}") }));
        },
      );
      req.on("error", reject);
      (async () => {
        for (const part of parts) {
          req.write(part);
          await new Promise((r) => setTimeout(r, 30));
        }
        req.end();
      })();
    });
  try {
    for (const p of ["/api/vor-ort/start", "/api/studio/new", "/api/export", "/api/studio/commit"]) assert.equal((await send(p, ["{kaputt"])).status, 400, p);
    const json = Buffer.from(JSON.stringify({ id: "atelier-sued", name: "Atelier Süd" }));
    const cut = json.indexOf(Buffer.from("ü")) + 1; // inside the two bytes of "ü"
    const created = await send("/api/studio/new", [json.subarray(0, cut), json.subarray(cut)]);
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.equal(JSON.parse(await readFile(path.join(studiosDir, "atelier-sued", "profile.json"), "utf8")).name, "Atelier Süd");
    assert.equal((await callApi(server, token, "GET", "/api/overview")).status, 200, "still running");
  } finally {
    server.close();
    await rm(path.join(studiosDir, "atelier-sued"), { recursive: true, force: true });
  }
});
