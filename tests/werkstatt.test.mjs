// Werkstatt (Phase 1): studio list, protection, summaries and access control. Uses a throw-away
// studio in a temporary folder and a temporary state folder; never ../Inkform-Studios.
import assert from "node:assert/strict";
import test from "node:test";
import { request } from "node:http";
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { root } from "../scripts/build.mjs";
import { summarizeBrowser, summarizeBuild, summarizeTests, testFileArgs } from "../werkstatt/runs.mjs";
import { listStudios } from "../werkstatt/status.mjs";
import { startWerkstatt } from "../werkstatt/server.mjs";

const base = await mkdtemp(path.join(tmpdir(), "inkform-werkstatt-"));
const studiosDir = path.join(base, "studios"),
  stateDir = path.join(base, "state"),
  studioDir = path.join(studiosDir, "testatelier");
await cp(path.join(root, "profiles", "beispiel"), studioDir, { recursive: true });
const profile = JSON.parse(await readFile(path.join(studioDir, "profile.json"), "utf8"));
await writeFile(path.join(studioDir, "profile.json"), JSON.stringify({ ...profile, id: "testatelier", name: "Testatelier" }, null, 2));
const env = { ...process.env, INKFORM_STUDIOS: studiosDir };
test.after(() => rm(base, { recursive: true, force: true }));

