// Werkstatt, part 4: export a tested build as an immutable package.
//
//   ../Inkform-Exporte/<studio>/inkform-<studio>-<version>-<JJJJ-MM-TT>/
//     index.html, dist/…         exactly the files buildProfile() produces
//     PRUEFBERICHT.txt           commits, test results, leak scan, date
//     SHA256SUMS                 for every file above (shasum -a 256 -c SHA256SUMS)
//
// Only exported when both repositories are clean, the tests and browser checks are green for
// exactly these commits, and the build on disk is current. Before the package is finished, every
// file is scanned for the markers and files of all other profiles. The package is written to a
// temporary folder, made read-only and then renamed: a package is complete or does not exist.
// Exports never contain test results, backups, certificates or customer data.
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmod, link, lstat, mkdir, readdir, readFile, realpath, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { buildProfile, defaultOut, discoverStudioProfiles, listBuiltinProfiles, root } from "../scripts/build.mjs";
import { findFingerprints, fingerprints, scanText } from "../tests/lib/leaks.mjs";
import { matchInWorker, realLocation } from "./profile.mjs";
import { buildState, gitInfo } from "./status.mjs";

const run = promisify(execFile);
const REPORT = "PRUEFBERICHT.txt";
const MARKER = ".unvollstaendig";
const SUMS = "SHA256SUMS";
// The only files a package may consist of (what build.mjs produces).
const PACKAGE_FILE = /^(index\.html|dist\/index\.html|dist\/sw\.js|dist\/manifest\.webmanifest|dist\/licenses\/[A-Za-z]+\.txt|dist\/icons\/icon-\d{2,4}\.png)$/;
const NAME = /^inkform-([a-z0-9-]+)-(\d+\.\d+\.\d+-p\d+)-(\d{4}-\d{2}-\d{2})$/;

export function exportsRoot(env = process.env) {
  return env.INKFORM_EXPORTE ? path.resolve(env.INKFORM_EXPORTE) : path.resolve(root, "..", "Inkform-Exporte");
}
const coreVersion = async () => JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version;
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const today = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

// A package is valid only if it is complete and unchanged: no "incomplete" marker, nothing but
// regular files, SHA256SUMS lists exactly the files present (report included, every required
// build file there) and every checksum matches. Results are cached per file list (name, size,
// change time, inode), so the overview stays fast and still notices any change.
const COMMIT = /^[0-9a-f]{7,40}$/;
const REQUIRED = ["index.html", "dist/index.html", "dist/sw.js", "dist/manifest.webmanifest", REPORT];
const verified = new Map();
async function packageFiles(folder) {
  const out = [];
  const walk = async (dir) => {
    for (const name of await readdir(dir)) {
      const full = path.join(dir, name);
      const st = await lstat(full);
      if (st.isSymbolicLink()) throw new Error(`${path.relative(folder, full)} ist eine Verknüpfung`);
      if (st.isDirectory()) await walk(full);
      else if (st.isFile()) out.push({ rel: path.relative(folder, full).split(path.sep).join("/"), st });
      else throw new Error(`${path.relative(folder, full)} ist keine normale Datei`);
    }
  };
  await walk(folder);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}
