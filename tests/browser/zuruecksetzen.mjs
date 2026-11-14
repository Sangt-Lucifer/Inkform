// PIN change and reset of the app on this device: a wrong current PIN changes nothing and counts as
// a failure, the new PIN applies at once; the reset asks for a typed word, deletes every Inkform key
// and file of this device (not other sites' keys, not the cached app) and starts with a new PIN.
// Synthetic data only.
import { HELPERS, ORIGIN, connect } from "./lib.mjs";

const { cmd, ev, until, check, navigate, screenshot, errors } = await connect();
await cmd("Emulation.setDeviceMetricsOverride", { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
const clean = await cmd("Page.addScriptToEvaluateOnNewDocument", {
  source: `try{localStorage.clear();sessionStorage.clear();for(const n of ['inkform-pending','inkform-archive','inkform-logo'])indexedDB.deleteDatabase(n)}catch(_){}`,
});
await navigate(ORIGIN + "/index.html");
await cmd("Page.removeScriptToEvaluateOnNewDocument", { identifier: clean.identifier });
// Leaving the previous check's page may log a blocked leave warning; it belongs to that page.
errors.length = 0;
await ev(HELPERS);
await until(`document.getElementById('admin-pin-dialog')?.open`);
await ev(`(()=>{for(const id of ['admin-pin','admin-pin-repeat'])document.getElementById(id).value='839274';document.getElementById('admin-pin-form').requestSubmit()})()`);
await until(`adminAccess.isUnlocked()`);

// PIN change ------------------------------------------------------------------------------------
await ev(`openAdminAuthorized('ipad')`);
const change = (current, pin, repeat) =>
  ev(`(()=>{document.getElementById('pin-current').value='${current}';document.getElementById('pin-new').value='${pin}';document.getElementById('pin-new-repeat').value='${repeat}';document.getElementById('pin-change-form').requestSubmit()})()`);
const pinError = () => ev(`(e=>e.hidden?'':e.textContent)(document.getElementById('pin-change-error'))`);
const stored = () => ev(`localStorage.getItem(ADMIN_PIN_KEY)`);
const before = await stored();
check("„PIN ändern“ unter iPad & Dateien", await ev(`!!document.getElementById('pin-change-form')&&document.getElementById('admin-app').textContent.includes(t('pin.changeTitle'))`));
await change("111111", "246813", "246813");
await until(`!document.getElementById('pin-change-error').hidden`);
check("Falsche bisherige PIN: Meldung, PIN unverändert, als Fehlversuch gezählt", (await pinError()) === (await ev(`t('pin.wrongCurrent')`)) && (await stored()) === before && (await ev(`JSON.parse(localStorage.getItem(ADMIN_LOCK_KEY)).failures`)) === 1);
await change("839274", "246813", "246800");
await until(`document.getElementById('pin-change-error').textContent===t('pin.mismatch')`);
check("Neue PIN zweimal verschieden: Meldung, PIN unverändert", (await stored()) === before);
await change("839274", "246813", "246813");
await until(`document.getElementById('pin-change-status').textContent===t('pin.changed')`);
check("PIN geändert: Felder leer, Fehlversuche zurückgesetzt", (await stored()) !== before && (await ev(`!document.getElementById('pin-current').value&&JSON.parse(localStorage.getItem(ADMIN_LOCK_KEY)).failures===0`)));
await ev(`adminAccess.lock();openAdmin('overview')`);
await until(`document.getElementById('admin-pin-dialog').open`);
await ev(`document.getElementById('admin-pin').value='839274';document.getElementById('admin-pin-form').requestSubmit()`);
await until(`!document.getElementById('admin-pin-error').hidden`);
check("Alte PIN gilt nicht mehr", await ev(`!adminAccess.isUnlocked()`));
await ev(`document.getElementById('admin-pin').value='246813';document.getElementById('admin-pin-form').requestSubmit()`);
await until(`adminAccess.isUnlocked()`);
check("Neue PIN öffnet die Verwaltung", true);

// Data that the reset must remove, and one key of another site part that must stay ----------------
await ev(`(async()=>{
  adminDraft=JSON.parse(JSON.stringify(settings));adminDraft.studio.location='Rücksetzort';saveAdmin();
  writeRetention(localStorage,{pdfYears:10,incomeYears:3});setTheme('dark');
  localStorage.setItem('fremd.schluessel','bleibt');sessionStorage.setItem('inkform.restored','1');
  await createIndexedDbFiles(indexedDB, ARCHIVE_DB).put('probe', new Blob(['%PDF-1.4'],{type:'application/pdf'}));
  await createIndexedDbFiles(indexedDB, LOGO_DB).put(LOGO_KEY, new Blob(['x'],{type:'image/png'}));
  await createIndexedDbFiles(indexedDB, LOGO_DB).put(ICON_KEY, new Blob(['y'],{type:'image/png'}));
  await createIndexedDbFiles(indexedDB).put('offen', new Blob(['%PDF-1.4'],{type:'application/pdf'}));
  localStorage.setItem(INCOME_KEY, JSON.stringify({schemaVersion:1,records:[]}));
})()`);
check("Kundenfenster „Formular leeren“ behält seinen eigenen Text", await ev(`document.getElementById('reset-title').textContent===t('reset.title')&&t('reset.title')!==t('appReset.dialogTitle')`));

await until(`caches.keys().then(k=>k.some(n=>n.startsWith('inkform-app-')))`);
// Reset -------------------------------------------------------------------------------------------
await ev(`openAdminAuthorized('retention')`);
check("„Aufbewahren & Löschen“ mit abgesetztem Bereich „App auf diesem iPad zurücksetzen“", await ev(`!!document.querySelector('.ad-danger-zone [data-admin-action="reset-open"]')&&document.querySelector('#admin-nav [aria-current="page"]').textContent.trim()===t('admin.page.retention.label')`));
await ev(`document.querySelector('[data-admin-action="reset-open"]').click()`);
check("Fenster offen, „Alles löschen“ gesperrt, Wort genannt", await ev(`document.getElementById('app-reset-dialog').open&&document.getElementById('app-reset-confirm').disabled&&document.getElementById('app-reset-word-label').textContent.includes(t('appReset.word'))`));
await screenshot("zuruecksetzen-fenster");
const typeWord = (word) => ev(`(e=>{e.value=${JSON.stringify(word)};e.dispatchEvent(new Event('input',{bubbles:true}))})(document.getElementById('app-reset-word'))`);
await typeWord("ZURÜCK");
check("Falsches Wort: weiter gesperrt", await ev(`document.getElementById('app-reset-confirm').disabled`));
await ev(`document.getElementById('app-reset-backup').click()`);
check("„Vorher Gesamtsicherung erstellen“ führt zu Sichern & Wiederherstellen", await ev(`!document.getElementById('app-reset-dialog').open&&adminPage==='backup'`));
await ev(`openAdminAuthorized('retention');document.querySelector('[data-admin-action="reset-open"]').click()`);
check("Erneut geöffnet: Eingabe leer, gesperrt", await ev(`document.getElementById('app-reset-word').value===''&&document.getElementById('app-reset-confirm').disabled`));
await typeWord(" zurücksetzen ");
check("Richtiges Wort (Groß/Klein egal): freigegeben", await ev(`!document.getElementById('app-reset-confirm').disabled`));
// An open edit must not hold the reload with a leave warning (registered after the app's own
// listener, so it sees whether the app asked for one).
await ev(`adminDraft.studio.location='Ungespeichert';window.__beforeReset=true;addEventListener('beforeunload',e=>{if(e.defaultPrevented)localStorage.setItem('probe.warned','1')});document.getElementById('app-reset-confirm').click()`);
await until(`!window.__beforeReset && document.readyState==='complete' && typeof adminAccess!=='undefined'`);
await ev(HELPERS);
await until(`document.getElementById('admin-pin-dialog')?.open`);
check("Nach dem Zurücksetzen: neue PIN festlegen", await ev(`!adminAccess.configured()&&!document.getElementById('admin-pin-repeat-field').hidden`));
check("Keine Warnung beim Verlassen trotz offener Änderung", await ev(`!localStorage.getItem('probe.warned')`));
check(
  "Keine Inkform-Daten mehr (nur der Start legt die Update-Prüfung neu an), fremder Schlüssel bleibt",
  await ev(`(()=>{const k=[...Object.keys(localStorage),...Object.keys(sessionStorage)].filter(x=>x.startsWith('inkform.')&&x!=='inkform.update-checks.v1');return k.length===0&&localStorage.getItem('fremd.schluessel')==='bleibt'})()`),
);
check(
  "PDF-Kopien, Logo, App-Symbol und offene Einwilligung gelöscht",
  (await ev(`Promise.all([createIndexedDbFiles(indexedDB, ARCHIVE_DB).keys(),createIndexedDbFiles(indexedDB, LOGO_DB).keys(),createIndexedDbFiles(indexedDB).keys()]).then(a=>a.every(k=>k.length===0))`)),
);
check("Offline-Kopie der App bleibt erhalten", await ev(`caches.keys().then(k=>k.some(n=>n.startsWith('inkform-app-')))`));
check("Keine JavaScript- oder CSP-Fehler", errors.length === 0, JSON.stringify(errors));
process.exit(0);
