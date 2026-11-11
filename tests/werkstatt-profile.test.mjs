// Werkstatt (Phase 2): new studio, profile editor and commit. Everything happens in a temporary
// studios folder and a temporary state folder; never in ../Inkform-Studios.
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { request } from "node:http";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { buildProfile, root } from "../scripts/build.mjs";
import { checkDraft, commitStudio, createStudio, editable, pendingChanges, readEditable, saveDraft } from "../werkstatt/profile.mjs";
import { listStudios } from "../werkstatt/status.mjs";
import { startWerkstatt } from "../werkstatt/server.mjs";

const base = await mkdtemp(path.join(tmpdir(), "inkform-werkstatt-p2-"));
const studiosDir = path.join(base, "studios"),
  stateDir = path.join(base, "state");
const env = { ...process.env, INKFORM_STUDIOS: studiosDir };
test.after(() => rm(base, { recursive: true, force: true }));

// A protected studio (not released) and a second studio whose markers must never be copied.
const protectedDir = path.join(studiosDir, "bestand");
await cp(path.join(root, "profiles", "beispiel"), protectedDir, { recursive: true });
const sample = JSON.parse(await readFile(path.join(root, "profiles", "beispiel", "profile.json"), "utf8"));
const neutral = (text, name) =>
  Object.fromEntries(
    Object.entries(text).map(([k, v]) => [
      k,
      v
        .replace(/musterstudio\.example/gi, `${name.toLowerCase().replace(/\s+/g, "-")}.example`)
        .replace(/12345 Musterstadt/g, "54321 Nordstadt")
        .replace(/Max Mustermann/g, "Erika Nordmann")
        .replace(/musterstudio/gi, name),
    ]),
  );
await writeFile(
  path.join(protectedDir, "profile.json"),
  JSON.stringify({ ...sample, id: "bestand", name: "Bestand Süd", markers: ["Bestand Süd"], text: neutral(sample.text, "Bestand Süd") }, null, 2),
);
execFileSync("git", ["init", "-q", protectedDir]);

async function snapshot(dir) {
  const out = [];
  for (const name of (await readdir(dir, { recursive: true })).sort()) {
    const s = await stat(path.join(dir, name));
    out.push(`${name}:${s.size}:${s.mtimeMs}`);
  }
  return out.join("\n");
}
function png(width, height) {
  const crc = (buf) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x40)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function http(port, token, { method = "GET", pathname, body }) {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, method, path: pathname, headers: { host: `127.0.0.1:${port}`, "x-werkstatt-token": token, "content-type": "application/json" } },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(text || "{}") }));
      },
    );
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}
const cleanDraft = async (dir, name) => {
  const { draft } = await readEditable(dir);
  return { ...draft, name, description: "Testprofil", markers: [name], text: neutral(draft.text, name) };
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
  assert.equal(await editable(entry, stateDir), null);
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

test("editor: Blanko and display-only studios cannot be edited", async () => {
  const list = await listStudios({ env, stateDir });
  assert.match(await editable(list.find((s) => s.key === "blanko"), stateDir), /Beispiel-Fassung/);
  assert.match(await editable(list.find((s) => s.key === "s-bestand"), stateDir), /Nur Anzeige/);
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
  const logo = png(600, 600).toString("base64");
  const saved = await saveDraft({ dir, id: "atelier-nord", draft, logoBase64: logo, expectedVersion: version, env });
  assert.deepEqual(saved.errors, []);
  assert.notEqual(saved.version, version);
  const profile = JSON.parse(await readFile(path.join(dir, "profile.json"), "utf8"));
  assert.equal(profile.id, "atelier-nord");
  assert.equal(profile.text.customerStudioName, "Atelier Nord");
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.webmanifest"), "utf8"));
  assert.equal(manifest.theme_color, "#224466");
  assert.equal(manifest.start_url, "/", "fixed fields stay");
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
  assert.match(await errorsOf(png(600, 512)), /quadratisch/);
  assert.match(await errorsOf(png(256, 256)), /512 bis 4096/);
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
  const port = server.address().port;
  const before = await snapshot(protectedDir);
  try {
    assert.equal((await http(port, token, { pathname: "/api/studio?key=s-bestand" })).status, 403);
    assert.equal((await http(port, token, { pathname: "/api/studio?key=blanko" })).status, 403);
    const draft = await cleanDraft(protectedDir, "Bestand Süd");
    for (const p of ["/api/studio/check", "/api/studio/save"])
      assert.equal((await http(port, token, { method: "POST", pathname: p, body: { studio: "s-bestand", draft, version: "x" } })).status, 403, p);
    assert.equal((await http(port, token, { pathname: "/api/studio/changes?key=s-bestand" })).status, 403);
    assert.equal((await http(port, token, { method: "POST", pathname: "/api/studio/commit", body: { studio: "s-bestand", message: "x", files: [] } })).status, 403);
    assert.equal((await http(port, token, { method: "POST", pathname: "/api/studio/new", body: { id: "bestand", name: "X" } })).status, 400);
    const ok = await http(port, token, { pathname: "/api/studio?key=s-atelier-nord" });
    assert.equal(ok.status, 200);
    assert.ok(ok.json.textKeys.includes("studioName"));
    const check = await http(port, token, { method: "POST", pathname: "/api/studio/check", body: { studio: "s-atelier-nord", draft: ok.json.draft } });
    assert.deepEqual(check.json.errors, []);
  } finally {
    server.close();
  }
  assert.equal(await snapshot(protectedDir), before);
});
