// Which studios exist, what state they are in, and which may be changed.
// Everything here only reads. The Werkstatt contains no studio data; studios are found next to
// the core (../Inkform-Studios or INKFORM_STUDIOS), exactly like the tests find them.
import { execFile } from "node:child_process";
import { mkdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  buildProfile,
  defaultOut,
  discoverStudioProfiles,
  listBuiltinProfiles,
  root,
} from "../scripts/build.mjs";
import { compileMarkers, findMarkers } from "../tests/lib/leaks.mjs";

const run = promisify(execFile);
export const defaultStateDir = () =>
  process.env.INKFORM_WERKSTATT_DIR ||
  path.join(homedir(), "Library", "Application Support", "Inkform", "werkstatt");
export const defaultCertDir = () =>
  path.join(homedir(), "Library", "Application Support", "Inkform", "zertifikat");

// The one rule for studio IDs in the Werkstatt (folder name, certificate folder, export names):
// 3 to 40 characters, a–z, 0–9 and hyphen, no hyphen at the start or end.
export const STUDIO_ID = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
export const inside = (p, q) => p === q || p.startsWith(q + path.sep);

// Real location of a path that may not exist yet: the nearest existing folder with links resolved,
// plus the missing rest.
export async function realLocation(p) {
  const rest = [];
  for (let cur = path.resolve(p); ; cur = path.dirname(cur)) {
    const real = await realpath(cur).catch(() => null);
    if (real) return path.join(real, ...rest.reverse());
    if (path.dirname(cur) === cur) return path.resolve(p);
    rest.push(path.basename(cur));
  }
}

// Git variables of the calling shell (GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE …) could point git at
// another repository; they are dropped for every call made here.
export const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
// No hooks, no fsmonitor program and no global attributes file. Filter programs that a repository
// itself sets up through .gitattributes cannot be switched off this way: the Werkstatt therefore
// refuses to commit in a repository that uses filters (see profile.mjs).
export const SAFE_GIT = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "core.attributesFile=/dev/null"];

// Studios are display-only unless their folder is listed in <state>/freigegeben.json
// ({"studios": ["/abs/path"]}). Existing installations therefore stay untouched by default;
// only the built-in sample ("Blanko") is always available for building and checking.
export async function releasedStudios(stateDir) {
  const data = await readJson(path.join(stateDir, "freigegeben.json")).catch(() => ({ studios: [] }));
  return new Set((Array.isArray(data.studios) ? data.studios : []).map((p) => path.resolve(String(p))));
}

export async function listStudios({ env = process.env, stateDir = defaultStateDir() } = {}) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const released = await releasedStudios(stateDir);
  const entries = [];
  for (const dir of await listBuiltinProfiles()) {
    const profile = await readJson(path.join(dir, "profile.json")).catch(() => null);
    if (!profile) continue;
    entries.push({ key: "blanko", id: profile.id, name: profile.name, dir, kind: "blanko", actionable: true });
  }
  for (const dir of await discoverStudioProfiles(env)) {
    const profile = await readJson(path.join(dir, "profile.json")).catch(() => null);
    if (!profile || !/^[a-z0-9-]+$/.test(profile.id ?? "")) continue;
    const validId = STUDIO_ID.test(profile.id);
    const actionable = released.has(path.resolve(dir)) && validId;
    entries.push({
      key: `s-${profile.id}`,
      id: profile.id,
      name: profile.name,
      dir,
      kind: "studio",
      actionable,
      protectedReason: actionable
        ? null
        : !validId
          ? `Nur Anzeige: Die Kennung „${profile.id}“ passt nicht zur Regel der Werkstatt (3 bis 40 Zeichen, a–z, 0–9, Bindestrich nicht am Rand).`
          : "Nur Anzeige: Dieses Studio ist in der Werkstatt nicht freigegeben. Profil, Repo und Build werden nicht angefasst.",
    });
  }
  return entries;
}

