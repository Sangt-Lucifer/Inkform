// Deleting PDF copies kept in the app (never files elsewhere), in the hosted build, offline:
//   - storage display; offer after a ZIP export; "Später löschen" keeps everything
//   - check step: warning, instructions with the count, box to tick, last question
//   - by period without export (warning if never exported) and for a single entry
//   - entries stay complete with "PDF nicht mehr in der App"; later exports name them
//   - restoring an older full backup does not bring deleted copies back
// Synthetic test data only.
import { HELPERS, ORIGIN, connect } from "./lib.mjs";

const { cmd, ev, until, check, navigate, reload, screenshot, offline, requests, errors, answer } = await connect();
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
await until(`document.getElementById('admin-pin-dialog')?.open`);
await ev(`document.getElementById('admin-pin').value='839274';document.getElementById('admin-pin-repeat').value='839274';document.getElementById('admin-pin-form').requestSubmit()`);
await until(`adminAccess.isUnlocked()`);
await ev(`finishAdminLeave()`);
const copies = () => ev(`createIndexedDbFiles(indexedDB, ARCHIVE_DB).keys().then(k=>k.length)`);

async function consent(firstName, lastName, appointment) {
  await ev(`fillConsent({firstName:${JSON.stringify(firstName)},lastName:${JSON.stringify(lastName)},appointment:'${appointment}'});form.requestSubmit()`);
  await until(`!document.getElementById('completion-screen').hidden && !!pendingConsent && (async()=>await pendingConsent.kept)()`);
  const before = await copies();
  await ev(`document.getElementById('completion-unlock').click()`);
  await until(`document.getElementById('admin-pin-dialog').open`);
  await ev(`unlockAdmin()`);
  await until(`document.getElementById('pdf-dialog').open && !nativeShareInFlight`);
  await ev(`document.getElementById('pdf-next').click()`);
  await until(`!document.getElementById('customer-app').hidden && !localStorage.getItem(PENDING_KEY)`);
  await until(`createIndexedDbFiles(indexedDB, ARCHIVE_DB).keys().then(k=>k.length===${before + 1})`);
}
await consent("Anna", "März", "2026-03-03");
await consent("Ben", "März", "2026-03-15");
await consent("Cem", "März", "2026-03-30");
await consent("Dora", "April", "2026-04-04");
await consent("Emil", "Mai", "2026-05-05");

// A full backup while all five copies exist (restored at the end).
await ev(`openAdmin('backup')`);
await until(`document.getElementById('admin-pin-dialog').open`);
await ev(`unlockAdmin()`);
await until(`adminAccess.isUnlocked() && !document.getElementById('admin-pin-dialog').open`);
await ev(`navigator.canShare=()=>true;navigator.share=async(d)=>{window.__shared=d.files[0]};document.querySelector('.ad-panel [data-admin-action="backup-create"]').click()`);
await until(`!document.querySelector('[data-backup-ready]').hidden`);
await ev(`document.querySelector('[data-admin-action="backup-save"]').click()`);
await until(`!!window.__shared && /^\\d{8}_\\d{4}_Inkform_Sicherung\\.json$/.test(window.__shared.name)`);
await ev(`window.__shared.text().then(t=>window.__backup=t)`);
await until(`!!window.__backup && JSON.parse(window.__backup).pdfs.length===5`);

