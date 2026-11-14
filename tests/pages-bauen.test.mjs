// gh-pages from the checked blanko build (scripts/pages-bauen.mjs), in a throwaway repository with a
// throwaway studio and home folder. main and its working tree stay untouched; never a remote.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildProfile, root } from "../scripts/build.mjs";
import { BRANCH, PAGES_FILES, buildPages } from "../scripts/pages-bauen.mjs";

const base = await mkdtemp(path.join(tmpdir(), "inkform-pages-test-"));
test.after(() => rm(base, { recursive: true, force: true }));
const studios = path.join(base, "studios"),
  home = path.join(base, "home"),
  repo = path.join(base, "repo");
await cp(path.join(root, "profiles", "beispiel"), path.join(studios, "nordlicht"), { recursive: true });
const profile = JSON.parse(await readFile(path.join(studios, "nordlicht", "profile.json"), "utf8"));
await writeFile(path.join(studios, "nordlicht", "profile.json"), JSON.stringify({ ...profile, id: "nordlicht", markers: ["Testatelier Nordlicht"] }));
await mkdir(home);
const git = (...args) => execFileSync("git", ["-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args], { encoding: "utf8" }).trim();
await mkdir(repo);
git("init", "-q", "-b", "main");
await writeFile(path.join(repo, "quelle.txt"), "Quellcode\n");
git("add", "-A");
git("commit", "-q", "-m", "Quelle");
await writeFile(path.join(repo, "offen.txt"), "nicht committet\n");
let leakChecks = 0;
const options = { repo, requireClean: false, env: { INKFORM_STUDIOS: studios }, home, leakCheck: () => leakChecks++ };
const mainState = () => [git("rev-parse", "HEAD"), git("branch", "--show-current"), git("status", "--porcelain", "--untracked-files=all")];

test("first run: branch gh-pages without history, exactly the checked app files and .nojekyll, main untouched", async () => {
  const before = mainState();
  const result = await buildPages(options);
  assert.equal(leakChecks, 1, "leak check ran");
  assert.equal(result.fresh, true);
  assert.equal(result.changed, true);
  assert.equal(result.remotes, "");
  assert.deepEqual(mainState(), before);
  assert.deepEqual(git("ls-tree", "-r", "--name-only", BRANCH).split("\n").sort(), [".nojekyll", ...PAGES_FILES.values()].sort());
  const { files: built } = await buildProfile("blanko");
  for (const [from, to] of PAGES_FILES)
    assert.ok(Buffer.from(built.get(from)).equals(execFileSync("git", ["-C", repo, "show", `${BRANCH}:${to}`], { maxBuffer: 1 << 28 })), to);
  assert.equal(git("rev-list", "--count", BRANCH), "1");
  assert.throws(() => git("merge-base", "main", BRANCH), "no common history with main");
  assert.equal(git("log", "-1", "--format=%an <%ae>", BRANCH), "Sven <sven@inkform.invalid>");
  const core = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  assert.match(git("log", "-1", "--format=%s", BRANCH), new RegExp(`^Inkform blanko \\d+\\.\\d+\\.\\d+ \\(Kern ${core}\\)$`));
  assert.equal(git("worktree", "list").split("\n").length, 1, "temporary worktree removed");
});

test("a second run of the same state adds no commit", async () => {
  const before = git("rev-parse", BRANCH);
  const result = await buildPages(options);
  assert.equal(result.changed, false);
  assert.equal(git("rev-parse", BRANCH), before);
});

test("a foreign file in gh-pages stops everything before anything is written", async () => {
  const dir = path.join(base, "fremd");
  git("worktree", "add", "-q", dir, BRANCH);
  await writeFile(path.join(dir, "kunden.json"), "[]");
  execFileSync("git", ["-C", dir, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "add", "-A"]);
  execFileSync("git", ["-C", dir, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-q", "-m", "fremd"]);
  git("worktree", "remove", dir);
  const before = git("rev-parse", BRANCH);
  await assert.rejects(buildPages(options), /enthält Fremdes; nichts geschrieben:\n- kunden\.json: fremde Datei/);
  assert.equal(git("rev-parse", BRANCH), before);
  assert.equal(git("worktree", "list").split("\n").length, 1);
});

test("a red leak check or a failed blanko check writes nothing", async () => {
  const fresh = path.join(base, "leer");
  await mkdir(fresh);
  execFileSync("git", ["-C", fresh, "init", "-q", "-b", "main"]);
  execFileSync("git", ["-C", fresh, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-q", "--allow-empty", "-m", "x"]);
  await assert.rejects(
    buildPages({ ...options, repo: fresh, leakCheck: () => { throw new Error("Leak-Prüfung fehlgeschlagen"); } }),
    /Leak-Prüfung fehlgeschlagen/,
  );
  await assert.rejects(buildPages({ ...options, repo: fresh, env: { INKFORM_STUDIOS: path.join(base, "keine") } }), /Studio-Ordner nicht lesbar/);
  await mkdir(path.join(base, "keine"));
  await assert.rejects(buildPages({ ...options, repo: fresh, env: { INKFORM_STUDIOS: path.join(base, "keine") } }), /Keine Studio-Profile gefunden/);
  assert.equal(execFileSync("git", ["-C", fresh, "branch", "--list", BRANCH], { encoding: "utf8" }).trim(), "");
});

async function freshRepo(name) {
  const dir = path.join(base, name);
  await mkdir(dir);
  execFileSync("git", ["-C", dir, "init", "-q", "-b", "main"]);
  execFileSync("git", ["-C", dir, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-q", "--allow-empty", "-m", "x"]);
  return dir;
}
const branchOf = (dir) => execFileSync("git", ["-C", dir, "branch", "--list", BRANCH], { encoding: "utf8" }).trim();

test("a clean filter of the repository that changes a file stops the commit", async () => {
  const dir = await freshRepo("filter");
  await writeFile(path.join(dir, ".git", "info", "attributes"), "index.html filter=probe\n");
  execFileSync("git", ["-C", dir, "config", "filter.probe.clean", "sed s/INKFORM/GEHEIM/g"]);
  await assert.rejects(buildPages({ ...options, repo: dir }), /andere Dateien committen als geprüft; nicht committet:\n- index\.html: weicht von der geprüften Datei ab/);
  assert.equal(branchOf(dir), "", "no commit, the new branch has nothing");
  assert.equal(execFileSync("git", ["-C", dir, "worktree", "list"], { encoding: "utf8" }).trim().split("\n").length, 1);
});

test("an ignore rule of the repository drops no file", async () => {
  const dir = await freshRepo("ignoriert");
  await writeFile(path.join(dir, ".git", "info", "exclude"), "sw.js\nicons/\n");
  await buildPages({ ...options, repo: dir });
  const files = execFileSync("git", ["-C", dir, "ls-tree", "-r", "--name-only", BRANCH], { encoding: "utf8" }).trim().split("\n");
  assert.ok(files.includes("sw.js") && files.includes("icons/icon-192.png"));
});

test("--ohne-studios: no studio folder at all, only the neutral leak check", async () => {
  const dir = await freshRepo("neutral"),
    seen = [];
  const result = await buildPages({
    ...options,
    repo: dir,
    env: {},
    places: { file: path.join(base, "keine-datei"), fallback: path.join(base, "kein-ordner") },
    withoutStudios: true,
    leakCheck: (o) => seen.push(o.withoutStudios),
  });
  assert.deepEqual(result.studios, []);
  assert.deepEqual(seen, [true]);
  assert.notEqual(branchOf(dir), "");
  await assert.rejects(
    buildPages({ ...options, repo: dir, env: {}, places: { file: path.join(base, "keine-datei"), fallback: path.join(base, "kein-ordner") } }),
    /Studio-Ordner nicht lesbar/,
    "without the switch a missing folder stops",
  );
  await assert.rejects(
    buildPages({ ...options, repo: dir, env: { INKFORM_STUDIOS: path.join(base, "kein-ordner") }, withoutStudios: true }),
    /Studio-Ordner nicht lesbar/,
    "a folder named on purpose must be readable, also with the switch",
  );
});

test("the local server delivers gh-pages under a sub path like GitHub Pages", async () => {
  const site = path.join(base, "site", "inkform");
  await mkdir(path.dirname(site), { recursive: true });
  git("worktree", "add", "-q", "--detach", site, BRANCH);
  const port = 18990 + Math.floor(Math.random() * 9),
    server = spawn(process.execPath, [path.join(root, "scripts", "serve.mjs"), "--dir", path.dirname(site), "--port", String(port)], { stdio: "ignore" });
  try {
    const get = async (p) => {
      for (let i = 0; i < 50; i++) {
        try {
          return (await fetch(`http://127.0.0.1:${port}${p}`)).status;
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
    };
    assert.equal(await get("/inkform/"), 200);
    assert.equal(await get("/inkform/sw.js"), 200);
    assert.equal(await get("/inkform/.nojekyll"), 404, "hidden entries are never served");
  } finally {
    server.kill();
    git("worktree", "remove", "--force", site);
  }
});