export async function verifyPackage(folder) {
  try {
    const top = await lstat(folder);
    if (top.isSymbolicLink() || !top.isDirectory()) return { valid: false, reason: "kein echter Ordner" };
    const files = await packageFiles(folder);
    const key = JSON.stringify(files.map((f) => [f.rel, f.st.size, f.st.mtimeMs, f.st.ctimeMs, f.st.ino]));
    if (verified.get(folder)?.key === key) return verified.get(folder).result;
    const result = await (async () => {
      if (files.some((f) => f.rel === MARKER)) return { valid: false, reason: "unvollständig (Export abgebrochen)" };
      const sums = await readFile(path.join(folder, SUMS), "utf8").catch(() => null);
      if (sums === null) return { valid: false, reason: "SHA256SUMS fehlt" };
      const listed = new Map();
      for (const line of sums.split("\n").filter(Boolean)) {
        const m = line.match(/^([0-9a-f]{64}) {2}(.+)$/);
        if (!m || listed.has(m[2])) return { valid: false, reason: "SHA256SUMS ist beschädigt" };
        listed.set(m[2], m[1]);
      }
      const present = files.map((f) => f.rel).filter((r) => r !== SUMS);
      if (JSON.stringify([...listed.keys()].sort()) !== JSON.stringify([...present].sort())) return { valid: false, reason: "Dateien und SHA256SUMS passen nicht zusammen" };
      if (REQUIRED.some((r) => !listed.has(r))) return { valid: false, reason: "Pflichtdateien fehlen" };
      if (present.some((r) => r !== REPORT && !PACKAGE_FILE.test(r))) return { valid: false, reason: "fremde Dateien im Paket" };
      for (const [rel, hash] of listed) if (sha256(await readFile(path.join(folder, rel))) !== hash) return { valid: false, reason: `${rel} wurde verändert` };
      return { valid: true, reason: null };
    })();
    verified.set(folder, { key, result });
    return result;
  } catch (error) {
    return { valid: false, reason: error.message };
  }
}

// Reads the existing packages of one studio (always verified, see above).
export async function listExports(id, env = process.env) {
  const dir = path.join(exportsRoot(env), id);
  const out = [];
  for (const name of await readdir(dir).catch(() => [])) {
    const m = name.match(NAME);
    if (!m || m[1] !== id) continue;
    const folder = path.join(dir, name);
    const report = await readFile(path.join(folder, REPORT), "utf8").catch(() => null);
    const field = (key) => report?.match(new RegExp(`^${key}:\\s*(\\S+)`, "m"))?.[1] ?? null;
    const core = field("Kern-Commit"),
      profile = field("Studio-Commit");
    const check = await verifyPackage(folder);
    const fieldsOk = COMMIT.test(core ?? "") && (profile === "keiner" || COMMIT.test(profile ?? "")) && field("Version") === m[2];
    out.push({
      name,
      version: m[2],
      date: m[3],
      core,
      profile: profile === "keiner" ? null : profile,
      folder,
      valid: check.valid && fieldsOk,
      reason: check.reason ?? (fieldsOk ? null : "Prüfbericht unvollständig"),
    });
  }
  return out.sort((a, b) => (a.date === b.date ? a.version.localeCompare(b.version, "en", { numeric: true }) : a.date.localeCompare(b.date)));
}

// Version: core version plus -p<n>, n counting the distinct states (core and studio commit)
// exported with this core version. The same state keeps its number; a new state gets the next one.
export function nextVersion(base, existing, state) {
  const same = existing.filter((e) => e.version.startsWith(`${base}-p`));
  const seen = same.find((e) => e.core === state.core && e.profile === state.profile);
  if (seen) return { version: seen.version, already: seen.name };
  const max = Math.max(0, ...same.map((e) => Number(e.version.split("-p")[1]) || 0));
  return { version: `${base}-p${max + 1}`, already: null };
}

// Why an export is (not yet) possible. All reasons are listed, so the user sees what to do.
export async function readiness(entry, { latest, git = gitInfo } = {}) {
  const reasons = [];
  const [core, studio] = await Promise.all([git(root), entry.kind === "studio" ? git(entry.dir) : null]);
  if (!core?.repo || !core.commit) reasons.push("Der Kern ist kein Git-Repo mit Commit.");
  else if (!core.clean) reasons.push(`Der Kern hat ${core.changes} ungespeicherte Änderungen. Erst committen.`);
  if (entry.kind === "studio") {
    if (!studio?.repo || !studio.commit) reasons.push("Das Studio hat noch keinen Commit.");
    else if (!studio.clean) reasons.push(`Das Studio hat ${studio.changes} ungespeicherte Änderungen. Erst committen.`);
    if (studio?.remotes?.length) reasons.push("Das Studio-Repo hat ein Remote. Exportiert wird nur ohne.");
  }
  const state = { core: core?.commit ?? null, profile: entry.kind === "studio" ? (studio?.commit ?? null) : null };
  for (const [kind, label] of [
    ["test", "Unit- und Leak-Tests"],
    ["browser", "Browser-Prüfungen"],
  ]) {
    const r = latest[`${entry.key}:${kind}`];
    if (!r) reasons.push(`${label}: noch nicht gelaufen.`);
    else if (!r.ok) reasons.push(`${label}: zuletzt rot.`);
    else if (!r.core?.clean || r.core.commit !== state.core || (entry.kind === "studio" && (!r.profile?.clean || r.profile.commit !== state.profile)))
      reasons.push(`${label}: grün, aber für einen anderen Stand. Bitte neu prüfen.`);
  }
  const build = await buildState(entry.dir);
  if (build.state !== "aktuell") reasons.push(`Build: ${build.state === "fehlt" ? "noch nicht gebaut" : build.state}. Bitte neu bauen.`);
  return { ok: reasons.length === 0, reasons, state };
}

