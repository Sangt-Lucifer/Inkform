// Writes the checked blanko build as a new commit to the local branch gh-pages, which GitHub Pages
// serves (Deploy from a branch: gh-pages, / (root)). main and the working tree stay untouched: the
// branch is written in a temporary git worktree. Never adds a remote, never pushes.
//
//   node scripts/pages-bauen.mjs                 (npm run pages)
//   node scripts/pages-bauen.mjs --ohne-studios  without studio profiles, only the neutral checks
//
// Order: committed core -> blanko build in memory -> blanko check and leak tests (stop on red) ->
// write exactly those bytes plus .nojekyll -> read back and compare checksums -> commit as Sven,
// message "Inkform blanko <version> (Kern <hash of main>)".
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BLANKO_FILES, assertCleanCore, checkBlanko, collectPrivate, studiosText } from "./blanko-pruefen.mjs";
import { buildProfile, resolveProfileDir, root } from "./build.mjs";

export const BRANCH = "gh-pages";
// Git without hooks, file system monitor or attributes from outside the repository.
const SAFE_GIT = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "core.attributesFile=/dev/null"];
const AUTHOR = ["-c", "user.name=Sven", "-c", "user.email=sven@inkform.invalid", "-c", "commit.gpgsign=false"];
// Build path -> path in gh-pages: the hosted app at the top level.
export const PAGES_FILES = new Map(BLANKO_FILES.filter((n) => n.startsWith("dist/")).map((n) => [n, n.slice("dist/".length)]));
const PAGES_DIRS = ["icons", "licenses", "sprachen"];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// The leak tests of the core over its working tree and its whole history, all branches included.
export function runLeakCheck({ env = process.env, withoutStudios = false } = {}) {
  const run = spawnSync(process.execPath, ["--test", "tests/core-leaks.test.mjs"], {
    cwd: root,
    env: { ...env, ...(withoutStudios ? { INKFORM_NUR_NEUTRAL: "1" } : {}) },
    encoding: "utf8",
  });
  if (run.status !== 0) throw new Error(`Leak-Prüfung fehlgeschlagen; nichts geschrieben:\n${run.stdout}${run.stderr}`);
}

// The branch may hold only the app files written here before (including retired licenses or packs).
const RETIRED = /^(?:licenses\/[\w-]+\.txt|sprachen\/[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2})?\.json)$/;
async function checkWorktree(dir) {
  const allowed = new Set([".git", ".nojekyll", ...PAGES_FILES.values()]),
    problems = [],
    retired = [];
  async function walk(rel) {
    for (const entry of await readdir(path.join(dir, rel))) {
      const name = rel ? `${rel}/${entry}` : entry,
        info = await lstat(path.join(dir, name));
      if (info.isSymbolicLink()) problems.push(`${name}: Verknüpfung`);
      else if (info.isDirectory()) {
        if (PAGES_DIRS.includes(name)) await walk(name);
        else problems.push(`${name}/: fremder Ordner`);
      } else if (!allowed.has(name)) {
        if (RETIRED.test(name)) retired.push(name);
        else problems.push(`${name}: fremde Datei`);
      }
    }
  }
  await walk("");
  if (problems.length) throw new Error(`${BRANCH} enthält Fremdes; nichts geschrieben:\n- ${problems.join("\n- ")}`);
  return retired;
}

// What Git staged must be exactly the checked files: a clean filter or an ignore rule of the
// repository could otherwise change or drop them between the check and the commit.
function checkStaged(inPages, out) {
  const staged = inPages("ls-files", "-s", "-z").split("\0").filter(Boolean),
    problems = [];
  for (const line of staged) {
    const [meta, name] = line.split("\t"),
      [mode, sha] = meta.split(" ");
    if (!out.has(name)) problems.push(`${name}: nicht geprüft`);
    else if (mode !== "100644") problems.push(`${name}: Modus ${mode}`);
    else if (!Buffer.from(inPages("cat-file", "blob", sha, { buffer: true })).equals(out.get(name))) problems.push(`${name}: weicht von der geprüften Datei ab`);
  }
  for (const name of out.keys()) if (!staged.some((line) => line.split("\t")[1] === name)) problems.push(`${name}: fehlt`);
  if (problems.length) throw new Error(`Git würde andere Dateien committen als geprüft; nicht committet:\n- ${problems.join("\n- ")}`);
}

