// Inkform Werkstatt: local overview to build and check the iPad app per studio.
//
//   npm run werkstatt                 http://127.0.0.1:8090
//   node werkstatt/server.mjs --port 8091
//
// Only on 127.0.0.1. Every request must carry the right Host header and, for the API, the session
// token embedded in the page: another website open in the browser can therefore neither read the
// overview nor start anything (DNS rebinding, cross-site requests). No customer data is read or
// stored here; run logs and state live in ~/Library/Application Support/Inkform/werkstatt/.
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkDraft, commitStudio, createStudio, editable, pendingChanges, readEditable, saveDraft } from "./profile.mjs";
import { execFile } from "node:child_process";
import { certStatus, createCert, renewCert } from "./certs.mjs";
import { exportStudio, listExports, readiness } from "./export.mjs";
import { ADDRESS, CHECKLIST, approveNeutralName, loadedByDevice, confirmInstalled, createOnsite, setChecklist, studioState, writeWebloc } from "./onsite.mjs";
import { qrMatrix } from "./qr.mjs";
import { createRunner } from "./runs.mjs";
import {
  beispielMarkers,
  buildState,
  certInfo,
  defaultCertDir,
  defaultStateDir,
  gitInfo,
  listStudios,
  warnings,
} from "./status.mjs";

