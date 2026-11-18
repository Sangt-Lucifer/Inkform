// Language packs from the app's own site (sprachen/): "Automatisch" with a device language the app
// lacks loads its pack, keeps it for offline use and switches to it; no pack there yet or no
// connection: the fallback with a note; the Safari tab of the install page stores nothing; a
// studio settings file brings its packs along. The test pack is the pseudo language "qaa", built
// into a copy of the blanko build served below its own sub path. Synthetic data.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildProfile } from "../../scripts/build.mjs";
import { PSEUDO, writePseudoPack } from "../lib/pseudo.mjs";
import { HELPERS, connect } from "./lib.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const packs = await mkdtemp(path.join(tmpdir(), "inkform-pakete-"));
await writePseudoPack(packs);
const { files } = await buildProfile(path.dirname(process.env.INKFORM_PROFILE), { packs });
const site = await mkdtemp(path.join(tmpdir(), "inkform-pakete-site-"));
for (const [name, contents] of files)
  if (name.startsWith("dist/")) {
    const target = path.join(site, "inkform", name.slice(5));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
const port = 18800 + Math.floor(Math.random() * 90),
  origin = `http://127.0.0.1:${port}`,
  app = `${origin}/inkform/`,
  server = spawn(process.execPath, [path.join(root, "scripts", "serve.mjs"), "--dir", site, "--port", String(port)], { stdio: "ignore" });
for (let i = 0; i < 100; i++) {
  if (await fetch(`${app}index.html`).then((r) => r.ok, () => false)) break;
  await new Promise((r) => setTimeout(r, 100));
}
const { cmd, ev, until, check, navigate, reload, screenshot, offline, requests, errors, answer } = await connect();
const WIPE = `try{localStorage.clear();sessionStorage.clear();for(const n of ['inkform-pending','inkform-archive','inkform-logo'])indexedDB.deleteDatabase(n)}catch(_){}`;
const device = (tags) =>
  `Object.defineProperty(Navigator.prototype,'languages',{configurable:true,get:()=>${JSON.stringify(tags)}});Object.defineProperty(Navigator.prototype,'language',{configurable:true,get:()=>${JSON.stringify(tags[0])}});`;
// A new device with these languages: storage wiped once, the languages for every later load.
let deviceScript = null;
const freshDevice = async (tags, extra = "") => {
  if (deviceScript) await cmd("Page.removeScriptToEvaluateOnNewDocument", { identifier: deviceScript.identifier });
  deviceScript = await cmd("Page.addScriptToEvaluateOnNewDocument", { source: device(tags) + extra });
  const wipe = await cmd("Page.addScriptToEvaluateOnNewDocument", { source: WIPE });
  await navigate(app);
  await cmd("Page.removeScriptToEvaluateOnNewDocument", { identifier: wipe.identifier });
  await ev(HELPERS);
};
const auto = `document.querySelector('#admin-pin-language [data-operator-language="auto"]')`;
const note = `document.getElementById('admin-pin-language-note')`;
const packFetches = () => requests.filter((u) => u.startsWith(`${app}sprachen/`)).length;
try {
  await navigate(app);
  await until(`navigator.serviceWorker.ready.then(() => true)`);

  // Device language with a pack: loaded, kept, switched to -----------------------------------
  await freshDevice([PSEUDO, "de"]);
  await until(`document.getElementById('admin-pin-dialog')?.open`);
  check("Ohne Wahl: keine Anfrage nach Sprachpaketen", packFetches() === 0);
  await ev(`${auto}.click()`);
  await until(`document.documentElement.lang==='${PSEUDO}'`);
  check(
    "Automatisch: Paket der Gerätesprache geladen, Dialog in ihr, von rechts nach links, kein Hinweis",
    await ev(`document.documentElement.dir==='rtl'&&document.getElementById('admin-pin-title').textContent.includes('[')&&${note}.hidden
      &&Object.keys(JSON.parse(localStorage.getItem('inkform.sprachpakete.v1'))).join()==='${PSEUDO}'&&localStorage.getItem('inkform.language.v1')==='auto'`),
  );
  check("Nur die eigene Adresse gefragt: Liste und ein Paket", requests.filter((u) => u.includes("/sprachen/")).every((u) => u.startsWith(`${app}sprachen/`)) && packFetches() === 2);
  await screenshot("paket-geladen");
  await ev(`(()=>{for(const id of ['admin-pin','admin-pin-repeat'])document.getElementById(id).value='839274';document.getElementById('admin-pin-form').requestSubmit()})()`);
  await until(`adminAccess.isUnlocked() && adminOpen`);
  check("Assistent in der Paketsprache", await ev(`document.documentElement.lang==='${PSEUDO}'&&document.getElementById('admin-page-title').textContent.includes('[')`));
  await ev(`adminPage='ipad';renderAdminSection()`);
  check("„Sprache dieses Geräts“ bietet das Paket an", await ev(`[...document.getElementById('operator-language').options].some(o=>o.value==='${PSEUDO}')`));
  await ev(`adminPage='setup';renderAdminSection()`);
  check("Kundenformular bleibt ohne Formulartexte in der Paketsprache bei der Studiosprache", await ev(`customerLanguage==='de'`));

  const before = packFetches();
  await offline(true);
  await reload();
  await until(`typeof adminAccess!=='undefined' && document.getElementById('admin-pin-dialog')?.open`);
  await ev(HELPERS);
  await ev(`unlockAdmin('839274')`);
  await until(`adminAccess.isUnlocked() && adminOpen`);
  check("Im Flugmodus neu gestartet: Paket vom Gerät, Verwaltung in ihm, ohne Anfrage", (await ev(`document.documentElement.lang==='${PSEUDO}'`)) && packFetches() === before);
  await ev(`adminDraft=JSON.parse(JSON.stringify(settings));finishAdminLeave()`);
  await offline(false);

  // A damaged stored pack is skipped, never shown half -----------------------------------------
  await ev(`(()=>{const p=JSON.parse(localStorage.getItem('inkform.sprachpakete.v1'));delete p['${PSEUDO}'].texts['pin.setupTitle'];localStorage.setItem('inkform.sprachpakete.v1',JSON.stringify(p))})()`);
  await offline(true);
  await reload();
  await until(`typeof adminAccess!=='undefined' && document.getElementById('admin-pin-dialog')?.open`);
  check("Beschädigtes Paket auf dem Gerät: übergangen, Rückfall auf die nächste Gerätesprache", await ev(`!hasLanguage('${PSEUDO}')&&operatorLanguage()==='de'`));
  await offline(false);

  // No pack for the device language yet --------------------------------------------------------
  await freshDevice(["fr-FR"]);
  await until(`document.getElementById('admin-pin-dialog')?.open`);
  await ev(`${auto}.click()`);
  await until(`!${note}.hidden && !${note}.textContent.includes('…') && !${note}.textContent.includes('...')`);
  check(
    "Kein Paket da: Englisch, Hinweis „noch nicht übersetzt“, nichts gespeichert",
    await ev(`document.documentElement.lang==='en'&&${note}.textContent.startsWith('French')&&${note}.textContent.includes('English')&&!localStorage.getItem('inkform.sprachpakete.v1')`),
  );
  await screenshot("paket-fehlt");

  // No connection -------------------------------------------------------------------------------
  await freshDevice([PSEUDO]);
  await until(`document.getElementById('admin-pin-dialog')?.open`);
  await offline(true);
  await ev(`${auto}.click()`);
  await until(`!${note}.hidden && ${note}.textContent.includes('(')`);
  check("Keine Verbindung: Englisch mit Hinweis, später erneut wählen", await ev(`document.documentElement.lang==='en'&&${note}.textContent.includes('no connection')&&!localStorage.getItem('inkform.sprachpakete.v1')`));
  await offline(false);
  await ev(`${auto}.click()`);
  await until(`document.documentElement.lang==='${PSEUDO}'`);
  check("Wieder online, erneut Automatisch: Paket geladen", await ev(`${note}.hidden`));

  // Safari tab of the install page: shown, not stored, handed on in the address -------------------
  const safari = `Object.defineProperty(Navigator.prototype,'standalone',{configurable:true,get:()=>false});`;
  await freshDevice([PSEUDO], safari);
  await until(`!document.getElementById('install-screen').hidden`);
  await ev(`document.querySelector('#install-language [data-operator-language="auto"]').click()`);
  await until(`document.documentElement.lang==='${PSEUDO}'`);
  check(
    "Safari-Tab: Installationsseite in der Paketsprache, nichts gespeichert, Wahl in der Adresse",
    await ev(`document.getElementById('install-screen-title').textContent.includes('[')&&!localStorage.getItem('inkform.sprachpakete.v1')&&!localStorage.getItem('inkform.language.v1')&&location.search==='?sprache=auto'`),
  );
  await screenshot("paket-safari");
  // The home screen app opens that address: it loads the pack itself on its first start.
  await freshDevice([PSEUDO]);
  await navigate(`${app}?sprache=auto`);
  await until(`document.documentElement.lang==='${PSEUDO}' && document.getElementById('admin-pin-dialog')?.open`);
  check("Home-Bildschirm-App mit ?sprache=auto: lädt das Paket beim ersten Start selbst", await ev(`!!JSON.parse(localStorage.getItem('inkform.sprachpakete.v1')||'{}')['${PSEUDO}']`));

  // Studio settings bring their packs to a device without them -----------------------------------
  await freshDevice(["de-DE"]);
  await until(`document.getElementById('admin-pin-dialog')?.open`);
  await ev(`(()=>{for(const id of ['admin-pin','admin-pin-repeat'])document.getElementById(id).value='839274';document.getElementById('admin-pin-form').requestSubmit()})()`);
  await until(`adminAccess.isUnlocked() && adminPage==='setup' && !!document.querySelector('[data-admin-action="setup-new"]')`);
  await ev(`(async()=>{const p=await fetch('sprachen/${PSEUDO}.json').then(r=>r.json());const f=createStudioSettings({settings,theme:'dark',logo:null,icon:null,retention:readRetention(localStorage),backupDays:7,packs:{'${PSEUDO}':p}});
    const dt=new DataTransfer();dt.items.add(new File([JSON.stringify(f)],'studio.json',{type:'application/json'}));const i=document.getElementById('setup-file');i.files=dt.files;i.dispatchEvent(new Event('change'))})()`);
  await answer();
  await until(`typeof adminAccess!=='undefined' && document.readyState==='complete' && document.getElementById('admin-pin-dialog')?.open`);
  check(
    "Studio-Einstellungen mit Paket: nach dem Übernehmen auf dem Gerät, Verwaltung bleibt deutsch",
    await ev(`hasLanguage('${PSEUDO}')&&!!JSON.parse(localStorage.getItem('inkform.sprachpakete.v1'))['${PSEUDO}']&&document.documentElement.lang==='de'`),
  );
  // The only failed loads allowed: the pack list asked for in airplane mode on purpose.
  const unexpected = errors.filter((e) => !(e.text?.includes("ERR_INTERNET_DISCONNECTED") && e.url?.endsWith("/sprachen/index.json")));
  check("Keine JavaScript- oder CSP-Fehler", unexpected.length === 0);
} finally {
  server.kill();
  await rm(site, { recursive: true, force: true });
  await rm(packs, { recursive: true, force: true });
}
process.exit(0);