// repo, requireClean, env, home, places and leakCheck exist for the tests, which run on an
// uncommitted core.
export async function buildPages({ repo = root, requireClean = true, env = process.env, home, places, leakCheck = runLeakCheck, withoutStudios = false } = {}) {
  const git = (...args) => execFileSync("git", [...SAFE_GIT, "-C", repo, ...args], { encoding: "utf8" });
  if (requireClean) assertCleanCore();
  const core = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")),
    profile = JSON.parse(await readFile(path.join(resolveProfileDir("blanko"), "profile.json"), "utf8")),
    reference = (await buildProfile("blanko")).files,
    priv = await collectPrivate({ env, home, places, withoutStudios });
  if (!priv.studios.length && !withoutStudios)
    throw new Error("Keine Studio-Profile gefunden. Ohne sie ist die Prüfung unvollständig; bewusst ohne: --ohne-studios.");
  const problems = await checkBlanko(reference, profile, priv, { reference });
  if (problems.length) throw new Error(`Blanko-Prüfung fehlgeschlagen; nichts geschrieben:\n- ${problems.join("\n- ")}`);
  await leakCheck({ env, withoutStudios });

  const out = new Map([...PAGES_FILES].map(([from, to]) => [to, Buffer.from(reference.get(from))]));
  out.set(".nojekyll", Buffer.alloc(0));
  const head = git("rev-parse", "HEAD").trim(),
    status = git("status", "--porcelain", "--untracked-files=all"),
    fresh = !git("branch", "--list", BRANCH).trim(),
    temp = await mkdtemp(path.join(tmpdir(), "inkform-pages-")),
    dir = path.join(temp, BRANCH);
  let changed = false,
    commit;
  try {
    git("worktree", "add", "-q", ...(fresh ? ["--orphan", "-b", BRANCH, dir] : [dir, BRANCH]));
    const retired = await checkWorktree(dir);
    for (const name of retired) await rm(path.join(dir, name));
    for (const [name, bytes] of out) {
      await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
      await writeFile(path.join(dir, name), bytes);
    }
    for (const [name, bytes] of out)
      if (sha256(await readFile(path.join(dir, name))) !== sha256(bytes)) throw new Error(`${name}: nach dem Schreiben abweichend; nicht committet.`);
    const inPages = (...args) => {
      const options = typeof args.at(-1) === "object" ? args.pop() : {};
      return execFileSync("git", [...SAFE_GIT, "-C", dir, ...AUTHOR, ...args], { encoding: options.buffer ? "buffer" : "utf8", maxBuffer: 1 << 28 });
    };
    inPages("add", "-A", "--force");
    checkStaged(inPages, out);
    changed = inPages("status", "--porcelain").trim().length > 0;
    if (changed) inPages("commit", "-q", "-m", `Inkform blanko ${version} (Kern ${core})`);
    commit = fresh && !changed ? null : inPages("rev-parse", "--short", "HEAD").trim();
  } finally {
    try {
      git("worktree", "remove", "--force", dir);
    } catch {}
    git("worktree", "prune");
    await rm(temp, { recursive: true, force: true });
  }
  if (git("rev-parse", "HEAD").trim() !== head || git("status", "--porcelain", "--untracked-files=all") !== status)
    throw new Error("main oder das Arbeitsverzeichnis haben sich verändert; bitte prüfen.");
  return {
    fresh,
    changed,
    commit,
    core,
    remotes: git("remote").trim(),
    studios: priv.studios,
    sums: [...out].map(([name, bytes]) => `${sha256(bytes)}  ${name}`),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const withoutStudios = process.argv.includes("--ohne-studios");
  buildPages({ withoutStudios }).then(
    (r) => {
      console.log(`Blanko-Prüfung und Leak-Prüfung bestanden (geprüft gegen das Beispiel und ${studiosText(r.studios)}).`);
      console.log(
        r.changed ? `${r.fresh ? "Zweig gh-pages angelegt" : "gh-pages"}: Commit ${r.commit} (Kern ${r.core})` : `Keine Änderungen; gh-pages bleibt ${r.commit}.`,
      );
      console.log(r.sums.join("\n"));
      console.log(r.remotes ? `Remote vorhanden: ${r.remotes}. Gepusht wurde nichts.` : "Kein Remote, nichts gepusht.");
    },
    (error) => {
      console.error(error.message);
      process.exit(1);
    },
  );
}