const UI = fileURLToPath(new URL("./ui/", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const SECURITY = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

export async function startWerkstatt({
  port = 8090,
  env = process.env,
  stateDir = defaultStateDir(),
  certDir = defaultCertDir(),
  git,
  onsiteOptions = {},
  reveal = (file) => new Promise((resolve) => execFile("open", ["-R", file], () => resolve())),
} = {}) {
  // Folders from the environment are fixed as absolute paths once: nothing depends on the
  // working directory (the export temporarily works inside its package folder).
  env = { ...env };
  stateDir = path.resolve(stateDir);
  certDir = path.resolve(certDir);
  for (const k of ["INKFORM_STUDIOS", "INKFORM_EXPORTE"])
    if (env[k]) env[k] = env[k].split(path.delimiter).filter(Boolean).map((p) => path.resolve(p)).join(path.delimiter);
  const token = randomBytes(24).toString("hex");
  const runner = createRunner({ stateDir, env });
  const onsite = createOnsite({ stateDir, env, ...onsiteOptions });
  let statusCache = null;
  // Editing a profile, creating a studio and committing never overlap with each other or with a
  // run (a build reading half-saved files would test something that was never saved).
  let editing = false;
  const busy = () => editing || !!(runner.current() && !runner.current().endedAt);
  async function exclusive(res, work) {
    if (busy()) return send(res, 409, { error: "Gerade läuft schon etwas. Bitte warten, bis es fertig ist." });
    editing = true;
    try {
      return await work();
    } finally {
      editing = false;
      statusCache = null;
    }
  }
  async function editableEntry(res, key) {
    const entry = (await studios()).find((e) => e.key === key);
    const reason = await editable(entry, stateDir, env);
    if (reason) {
      send(res, entry ? 403 : 404, { error: reason });
      return null;
    }
    return entry;
  }

  async function studios() {
    return listStudios({ env, stateDir });
  }
  async function overview(refresh) {
    const entries = await studios();
    if (refresh || !statusCache) {
      const markers = await beispielMarkers();
      statusCache = {};
      for (const e of entries)
        statusCache[e.key] = {
          git: await gitInfo(e.dir),
          build: await buildState(e.dir),
          warnings: await warnings(e, markers),
          checkedAt: new Date().toISOString(),
        };
    }
    const latest = await runner.latest();
    const current = runner.current();
    const exportsById = {};
    for (const e of entries) exportsById[e.id] = (await listExports(e.id, env)).filter((x) => x.valid).at(-1) ?? null;
    return {
      studios: entries.map((e) => ({
        key: e.key,
        id: e.id,
        name: e.name,
        kind: e.kind,
        folder: e.dir,
        actionable: e.actionable,
        protectedReason: e.protectedReason ?? null,
        ...(statusCache[e.key] ?? {}),
        lastExport: exportsById[e.id] ?? null,
        runs: Object.fromEntries(
          ["build", "test", "browser"].map((k) => [k, latest[`${e.key}:${k}`] ?? null]),
        ),
      })),
      cert: await certInfo(certDir),
      running: current && !current.endedAt ? { id: current.id, studio: current.studio, label: current.label } : null,
    };
  }

  const send = (res, status, body, type = "application/json; charset=utf-8") => {
    res.writeHead(status, { "Content-Type": type, ...SECURITY });
    res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
  };
  const tokenOk = (value) => {
    const a = Buffer.from(String(value ?? "")),
      b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  // Bytes are collected and decoded once at the end: a character split across two network
  // packets stays intact. The limit counts bytes.
  async function body(req, limit = 10_000) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw Object.assign(Error("Anfrage zu groß."), { status: 413 });
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw Object.assign(Error("Ungültige Anfrage."), { status: 400 });
    }
  }

  // ---------- on-site mode (only Beispiel and released studios) ----------
  async function onsiteEntry(res, key) {
    const entry = (await studios()).find((e) => e.key === key);
    if (!entry) send(res, 404, { error: "Studio nicht gefunden." });
    else if (!entry.actionable) send(res, 403, { error: entry.protectedReason });
    else return entry;
    return null;
  }
  async function onsiteRoute(req, res, url) {
    const p = url.pathname;
    if (req.method === "GET" && p === "/api/vor-ort/laufend") return send(res, 200, { session: onsite.current() });
    if (req.method === "GET" && p === "/api/vor-ort/qr") return send(res, 200, { address: ADDRESS, ...qrMatrix(ADDRESS) });
    if (req.method === "POST" && p === "/api/vor-ort/stop") return send(res, 200, { session: onsite.stop("per Knopf beendet") });
    if (req.method === "GET" && p === "/api/vor-ort") {
      const entry = await onsiteEntry(res, url.searchParams.get("key"));
      if (!entry) return;
      const exports = (await listExports(entry.id, env)).filter((e) => e.valid).reverse().map((e) => ({ name: e.name, version: e.version, date: e.date }));
      return send(res, 200, {
        address: ADDRESS,
        exports,
        cert: await certStatus(entry.id, env),
        state: await studioState(stateDir, entry.id),
        checklist: CHECKLIST,
        session: onsite.current(),
        beispiel: entry.kind === "beispiel",
      });
    }
    const input = req.method === "POST" ? await body(req) : {};
    const entry = await onsiteEntry(res, input.studio);
    if (!entry) return;
    if (p === "/api/vor-ort/pruefen") {
      const { ok, checks } = await onsite.checks(entry, input.export);
      return send(res, 200, { ok, checks });
    }
    if (p === "/api/vor-ort/start") {
      const result = await onsite.start(entry, input.export);
      if (!result.error) await writeWebloc(stateDir);
      return send(res, result.error ? 409 : 200, result);
    }
    if (p === "/api/vor-ort/zertifikat") {
      // The password is only passed on to openssl; it is never logged or stored.
      const result = input.action === "renew" ? await renewCert(entry.id, input.password, env) : await createCert(entry.id, input.password, env);
      return send(res, result.error ? 400 : 200, result.error ? { error: result.error } : { cert: result });
    }
    if (p === "/api/vor-ort/finder") {
      // Shows the root certificate or the .webloc in the Finder for AirDrop. Never the key.
      const file = input.what === "webloc" ? await writeWebloc(stateDir) : (await certStatus(entry.id, env)).rootFile;
      if (!file) return send(res, 400, { error: "Noch kein Zertifikat." });
      await reveal(file);
      return send(res, 200, { shown: path.basename(file) });
    }
    if (p === "/api/vor-ort/checkliste") {
      const result = await setChecklist(stateDir, entry.id, input.key, input.done === true);
      return send(res, result.error ? 400 : 200, result);
    }
    if (p === "/api/vor-ort/installiert") {
      const result = await confirmInstalled(stateDir, entry.id, input.version);
      return send(res, result.error ? 400 : 200, result);
    }
    if (p === "/api/vor-ort/freigeben") {
      // Only after a Beispiel session that the (test) iPad actually loaded.
      const s = onsite.current();
      if (entry.kind !== "beispiel" || !s || s.id !== entry.id || !loadedByDevice(s.requests))
        return send(res, 409, { error: "Erst mit dem Beispiel im Vor-Ort-Modus ein Test-iPad die App vollständig laden lassen (Startseite und Offline-Speicher)." });
      return send(res, 200, { neutralApproved: await approveNeutralName(stateDir) });
    }
    return send(res, 404, { error: "Unbekannt." });
  }

  const server = createServer(async (req, res) => {
    try {
      const host = `127.0.0.1:${server.address().port}`;
      if (req.headers.host !== host) return send(res, 403, { error: "Nur über http://" + host + " erreichbar." });
      const origin = req.headers.origin;
      if (origin && origin !== `http://${host}`) return send(res, 403, { error: "Fremde Herkunft." });
      const url = new URL(req.url, `http://${host}`);

      if (url.pathname.startsWith("/api/")) {
        if (!tokenOk(req.headers["x-werkstatt-token"])) return send(res, 403, { error: "Sitzung ungültig. Seite neu laden." });
        if (req.method === "GET" && url.pathname === "/api/overview")
          return send(res, 200, await overview(url.searchParams.get("refresh") === "1"));
        if (req.method === "POST" && url.pathname === "/api/run") {
          const { studio, kind } = await body(req);
          const entry = (await studios()).find((e) => e.key === studio);
          if (!entry) return send(res, 404, { error: "Studio nicht gefunden." });
          if (editing) return send(res, 409, { error: "Gerade wird ein Profil gespeichert. Bitte kurz warten." });
          const record = await runner.start(entry, kind);
          statusCache = null;
          return send(res, 202, { id: record.id });
        }
        if (req.method === "GET" && url.pathname === "/api/run") {
          const current = runner.current();
          if (!current || current.id !== url.searchParams.get("id")) return send(res, 404, { error: "Lauf nicht gefunden." });
          const from = Math.max(0, Number(url.searchParams.get("from")) || 0);
          return send(res, 200, {
            id: current.id,
            label: current.label,
            name: current.name,
            endedAt: current.endedAt,
            ok: current.ok,
            steps: current.steps,
            log: current.log.slice(from),
            offset: current.log.length,
          });
        }
        if (req.method === "GET" && url.pathname === "/api/studio") {
          const entry = await editableEntry(res, url.searchParams.get("key"));
          if (!entry) return;
          return send(res, 200, { key: entry.key, id: entry.id, folder: entry.dir, ...(await readEditable(entry.dir)) });
        }
        if (req.method === "POST" && (url.pathname === "/api/studio/check" || url.pathname === "/api/studio/save")) {
          const { studio, draft, logo, version } = await body(req, 4_000_000);
          const entry = await editableEntry(res, studio);
          if (!entry) return;
          const args = { dir: entry.dir, id: entry.id, draft, logoBase64: logo || null, env };
          if (url.pathname.endsWith("/check")) {
            const { errors, probe, warnings } = await checkDraft(args);
            return send(res, 200, { errors, probe, warnings });
          }
          return await exclusive(res, async () => {
            const result = await saveDraft({ ...args, expectedVersion: version, stateDir });
            return send(res, result.conflict ? 409 : result.errors.length ? 422 : 200, result);
          });
        }
        if (req.method === "POST" && url.pathname === "/api/studio/new") {
          const { id, name } = await body(req);
          return await exclusive(res, async () => {
            const result = await createStudio({ id, name, env, stateDir });
            return send(res, result.error ? 400 : 201, result.error ? { error: result.error } : { key: result.key, folder: result.dir });
          });
        }
        if (req.method === "GET" && url.pathname === "/api/studio/changes") {
          const entry = await editableEntry(res, url.searchParams.get("key"));
          if (!entry) return;
          const result = await pendingChanges(entry.dir);
          return send(res, result.error ? 400 : 200, result);
        }
        if (req.method === "POST" && url.pathname === "/api/studio/commit") {
          const { studio, message, files } = await body(req, 200_000);
          const entry = await editableEntry(res, studio);
          if (!entry) return;
          return await exclusive(res, async () => {
            const result = await commitStudio({ dir: entry.dir, message, files, env, stateDir });
            return send(res, result.conflict ? 409 : result.error ? 400 : 200, result);
          });
        }
        if (req.method === "GET" && url.pathname === "/api/export") {
          const entry = (await studios()).find((e) => e.key === url.searchParams.get("key"));
          if (!entry) return send(res, 404, { error: "Studio nicht gefunden." });
          if (!entry.actionable) return send(res, 403, { error: entry.protectedReason });
          const ready = await readiness(entry, { latest: await runner.latest(), ...(git ? { git } : {}) });
          return send(res, 200, ready);
        }
        if (req.method === "POST" && url.pathname === "/api/export") {
          const { studio, zip } = await body(req);
          const entry = (await studios()).find((e) => e.key === studio);
          if (!entry) return send(res, 404, { error: "Studio nicht gefunden." });
          if (!entry.actionable) return send(res, 403, { error: entry.protectedReason });
          return await exclusive(res, async () => {
            const result = await exportStudio(entry, { latest: await runner.latest(), env, zip: zip === true, ...(git ? { git } : {}) });
            return send(res, result.error ? 409 : 201, result);
          });
        }
        if (url.pathname.startsWith("/api/vor-ort")) return await onsiteRoute(req, res, url);
        return send(res, 404, { error: "Unbekannt." });
      }

      if (req.method !== "GET") return send(res, 405, { error: "Nicht erlaubt." });
      if (url.pathname === "/favicon.ico") {
        res.writeHead(204, SECURITY).end();
        return;
      }
      const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      if (!/^[a-z-]+\.(html|js|css)$/.test(file)) return send(res, 404, "Nicht gefunden.", "text/plain; charset=utf-8");
      let content = await readFile(path.join(UI, file), "utf8").catch(() => null);
      if (content === null) return send(res, 404, "Nicht gefunden.", "text/plain; charset=utf-8");
      if (file === "index.html") content = content.replace("__WERKSTATT_TOKEN__", token);
      return send(res, 200, content, TYPES[path.extname(file)]);
    } catch (error) {
      send(res, error.status ?? 500, { error: error.message });
    }
  });
  await new Promise((resolve, reject) => server.once("error", reject).listen(port, "127.0.0.1", resolve));
  server.on("close", () => onsite.cleanup());
  return { server, token, url: `http://127.0.0.1:${server.address().port}/`, runner, onsite };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--port");
  const { url } = await startWerkstatt({ port: i > 0 ? Number(process.argv[i + 1]) : 8090 });
  console.log(`Inkform Werkstatt: ${url}  (nur auf diesem Mac, beenden mit Ctrl+C)`);
  // Ctrl+C ends the Werkstatt and with it a running on-site server and its Bonjour announcement.
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(0));
}
