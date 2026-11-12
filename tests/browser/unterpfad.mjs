// The build repository's content served below a sub path (/inkform/), as a static host such as
// GitHub Pages would: install, airplane mode, update. Uses its own local server on 127.0.0.1.
import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HELPERS, connect } from "./lib.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const site = await mkdtemp(path.join(tmpdir(), "inkform-unterpfad-")),
  app = path.join(site, "inkform");
await cp(path.join(root, "build", "blanko", "dist"), app, { recursive: true });
const port = 18900 + Math.floor(Math.random() * 90),
  origin = `http://127.0.0.1:${port}`,
  server = spawn(process.execPath, [path.join(root, "scripts", "serve.mjs"), "--dir", site, "--port", String(port)], { stdio: "ignore" });
for (let i = 0; i < 100; i++) {
  if (await fetch(`${origin}/inkform/index.html`).then((r) => r.ok, () => false)) break;
  await new Promise((r) => setTimeout(r, 100));
}
const { cmd, ev, until, check, navigate, reload, offline, requests, errors } = await connect();
try {
  await navigate(`${origin}/inkform/`);
  await until(`navigator.serviceWorker.ready.then(() => true)`);
  await reload();
  await until(`!!navigator.serviceWorker.controller`);
  check(
    "Service Worker gilt nur für /inkform/ und speichert die Dateien dort",
    await ev(`navigator.serviceWorker.getRegistration().then(async r=>r.scope==='${origin}/inkform/'&&r.active.scriptURL==='${origin}/inkform/sw.js'&&(await caches.open((await caches.keys())[0]).then(c=>c.match('${origin}/inkform/index.html')))!==undefined)`),
  );
  const href = await ev(`document.querySelector('link[rel="manifest"]').href`),
    manifest = await (await fetch(href)).json();
  check(
    "Manifest unter /inkform/, Start und Bereich relativ dazu",
    href === `${origin}/inkform/manifest.webmanifest` && manifest.start_url === "./" && manifest.scope === "./" && manifest.id === "./",
  );
  await offline(true);
  await reload();
  await ev(HELPERS);
  check("Im Flugmodus unter /inkform/ geladen, Einrichtung beginnt", await ev(`!!navigator.serviceWorker.controller&&document.getElementById('admin-pin-dialog').open`));
  await ev(`document.getElementById('admin-pin').value='839274';document.getElementById('admin-pin-repeat').value='839274';document.getElementById('admin-pin-form').requestSubmit()`);
  await until(`adminAccess.isUnlocked() && adminPage==='setup'`);
  check("Offline: PIN gesetzt, Einrichtungsassistent offen", true);
  await offline(false);

  // A new version appears at the same address: it takes over while the app is idle, the old one goes.
  const oldCache = await ev(`caches.keys().then(k=>k.join())`);
  const sw = await readFile(path.join(app, "sw.js"), "utf8");
  await writeFile(path.join(app, "sw.js"), sw.replace(/inkform-app-[0-9a-f]+/, "inkform-app-unterpfadupdate"));
  await ev(`navigator.serviceWorker.getRegistration().then(r=>r.update())`);
  await until(`caches.keys().then(k=>k.join()==='inkform-app-unterpfadupdate')`, 200);
  check("Update unter /inkform/: neue Version übernimmt, alte ist gelöscht", oldCache !== "inkform-app-unterpfadupdate" && (await ev(`navigator.serviceWorker.getRegistration().then(r=>!r.waiting&&r.scope==='${origin}/inkform/')`)));
  check("Keine Anfrage außerhalb von /inkform/", requests.filter((u) => u.startsWith(origin)).every((u) => u.startsWith(`${origin}/inkform/`)));
  check("Keine Netzwerkzugriffe zu anderen Adressen", requests.every((u) => !/^https?:/.test(u) || u.startsWith(origin)));
  check("Keine JavaScript- oder CSP-Fehler", errors.length === 0);
} finally {
  server.kill();
  await rm(site, { recursive: true, force: true });
}
process.exit(0);
