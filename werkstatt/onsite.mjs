// On-site mode. Serves one exported, tested package to the studio's iPad over
// the studio Wi-Fi, under the neutral address https://inkform-app.local:8443/, and only while it
// runs. Uses the existing scripts/serve.mjs (HTTPS, only GET/HEAD, static files) bound to the
// Wi-Fi address alone, and macOS's dns-sd to announce the name. Nothing is received from the iPad;
// the request log keeps time and path only, never an address. State kept per studio: installed
// version and date, checklist dates. No customer data.
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { root } from "../scripts/build.mjs";
import { certStatus, NEUTRAL_HOST, studioCertDir } from "./certs.mjs";
import { listExports } from "./export.mjs";

const run = promisify(execFile);
const PORT = 8443;
export const ADDRESS = `https://${NEUTRAL_HOST}:${PORT}/`;
const IDLE_MS = 30 * 60 * 1000;
export const CHECKLIST = [
  ["zertifikat", "Zertifikat installiert und unter Einstellungen → Allgemein → Info → Zertifikatsvertrauen aktiviert"],
  ["safari", "Adresse in Safari geöffnet"],
  ["homescreen", "Zum Home-Bildschirm hinzugefügt"],
  ["pin", "PIN festgelegt (bei Updates: vorher Einnahmen und Einstellungen gesichert)"],
  ["offline", "„Offline bereit“ abgewartet"],
  ["flugmodus", "Flugmodus-Test bestanden"],
  ["sicherheit", "Sicherheits-Checkliste der App abgearbeitet"],
];

// "1.2.0-p3" -> [1, 2, 0, 3]; compared part by part.
export function compareVersions(a, b) {
  const parts = (v) => String(v).split(/[.-]p?/).map(Number);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

// The Wi-Fi interface and its current address (the interface of the default route, if it is Wi-Fi).
async function wifiAddress() {
  try {
    const ports = (await run("networksetup", ["-listallhardwareports"], { encoding: "utf8" })).stdout;
    const device = ports.match(/Hardware Port: Wi-Fi\s*\nDevice: (\S+)/)?.[1];
    if (!device) return { error: "Kein WLAN-Adapter gefunden." };
    const ip = (await run("ipconfig", ["getifaddr", device], { encoding: "utf8" }).catch(() => ({ stdout: "" }))).stdout.trim();
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return { device, error: "Nicht mit einem WLAN verbunden." };
    return { device, ip };
  } catch (error) {
    return { error: `WLAN nicht ermittelbar: ${error.message}` };
  }
}

async function fileVault() {
  const out = (await run("fdesetup", ["status"], { encoding: "utf8" }).catch(() => ({ stdout: "" }))).stdout;
  return /FileVault is On/.test(out);
}

// Does anything in the network already answer to the name? (mDNS lookup, at most ~6 s)
async function nameTaken(lookup = dnsLookup, ms = 6000) {
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), ms).unref());
  const found = await Promise.race([lookup(NEUTRAL_HOST, { family: 4 }).then((r) => r.address, () => null), timeout]);
  return found;
}

