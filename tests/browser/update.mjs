// App update via the service worker: a newer version takes over only while the app is idle and
// removes the older cached version, so no old app can start again on newer data. Simulated by
// serving a changed sw.js (new cache name) from the local preview; restored afterwards.
import { readFileSync } from "node:fs";
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
  // Stored settings in today's format, as a file writes them (not as the app would): an update
  // that needs no migration must leave them byte for byte as they are.
  const settingsText = readFileSync(new URL("../fixtures/einstellungen-v1.json", import.meta.url), "utf8");
  await ev(`localStorage.setItem(SETTINGS_KEY,${JSON.stringify(settingsText)})`);
  const oldCache = await ev(`caches.keys().then(k=>k.filter(n=>n.startsWith('inkform-app-')).join())`);
  check("Ausgangslage: eine App-Version im Offline-Speicher", !!oldCache && !oldCache.includes(","));

  // Customer starts filling in the form, then a new version is published.
  await ev(`document.getElementById('firstName').value='Halb';document.getElementById('firstName').dispatchEvent(new Event('input',{bubbles:true}))`);
  await writeFile(swFile, original.replace(/inkform-app-[0-9a-f]+/, "inkform-app-testupdate"));
  // Back in the foreground during the customer's turn (e.g. from the share sheet): no request,
  // even if the app has not asked yet today.
  await ev(`localStorage.removeItem('inkform.update-day.v1');document.dispatchEvent(new Event('visibilitychange'))`);
  check("Während ein Formular in Arbeit ist, fragt die App nicht nach Updates", await ev(`(()=>{const c=window.inkformUpdateChecks().at(-1);return c.reason==='visible'&&c.asked===false&&localStorage.getItem('inkform.update-day.v1')===null})()`));
  // An update found just before the customer started waits until the form is cleared.
  await ev(`navigator.serviceWorker.getRegistration().then(r=>r.update())`);
  await until(`navigator.serviceWorker.getRegistration().then(r=>!!r.waiting)`);
  await new Promise((r) => setTimeout(r, 1500));
  check("Während ein Formular in Arbeit ist, wartet das Update", await ev(`navigator.serviceWorker.getRegistration().then(r=>!!r.waiting&&document.getElementById('firstName').value==='Halb')`));

  // Form cleared: the update takes over without reloading and removes the old version.
  await ev(`resetCustomerForm()`);
  await until(`caches.keys().then(k=>k.includes('inkform-app-testupdate')&&!k.includes(${JSON.stringify(oldCache)}))`, 200);
  check("Leeres Formular: neue Version übernimmt, alte Version ist aus dem Offline-Speicher gelöscht", await ev(`navigator.serviceWorker.getRegistration().then(r=>!r.waiting&&r.active.scriptURL.endsWith('/sw.js'))`));

  // Idle and back in the foreground: the app asks by itself once a day (Safari does not).
  await writeFile(swFile, original.replace(/inkform-app-[0-9a-f]+/, "inkform-app-testupdate2"));
  const before = await ev(`JSON.stringify(window.inkformUpdateChecks())`);
  await ev(`localStorage.setItem('inkform.update-day.v1',new Date().toDateString());document.dispatchEvent(new Event('visibilitychange'))`);
  check("Am selben Tag fragt die App nicht noch einmal von selbst", (await ev(`JSON.stringify(window.inkformUpdateChecks())`)) === before);
  await ev(`localStorage.setItem('inkform.update-day.v1',new Date(Date.now()-864e5).toDateString());document.dispatchEvent(new Event('visibilitychange'))`);
  await until(`caches.keys().then(k=>k.includes('inkform-app-testupdate2')&&!k.includes('inkform-app-testupdate'))`, 200);
  check("Erster Start eines neuen Tages: fragt selbst nach der neuen Version", await ev(`localStorage.getItem('inkform.update-day.v1')===new Date().toDateString()`));

  // „Nach Update suchen“ asks at any time; while a form is in progress it only reports the update.
  await writeFile(swFile, original.replace(/inkform-app-[0-9a-f]+/, "inkform-app-testupdate3"));
  await ev(`document.getElementById('firstName').value='Halb';document.getElementById('firstName').dispatchEvent(new Event('input',{bubbles:true}))`);
  check("Knopf bei Formular in Arbeit: meldet die neue Version, lädt nicht", (await ev(`window.inkformLookForUpdate()`)) === "busy");
  // Idle: the new version takes over and the page reloads into it.
  await ev(`resetCustomerForm();window.__alteSeite=true`);
  check("Knopf „Nach Update suchen“ lädt die neue Version", (await ev(`window.inkformLookForUpdate()`)) === "loading");
  await until(`!window.__alteSeite&&document.readyState==='complete'&&!!navigator.serviceWorker.controller`, 200);
  check("Nach dem Neuladen: neue Version aktiv, alte gelöscht, App bedienbar", await ev(`caches.keys().then(k=>k.includes('inkform-app-testupdate3')&&!k.includes('inkform-app-testupdate2')&&!!document.getElementById('customer-app'))`));
  // The worker took over while this page was in the background: the page itself is older than
  // its cached copy, so the button reloads instead of reporting "up to date".
  check("Seite und Offline-Kopie gleich: „aktuell“", (await ev(`window.inkformLookForUpdate()`)) === "none");
  await ev(`(async()=>{const r=await navigator.serviceWorker.getRegistration(),u=new URL('index.html',r.scope).href,c=await caches.open((await caches.keys()).find(k=>k.startsWith('inkform-app-'))),t=await (await c.match(u)).text();await c.put(u,new Response(t.replace(/(<meta name="inkform-page" content=")[0-9a-f]+/,'$1ffffffffffff'),{headers:{'Content-Type':'text/html; charset=utf-8'}}));window.__alteSeite=true})()`);
  await ev(`document.getElementById('firstName').value='Halb';document.getElementById('firstName').dispatchEvent(new Event('input',{bubbles:true}))`);
  check("Neuere Offline-Kopie bei Formular in Arbeit: meldet sie, lädt nicht", (await ev(`window.inkformLookForUpdate()`)) === "busy" && (await ev(`window.__alteSeite===true`)));
  await ev(`resetCustomerForm()`);
  check("Neuere Offline-Kopie als die laufende Seite: Knopf lädt neu", (await ev(`window.inkformLookForUpdate()`)) === "loading");
  await until(`!window.__alteSeite&&document.readyState==='complete'&&!!navigator.serviceWorker.controller`, 200);
  check("Danach läuft die Seite aus der Kopie", await ev(`document.querySelector('meta[name="inkform-page"]').content==='ffffffffffff'`));
  check(
    "Nach den Updates: Einstellungen gelesen und Byte für Byte unverändert",
    (await ev(`localStorage.getItem(SETTINGS_KEY)`)) === settingsText && (await ev(`settings.app.headline`)) === JSON.parse(settingsText).app.headline,
  );
  check("Keine JavaScript-Fehler", errors.length === 0);
} finally {
  await writeFile(swFile, original);
  await writeFile(indexFile, originalIndex);
}
process.exit(0);
