// Werkstatt (Phase 4): on-site mode. Everything runs in temporary folders and on 127.0.0.1 with
// throw-away certificates; no real network name is announced (dns-sd is replaced by a placeholder
// process) and nothing is written to ~/Library/Application Support/Inkform.
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { request } from "node:http";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { root } from "../scripts/build.mjs";
import { NEUTRAL_HOST, certStatus, createCert, renewCert, studioCertDir } from "../werkstatt/certs.mjs";
import { exportStudio } from "../werkstatt/export.mjs";
import { compareVersions, confirmInstalled, createOnsite, setChecklist, studioState } from "../werkstatt/onsite.mjs";
import { qrMatrix } from "../werkstatt/qr.mjs";
import { listStudios } from "../werkstatt/status.mjs";
import { startWerkstatt } from "../werkstatt/server.mjs";

const base = await mkdtemp(path.join(tmpdir(), "inkform-vorort-"));
const env = {
  ...process.env,
  INKFORM_STUDIOS: path.join(base, "studios"),
  INKFORM_EXPORTE: path.join(base, "exporte"),
  INKFORM_ZERTIFIKATE: path.join(base, "zertifikate"),
};
const stateDir = path.join(base, "state");
await mkdir(env.INKFORM_STUDIOS, { recursive: true });
test.after(async () => {
  execFileSync("chmod", ["-R", "u+w", base]);
  await rm(base, { recursive: true, force: true });
});
const PASSWORD = "testpasswort-nur-fuer-tests";

// ---------- QR code ----------
function png(modules, scale = 8, quiet = 4) {
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
  const n = (modules.length + 2 * quiet) * scale;
  const rows = [];
  for (let y = 0; y < n; y++) {
    const row = Buffer.alloc(1 + n, 255);
    row[0] = 0;
    for (let x = 0; x < n; x++) {
      const r = Math.floor(y / scale) - quiet,
        c = Math.floor(x / scale) - quiet;
      if (r >= 0 && c >= 0 && r < modules.length && c < modules.length && modules[r][c]) row[1 + x] = 0;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0);
  ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}
// macOS's own QR reader (CoreImage) as an independent check of the encoder.
function decode(file) {
  const script = `ObjC.import('CoreImage'); var img=$.CIImage.imageWithContentsOfURL($.NSURL.fileURLWithPath(${JSON.stringify(file)})); var d=$.CIDetector.detectorOfTypeContextOptions($.CIDetectorTypeQRCode, $(), $({CIDetectorAccuracy: $.CIDetectorAccuracyHigh})); var f=d.featuresInImage(img); f.count>0 ? ObjC.unwrap(f.objectAtIndex(0).messageString) : ''`;
  return execFileSync("osascript", ["-l", "JavaScript", "-e", script], { encoding: "utf8" }).trim();
}
const matrixHash = (m) => createHash("sha256").update(m.map((r) => r.map(Number).join("")).join("\n")).digest("hex");

test("QR code: fixed reference matrices", () => {
  const address = qrMatrix(`https://${NEUTRAL_HOST}:8443/`);
  assert.equal(address.version, 3);
  assert.equal(matrixHash(address.modules), "37b1f127f5137823c41d661d76433c61515373e27ea14471e7e4426365e35ca5");
  assert.equal(matrixHash(qrMatrix("HELLO").modules), "c346c75add5698735afe3f7eb4f3e6c57ccefd9563f45f65c6d76aa518fb6f91");
  assert.throws(() => qrMatrix("x".repeat(200)), /zu lang/);
});

test("QR code: macOS reads back exactly what was encoded (versions 1 to 5, UTF-8, two blocks)", async () => {
  const cases = [`https://${NEUTRAL_HOST}:8443/`, "A", "Größe ÄÖÜ ß", "x".repeat(60), "https://example.invalid/" + "y".repeat(55)];
  for (const [i, text] of cases.entries()) {
    const file = path.join(base, `qr-${i}.png`);
    await writeFile(file, png(qrMatrix(text).modules));
    assert.equal(decode(file), text);
  }
});

test("versions compare part by part", () => {
  assert.ok(compareVersions("1.2.0-p10", "1.2.0-p9") > 0);
  assert.ok(compareVersions("1.10.0-p1", "1.9.0-p5") > 0);
  assert.equal(compareVersions("1.2.0-p3", "1.2.0-p3"), 0);
  assert.ok(compareVersions("1.2.0-p1", "1.3.0-p1") < 0);
});

// ---------- certificates ----------
test("certificate per studio: only for inkform-app.local, root key encrypted, renew needs the password", async () => {
  assert.match((await createCert("blanko-test", "kurz", env)).error, /12 Zeichen/);
  const created = await createCert("beispiel", PASSWORD, env);
  assert.ok(created.exists, created.error);
  const dir = studioCertDir("beispiel", env);
  assert.equal((await stat(dir)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(dir, "ca.key"))).mode & 0o777, 0o600);
  assert.match(await readFile(path.join(dir, "ca.key"), "utf8"), /BEGIN ENCRYPTED PRIVATE KEY/);
  assert.throws(() => execFileSync("openssl", ["pkey", "-in", path.join(dir, "ca.key"), "-passin", "pass:falsch", "-noout"], { stdio: "ignore" }));
  const text = execFileSync("openssl", ["x509", "-in", path.join(dir, "beispiel.crt"), "-noout", "-text"], { encoding: "utf8" });
  assert.match(text, /Name Constraints: critical[\s\S]*DNS:inkform-app\.local/);
  assert.ok(created.server.daysLeft >= 820 && created.server.daysLeft <= 825);
  assert.match((await createCert("beispiel", PASSWORD, env)).error, /nicht ersetzt/);
  const before = await readFile(path.join(dir, "server.crt"));
  assert.equal((await renewCert("beispiel", "falsches-passwort-123", env)).error, "Passwort falsch.");
  assert.deepEqual(await readFile(path.join(dir, "server.crt")), before, "nothing replaced on a wrong password");
  assert.deepEqual((await readdir(dir)).filter((n) => n.endsWith(".neu")), []);
  const renewed = await renewCert("beispiel", PASSWORD, env);
  assert.ok(renewed.server, renewed.error);
  assert.notDeepEqual(await readFile(path.join(dir, "server.crt")), before);
  execFileSync("openssl", ["verify", "-CAfile", path.join(dir, "beispiel.crt"), path.join(dir, "server.crt")]);
});

