// Copies the checked blanko build into the separate local build repository and commits it there.
// The repository holds only the hosted app (the contents of dist/) and its README. This script
// never adds a remote and never pushes: creating the private repository on GitHub and every push
// are done by hand, only after approval.
//
//   node scripts/blanko-uebergeben.mjs                  into ../Inkform-GitHub (created if missing)
//   node scripts/blanko-uebergeben.mjs --ziel <ordner>  into another folder
//
// Order: committed core -> build in memory -> check (origin, search, README) -> write exactly those
// bytes -> read them back and compare checksums -> local commit as Sven.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SAFE_GIT } from "../werkstatt/status.mjs";
import { BLANKO_FILES, assertCleanCore, checkBlanko, collectPrivate, studiosText } from "./blanko-pruefen.mjs";
import { buildProfile, resolveProfileDir, root } from "./build.mjs";

const AUTHOR = ["-c", "user.name=Sven", "-c", "user.email=sven@inkform.invalid", "-c", "commit.gpgsign=false"];
// Build path -> path in the repository: the hosted app at the top level.
export const REPO_FILES = new Map(BLANKO_FILES.filter((n) => n.startsWith("dist/")).map((n) => [n, n.slice("dist/".length)]));
const REPO_DIRS = ["icons", "licenses"];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inside = (dir, parent) => {
  const rel = path.relative(parent, dir);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

// The target may hold only its Git folder, the README and the app files written here before.
async function checkTarget(target) {
  const allowed = new Set([".git", ".DS_Store", "README.md", ...REPO_FILES.values()]),
    problems = [];
  async function walk(rel) {
    for (const entry of await readdir(path.join(target, rel))) {
      const name = rel ? `${rel}/${entry}` : entry,
        info = await lstat(path.join(target, name));
      if (info.isSymbolicLink()) problems.push(`${name}: Verknüpfung`);
      else if (info.isDirectory() && name !== ".git") {
        if (REPO_DIRS.includes(name)) await walk(name);
        else problems.push(`${name}/: fremder Ordner`);
      } else if (!allowed.has(name)) problems.push(`${name}: fremde Datei`);
    }
  }
  await walk("");
  if (problems.length) throw new Error(`${target} enthält Fremdes; nichts geschrieben:\n- ${problems.join("\n- ")}`);
  const top = execFileSync("git", [...SAFE_GIT, "-C", target, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  if ((await realpath(top)) !== (await realpath(target))) throw new Error(`${target} ist kein eigenes Git-Repo.`);
}

// requireClean, env and home exist for the tests, which run on an uncommitted core.
export async function handOver(target, { requireClean = true, env, home } = {}) {
  target = path.resolve(target);
  for (const forbidden of [root, path.resolve(root, "..", "Inkform-Studios"), path.resolve(root, "..", "Inkform-Archiv")])
    if (inside(target, forbidden) || inside(forbidden, target)) throw new Error(`Ziel ${target} liegt im oder über einem geschützten Ordner.`);
  if (requireClean) assertCleanCore();
  const profile = JSON.parse(await readFile(path.join(resolveProfileDir("blanko"), "profile.json"), "utf8")),
    readme = await readFile(path.join(resolveProfileDir("blanko"), "README.md")),
    reference = (await buildProfile("blanko")).files,
    priv = await collectPrivate({ env, home });
  if (!priv.studios.length) throw new Error("Keine Studio-Profile gefunden; ohne sie ist die Prüfung unvollständig.");
  const problems = await checkBlanko(new Map([...reference, ["README.md", readme]]), profile, priv, { reference, extra: ["README.md"] });
  if (problems.length) throw new Error(`Blanko-Prüfung fehlgeschlagen; nichts geschrieben:\n- ${problems.join("\n- ")}`);

  const out = new Map([...REPO_FILES].map(([from, to]) => [to, Buffer.from(reference.get(from))]));
  out.set("README.md", readme);
  const fresh = !(await lstat(target).catch(() => null)) || (await readdir(target)).length === 0;
  if (fresh) {
    await mkdir(target, { recursive: true });
    execFileSync("git", [...SAFE_GIT, "-C", target, "init", "-q", "-b", "main"]);
  }
  await checkTarget(target);
  for (const [name, bytes] of out) {
    await mkdir(path.dirname(path.join(target, name)), { recursive: true });
    await writeFile(path.join(target, name), bytes);
  }
  for (const [name, bytes] of out)
    if (sha256(await readFile(path.join(target, name))) !== sha256(bytes)) throw new Error(`${name}: nach dem Kopieren abweichend; nicht committet.`);

  const git = (...args) => execFileSync("git", [...SAFE_GIT, "-C", target, ...AUTHOR, ...args], { encoding: "utf8" });
  git("add", "-A");
  const core = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const changed = git("status", "--porcelain").trim().length > 0;
  if (changed) git("commit", "-q", "-m", `Inkform blanko ${version} (Kern ${core})`);
  return {
    target,
    fresh,
    changed,
    commit: git("rev-parse", "--short", "HEAD").trim(),
    remotes: git("remote").trim(),
    studios: priv.studios,
    sums: [...out].map(([name, bytes]) => `${sha256(bytes)}  ${name}`),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const target = argv.includes("--ziel") ? argv[argv.indexOf("--ziel") + 1] : path.resolve(root, "..", "Inkform-GitHub");
  handOver(target).then(
    (r) => {
      console.log(`Blanko-Prüfung bestanden (geprüft gegen das Beispiel und ${studiosText(r.studios)}).`);
      console.log(`${r.fresh ? "Neues lokales Repo" : "Repo"}: ${r.target}`);
      console.log(r.changed ? `Lokal committet: ${r.commit}` : `Keine Änderungen; Stand bleibt ${r.commit}.`);
      console.log(r.sums.join("\n"));
      console.log(r.remotes ? `Remote vorhanden: ${r.remotes}. Gepusht wurde nichts.` : "Kein Remote, nichts gepusht.");
    },
    (error) => {
      console.error(error.message);
      process.exit(1);
    },
  );
}
