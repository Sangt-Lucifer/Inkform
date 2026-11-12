// Neutral edition (profile "blanko") in the hosted build: loaded once online, then in airplane mode:
//   - no Mac hints and no owner guide; PIN input takes digits only, with separate messages
//   - setup assistant at the first start, saved only on this device, not shown again
//   - sample data can be loaded and removed completely
//   - a consent works offline and carries the studio from the assistant
// Synthetic test data only.
import { pdfText } from "../lib/leaks.mjs";
import { HELPERS, ORIGIN, connect } from "./lib.mjs";

const { cmd, ev, until, check, navigate, reload, screenshot, offline, requests, errors } = await connect();
await cmd("Emulation.setDeviceMetricsOverride", { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
const reset = await cmd("Page.addScriptToEvaluateOnNewDocument", {
  source: `try{localStorage.clear();sessionStorage.clear();indexedDB.deleteDatabase('inkform-pending');indexedDB.deleteDatabase('inkform-archive')}catch(_){}`,
});
await navigate(ORIGIN + "/index.html");
await cmd("Page.removeScriptToEvaluateOnNewDocument", { identifier: reset.identifier });
await until(`navigator.serviceWorker.ready.then(() => true)`);
await reload();
await offline(true);
await reload();
await ev(HELPERS);
check("Offline geladen: Service Worker liefert die App im Flugmodus", await ev(`!!navigator.serviceWorker.controller&&BLANK_EDITION===true`));
check("Keine Mac-Hinweise und keine Anleitung", await ev(`[...document.querySelectorAll('[data-studio-only]')].every(n=>n.hidden)&&[...document.querySelectorAll('[data-admin-action="guide"]')].every(n=>n.hidden)`));

// PIN at the first start -------------------------------------------------------------------
await until(`document.getElementById('admin-pin-dialog')?.open`);
const type = (id, value) => ev(`(()=>{const el=document.getElementById('${id}');el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));return el.value})()`);
const pinError = () => ev(`document.getElementById('admin-pin-error').hidden?'':document.getElementById('admin-pin-error').textContent`);
check("Beschriftung nennt Länge und nur Ziffern", await ev(`document.querySelector('label[for="admin-pin"]').textContent==='PIN (6 bis 12 Ziffern, nur Zahlen 0–9)'`));
check("Buchstaben und Zeichen werden beim Tippen entfernt, mit Hinweis", (await type("admin-pin", "83a9-2 74")) === "839274" && (await pinError()).includes("Nur Ziffern 0–9 erlaubt"));
check("Auch im Wiederholungsfeld", (await type("admin-pin-repeat", "8392x74")) === "839274");
await type("admin-pin", "12345");
await type("admin-pin-repeat", "12345");
await ev(`document.getElementById('admin-pin-form').requestSubmit()`);
await until(`document.getElementById('admin-pin-error').textContent.includes('zu kurz')`);
check("Zu kurze PIN: eigene Meldung", (await pinError()).includes("mindestens 6 Ziffern"));
await type("admin-pin", "839274");
await type("admin-pin-repeat", "839274");
await ev(`document.getElementById('admin-pin-form').requestSubmit()`);
await until(`adminAccess.isUnlocked() && adminPage==='setup' && !!document.getElementById('admin-studio-name')`);

// Setup assistant ---------------------------------------------------------------------------
check("Nach der PIN öffnet der Einrichtungsassistent, Felder leer", await ev(`document.getElementById('admin-page-title').textContent==='Einrichtung'&&['name','contact','address','location'].every(k=>document.getElementById('admin-studio-'+k).value==='')`));
await screenshot("blanko-einrichtung");
await ev(`openAdminAuthorized('export')`);
check("Vor der Einrichtung führt jede Admin-Seite zum Assistenten", await ev(`adminPage==='setup'`));
await ev(`document.querySelector('[data-admin-action="setup-finish"]').click()`);
check("Ohne Angaben: klare Meldung, nichts gespeichert", await ev(`!document.getElementById('admin-error').hidden&&document.getElementById('admin-error').textContent.includes('Bitte Studio')&&!localStorage.getItem(SETTINGS_KEY)`));
for (const [id, value] of [
  ["admin-studio-name", "Atelier Probe · Kim Test"],
  ["admin-studio-contact", "kontakt@atelier-probe.example"],
  ["admin-studio-address", "Probeweg 2, 54321 Teststadt"],
  ["admin-studio-location", "Teststadt"],
  ["setup-pdf-years", "10"],
])
  await type(id, value);
await ev(`document.querySelector('[data-admin-action="setup-finish"]').click()`);
await until(`adminPage==='overview'`);
check(
  "Einrichtung gespeichert, nur auf dem Gerät: Studio, Kontakt, Frist",
  await ev(`JSON.parse(localStorage.getItem(SETTINGS_KEY)).studio.name==='Atelier Probe · Kim Test'&&readRetention(localStorage).pdfYears===10`),
);
await ev(`finishAdminLeave()`);
check("Kundenformular zeigt das eingerichtete Studio", await ev(`document.getElementById('customer-studio-name').textContent==='Atelier Probe'`));
await reload();
await ev(HELPERS);
check("Nach dem Neuladen kein Assistent mehr", await ev(`!document.getElementById('admin-pin-dialog').open&&!document.getElementById('customer-app').hidden`));

// Studio page keeps the values editable later -------------------------------------------------
await ev(`openAdmin('studio')`);
await until(`document.getElementById('admin-pin-dialog').open`);
check("Entsperren: Buchstaben werden auch hier entfernt", (await type("admin-pin", "83a9274")) === "839274");
await ev(`document.getElementById('admin-pin-form').requestSubmit()`);
await until(`adminAccess.isUnlocked() && adminPage==='studio'`);
check("Angaben später unter „Studio & Kontakt“ änderbar", await ev(`document.getElementById('admin-studio-address').value==='Probeweg 2, 54321 Teststadt'`));

// Sample data --------------------------------------------------------------------------------
await ev(`openAdminAuthorized('overview')`);
check("Standard ist leer", await ev(`incomeRecords().length===0&&!!document.querySelector('[data-admin-action="sample-load"]')`));
await ev(`document.querySelector('[data-admin-action="sample-load"]').click()`);
await until(`!!document.querySelector('[data-admin-action="sample-remove"]')`);
check("Beispieldaten: 6 erfundene Einträge mit PDFs", (await ev(`incomeRecords().length===6&&incomeRecords().every(r=>r.id.startsWith('beispiel-'))`)) && (await ev(`createIndexedDbFiles(indexedDB, ARCHIVE_DB).keys().then(k=>k.length)`)) === 6);
await ev(`openAdminAuthorized('export');(()=>{const el=document.getElementById('export-month');el.value=previousMonth(localDate());el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
await until(`document.getElementById('export-preview').textContent.includes('Davon')`);
check("Beispieldaten lassen sich exportieren", await ev(`document.getElementById('export-preview').textContent.includes('Davon 3 Einwilligungen')`));
await ev(`openAdminAuthorized('overview');document.querySelector('[data-admin-action="sample-remove"]').click()`);
await until(`!!document.querySelector('[data-admin-action="sample-load"]')`);
await until(`createIndexedDbFiles(indexedDB, ARCHIVE_DB).keys().then(k=>k.length===0)`);
check("Beispieldaten vollständig entfernt (Einträge und PDFs)", await ev(`incomeRecords().length===0`));
await ev(`finishAdminLeave()`);

// A consent offline with the studio from the assistant ----------------------------------------
await ev(`fillConsent({firstName:'Mira',lastName:'Ölmann'});form.requestSubmit()`);
await until(`!document.getElementById('completion-screen').hidden && !!pendingConsent && (async()=>await pendingConsent.kept)()`);
const pdf = pdfText(Buffer.from(await ev(`blobBase64(pendingConsent.blob)`), "base64"));
check("Einwilligungs-PDF nennt das eingerichtete Studio und die Kundin", pdf.includes("Atelier Probe · Kim Test") && pdf.includes("Probeweg 2, 54321 Teststadt") && pdf.includes("Mira Ölmann"));
await ev(`document.getElementById('completion-unlock').click()`);
await until(`document.getElementById('admin-pin-dialog').open`);
await ev(`unlockAdmin()`);
await until(`document.getElementById('pdf-dialog').open && !nativeShareInFlight`);
await ev(`document.getElementById('pdf-next').click()`);
await until(`!document.getElementById('customer-app').hidden && incomeRecords().length===1`);
await until(`createIndexedDbFiles(indexedDB, ARCHIVE_DB).keys().then(k=>k.length===1)`);
check("Gebucht und für den Export gespeichert, alles im Flugmodus", true);

check("Keine Netzwerkzugriffe außer der lokalen Vorschau", requests.every((u) => !/^https?:/.test(u) || u.startsWith(ORIGIN)));
check("Keine JavaScript- oder CSP-Fehler", errors.length === 0);
process.exit(0);