// ---------- state (installed version, checklist) ----------
async function readState(stateDir) {
  try {
    const data = JSON.parse(await readFile(path.join(stateDir, "vor-ort.json"), "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}
async function writeState(stateDir, data) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const file = path.join(stateDir, "vor-ort.json");
  const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  await rename(tmp, file);
}
// All changes to the state file run one after another: no click can overwrite another one.
let stateQueue = Promise.resolve();
function locked(work) {
  const result = stateQueue.then(work, work);
  stateQueue = result.catch(() => {});
  return result;
}
export async function studioState(stateDir, id) {
  const data = await readState(stateDir);
  return { installed: data.studios?.[id]?.installed ?? null, checklist: data.studios?.[id]?.checklist ?? {}, neutralApproved: data.neutralApproved ?? null };
}
// change() may return { error } to refuse; it always sees the latest saved state.
function updateStudio(stateDir, id, change) {
  return locked(async () => {
    const data = await readState(stateDir);
    data.studios ??= {};
    const next = change({ installed: null, checklist: {}, ...(data.studios[id] ?? {}) });
    if (next.error) return next;
    data.studios[id] = next;
    await writeState(stateDir, data);
    return null;
  });
}
export async function setChecklist(stateDir, id, key, done, now = new Date()) {
  if (!CHECKLIST.some(([k]) => k === key)) return { error: "Unbekannter Punkt." };
  await updateStudio(stateDir, id, (s) => {
    const checklist = { ...s.checklist };
    if (done) checklist[key] = now.toISOString().slice(0, 10);
    else delete checklist[key];
    return { ...s, checklist };
  });
  return studioState(stateDir, id);
}
export async function confirmInstalled(stateDir, id, version, now = new Date()) {
  if (!/^\d+\.\d+\.\d+-p\d+$/.test(String(version))) return { error: "Ungültige Version." };
  const refused = await updateStudio(stateDir, id, (s) =>
    s.installed && compareVersions(version, s.installed.version) < 0
      ? { error: "Das wäre ein Rückschritt; nicht bestätigt." }
      : { ...s, installed: { version, date: now.toISOString().slice(0, 10) } },
  );
  return refused ?? studioState(stateDir, id);
}
// After a successful first test with a test iPad (Blanko), the neutral name may be used for studios.
export function approveNeutralName(stateDir, now = new Date()) {
  return locked(async () => {
    const data = await readState(stateDir);
    data.neutralApproved = now.toISOString().slice(0, 10);
    await writeState(stateDir, data);
    return data.neutralApproved;
  });
}
// A test iPad really loaded the app: index and service worker delivered successfully via GET.
export function loadedByDevice(requests) {
  const ok = (p) => requests.some((r) => r.method === "GET" && r.status === 200 && p.includes(r.path));
  return ok(["/", "/index.html"]) && ok(["/sw.js"]);
}

// .webloc for AirDrop: opens the address directly in Safari.
export async function writeWebloc(stateDir) {
  const dir = path.join(stateDir, "vor-ort");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "Inkform-App.webloc");
  // Written to a new temporary file and renamed: an existing link is replaced, never written through.
  const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(
    tmp,
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n\t<key>URL</key>\n\t<string>${ADDRESS}</string>\n</dict>\n</plist>\n`,
    { flag: "wx" },
  );
  await rename(tmp, file);
  return file;
}

// ---------- checks and server ----------
const ACTIVE = new Set();
process.once("exit", () => {
  for (const cleanup of ACTIVE) cleanup();
});

export function createOnsite({
  stateDir,
  env = process.env,
  spawnFn = spawn,
  lookup = dnsLookup,
  wifi = wifiAddress,
  vault = fileVault,
  idleMs = IDLE_MS,
  lookupMs = 6000,
  port = PORT,
} = {}) {
  let current = null;

  async function checks(entry, exportName) {
    const list = [];
    const add = (key, ok, text) => list.push({ key, ok, text });
    const exports = (await listExports(entry.id, env)).filter((e) => e.valid);
    const exp = exports.find((e) => e.name === exportName);
    add("export", !!exp, exp ? `Export ${exp.name} (geprüft, vollständig)` : "Kein gültiger Export ausgewählt.");
    const state = await studioState(stateDir, entry.id);
    if (entry.kind !== "blanko")
      add(
        "name",
        !!state.neutralApproved,
        state.neutralApproved
          ? `Neutraler Name freigegeben (Test-iPad am ${state.neutralApproved})`
          : "Der neutrale Name ist noch nicht mit einem Test-iPad geprüft. Erst mit Blanko testen und dort freigeben.",
      );
    const cert = await certStatus(entry.id, env);
    add(
      "zertifikat",
      cert.exists && cert.server?.daysLeft >= 0,
      !cert.exists ? "Noch kein Zertifikat für dieses Studio." : cert.server ? `Serverzertifikat gültig, noch ${cert.server.daysLeft} Tage` : "Kein Serverzertifikat.",
    );
    const net = await wifi();
    add("wlan", !net.error, net.error ?? `WLAN ${net.device}: ${net.ip}`);
    const taken = current && !current.endedAt ? null : await nameTaken(lookup, lookupMs);
    add("frei", !taken, taken ? `${NEUTRAL_HOST} antwortet im Netz schon (${taken}). Abbruch: kein Ausweichen auf einen anderen Namen.` : `${NEUTRAL_HOST} ist im Netz frei`);
    const back = exp && state.installed && compareVersions(exp.version, state.installed.version) < 0;
    add("version", !back, back ? `Rückschritt: installiert ist ${state.installed.version}.` : state.installed ? `Installiert: ${state.installed.version} (${state.installed.date})` : "Noch keine Installation bestätigt");
    const fv = await vault();
    add("filevault", fv, fv ? "FileVault ist an" : "FileVault ist aus. Bitte einschalten (Systemeinstellungen → Datenschutz & Sicherheit).");
    return { ok: list.every((c) => c.ok), checks: list, exp, net, cert, state };
  }

  const view = (s) =>
    s && {
      studio: s.studio,
      id: s.id,
      exportName: s.exportName,
      version: s.version,
      address: s.address,
      ip: s.ip,
      startedAt: s.startedAt,
      lastRequest: s.lastRequest,
      endedAt: s.endedAt,
      reason: s.reason,
      requests: s.requests.slice(-50),
      idleMinutes: Math.round(idleMs / 60000),
    };

  let starting = null;
  function stopSession(session, reason) {
    if (!session || session.endedAt) return session;
    clearTimeout(session.timer);
    for (const child of [session.server, session.announce]) if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    session.endedAt = new Date().toISOString();
    session.reason = reason;
    return session;
  }
  function stop(reason = "beendet") {
    // A start still in its checks is cancelled; it never spawns anything afterwards.
    if (starting) starting.cancelled = reason;
    return stopSession(current, reason);
  }

  async function start(entry, exportName) {
    // The slot is taken before the first await: two starts can never both run.
    if ((current && !current.endedAt) || starting) return { error: "Der Vor-Ort-Modus läuft schon oder startet gerade." };
    const attempt = { cancelled: null };
    starting = attempt;
    try {
      const result = await checks(entry, exportName);
      if (attempt.cancelled) return { error: `Start abgebrochen (${attempt.cancelled}).` };
      if (!result.ok) return { error: "Voraussetzungen nicht erfüllt.", checks: result.checks };
      return await launch(entry, result);
    } finally {
      starting = null;
    }
  }

  async function launch(entry, { exp, net }) {
    const session = {
      studio: entry.key,
      id: entry.id,
      exportName: exp.name,
      version: exp.version,
      address: ADDRESS,
      ip: net.ip,
      startedAt: new Date().toISOString(),
      lastRequest: null,
      requests: [],
      endedAt: null,
      reason: null,
    };
    current = session;
    const end = (reason) => stopSession(session, reason);
    const idle = () => {
      clearTimeout(session.timer);
      session.timer = setTimeout(() => end("30 Minuten ohne Anfrage"), idleMs);
      session.timer.unref?.();
    };
    // Announce the neutral name for the Wi-Fi address only, without renaming the Mac. If the
    // announcement ends, the on-site mode ends with it: the address would no longer work.
    session.announce = spawnFn("dns-sd", ["-P", `Inkform ${entry.id}`, "_https._tcp", "local", String(port), NEUTRAL_HOST, net.ip], { stdio: "ignore" });
    session.announce.on?.("error", () => end("Bonjour-Ankündigung fehlgeschlagen"));
    session.announce.on?.("exit", () => end(session.endedAt ? session.reason : "Bonjour-Ankündigung beendet; die Adresse ist nicht mehr erreichbar"));
    session.server = spawnFn(
      process.execPath,
      [path.join(root, "scripts", "serve.mjs"), "--lan", "--dir", path.join(exp.folder, "dist"), "--cert-dir", studioCertDir(entry.id, env), "--bind", net.ip, "--port", String(port), "--log-requests"],
      { stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "/usr/bin:/bin" } },
    );
    const ready = new Promise((resolve) => {
      let buffer = "";
      session.server.stdout.on("data", (chunk) => {
        buffer += chunk;
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (line.startsWith("Für das iPad")) resolve(true);
          const m = line.match(/^ANFRAGE (\S+) (GET|HEAD) (\d{3}) (\S+)$/);
          if (m) {
            session.lastRequest = m[1];
            session.requests.push({ at: m[1], method: m[2], status: Number(m[3]), path: m[4] });
            if (session.requests.length > 200) session.requests.shift();
            idle();
          }
        }
      });
      session.server.on("error", () => resolve(false));
      session.server.on("exit", () => {
        resolve(false);
        end(session.endedAt ? session.reason : "Server beendet");
      });
    });
    const started = await Promise.race([ready, new Promise((r) => setTimeout(() => r(false), 10_000).unref())]);
    // Give the announcement a moment: if it fails right away, nothing is reported as running.
    await new Promise((r) => setTimeout(r, 300));
    if (!started || session.endedAt) {
      const why = session.endedAt ? session.reason : "Server konnte nicht starten";
      end(why);
      return { error: `Vor-Ort-Modus nicht gestartet: ${why}.` };
    }
    idle();
    return { session: view(session) };
  }

  // Everything ends with the Werkstatt.
  const cleanup = () => stop("Werkstatt beendet");
  ACTIVE.add(cleanup);

  return { checks, start, stop: (reason) => view(stop(reason)), current: () => view(current), cleanup };
}