// Markers and files of every other profile (Blanko included), only read.
async function otherProfiles(entry, env) {
  const dirs = [...(await listBuiltinProfiles()), ...(await discoverStudioProfiles(env))];
  const out = [];
  for (const dir of dirs) {
    if (path.resolve(dir) === path.resolve(entry.dir)) continue;
    const profile = JSON.parse(await readFile(path.join(dir, "profile.json"), "utf8"));
    out.push({ id: profile.id, markers: profile.markers ?? [], prints: await fingerprints(dir, profile.logo) });
  }
  return out;
}

export async function leakScan(entry, files, env) {
  const others = await otherProfiles(entry, env);
  const names = [...files.keys()];
  const texts = names.map((n) => scanText(files.get(n)) + "\n" + n);
  const hits = [];
  for (const o of others) {
    const found = await matchInWorker(o.markers, texts);
    found.forEach((h, i) => {
      const label = typeof o.markers[i] === "string" ? o.markers[i] : `/${o.markers[i]?.regex}/`;
      if (h === null) hits.push(`Kennzeichen ${label} von „${o.id}“: zu langsam, Prüfung abgebrochen`);
      else for (const t of h) hits.push(`${names[t]}: Kennzeichen ${label} von „${o.id}“`);
    });
    for (const [name, contents] of files) for (const f of findFingerprints(contents, o.prints)) hits.push(`${name}: Datei ${f} von „${o.id}“`);
  }
  return { hits, count: others.length };
}

// Where exports may go: outside the core and outside every studio folder.
async function placeError(target, env) {
  const real = await realLocation(target);
  const inside = (p, q) => p === q || p.startsWith(q + path.sep);
  if (inside(real, await realpath(root))) return "Der Exportordner liegt im Kern. Exporte gehören daneben (../Inkform-Exporte).";
  for (const d of await discoverStudioProfiles(env)) {
    const r = await realpath(d).catch(() => null);
    if (r && inside(real, r)) return "Der Exportordner liegt in einem Studio-Ordner. Exporte gehören daneben (../Inkform-Exporte).";
  }
  return null;
}


