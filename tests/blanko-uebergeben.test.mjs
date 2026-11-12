// Hand-over of the checked blanko build into a separate local repository (scripts/blanko-uebergeben.mjs),
// with a throwaway studio, certificate folder and target. Never a remote, never a push.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildProfile, root } from "../scripts/build.mjs";
import { REPO_FILES, handOver } from "../scripts/blanko-uebergeben.mjs";

const base = await mkdtemp(path.join(tmpdir(), "inkform-uebergabe-"));
test.after(() => rm(base, { recursive: true, force: true }));
const studios = path.join(base, "studios"),
  home = path.join(base, "home"),
  target = path.join(base, "Inkform-GitHub");
await cp(path.join(root, "profiles", "beispiel"), path.join(studios, "nordlicht"), { recursive: true });
const profile = JSON.parse(await readFile(path.join(studios, "nordlicht", "profile.json"), "utf8"));
await writeFile(path.join(studios, "nordlicht", "profile.json"), JSON.stringify({ ...profile, id: "nordlicht", markers: ["Testatelier Nordlicht"] }));
await mkdir(home);
const options = { requireClean: false, env: { INKFORM_STUDIOS: studios }, home };
const git = (...args) => execFileSync("git", ["-C", target, ...args], { encoding: "utf8" }).trim();

test("first hand-over: new local repository with exactly the checked app files and the README", async () => {
  const result = await handOver(target, options);
  assert.equal(result.fresh, true);
  assert.equal(result.changed, true);
  assert.equal(result.remotes, "");
  const files = git("ls-files").split("\n").sort();
  assert.deepEqual(files, [...REPO_FILES.values(), "README.md"].sort());
  const { files: built } = await buildProfile("blanko");
  for (const [from, to] of REPO_FILES) assert.ok(Buffer.from(built.get(from)).equals(await readFile(path.join(target, to))), to);
  assert.equal(await readFile(path.join(target, "README.md"), "utf8"), await readFile(path.join(root, "profiles", "blanko", "README.md"), "utf8"));
  assert.equal(git("log", "-1", "--format=%an <%ae>"), "Sven <sven@inkform.invalid>");
  assert.match(git("log", "-1", "--format=%s"), /^Inkform blanko \d+\.\d+\.\d+ \(Kern [0-9a-f]+\)$/);
  assert.equal(git("remote"), "");
  assert.equal(git("branch", "--show-current"), "main");
});

test("a second hand-over of the same state changes nothing", async () => {
  const before = git("rev-parse", "HEAD");
  const result = await handOver(target, options);
  assert.equal(result.changed, false);
  assert.equal(git("rev-parse", "HEAD"), before);
});

test("foreign content in the target stops before anything is written", async () => {
  await writeFile(path.join(target, "kunden.json"), "[]");
  await writeFile(path.join(target, "sw.js"), "geändert");
  await assert.rejects(handOver(target, options), /enthält Fremdes; nichts geschrieben:\n- kunden\.json: fremde Datei/);
  assert.equal(await readFile(path.join(target, "sw.js"), "utf8"), "geändert");
  await rm(path.join(target, "kunden.json"));
  await mkdir(path.join(target, "daten"));
  await assert.rejects(handOver(target, options), /daten\/: fremder Ordner/);
  await rm(path.join(target, "daten"), { recursive: true });
  const result = await handOver(target, options);
  assert.equal(result.changed, false, "the changed file is written back to the checked bytes");
});

test("never into or above the core, the studios or the archive", async () => {
  for (const dir of [path.join(root, "build", "x"), path.resolve(root, "..", "Inkform-Studios", "x"), path.resolve(root, "..")])
    await assert.rejects(handOver(dir, options), /geschützten Ordner/, dir);
});

test("a target folder that is not empty and not a repository is refused", async () => {
  const other = path.join(base, "anders");
  await mkdir(other);
  await writeFile(path.join(other, "README.md"), "x");
  await assert.rejects(handOver(other, options));
  assert.deepEqual(await readdir(other), ["README.md"]);
});

test("the local server delivers the repository but never its hidden entries", async () => {
  const port = 18990 + Math.floor(Math.random() * 9),
    server = spawn(process.execPath, [path.join(root, "scripts", "serve.mjs"), "--dir", target, "--port", String(port)], { stdio: "ignore" });
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
    assert.equal(await get("/"), 200);
    assert.equal(await get("/sw.js"), 200);
    assert.equal(await get("/.git/HEAD"), 404);
    assert.equal(await get("/icons/../.git/config"), 404);
    assert.equal(await get("/%2egit/HEAD"), 404);
  } finally {
    server.kill();
  }
});