// ---------- serve.mjs ----------
function serve(args, extraEnv = {}) {
  const child = spawn(process.execPath, [path.join(root, "scripts", "serve.mjs"), ...args], { env: { ...process.env, ...extraEnv } });
  const lines = [];
  const first = new Promise((resolve, reject) => {
    child.stdout.on("data", (c) => {
      lines.push(...String(c).split("\n").filter(Boolean));
      resolve();
    });
    child.on("exit", (code) => reject(new Error(`serve.mjs beendet (${code})`)));
  });
  return { child, lines, first };
}
const port = () => 20000 + Math.floor(Math.random() * 20000);
function getHttps(p, pathname, ca, host = "127.0.0.1") {
  return new Promise((resolve, reject) =>
    httpsRequest({ host, port: p, path: pathname, ca, servername: NEUTRAL_HOST, headers: { host: `${NEUTRAL_HOST}:${p}` } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    })
      .on("error", reject)
      .end(),
  );
}

test("serve.mjs without the new options behaves as before (default folder, all interfaces)", async () => {
  // A fake home with the existing installation's certificate layout (copied test certificate).
  const home = path.join(base, "home");
  const legacy = path.join(home, "Library", "Application Support", "Inkform", "zertifikat");
  await mkdir(legacy, { recursive: true });
  const dir = studioCertDir("beispiel", env);
  for (const f of ["server.key", "server.crt"]) await cp(path.join(dir, f), path.join(legacy, f));
  await writeFile(path.join(legacy, "host.txt"), "altes-geraet.local\n");
  const p = port();
  const s = serve(["--lan", "--port", String(p)], { HOME: home });
  try {
    await s.first;
    assert.match(s.lines[0], new RegExp(`^Für das iPad: https://altes-geraet\\.local:${p}/`));
    const listening = execFileSync("lsof", ["-nP", `-iTCP:${p}`, "-sTCP:LISTEN"], { encoding: "utf8" });
    assert.match(listening, /\*:\d+ \(LISTEN\)/, "bound to all interfaces as before");
    const res = await getHttps(p, "/", await readFile(path.join(dir, "beispiel.crt")));
    assert.equal(res.status, 200);
    assert.ok(!s.lines.some((l) => l.startsWith("ANFRAGE")), "no request log without --log-requests");
  } finally {
    s.child.kill();
  }
});

test("serve.mjs with --cert-dir, --bind and --log-requests: only that address, log without client address", async () => {
  const dir = studioCertDir("beispiel", env);
  const p = port();
  const s = serve(["--lan", "--port", String(p), "--cert-dir", dir, "--bind", "127.0.0.1", "--log-requests"]);
  try {
    await s.first;
    assert.match(s.lines[0], new RegExp(`https://${NEUTRAL_HOST}:${p}/`));
    const listening = execFileSync("lsof", ["-nP", `-iTCP:${p}`, "-sTCP:LISTEN"], { encoding: "utf8" });
    assert.match(listening, /127\.0\.0\.1:\d+ \(LISTEN\)/);
    assert.doesNotMatch(listening, /\*:\d+/);
    assert.equal((await getHttps(p, "/sw.js", await readFile(path.join(dir, "beispiel.crt")))).status, 200);
    await new Promise((r) => setTimeout(r, 100));
    const log = s.lines.filter((l) => l.startsWith("ANFRAGE"));
    assert.equal(log.length, 1);
    assert.match(log[0], /^ANFRAGE \S+ GET \/sw\.js$/);
    assert.doesNotMatch(log[0], /127\.0\.0\.1/);
  } finally {
    s.child.kill();
  }
});