// Read-only Git: without optional locks "git status" never rewrites .git/index (it would otherwise
// refresh cached file stats), so looking at a protected studio writes nothing into its folder.
async function git(dir, args) {
  try {
    return (
      await run("git", [...SAFE_GIT, "--no-optional-locks", "-C", dir, ...args], {
        encoding: "utf8",
        env: { ...cleanEnv(), GIT_OPTIONAL_LOCKS: "0" },
      })
    ).stdout.trim();
  } catch {
    return null;
  }
}

export async function gitInfo(dir) {
  const top = await git(dir, ["rev-parse", "--show-toplevel"]);
  if (!top) return { repo: false };
  const [head, porcelain, remotes] = await Promise.all([
    git(dir, ["log", "-1", "--format=%h%x09%cI%x09%s"]),
    git(dir, ["status", "--porcelain"]),
    git(dir, ["remote"]),
  ]);
  const [commit, date, subject] = (head ?? "").split("\t");
  return {
    repo: true,
    top,
    commit: commit || null,
    date: date || null,
    subject: subject || null,
    clean: porcelain === "",
    changes: porcelain ? porcelain.split("\n").length : 0,
    remotes: remotes ? remotes.split("\n").filter(Boolean) : [],
  };
}

// Compares the current sources with the existing build without writing anything.
export async function buildState(dir) {
  const out = defaultOut(dir);
  let builtAt = null;
  try {
    builtAt = (await stat(path.join(out, "index.html"))).mtime.toISOString();
  } catch {
    return { state: "fehlt", builtAt: null, out };
  }
  try {
    const { files } = await buildProfile(dir);
    for (const [name, expected] of files) {
      const actual = await readFile(path.join(out, name)).catch(() => null);
      if (!actual || !actual.equals(Buffer.from(expected))) return { state: "veraltet", builtAt, out };
    }
    return { state: "aktuell", builtAt, out };
  } catch (error) {
    return { state: "fehler", builtAt, out, error: error.message };
  }
}

// Read-only warnings: sample-studio texts left in a real studio, guide PDF older than its text.
export async function warnings(entry, blankoMarkers) {
  const list = [];
  const profile = await readJson(path.join(entry.dir, "profile.json")).catch(() => ({}));
  if (entry.kind === "studio") {
    const guide = await readFile(path.join(entry.dir, "Dokumente", "Anleitung.md"), "utf8").catch(() => "");
    const hits = findMarkers(JSON.stringify(profile.text ?? {}) + "\n" + guide, blankoMarkers);
    if (hits.length) list.push(`Enthält noch Texte des Musterstudios (${hits.join(", ")}).`);
  }
  const [md, pdf] = await Promise.all(
    ["Dokumente/Anleitung.md", "Anleitung-iPad-und-Admin.pdf"].map((f) =>
      stat(path.join(entry.dir, f)).then((s) => s.mtimeMs, () => null),
    ),
  );
  if (md && pdf && md > pdf) list.push("Die Anleitung als PDF ist älter als Anleitung.md.");
  return list;
}

export async function certInfo(certDir = defaultCertDir()) {
  const host = await readFile(path.join(certDir, "host.txt"), "utf8").then((t) => t.trim(), () => null);
  if (!host) return null;
  try {
    const { stdout } = await run("openssl", ["x509", "-in", path.join(certDir, "server.crt"), "-noout", "-enddate"], {
      encoding: "utf8",
    });
    const until = new Date(stdout.trim().replace("notAfter=", ""));
    return { host, until: until.toISOString(), daysLeft: Math.floor((until - Date.now()) / 86_400_000) };
  } catch {
    return { host, until: null, daysLeft: null };
  }
}

export async function blankoMarkers() {
  const profile = await readJson(path.join(root, "profiles", "beispiel", "profile.json")).catch(() => ({ markers: [] }));
  return compileMarkers(profile.markers);
}
