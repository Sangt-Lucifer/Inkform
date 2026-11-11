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
import { chmod, lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { buildProfile, discoverStudioProfiles, listBuiltinProfiles, root } from "../scripts/build.mjs";
import { findFingerprints, fingerprints, scanText } from "../tests/lib/leaks.mjs";
import { matchInWorker, realLocation } from "./profile.mjs";
import { buildState, gitInfo } from "./status.mjs";

const run = promisify(execFile);
const REPORT = "PRUEFBERICHT.txt";
const SUMS = "SHA256SUMS";
const NAME = /^inkform-([a-z0-9-]+)-(\d+\.\d+\.\d+-p\d+)-(\d{4}-\d{2}-\d{2})$/;

export function exportsRoot(env = process.env) {
  return env.INKFORM_EXPORTE ? path.resolve(env.INKFORM_EXPORTE) : path.resolve(root, "..", "Inkform-Exporte");
}
const coreVersion = async () => JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version;
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const today = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

// Reads the existing packages of one studio (name and the commits named in their report).
export async function listExports(id, env = process.env) {
  const dir = path.join(exportsRoot(env), id);
  const out = [];
  for (const name of await readdir(dir).catch(() => [])) {
    const m = name.match(NAME);
    if (!m || m[1] !== id) continue;
    const report = await readFile(path.join(dir, name, REPORT), "utf8").catch(() => "");
    const field = (key) => report.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? null;
    out.push({ name, version: m[2], date: m[3], core: field("Kern-Commit"), profile: field("Studio-Commit"), folder: path.join(dir, name) });
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
  return { hits, profiles: others.map((o) => o.id) };
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

async function makeReadOnly(dir, top = true) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await makeReadOnly(full, false);
    else await chmod(full, 0o444);
  }
  // The top folder stays writable until it is renamed (macOS needs that for a folder rename).
  if (!top) await chmod(dir, 0o555);
}

export async function exportStudio(entry, { latest, env = process.env, git = gitInfo, zip = false, now = new Date() } = {}) {
  if (!entry?.actionable) return { error: entry?.protectedReason ?? "Dieses Studio wird nicht exportiert." };
  const ready = await readiness(entry, { latest, git });
  if (!ready.ok) return { error: "Export noch nicht möglich.", reasons: ready.reasons };

  const parent = path.join(exportsRoot(env), entry.id);
  const place = await placeError(parent, env);
  if (place) return { error: place };
  const { version, already } = nextVersion(await coreVersion(), await listExports(entry.id, env), ready.state);
  if (already) return { error: `Dieser Stand ist bereits exportiert: ${already}. Exporte werden nicht überschrieben.` };
  const name = `inkform-${entry.id}-${version}-${today(now)}`;
  const target = path.join(parent, name);
  if (await lstat(target).then(() => true, () => false)) return { error: `${name} gibt es schon. Exporte werden nicht überschrieben.` };

  // The package is built from the file list of buildProfile, never by copying a folder; the build
  // on disk was just confirmed to be identical.
  const { files } = await buildProfile(entry.dir);
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
    `Studio-Commit: ${ready.state.profile ?? "– (Blanko liegt im Kern)"}`,
    `Tests: ${lastRun("test").text} (${lastRun("test").at})`,
    `Browser-Prüfungen: ${lastRun("browser").text} (${lastRun("browser").at})`,
    `Build: aktuell (identisch mit build.mjs)`,
    `Leak-Prüfung: keine Funde; geprüft gegen ${scan.profiles.length ? scan.profiles.join(", ") : "keine anderen Profile"}`,
    "",
    "Inhalt: index.html (Einzeldatei) und dist/ (für die Installation auf dem iPad).",
    "Prüfen: shasum -a 256 -c SHA256SUMS",
    "Keine Kundendaten, keine Testausgaben, keine Zertifikate.",
    "",
  ].join("\n");
  const all = new Map([...files, [REPORT, report]]);
  const sums = [...all].map(([n, c]) => `${sha256(Buffer.from(c))}  ${n}`).sort((a, b) => a.slice(66).localeCompare(b.slice(66))).join("\n") + "\n";
  all.set(SUMS, sums);

  await mkdir(parent, { recursive: true });
  const work = path.join(parent, `.${name}.${randomBytes(4).toString("hex")}.tmp`);
  let createdTarget = false;
  try {
    for (const [n, c] of all) {
      await mkdir(path.dirname(path.join(work, n)), { recursive: true });
      await writeFile(path.join(work, n), c, { flag: "wx" });
    }
    const check = await run_("shasum", ["-a", "256", "-c", SUMS], { cwd: work });
    if (!/: OK/.test(check)) throw new Error("Prüfsummen stimmen nicht.");
    await makeReadOnly(work);
    // Exclusive: the final folder is created first (fails if it exists), then replaced by the
    // complete package in one rename.
    await mkdir(target);
    createdTarget = true;
    await rename(work, target);
    await chmod(target, 0o555);
  } catch (error) {
    if (createdTarget) await rmEmpty(target).catch(() => {});
    await chmodTree(work).catch(() => {});
    await rm(work, { recursive: true, force: true }).catch(() => {});
    return { error: `Export fehlgeschlagen: ${error.message}` };
  }
  let zipFile = null;
  if (zip) {
    zipFile = `${target}.zip`;
    try {
      await run("ditto", ["-c", "-k", "--keepParent", target, zipFile]);
      await chmod(zipFile, 0o444);
    } catch (error) {
      await rm(zipFile, { force: true }).catch(() => {});
      return { name, folder: target, version, warning: `Paket fertig, ZIP fehlgeschlagen: ${error.message}` };
    }
  }
  return { name, folder: target, version, zip: zipFile, files: all.size };
}

// Removes the final folder only if it is still the empty one created here.
async function rmEmpty(dir) {
  if ((await readdir(dir).catch(() => ["x"])).length === 0) await rm(dir, { recursive: true, force: true });
}
const run_ = async (cmd, args, opts) => (await run(cmd, args, { encoding: "utf8", ...opts })).stdout;
async function chmodTree(dir) {
  await chmod(dir, 0o755);
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await chmodTree(full);
    else await chmod(full, 0o644);
  }
}
