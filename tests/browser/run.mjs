// Browser checks against a fresh local build, entirely on this Mac.
//
//   npm run test:browser                          profile "beispiel", then the "blanko" check
//   node tests/browser/run.mjs                    profile "beispiel", all checks of that profile
//   npm run test:browser -- --profile ../Inkform-Studios/<studio>   a studio profile
//   npm run test:browser -- offline               only some checks (file names without .mjs)
//
// Starts the local preview server on 127.0.0.1, launches Google Chrome headless with an
// empty temporary profile and the DevTools port bound to 127.0.0.1, runs each check as a
// separate process and removes the temporary Chrome profile afterwards. Screenshots and
// protocols go to test-results/ of the core (built-in profile) or of the studio folder, so a
// studio's screenshots never end up in the core. The checks use synthetic data only.
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defaultOut, isBuiltin, resolveProfileDir, root } from "../../scripts/build.mjs";

const CHECKS = ["formular", "pin-einnahmen", "abschluss", "aufbewahrung", "export", "kopien", "sicherung", "einstellungen", "schriftgroessen", "offline", "update", "symbol", "werkstatt", "blanko", "einrichtung", "unterpfad", "sprachen", "flaggen", "zuruecksetzen", "rueckfragen", "seitenleiste"];
// Checks bound to one built-in profile; that profile runs only these.
const PROFILE_CHECKS = { blanko: ["blanko", "einrichtung", "unterpfad"] };
// Checks of the core itself, not of a studio's app: only with the built-in profile.
const CORE_ONLY = ["werkstatt", "sprachen", "flaggen"];
const argv = process.argv.slice(2);
const pi = argv.indexOf("--profile");
const profile = pi >= 0 ? argv[pi + 1] : "beispiel";
const selected = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--profile");
let checks = selected.length ? selected : CHECKS;
for (const c of checks) if (!CHECKS.includes(c)) throw new Error(`Unbekannte Prüfung: ${c}`);

const CHROME =
  process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const httpPort = 18080 + Math.floor(Math.random() * 800);
const cdpPort = 19900 + Math.floor(Math.random() * 90);
const profileDir = resolveProfileDir(profile);
if (!isBuiltin(profileDir)) checks = checks.filter((c) => !CORE_ONLY.includes(c));
const bound = PROFILE_CHECKS[path.basename(profileDir)];
checks = bound
  ? checks.filter((c) => bound.includes(c))
  : checks.filter((c) => !Object.values(PROFILE_CHECKS).flat().includes(c));
const buildDir = defaultOut(profileDir);
const results = isBuiltin(profileDir) ? root : profileDir;
const out = path.join(results, "test-results", `${path.basename(profileDir)}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
await mkdir(out, { recursive: true });

const run = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...opts });
    child.on("exit", (code) => resolve(code ?? 1));
  });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await wait(100);
  }
  throw new Error(`Nicht erreichbar: ${url}`);
}

async function setDownloadFolder(cdp, folder) {
  await mkdir(folder, { recursive: true });
  const { webSocketDebuggerUrl } = await (await fetch(`${cdp}/json/version`)).json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  const reply = new Promise((resolve, reject) =>
    ws.addEventListener("message", ({ data }) => {
      const m = JSON.parse(data);
      if (m.id === 1) (m.error ? reject(Error(JSON.stringify(m.error))) : resolve());
    }),
  );
  ws.send(
    JSON.stringify({
      id: 1,
      method: "Browser.setDownloadBehavior",
      params: { behavior: "allow", downloadPath: folder, eventsEnabled: false },
    }),
  );
  await reply;
  ws.close();
}

if ((await run(process.execPath, [path.join(root, "scripts/build.mjs"), "--profile", profile])) !== 0)
  process.exit(1);
const server = spawn(
  process.execPath,
  [path.join(root, "scripts/serve.mjs"), "--dir", path.join(buildDir, "dist"), "--port", String(httpPort)],
  { stdio: "ignore" },
);
const chromeData = await mkdtemp(path.join(tmpdir(), "inkform-chrome-"));
// Exports clicked by the checks (CSV, JSON, HTML, PDF) go to test-results/, never to ~/Downloads.
const downloads = path.join(out, "downloads");
await mkdir(path.join(chromeData, "Default"), { recursive: true });
await writeFile(
  path.join(chromeData, "Default", "Preferences"),
  JSON.stringify({
    download: { default_directory: downloads, prompt_for_download: false, directory_upgrade: true },
    savefile: { default_directory: downloads },
  }),
);
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${cdpPort}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${chromeData}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--disable-default-apps",
    "--disable-extensions",
    "about:blank",
  ],
  { stdio: "ignore" },
);
let failed = 0;
try {
  await until(`http://127.0.0.1:${httpPort}/index.html`);
  await until(`http://127.0.0.1:${cdpPort}/json/version`);
  // Exports clicked by the checks (CSV, JSON, HTML, PDF) go to test-results/, never to ~/Downloads.
  await setDownloadFolder(`http://127.0.0.1:${cdpPort}`, downloads);
  const env = {
    ...process.env,
    INKFORM_CDP: `http://127.0.0.1:${cdpPort}`,
    INKFORM_HTTP_ORIGIN: `http://127.0.0.1:${httpPort}`,
    INKFORM_FILE_URL: pathToFileURL(path.join(buildDir, "index.html")).href,
    INKFORM_PROFILE: path.join(profileDir, "profile.json"),
    INKFORM_OUT: out,
  };
  for (const check of checks) {
    console.log(`\n=== ${check} (Profil ${path.basename(profileDir)})`);
    const code = await run(
      process.execPath,
      [fileURLToPath(new URL(`./${check}.mjs`, import.meta.url))],
      { env },
    );
    if (code !== 0) {
      failed++;
      console.log(`FAIL ${check}`);
    }
  }
} finally {
  chrome.kill();
  server.kill();
  await wait(300);
  await rm(chromeData, { recursive: true, force: true });
}
console.log(`\n${checks.length - failed}/${checks.length} Browser-Prüfungen bestanden. Ausgaben: ${out}`);
process.exit(failed ? 1 : 0);