// ---------- state ----------
test("checklist stores only dates; an installed version can never go backwards", async () => {
  await setChecklist(stateDir, "beispiel", "safari", true, new Date("2026-11-12T10:00:00Z"));
  assert.equal((await setChecklist(stateDir, "beispiel", "kundendaten", true)).error, "Unbekannter Punkt.");
  assert.ok(await confirmInstalled(stateDir, "beispiel", "1.2.0-p2", new Date("2026-11-12T10:00:00Z")));
  assert.match((await confirmInstalled(stateDir, "beispiel", "1.2.0-p1")).error, /Rückschritt/);
  const saved = JSON.parse(await readFile(path.join(stateDir, "vor-ort.json"), "utf8"));
  assert.deepEqual(saved, { studios: { beispiel: { installed: { version: "1.2.0-p2", date: "2026-11-12" }, checklist: { safari: "2026-11-12" } } } });
  await rm(path.join(stateDir, "vor-ort.json"));
});

// ---------- on-site server ----------
const fakeGit = async (dir) =>
  path.resolve(dir) === path.resolve(root) ? { repo: true, commit: "c0ffee1", clean: true, changes: 0, remotes: [] } : { repo: false };
async function blankoExport() {
  const blanko = (await listStudios({ env, stateDir })).find((s) => s.key === "blanko");
  const r = { ok: true, text: "ok", at: new Date().toISOString(), core: { commit: "c0ffee1", clean: true }, profile: null };
  const result = await exportStudio(blanko, { latest: { "blanko:test": r, "blanko:browser": r }, env, git: fakeGit });
  assert.ok(result.folder, JSON.stringify(result));
  return { blanko, name: result.name };
}
// dns-sd is replaced by a harmless placeholder: no name is announced in any real network.
const announced = [];
const spawnFn = (cmd, args, opts) => {
  if (cmd === "dns-sd") {
    announced.push(args);
    return spawn("/bin/sleep", ["60"], { stdio: "ignore" });
  }
  return spawn(cmd, args, opts);
};
const onsiteFor = (extra = {}) =>
  createOnsite({
    stateDir,
    env,
    spawnFn,
    lookup: () => Promise.reject(Object.assign(new Error("not found"), { code: "ENOTFOUND" })),
    wifi: async () => ({ device: "lo0", ip: "127.0.0.1" }),
    vault: async () => true,
    lookupMs: 200,
    port: port(),
    ...extra,
  });

test("on-site: checks name every missing precondition", async () => {
  const { blanko, name } = await blankoExport();
  const onsite = onsiteFor({
    lookup: async () => ({ address: "192.168.0.99" }),
    vault: async () => false,
    wifi: async () => ({ error: "Nicht mit einem WLAN verbunden." }),
  });
  const { ok, checks } = await onsite.checks(blanko, name);
  assert.equal(ok, false);
  const byKey = Object.fromEntries(checks.map((c) => [c.key, c]));
  assert.equal(byKey.frei.ok, false);
  assert.match(byKey.frei.text, /antwortet im Netz schon/);
  assert.equal(byKey.filevault.ok, false);
  assert.equal(byKey.wlan.ok, false);
  assert.equal(byKey.export.ok, true);
  assert.ok(!byKey.name, "Blanko is the test: no approval needed");
  assert.equal((await onsite.checks(blanko, "inkform-beispiel-0.0.0-p1-2000-01-01")).checks.find((c) => c.key === "export").ok, false);
  await confirmInstalled(stateDir, "beispiel", "99.0.0-p1");
  assert.equal((await onsite.checks(blanko, name)).checks.find((c) => c.key === "version").ok, false, "no downgrade");
  await rm(path.join(stateDir, "vor-ort.json"));
});

