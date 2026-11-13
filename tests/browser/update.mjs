// App update via the service worker: a newer version takes over only while the app is idle and
// removes the older cached version, so no old app can start again on newer data. Simulated by
// serving a changed sw.js (new cache name) from the local preview; restored afterwards.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HELPERS, ORIGIN, connect } from "./lib.mjs";

const dist = path.join(path.dirname(fileURLToPath(process.env.INKFORM_FILE_URL)), "dist");
const swFile = path.join(dist, "sw.js"),
  indexFile = path.join(dist, "index.html");
const original = await readFile(swFile, "utf8"),
  originalIndex = await readFile(indexFile, "utf8");
const { cmd, ev, until, check, navigate, reload, errors } = await connect();
try {
  const reset = await cmd("Page.addScriptToEvaluateOnNewDocument", {
    source: `try{localStorage.clear();sessionStorage.clear()}catch(_){}`,
  });
  await navigate(ORIGIN + "/index.html");
  await cmd("Page.removeScriptToEvaluateOnNewDocument", { identifier: reset.identifier });
  await until(`navigator.serviceWorker.ready.then(() => !!navigator.serviceWorker.controller || (location.reload(), false))`);
  await reload();
  await until(`!!navigator.serviceWorker.controller`);

  // A changed page on the server does not reach a started app: it starts from its cache.
  await writeFile(indexFile, originalIndex.replace("</body>", '<i id="vom-server"></i></body>'));
  await navigate(ORIGIN + "/");
  await until(`!!navigator.serviceWorker.controller`);
  check("Start aus dem Offline-Speicher, auch wenn der Server erreichbar ist", await ev(`!document.getElementById('vom-server')&&!!document.getElementById('customer-app')`));
  await writeFile(indexFile, originalIndex);
  await ev(HELPERS);
  await ev(`document.getElementById('admin-pin').value='839274';document.getElementById('admin-pin-repeat').value='839274';document.getElementById('admin-pin-form').requestSubmit()`);
  await until(`adminAccess.isUnlocked()`);
  await ev(`finishAdminLeave()`);
  const oldCache = await ev(`caches.keys().then(k=>k.filter(n=>n.startsWith('inkform-app-')).join())`);
  check("Ausgangslage: eine App-Version im Offline-Speicher", !!oldCache && !oldCache.includes(","));

  // Customer starts filling in the form, then a new version is published.
  await ev(`document.getElementById('firstName').value='Halb';document.getElementById('firstName').dispatchEvent(new Event('input',{bubbles:true}))`);
  await writeFile(swFile, original.replace(/inkform-app-[0-9a-f]+/, "inkform-app-testupdate"));
  await ev(`navigator.serviceWorker.getRegistration().then(r=>r.update())`);
  await until(`navigator.serviceWorker.getRegistration().then(r=>!!r.waiting)`);
  await new Promise((r) => setTimeout(r, 1500));
  check("Während ein Formular in Arbeit ist, wartet das Update", await ev(`navigator.serviceWorker.getRegistration().then(r=>!!r.waiting&&document.getElementById('firstName').value==='Halb')`));

  // Form cleared: the update takes over without reloading and removes the old version.
  await ev(`resetCustomerForm()`);
  await until(`caches.keys().then(k=>k.includes('inkform-app-testupdate')&&!k.includes(${JSON.stringify(oldCache)}))`, 200);
  check("Leeres Formular: neue Version übernimmt, alte Version ist aus dem Offline-Speicher gelöscht", await ev(`navigator.serviceWorker.getRegistration().then(r=>!r.waiting&&r.active.scriptURL.endsWith('/sw.js'))`));
  check("Ohne Neuladen: Seite bleibt bedienbar", await ev(`!document.getElementById('customer-app').hidden&&typeof adminAccess!=='undefined'`));
  check("Keine JavaScript-Fehler", errors.length === 0);
} finally {
  await writeFile(swFile, original);
  await writeFile(indexFile, originalIndex);
}
process.exit(0);
