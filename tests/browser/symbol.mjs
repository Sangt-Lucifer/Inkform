// Home screen icon: chosen with a preview, stored on the device, handed to iPadOS as a data:
// address of 180 × 180 pixels (it fetches linked files from the server, past the service
// worker), part of the full backup. A damaged stored icon falls back to the built-in one.
import { HELPERS, ORIGIN, connect } from "./lib.mjs";

const { cmd, ev, until, check, navigate, reload, errors, screenshot } = await connect();
const reset = await cmd("Page.addScriptToEvaluateOnNewDocument", {
  source: `try{localStorage.clear();sessionStorage.clear();indexedDB.deleteDatabase('inkform-logo')}catch(_){}`,
});
await navigate(ORIGIN + "/index.html");
await cmd("Page.removeScriptToEvaluateOnNewDocument", { identifier: reset.identifier });
await until(`navigator.serviceWorker.ready.then(() => !!navigator.serviceWorker.controller || (location.reload(), false))`);
await reload();
await until(`!!navigator.serviceWorker.controller`);
await ev(HELPERS);
const unlock = async () => {
  await ev(`openAdmin('studio')`);
  await until(`document.getElementById('admin-pin-dialog').open || adminAccess.isUnlocked()`);
  if (await ev(`document.getElementById('admin-pin-dialog').open`)) {
    await ev(`(()=>{const r=document.getElementById('admin-pin-repeat');document.getElementById('admin-pin').value='839274';if(r&&!r.hidden&&r.offsetParent)r.value='839274';document.getElementById('admin-pin-form').requestSubmit()})()`);
  }
  await until(`adminAccess.isUnlocked() && !document.getElementById('admin-pin-dialog').open && !document.getElementById('admin-app').hidden`);
  await ev(`openAdminAuthorized('studio')`);
};
await unlock();

const link = () => ev(`document.querySelector('link[rel="apple-touch-icon"]').getAttribute('href')`);
// Edge and the colours of a corner and the middle, as "edge|r,g,b|r,g,b".
const look = (src) =>
  ev(`(async()=>{const src=${src};return new Promise((ok,no)=>{const i=new Image();i.onload=()=>{const n=i.naturalWidth,c=document.createElement('canvas');c.width=c.height=n;const x=c.getContext('2d');x.drawImage(i,0,0);const p=(a,b)=>[...x.getImageData(a,b,1,1).data.slice(0,3)].join();ok(n+'x'+i.naturalHeight+'|'+p(2,2)+'|'+p(n/2,n/2))};i.onerror=()=>no(Error('kein Bild'));i.src=src})})()`);
const choose = (name, type, body) =>
  ev(`(async()=>{const dt=new DataTransfer();dt.items.add(new File([${body}],'${name}',{type:'${type}'}));const i=document.getElementById('icon-file');i.files=dt.files;i.dispatchEvent(new Event('change'))})()`);
// Invented picture: transparent, wider than high, a dark square in the middle with a light bar.
const picture = `await (async()=>{const c=document.createElement('canvas');c.width=400;c.height=300;const g=c.getContext('2d');g.fillStyle='#223355';g.fillRect(100,50,200,200);g.fillStyle='#ffdd44';g.fillRect(150,130,100,40);return new Promise(r=>c.toBlob(r,'image/png'))})()`;

await until(`!!builtInLogo&&!!builtInIconBytes`);
await ev(`navigator.canShare=()=>true;navigator.share=async(d)=>{window.__shared=d.files[0]};window.__shared=null;openAdminAuthorized('backup');document.querySelector('[data-admin-action="export-json"]').click()`);
await until(`!!window.__shared`);
check(
  "Studio-Build ohne eigenes Logo und Symbol: Studio-Einstellungen enthalten die eingebauten",
  await ev(`window.__shared.text().then(t=>{const f=JSON.parse(t),i=fromBase64(f.icon),l=fromBase64(f.logo);return pngSize(i).width===192&&pngSize(i).height===192&&!!pngSize(l)})`),
);
await ev(`openAdminAuthorized('studio')`);
check("Ohne eigenes Symbol: eingebautes Symbol für den Home-Bildschirm", (await link()) === "./icons/icon-192.png" && (await ev(`!!document.querySelector('[data-admin-action="icon-choose"]')&&!document.querySelector('[data-admin-action="icon-remove"]')`)));