test("on-site: serves the export over HTTPS on the given address only, logs paths, ends when idle", async () => {
  const { blanko, name } = await blankoExport().catch(async () => {
    const e = (await (await import("../werkstatt/export.mjs")).listExports("beispiel", env)).at(-1);
    return { blanko: (await listStudios({ env, stateDir })).find((s) => s.key === "blanko"), name: e.name };
  });
  const p = port();
  const onsite = onsiteFor({ port: p, idleMs: 1500 });
  const started = await onsite.start(blanko, name);
  assert.ok(started.session, JSON.stringify(started));
  assert.deepEqual(announced.at(-1), ["-P", "Inkform beispiel", "_https._tcp", "local", String(p), NEUTRAL_HOST, "127.0.0.1"]);
  const ca = await readFile(path.join(studioCertDir("beispiel", env), "beispiel.crt"));
  const res = await getHttps(p, "/", ca);
  assert.equal(res.status, 200);
  assert.match(res.body, /<html/i);
  await new Promise((r) => setTimeout(r, 200));
  const s = onsite.current();
  assert.deepEqual(s.requests.map((r) => r.path), ["/"]);
  for (const r of s.requests) assert.deepEqual(Object.keys(r).sort(), ["at", "path"], "time and path only, no client address");
  assert.match((await onsite.start(blanko, name)).error, /läuft schon/);
  await new Promise((r) => setTimeout(r, 2000));
  const ended = onsite.current();
  assert.ok(ended.endedAt);
  assert.equal(ended.reason, "30 Minuten ohne Anfrage");
  await assert.rejects(getHttps(p, "/", ca));
});

test("server: on-site routes refuse protected studios; approval needs a Blanko session the iPad loaded", async () => {
  const protectedDir = path.join(env.INKFORM_STUDIOS, "bestand");
  await cp(path.join(root, "profiles", "beispiel"), protectedDir, { recursive: true });
  const p = JSON.parse(await readFile(path.join(protectedDir, "profile.json"), "utf8"));
  await writeFile(path.join(protectedDir, "profile.json"), JSON.stringify({ ...p, id: "bestand", name: "Bestand" }));
  const shown = [];
  const { server, token } = await startWerkstatt({
    port: 0,
    env,
    stateDir,
    certDir: path.join(base, "keine"),
    git: fakeGit,
    reveal: async (file) => shown.push(file),
    onsiteOptions: { spawnFn, wifi: async () => ({ device: "lo0", ip: "127.0.0.1" }), vault: async () => true, lookup: () => Promise.reject(new Error("x")), lookupMs: 100, port: port() },
  });
  const call = (method, pathname, body) =>
    new Promise((resolve, reject) => {
      const q = request(
        { host: "127.0.0.1", port: server.address().port, method, path: pathname, headers: { host: `127.0.0.1:${server.address().port}`, "x-werkstatt-token": token, "content-type": "application/json" } },
        (res) => {
          let t = "";
          res.on("data", (c) => (t += c));
          res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(t || "{}") }));
        },
      );
      q.on("error", reject);
      if (body) q.write(JSON.stringify(body));
      q.end();
    });
  try {
    assert.equal((await call("GET", "/api/vor-ort?key=s-bestand")).status, 403);
    for (const route of ["start", "zertifikat", "finder", "checkliste", "installiert", "freigeben", "pruefen"])
      assert.equal((await call("POST", `/api/vor-ort/${route}`, { studio: "s-bestand", password: PASSWORD, action: "create" })).status, 403, route);
    assert.equal(await stat(studioCertDir("bestand", env)).then(() => true, () => false), false, "no certificate for the protected studio");
    const info = await call("GET", "/api/vor-ort?key=blanko");
    assert.equal(info.status, 200);
    assert.ok(info.json.exports.length >= 1);
    assert.equal((await call("POST", "/api/vor-ort/freigeben", { studio: "blanko" })).status, 409);
    assert.equal((await call("POST", "/api/vor-ort/finder", { studio: "blanko", what: "zertifikat" })).status, 200);
    assert.ok(shown.at(-1).endsWith("beispiel.crt"), "the certificate, never the key");
    assert.equal((await call("POST", "/api/vor-ort/finder", { studio: "blanko", what: "webloc" })).status, 200);
    assert.match(await readFile(shown.at(-1), "utf8"), /<string>https:\/\/inkform-app\.local:8443\/<\/string>/);
    const qr = await call("GET", "/api/vor-ort/qr");
    assert.equal(qr.json.address, "https://inkform-app.local:8443/");
  } finally {
    server.close();
    await rm(protectedDir, { recursive: true, force: true });
  }
});

test("no repository contains certificate or key files", () => {
  const repos = [root];
  const studios = path.resolve(root, "..", "Inkform-Studios");
  let names = [];
  try {
    names = execFileSync("ls", [studios], { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {}
  // Studio repositories are only read (git ls-files with optional locks off).
  for (const dir of names) repos.push(path.join(studios, dir));
  for (const repo of repos) {
    let files = "";
    try {
      files = execFileSync("git", ["--no-optional-locks", "-C", repo, "ls-files"], { encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
    } catch {
      continue;
    }
    assert.deepEqual(files.split("\n").filter((f) => /\.(key|crt|pem|p12|pfx|csr)$/i.test(f)), [], repo);
  }
});