export async function exportStudio(entry, { latest, env = process.env, git = gitInfo, zip = false, now = new Date() } = {}) {
  if (!entry?.actionable) return { error: entry?.protectedReason ?? "Dieses Studio wird nicht exportiert." };
  const ready = await readiness(entry, { latest, git });
  if (!ready.ok) return { error: "Export noch nicht möglich.", reasons: ready.reasons };

  const parent = path.join(exportsRoot(env), entry.id);
  const place = await placeError(parent, env);
  if (place) return { error: place };
  const existing = await listExports(entry.id, env);
  const damaged = existing.filter((e) => !e.valid);
  if (damaged.length)
    return { error: "Unter den bisherigen Exporten sind unvollständige oder veränderte Pakete. Bitte erst prüfen und wegräumen.", reasons: damaged.map((d) => `${d.folder}: ${d.reason}`) };
  const { version, already } = nextVersion(await coreVersion(), existing, ready.state);
  if (already) return { error: `Dieser Stand ist bereits exportiert: ${already}. Exporte werden nicht überschrieben.` };
  const name = `inkform-${entry.id}-${version}-${today(now)}`;
  const target = path.join(parent, name);
  if (await lstat(target).then(() => true, () => false)) return { error: `${name} gibt es schon. Exporte werden nicht überschrieben.` };

  // The package is built from the file list of buildProfile, never by copying a folder. Only the
  // files a build is made of are allowed (anything else, e.g. a stray file in icons/, stops the
  // export), and every file must be byte for byte the tested build on disk.
  const { files } = await buildProfile(entry.dir);
  const unexpected = [...files.keys()].filter((n) => !PACKAGE_FILE.test(n));
  if (unexpected.length) return { error: "Unerwartete Dateien im Build. Nicht exportiert.", reasons: unexpected };
  const out = defaultOut(entry.dir);
  for (const [n, c] of files) {
    const onDisk = await readFile(path.join(out, n)).catch(() => null);
    if (!onDisk || !onDisk.equals(Buffer.from(c))) return { error: `Build hat sich seit der Prüfung geändert (${n}). Bitte neu bauen und prüfen.` };
  }
  const scan = await leakScan(entry, files, env);
  if (scan.hits.length) return { error: "Leak-Prüfung: Das Paket enthält Daten anderer Profile. Nicht exportiert.", reasons: scan.hits.slice(0, 30) };

  const lastRun = (kind) => latest[`${entry.key}:${kind}`];
  const report = [
    "INKFORM – Prüfbericht zum Export",
    "",
    `Paket: ${name}`,
    `Studio: ${entry.id} (${entry.name})`,
    `Version: ${version}`,
    `Datum: ${now.toISOString()}`,
    `Kern-Commit: ${ready.state.core}`,
    `Studio-Commit: ${ready.state.profile ?? "keiner (Blanko liegt im Kern)"}`,
    `Tests: ${lastRun("test").text} (${lastRun("test").at})`,
    `Browser-Prüfungen: ${lastRun("browser").text} (${lastRun("browser").at})`,
    `Build: aktuell (identisch mit build.mjs)`,
    `Leak-Prüfung: keine Funde; geprüft gegen ${scan.count} andere${scan.count === 1 ? "s Profil" : " Profile"}`,
    "",
    "Inhalt: index.html (Einzeldatei) und dist/ (für die Installation auf dem iPad).",
    "Prüfen: shasum -a 256 -c SHA256SUMS",
    "Keine Kundendaten, keine Testausgaben, keine Zertifikate.",
    "",
  ].join("\n");
  const all = new Map([...files, [REPORT, report]]);
  const sums = [...all].map(([n, c]) => `${sha256(Buffer.from(c))}  ${n}`).sort((a, b) => a.slice(66).localeCompare(b.slice(66))).join("\n") + "\n";
  all.set(SUMS, sums);

  // Still the tested state? Commits and cleanliness are compared again right before writing and
  // once more right before the package gets its final name.
  // ... and the bytes written must be what a fresh build of exactly that state produces.
  const unchanged = async () => {
    const again = await readiness(entry, { latest, git });
    if (!(again.ok && again.state.core === ready.state.core && again.state.profile === ready.state.profile)) return false;
    const fresh = (await buildProfile(entry.dir)).files;
    return fresh.size === files.size && [...fresh].every(([n, c]) => files.has(n) && Buffer.from(c).equals(Buffer.from(files.get(n))));
  };
  if (!(await unchanged())) return { error: "Der Stand hat sich während des Exports geändert. Nichts exportiert." };

  await mkdir(parent, { recursive: true });
  const realParent = await realpath(parent);
  // Publication: the final folder is created exclusively (mkdir fails if anything has the name,
  // an empty folder included) and carries an "incomplete" marker until the very end. All writes
  // happen relative to that folder itself (it becomes the working directory), so they always land
  // in the folder created here, even if someone moves or swaps its path meanwhile. Place and
  // identity are checked after every step; on any problem exactly the files and folders created
  // here are removed again, wherever the folder is now.
  const created = [];
  let id = null;
  const previousCwd = process.cwd();
  const same = async (p, want) => stat(p).then((st) => st.ino === want.ino && st.dev === want.dev, () => false);
  const here = async (inside = true) =>
    !(await placeError(parent, env)) &&
    (await realpath(parent).catch(() => null)) === realParent &&
    (await realpath(target).catch(() => null)) === path.join(realParent, name) &&
    (await same(target, id)) &&
    (!inside || (await same(".", id)));
  const ensure = async () => {
    if (!(await here())) throw new Error("Der Exportordner hat sich während des Exports verändert.");
  };
  try {
    await mkdir(target);
    id = await stat(target);
    process.chdir(target);
    await ensure();
    await writeFile(MARKER, "Export läuft oder wurde abgebrochen. Dieses Paket nicht verwenden.\n", { flag: "wx" });
    created.push(MARKER);
    for (const [n, c] of all) {
      const parts = n.split("/");
      for (let i = 1; i < parts.length; i++) {
        const sub = parts.slice(0, i).join("/");
        if (created.includes(sub + "/")) continue;
        await mkdir(sub);
        created.push(sub + "/");
      }
      await writeFile(n, c, { flag: "wx" });
      created.push(n);
      await ensure();
    }
    for (const [n, c] of all) if (sha256(await readFile(n)) !== sha256(Buffer.from(c))) throw new Error(`${n}: Prüfsumme stimmt nicht.`);
    if (!(await unchanged())) throw new Error("Der Stand hat sich während des Exports geändert.");
    for (const c of created) if (c !== MARKER && !c.endsWith("/")) await chmod(c, 0o444);
    await ensure();
    await unlink(MARKER);
    created.splice(created.indexOf(MARKER), 1);
    for (const c of [...created].reverse()) if (c.endsWith("/")) await chmod(c, 0o555);
    await chmod(".", 0o555);
    await ensure();
    const final = await verifyPackage(target);
    if (!final.valid) throw new Error(`Paket nicht gültig: ${final.reason}`);
  } catch (error) {
    if (id && (await same(".", id))) await removeCreatedHere(name, created);
    return { error: `Export fehlgeschlagen: ${error.message}` };
  } finally {
    process.chdir(previousCwd);
  }
  let zipFile = null;
  if (zip) {
    // Written under a temporary name, then hard-linked to the final name: link() fails if that
    // name exists, so no existing file is ever replaced or deleted. The link is removed again if
    // the folder moved meanwhile.
    const tmpZip = path.join(parent, `.${name}.${randomBytes(4).toString("hex")}.zip.tmp`);
    zipFile = `${target}.zip`;
    try {
      await run("ditto", ["-c", "-k", "--keepParent", target, tmpZip]);
      await chmod(tmpZip, 0o444);
      const zipId = await stat(tmpZip);
      await link(tmpZip, zipFile);
      if (!(await here(false))) {
        if (await same(zipFile, zipId)) await unlink(zipFile).catch(() => {});
        throw new Error("Der Exportordner hat sich verändert.");
      }
    } catch (error) {
      return {
        name,
        folder: target,
        version,
        warning: error.code === "EEXIST" ? `Paket fertig. ${path.basename(zipFile)} gab es schon, kein neues ZIP angelegt.` : `Paket fertig, ZIP nicht angelegt: ${error.message}`,
      };
    } finally {
      await unlink(tmpZip).catch(() => {});
    }
  }
  return { name, folder: target, version, zip: zipFile, files: all.size };
}

// Removes only what this export created (files first, then its own folders), relative to the
// export folder as working directory, so it works wherever that folder was moved. If anything
// foreign is left, the folder stays, marked as incomplete, and is never taken for a valid package.
async function removeCreatedHere(name, created) {
  await chmod(".", 0o755).catch(() => {});
  for (const c of created.filter((c) => c.endsWith("/"))) await chmod(c, 0o755).catch(() => {});
  for (const c of [...created].reverse()) await (c.endsWith("/") ? rmdir(c) : unlink(c)).catch(() => {});
  const leftover = await readdir(".").catch(() => ["?"]);
  if (leftover.length) {
    await writeFile(MARKER, "Export abgebrochen. Dieses Paket nicht verwenden.\n").catch(() => {});
    return;
  }
  process.chdir("..");
  await rmdir(name).catch(() => {});
}