await choose("symbol.png", "image/png", picture);
await until(`!!document.querySelector('[data-admin-action="icon-accept"]')`);
check("Vorschau: Quadrat 512 × 512 aus der Bildmitte, durchsichtige Ecke hell", (await look(`document.querySelector('.icon-preview.draft img').src`)) === "512x512|255,255,255|255,221,68");
await ev(`document.querySelector('[data-admin-action="icon-background"][data-background="dark"]').click()`);
await until(`document.querySelector('[data-background="dark"]')?.getAttribute('aria-pressed')==='true'`);
check("Hintergrund dunkel: Ecke schwarz", (await look(`document.querySelector('.icon-preview.draft img').src`)) === "512x512|0,0,0|255,221,68");
await ev(`(p=>{let c=p.parentElement;while(c&&c.scrollHeight<=c.clientHeight)c=c.parentElement;(c||document.scrollingElement).scrollTop+=p.getBoundingClientRect().top-10})(document.querySelector('[data-icon-panel]'));new Promise(r=>setTimeout(r,200))`);
await screenshot("symbol-vorschau");
// Cancel while the dark version is still being drawn: the late result does not bring the preview back.
await ev(`document.querySelector('[data-admin-action="icon-background"][data-background="light"]').click();document.querySelector('[data-admin-action="icon-cancel"]').click()`);
await new Promise((r) => setTimeout(r, 800));
check("Abbrechen während der Umrechnung: Vorschau bleibt weg", await ev(`!iconDraft&&!document.querySelector('[data-admin-action="icon-accept"]')`));
check("Abbrechen: nichts gespeichert", (await ev(`logoStore.get(ICON_KEY).then(b=>b===null&&!ownIcon)`)) && (await link()) === "./icons/icon-192.png");

await choose("symbol.png", "image/png", picture);
await until(`!!document.querySelector('[data-admin-action="icon-accept"]')`);
// Locking the admin drops an open preview.
await ev(`finishAdminLeave()`);
check("Sperren verwirft die offene Vorschau", await ev(`!iconDraft`));
await unlock();
await choose("symbol.png", "image/png", picture);
await until(`!!document.querySelector('[data-admin-action="icon-accept"]')`);
await ev(`document.querySelector('[data-admin-action="icon-accept"]').click()`);
await until(`document.querySelector('link[rel="apple-touch-icon"]').getAttribute('href').startsWith('data:image/png;base64,')`);
check("Übernommen: gespeichert als PNG 512 × 512", (await look(`URL.createObjectURL(await logoStore.get(ICON_KEY))`)) === "512x512|255,255,255|255,221,68");
check("Für iPadOS: data:-Adresse mit 180 × 180 Pixeln", (await look(`document.querySelector('link[rel="apple-touch-icon"]').href`)) === "180x180|255,255,255|255,221,68");
check("Symbol-Bereich bietet „App-Symbol entfernen“", await ev(`!!document.querySelector('[data-admin-action="icon-remove"]')`));

await reload();
await ev(HELPERS);
await until(`document.querySelector('link[rel="apple-touch-icon"]').getAttribute('href').startsWith('data:image/png;base64,')`);
check("Nach dem Neustart: eigenes Symbol wieder gesetzt", (await look(`document.querySelector('link[rel="apple-touch-icon"]').href`)).startsWith("180x180|"));

// In the full backup.
await unlock();
await ev(`openAdminAuthorized('backup');navigator.canShare=()=>true;navigator.share=async(d)=>{window.__shared=d.files[0]};window.__shared=null;document.querySelector('.ad-panel [data-admin-action="backup-create"]').click()`);
await until(`!document.querySelector('[data-backup-ready]').hidden`);
await ev(`document.querySelector('[data-admin-action="backup-save"]').click()`);
await until(`!!window.__shared`);
const backup = JSON.parse(await ev(`window.__shared.text()`));
check("Gesamtsicherung enthält das App-Symbol", backup.schemaVersion === 4 && Buffer.from(backup.icon, "base64").readUInt32BE(16) === 512);

await ev(`openAdminAuthorized('studio');window.__toast=null`);
await choose("notiz.txt", "text/plain", `'kein Bild'`);
await until(`document.getElementById('toast').textContent.includes('App-Symbol nicht übernommen')`);
check("Kein Bild: abgelehnt, Symbol bleibt", (await ev(`document.getElementById('toast').textContent`)).includes("PNG- oder JPEG") && (await ev(`!!ownIcon`)));

await ev(`askWith(()=>true);document.querySelector('[data-admin-action="icon-remove"]').click();askReal()`);
await until(`!ownIcon`);
check("Entfernt: wieder das eingebaute Symbol", (await link()) === "./icons/icon-192.png" && (await ev(`logoStore.get(ICON_KEY).then(b=>b===null)`)));

// A damaged or non-square stored icon is not used.
await ev(`(async()=>{const c=document.createElement('canvas');c.width=300;c.height=200;await logoStore.put(ICON_KEY,await new Promise(r=>c.toBlob(r,'image/png')))})()`);
await reload();
await ev(HELPERS);
await new Promise((r) => setTimeout(r, 500));
check("Gespeichertes Symbol nicht quadratisch: eingebautes Symbol", (await link()) === "./icons/icon-192.png" && (await ev(`!ownIcon`)));
check("Keine JavaScript- oder CSP-Fehler", errors.length === 0, JSON.stringify(errors));
process.exit(0);