async function snapshot(dir) {
  const out = [];
  for (const name of (await readdir(dir, { recursive: true })).sort()) {
    const s = await stat(path.join(dir, name));
    out.push(`${name}:${s.size}:${s.mtimeMs}`);
  }
  return out.join("\n");
}
function http(port, { method = "GET", pathname = "/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path: pathname, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

test("studios are display-only unless released; Blanko is always available", async () => {
  const list = await listStudios({ env, stateDir });
  const blanko = list.find((s) => s.key === "blanko"),
    studio = list.find((s) => s.key === "s-testatelier");
  assert.equal(blanko.actionable, true);
  assert.equal(studio.actionable, false);
  assert.match(studio.protectedReason, /Nur Anzeige/);
  await writeFile(path.join(stateDir, "freigegeben.json"), JSON.stringify({ studios: [studioDir] }));
  assert.equal((await listStudios({ env, stateDir })).find((s) => s.key === "s-testatelier").actionable, true);
  await rm(path.join(stateDir, "freigegeben.json"));
});

test("summaries: build, tests (with leak findings) and browser checks", () => {
  assert.deepEqual(summarizeBuild("x\nbuild/a (a): self-contained index.html\n", 0).ok, true);
  assert.match(summarizeBuild("Platzhalter %%x%% in src/app.js fehlt im Profil.\n", 1).text, /fehlt im Profil/);
  const tests = summarizeTests(
    "✖ studio-a: build and profile folder contain nothing from studio-b (5ms)\n  +   'build/dist/index.html: Kennzeichen Studio B'\nℹ tests 3\nℹ pass 2\nℹ fail 1\n✖ failing tests:\n",
    1,
  );
  assert.equal(tests.ok, false);
  assert.match(tests.text, /2 von 3 Tests bestanden, 1 fehlgeschlagen/);
  assert.deepEqual(tests.failing, ["studio-a: build and profile folder contain nothing from studio-b"]);
  assert.deepEqual(tests.leaks, ["build/dist/index.html: Kennzeichen Studio B"]);
  assert.equal(summarizeTests("ℹ pass 94\nℹ fail 0\n", 0).ok, true);
  const browser = summarizeBrowser("FAIL abschluss\nAssertionError [ERR_ASSERTION]: Keine Fehler\n6/7 Browser-Prüfungen bestanden.", 1);
  assert.equal(browser.ok, false);
  assert.deepEqual(browser.failing, ["abschluss"]);
  assert.deepEqual(browser.reasons, ["Keine Fehler"]);
  assert.equal(summarizeBrowser("7/7 Browser-Prüfungen bestanden.", 0).ok, true);
});

test("server: only 127.0.0.1 with the right Host, API only with the session token", async () => {
  const { server, token } = await startWerkstatt({ port: 0, env, stateDir, certDir: path.join(base, "keine-zertifikate") });
  const port = server.address().port;
  try {
    assert.equal(server.address().address, "127.0.0.1");
    const page = await http(port);
    assert.equal(page.status, 200);
    assert.ok(page.text.includes(token), "token embedded in the page");
    assert.match(page.headers["content-security-policy"], /default-src 'none'/);
    // DNS rebinding: a foreign host name is refused.
    assert.equal((await http(port, { headers: { host: `evil.example:${port}` } })).status, 403);
    // API without or with a wrong token.
    assert.equal((await http(port, { pathname: "/api/overview" })).status, 403);
    assert.equal((await http(port, { pathname: "/api/overview", headers: { "x-werkstatt-token": "falsch" } })).status, 403);
    // Cross-site request with a valid token is still refused by its origin.
    assert.equal(
      (await http(port, { method: "POST", pathname: "/api/run", headers: { "x-werkstatt-token": token, origin: "https://evil.example" }, body: "{}" })).status,
      403,
    );
    const overview = JSON.parse((await http(port, { pathname: "/api/overview?refresh=1", headers: { "x-werkstatt-token": token } })).text);
    const studio = overview.studios.find((s) => s.key === "s-testatelier");
    assert.equal(studio.actionable, false);
    assert.equal(studio.build.state, "fehlt");
    assert.ok(studio.warnings.some((w) => w.includes("Musterstudio")), "sample texts left in a studio are reported");
    assert.equal(overview.studios.find((s) => s.key === "blanko").kind, "blanko");
    assert.equal(overview.cert, null);
    // Static files: only the UI, no path traversal.
    assert.equal((await http(port, { pathname: "/werkstatt.js" })).status, 200);
    assert.equal((await http(port, { pathname: "/../server.mjs" })).status, 404);
    assert.equal((await http(port, { pathname: "/%2e%2e/status.mjs" })).status, 404);
  } finally {
    server.close();
  }
});

test("a protected studio cannot be built or checked, and its folder stays unchanged", async () => {
  const { server, token } = await startWerkstatt({ port: 0, env, stateDir, certDir: base });
  const port = server.address().port;
  try {
    const before = await snapshot(studioDir);
    for (const kind of ["build", "test", "browser", "alles"]) {
      const res = await http(port, {
        method: "POST",
        pathname: "/api/run",
        headers: { "x-werkstatt-token": token, "content-type": "application/json" },
        body: JSON.stringify({ studio: "s-testatelier", kind }),
      });
      assert.equal(res.status, 403, kind);
      assert.match(JSON.parse(res.text).error, /Nur Anzeige/);
    }
    assert.equal(await snapshot(studioDir), before);
    assert.equal(
      (await http(port, { method: "POST", pathname: "/api/run", headers: { "x-werkstatt-token": token }, body: JSON.stringify({ studio: "blanko", kind: "rm -rf" }) })).status,
      400,
    );
  } finally {
    server.close();
  }
});

test("building Blanko through the Werkstatt works and is recorded outside the repositories", async () => {
  const { server, token, runner } = await startWerkstatt({ port: 0, env, stateDir, certDir: base });
  const port = server.address().port;
  try {
    const res = await http(port, {
      method: "POST",
      pathname: "/api/run",
      headers: { "x-werkstatt-token": token },
      body: JSON.stringify({ studio: "blanko", kind: "build" }),
    });
    assert.equal(res.status, 202);
    const second = await http(port, {
      method: "POST",
      pathname: "/api/run",
      headers: { "x-werkstatt-token": token },
      body: JSON.stringify({ studio: "blanko", kind: "build" }),
    });
    assert.equal(second.status, 409, "only one run at a time");
    for (let i = 0; i < 200 && !runner.current().endedAt; i++) await new Promise((r) => setTimeout(r, 50));
    const run = runner.current();
    assert.equal(run.ok, true, run.log);
    assert.equal(run.steps[0].kind, "build");
    for (let i = 0; i < 40 && !(await readdir(path.join(stateDir, "laeufe")).catch(() => [])).length; i++)
      await new Promise((r) => setTimeout(r, 50));
    const files = await readdir(path.join(stateDir, "laeufe"));
    assert.equal(files.length, 1);
    assert.ok(stateDir.startsWith(base), "state lives in the given folder, not in a repository");
  } finally {
    server.close();
  }
});

test("test files are passed relative to the core (folder names with [brackets] are glob syntax)", async () => {
  const args = await testFileArgs();
  assert.ok(args.length >= 10);
  assert.ok(args.every((a) => /^tests\/[\w.-]+\.test\.mjs$/.test(a)), args.join());
});

// ---------- Review Phase 1 ----------
import { execFileSync } from "node:child_process";
import { utimes } from "node:fs/promises";

test("two simultaneous start requests: exactly one run starts", async () => {
  const state = path.join(base, "state-race");
  const { server, token, runner } = await startWerkstatt({ port: 0, env, stateDir: state, certDir: base });
  const port = server.address().port;
  try {
    const post = () =>
      http(port, { method: "POST", pathname: "/api/run", headers: { "x-werkstatt-token": token }, body: JSON.stringify({ studio: "blanko", kind: "build" }) });
    const results = await Promise.all([post(), post(), post()]);
    assert.deepEqual(results.map((r) => r.status).sort(), [202, 409, 409]);
    for (let i = 0; i < 200 && !runner.current().endedAt; i++) await new Promise((r) => setTimeout(r, 50));
    for (let i = 0; i < 40 && !(await readdir(path.join(state, "laeufe")).catch(() => [])).length; i++)
      await new Promise((r) => setTimeout(r, 50));
    assert.equal((await readdir(path.join(state, "laeufe"))).length, 1, "only one run was recorded");
    assert.equal(runner.current().steps.length, 1);
    assert.equal(runner.current().ok, true);
  } finally {
    server.close();
  }
});

test("showing a protected studio with its own Git repo writes nothing, not even .git/index", async () => {
  const studios = path.join(base, "studios-git"),
    dir = path.join(studios, "gitatelier");
  await cp(path.join(root, "profiles", "beispiel"), dir, { recursive: true });
  const p = JSON.parse(await readFile(path.join(dir, "profile.json"), "utf8"));
  await writeFile(path.join(dir, "profile.json"), JSON.stringify({ ...p, id: "gitatelier", name: "Gitatelier" }));
  const g = (...args) => execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
  g("init", "-q");
  g("add", "-A");
  g("-c", "user.name=Test", "-c", "user.email=test@inkform.invalid", "commit", "-qm", "x");
  // Same content, new modification time: a normal "git status" would rewrite .git/index.
  const old = new Date("2026-01-01T00:00:00Z");
  await utimes(path.join(dir, "profile.json"), old, old);
  await new Promise((r) => setTimeout(r, 1100));
  const before = await snapshot(dir);
  const { server, token } = await startWerkstatt({ port: 0, env: { ...process.env, INKFORM_STUDIOS: studios }, stateDir: path.join(base, "state-git"), certDir: base });
  const port = server.address().port;
  try {
    const res = await http(port, { pathname: "/api/overview?refresh=1", headers: { "x-werkstatt-token": token } });
    const studio = JSON.parse(res.text).studios.find((s) => s.key === "s-gitatelier");
    assert.equal(studio.actionable, false);
    assert.equal(studio.git.repo, true);
    assert.equal(await snapshot(dir), before, "protected studio folder including .git unchanged");
  } finally {
    server.close();
  }
});

// ---------- Re-review: failures are never shown as green ----------
import { createRunner } from "../werkstatt/runs.mjs";
const finished = async (runner) => {
  for (let i = 0; i < 300 && !runner.current()?.endedAt; i++) await new Promise((r) => setTimeout(r, 50));
  return runner.current();
};
const blankoEntry = async () => (await listStudios({ env, stateDir })).find((s) => s.key === "blanko");

test("a run whose record cannot be saved is red, also in the overview", async () => {
  const runner = createRunner({
    stateDir: path.join(base, "state-full"),
    env,
    fs: {
      mkdir: async () => {},
      writeFile: async () => {
        throw Object.assign(Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
      },
      rename: async () => {},
    },
  });
  await runner.start(await blankoEntry(), "build");
  const run = await finished(runner);
  assert.equal(run.ok, false);
  assert.match(run.saveError, /ENOSPC/);
  assert.equal(run.steps.at(-1).ok, false);
  const latest = await runner.latest();
  assert.equal(latest["blanko:build"].ok, false, "overview must not show green");
  assert.match(latest["blanko:build"].text, /nicht gespeichert/);
});

test("a failure before the check starts replaces an older green result", async () => {
  const state = path.join(base, "state-prep");
  const runsDir = path.join(state, "laeufe");
  const { mkdir: mk } = await import("node:fs/promises");
  await mk(runsDir, { recursive: true });
  await writeFile(
    path.join(runsDir, "2026-01-01T00-00-00-000Z_blanko_test.json"),
    JSON.stringify({ studio: "blanko", endedAt: "2026-01-01T00:00:00.000Z", steps: [{ kind: "test", ok: true, text: "alt grün" }] }),
  );
  const runner = createRunner({
    stateDir: state,
    env,
    listTests: async () => {
      throw Object.assign(Error("EACCES: permission denied, scandir 'tests'"), { code: "EACCES" });
    },
  });
  assert.equal((await runner.latest())["blanko:test"].ok, true, "old green result exists");
  await runner.start(await blankoEntry(), "test");
  const run = await finished(runner);
  assert.equal(run.ok, false);
  assert.deepEqual(run.steps.map((s) => [s.kind, s.ok]), [["test", false]]);
  const latest = await runner.latest();
  assert.equal(latest["blanko:test"].ok, false);
  assert.match(latest["blanko:test"].text, /Vorbereitung fehlgeschlagen/);
});

test("a damaged run record is skipped and never blocks the overview", async () => {
  const state = path.join(base, "state-damaged");
  const { mkdir: mk } = await import("node:fs/promises");
  await mk(path.join(state, "laeufe"), { recursive: true });
  await writeFile(path.join(state, "laeufe", "2026-01-01_blanko_build.json"), '{"studio":"blanko","steps":[{"kind":"bu');
  await writeFile(path.join(state, "laeufe", "2026-01-02_blanko_build.json"), JSON.stringify({ studio: "blanko", endedAt: "x", steps: [{ kind: "build", ok: true, text: "ok" }] }));
  const runner = createRunner({ stateDir: state, env });
  const latest = await runner.latest();
  assert.equal(latest["blanko:build"].ok, true);
});

test("a damaged step inside a readable record is skipped too", async () => {
  const state = path.join(base, "state-null-step");
  const { mkdir: mk } = await import("node:fs/promises");
  await mk(path.join(state, "laeufe"), { recursive: true });
  await writeFile(
    path.join(state, "laeufe", "2026-01-01_blanko_build.json"),
    JSON.stringify({ studio: "blanko", endedAt: "x", steps: [null, 7, { kind: "toString" }, { kind: "build", ok: true, text: "ok" }] }),
  );
  const latest = await createRunner({ stateDir: state, env }).latest();
  assert.equal(latest["blanko:build"].ok, true);
  assert.equal(Object.keys(latest).length, 1);
});

test("a failed save leaves no temporary file behind", async () => {
  const state = path.join(base, "state-rename");
  const real = await import("node:fs/promises");
  const runner = createRunner({
    stateDir: state,
    env,
    fs: {
      mkdir: real.mkdir,
      writeFile: real.writeFile,
      rename: async () => {
        throw Object.assign(Error("EIO: i/o error, rename"), { code: "EIO" });
      },
      rm: real.rm,
    },
  });
  await runner.start(await blankoEntry(), "build");
  const run = await finished(runner);
  assert.equal(run.ok, false);
  assert.deepEqual(await real.readdir(path.join(state, "laeufe")), []);
});