// Storage display and the offer after a ZIP export -------------------------------------------
const set = (id, value) => ev(`(()=>{const el=document.getElementById('${id}');el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
const preview = () =>
  until(`!!document.getElementById('export-preview') && !document.getElementById('export-preview').textContent.includes('berechnet')`).then(() => ev(`document.getElementById('export-preview').textContent`));
await ev(`openAdminAuthorized('export')`);
await until(`/PDF-Kopien in der App, zusammen \\d+ KB/.test(document.getElementById('copies-usage').textContent)`);
check("Speicheranzeige: 5 PDF-Kopien mit Größe", await ev(`document.getElementById('copies-usage').textContent.startsWith('5 PDF-Kopien in der App')`));
check("Klarer Hinweis: nur Kopien in der App, Dateien-App und USB-Sticks nie berührt", await ev(`document.getElementById('export-content').textContent.includes('Dateien-App, auf dem Mac, auf USB-Sticks oder in ZIP-Dateien werden nie berührt')`));
await set("export-month", "2026-03");
await preview();
await ev(`window.__shared=null;document.getElementById('export-save').click()`);
await until(`window.__shared?.name==='Inkform_2026-03.zip' && !document.getElementById('export-offer').hidden`);
check("Nach dem ZIP-Export: Angebot „Die 3 PDFs dieses Zeitraums jetzt aus der App löschen?“", await ev(`document.getElementById('export-offer-text').textContent.startsWith('Die 3 PDFs dieses Zeitraums jetzt aus der App löschen?')`));
await ev(`document.getElementById('export-offer-later').click()`);
check("„Später löschen“: nichts gelöscht, Angebot weg", (await ev(`document.getElementById('export-offer').hidden`)) && (await copies()) === 5);

// Check step ---------------------------------------------------------------------------------
await ev(`window.__shared=null;document.getElementById('export-save').click()`);
await until(`!document.getElementById('export-offer').hidden`);
await ev(`document.getElementById('export-offer-delete').click()`);
await until(`document.getElementById('copy-delete-dialog').open`);
const dialogText = await ev(`document.getElementById('copy-delete-dialog').textContent`);
check(
  "Prüfschritt: Warnung, Anleitung mit Anzahl, Hinweis auf die Dateien-App",
  dialogText.includes("3 PDF-Kopien für 01.03.2026 bis 31.03.2026") &&
    dialogText.includes("für immer weg und lassen sich nicht wiederherstellen") &&
    dialogText.includes("Prüfe deshalb vorher die ZIP-Datei") &&
    dialogText.includes("„Inkform_2026-03.zip“") &&
    dialogText.includes("Es müssen genau 3 sein") &&
    dialogText.includes("stichprobenartig") &&
    (await ev(`document.getElementById('copy-delete-never').hidden`)),
);
check("Löschen erst nach dem Kästchen möglich", await ev(`document.getElementById('copy-delete-confirm').disabled`));
await screenshot("kopien-pruefschritt");
await ev(`(()=>{const c=document.getElementById('copy-delete-checked');c.click()})()`);
check("Kästchen angehakt: Knopf aktiv", await ev(`!document.getElementById('copy-delete-confirm').disabled`));
await ev(`askWith((m)=>{window.__question=m;return false});document.getElementById('copy-delete-confirm').click()`);
check("Letzte Rückfrage nennt Anzahl und Zeitraum; Abbrechen löscht nichts", (await ev(`window.__question`)).includes("3 PDF-Kopien für 01.03.2026 bis 31.03.2026 endgültig") && (await copies()) === 5);
await ev(`askReal();document.getElementById('copy-delete-confirm').click()`);
await answer();
await until(`createIndexedDbFiles(indexedDB, ARCHIVE_DB).keys().then(k=>k.length===2)`);
check(
  "Gelöscht: 3 Kopien weg, Einträge vollständig mit Vermerk, Liste der gelöschten Kopien",
  await ev(`incomeRecords().length===5&&incomeRecords().filter(r=>r.pdfRemovedAt).map(r=>r.customer).sort().join()==='Anna März,Ben März,Cem März'&&incomeRecords().every(r=>r.customer&&r.source&&!r.pdfDeletedAt)&&readRemovedIds(localStorage).size===3`),
);
check("Angebot erledigt, Speicheranzeige aktualisiert", await ev(`document.getElementById('export-offer').hidden`).then(async (hidden) => hidden && (await until(`document.getElementById('copies-usage').textContent.startsWith('2 PDF-Kopien')`).then(() => true))));
const march = await preview();
check("Spätere Exporte bieten sie nicht mehr an und nennen sie", march.includes("Davon 0 Einwilligungen") && march.includes("Davon 3 mit dem Vermerk „PDF nicht mehr in der App“"));

// By period without a ZIP: warning --------------------------------------------------------------
await set("export-month", "2026-05");
await preview();
await ev(`document.getElementById('export-delete').click()`);
await until(`document.getElementById('copy-delete-dialog').open`);
check("Nie als ZIP exportierter Zeitraum: deutliche Warnung", await ev(`!document.getElementById('copy-delete-never').hidden&&document.getElementById('copy-delete-summary').textContent.startsWith('1 PDF-Kopie für 01.05.2026 bis 31.05.2026')`));
await ev(`document.querySelector('#copy-delete-dialog [data-copy-later]').click()`);
check("„Später löschen“ im Prüfschritt: nichts gelöscht", (await ev(`!document.getElementById('copy-delete-dialog').open`)) && (await copies()) === 2);
// Changed meanwhile (as from another window): nothing is deleted.
await ev(`document.getElementById('export-delete').click()`);
await until(`document.getElementById('copy-delete-dialog').open`);
await ev(`(()=>{const v=JSON.parse(localStorage.getItem(INCOME_KEY));const r=v.records.find(r=>r.customer==='Emil Mai');r.date='2026-06-05';r.updatedAt=new Date().toISOString();localStorage.setItem(INCOME_KEY,JSON.stringify(v))})();document.getElementById('copy-delete-checked').click();document.getElementById('copy-delete-confirm').click()`);
await answer();
await until(`document.getElementById('toast').textContent.includes('Es wurde nichts gelöscht')`);
check("Eintrag inzwischen in einen anderen Zeitraum verschoben: nichts gelöscht", (await copies()) === 2 && (await ev(`!incomeRecords().find(r=>r.customer==='Emil Mai').pdfRemovedAt&&readRemovedIds(localStorage).size===3`)));
await ev(`(()=>{const v=JSON.parse(localStorage.getItem(INCOME_KEY));const r=v.records.find(r=>r.customer==='Emil Mai');r.date='2026-05-05';r.updatedAt=new Date().toISOString();localStorage.setItem(INCOME_KEY,JSON.stringify(v))})()`);
await set("export-month", "2026-05");
await until(`!document.getElementById('export-delete').disabled`);
await ev(`document.getElementById('export-delete').click()`);
await until(`document.getElementById('copy-delete-dialog').open`);
await ev(`document.getElementById('copy-delete-checked').click();document.getElementById('copy-delete-confirm').click()`);
await answer();
await until(`createIndexedDbFiles(indexedDB, ARCHIVE_DB).keys().then(k=>k.length===1)`);
check("Nach Prüfschritt und Rückfrage gelöscht", await ev(`incomeRecords().find(r=>r.customer==='Emil Mai').pdfRemovedAt===localDate()`));

// Single entry ------------------------------------------------------------------------------------
await ev(`openAdminAuthorized('income');(()=>{const el=document.getElementById('income-filter-year');el.value='';el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
const dora = await ev(`incomeRecords().find(r=>r.customer==='Dora April').id`);
check("Einnahmenliste: Knopf nur bei vorhandener Kopie, Vermerk bei gelöschten", await ev(`document.querySelectorAll('[data-income-copy]').length===1&&!!document.querySelector('[data-income-copy="${dora}"]')&&[...document.querySelectorAll('.income-table tbody tr')].filter(tr=>tr.textContent.includes('PDF nicht mehr in der App')).length===4`));
// "PDF fehlt" in the editor would delete the copy: warning first, cancel keeps everything.
await ev(`askWith((m)=>{window.__question=m;return false});document.querySelector('[data-income-edit="${dora}"]').click()`);
await until(`document.getElementById('income-editor').open`);
await ev(`document.getElementById('income-pdf-missing').click();document.getElementById('income-edit-form').requestSubmit()`);
check("Editor: „PDF fehlt“ bei vorhandener Kopie warnt; Abbrechen ändert nichts", (await ev(`window.__question`)).includes("aus der App gelöscht") && (await ev(`!incomeRecords().find(r=>r.id==='${dora}').pdfMissing`)) && (await copies()) === 1);
await ev(`document.getElementById('income-editor').close()`);
// Marking fails (e.g. storage full): the id list is put back, no copy is deleted.
await ev(`window.__mark=incomeFeature.markCopiesRemoved;incomeFeature.markCopiesRemoved=()=>{throw Error('Speicher voll (Test)')};askWith(()=>true);document.querySelector('[data-income-copy="${dora}"]').click()`);
await until(`document.getElementById('toast').textContent.includes('PDF-Kopie nicht gelöscht')`);
check("Fehler beim Vermerken: Liste zurückgesetzt, nichts gelöscht", (await copies()) === 1 && (await ev(`readRemovedIds(localStorage).size===4&&!readRemovedIds(localStorage).has('${dora}')`)));
await ev(`incomeFeature.markCopiesRemoved=window.__mark`);
await ev(`askWith((m)=>{window.__question=m;return true});document.querySelector('[data-income-copy="${dora}"]').click()`);
await until(`createIndexedDbFiles(indexedDB, ARCHIVE_DB).keys().then(k=>k.length===0)`);
check("Einzeln: kurze Warnung mit Rückfrage, Kopie gelöscht, Eintrag bleibt", (await ev(`window.__question`)).includes("für immer weg") && (await ev(`window.__question`)).includes("Dateien-App") && (await ev(`incomeRecords().length===5&&incomeRecords().every(r=>r.pdfRemovedAt)`)));
await ev(`askReal()`);

// "PDF fehlt" in the editor, confirmed: recorded like any other deletion from the app.
await ev(`askReal();finishAdminLeave()`);
await consent("Finn", "Juni", "2026-06-06");
await ev(`openAdmin('income')`);
await until(`document.getElementById('admin-pin-dialog').open`);
await ev(`unlockAdmin()`);
await until(`adminAccess.isUnlocked() && !!document.getElementById('income-filter-year')`);
await ev(`(()=>{const el=document.getElementById('income-filter-year');el.value='';el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
const finn = await ev(`incomeRecords().find(r=>r.customer==='Finn Juni').id`);
await ev(`askWith((m)=>{window.__question=m;return true});document.querySelector('[data-income-edit="${finn}"]').click()`);
await until(`document.getElementById('income-editor').open`);
await ev(`document.getElementById('income-pdf-missing').click();document.getElementById('income-edit-form').requestSubmit()`);
await until(`!document.getElementById('income-editor').open`);
await until(`createIndexedDbFiles(indexedDB, ARCHIVE_DB).keys().then(k=>k.length===0)`);
check(
  "Editor: „PDF fehlt“ bestätigt, Kopie gelöscht, mit Vermerk und in der dauerhaften Liste",
  await ev(`(()=>{const r=incomeRecords().find(r=>r.id==='${finn}');return r.pdfMissing===true&&r.pdfRemovedAt===localDate()&&readRemovedIds(localStorage).has('${finn}')})()`),
);
await ev(`askReal()`);

// Marks are recorded for good even if the id list was lost (e.g. after an income import).
await ev(`localStorage.setItem(PDF_REMOVED_KEY,'[]');incomeFeature.refresh()`);
check("Vermerke werden in die dauerhafte Liste übernommen", await ev(`readRemovedIds(localStorage).size===6`));
await ev(`localStorage.setItem(PDF_REMOVED_KEY,'[]')`);

// A restore whose PDFs cannot be written changes nothing, also not the list of deleted copies.
await ev(`openAdminAuthorized('overview');window.__restore=exportFeature.restore;exportFeature.restore=()=>Promise.reject(Error('Speicher voll (Test)'))`);
await ev(`(()=>{const dt=new DataTransfer();dt.items.add(new File([window.__backup],'sicherung.json',{type:'application/json'}));const i=document.getElementById('backup-file');i.files=dt.files;i.dispatchEvent(new Event('change'))})()`);
await answer();
await until(`document.getElementById('toast').textContent.includes('Wiederherstellen nicht möglich')`);
check("Gescheitertes Wiederherstellen: Löschliste und Einträge unverändert", await ev(`localStorage.getItem(PDF_REMOVED_KEY)==='[]'&&incomeRecords().length===6`));
await ev(`exportFeature.restore=window.__restore`);

// Restoring the older backup brings nothing back, even without the id list -------------------------
await ev(`openAdminAuthorized('overview')`);
await ev(`(()=>{const dt=new DataTransfer();dt.items.add(new File([window.__backup],'sicherung.json',{type:'application/json'}));const i=document.getElementById('backup-file');i.files=dt.files;i.dispatchEvent(new Event('change'))})()`);
await answer();
await until(`typeof adminAccess!=='undefined' && document.readyState==='complete' && document.getElementById('toast').textContent.includes('Sicherung wiederhergestellt')`);
await ev(HELPERS);
await until(`exportFeature.copies().size===0`);
check(
  "Ältere Sicherung wiederhergestellt: gelöschte Kopien kommen nicht zurück, Vermerke bleiben",
  (await copies()) === 0 && (await ev(`incomeRecords().length===5&&incomeRecords().every(r=>r.pdfRemovedAt)&&readRemovedIds(localStorage).size===6`)),
);

check("Keine Netzwerkzugriffe außer der lokalen Vorschau", requests.every((u) => !/^https?:/.test(u) || u.startsWith(ORIGIN)));
check("Keine JavaScript- oder CSP-Fehler", errors.length === 0);
process.exit(0);
