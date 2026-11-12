// Full backup, restore and reminders in the hosted build, offline after the first load:
//   - reminder without a backup and after the chosen interval; hint for months not yet exported
//   - the backup holds settings, theme, deadlines, income, export log, interval and PDFs
//   - restore: cancel and damaged files change nothing; a confirmed restore replaces everything
//     and keeps the PIN
// Synthetic test data only.
import { writeFile } from "node:fs/promises";
import { HELPERS, OUT, ORIGIN, connect } from "./lib.mjs";

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
await until(`document.getElementById('admin-pin-dialog')?.open`);
await ev(`document.getElementById('admin-pin').value='839274';document.getElementById('admin-pin-repeat').value='839274';document.getElementById('admin-pin-form').requestSubmit()`);
await until(`adminAccess.isUnlocked()`);
await ev(`finishAdminLeave()`);
const archived = () => ev(`createIndexedDbFiles(indexedDB, ARCHIVE_DB).keys().then(k=>k.length)`);

async function consent(firstName, lastName, appointment) {
  await ev(`fillConsent({firstName:${JSON.stringify(firstName)},lastName:${JSON.stringify(lastName)},appointment:'${appointment}'});form.requestSubmit()`);
  await until(`!document.getElementById('completion-screen').hidden && !!pendingConsent && (async()=>await pendingConsent.kept)()`);
  const before = await archived();
  await ev(`document.getElementById('completion-unlock').click()`);
  await until(`document.getElementById('admin-pin-dialog').open`);
  await ev(`unlockAdmin()`);
  await until(`document.getElementById('pdf-dialog').open && !nativeShareInFlight`);
  await ev(`document.getElementById('pdf-next').click()`);
  await until(`!document.getElementById('customer-app').hidden && !localStorage.getItem(PENDING_KEY)`);
  await until(`createIndexedDbFiles(indexedDB, ARCHIVE_DB).keys().then(k=>k.length===${before + 1})`);
}
await consent("Jürgen", "Müller", "2026-02-10");
await consent("Gül", "Şahin", "2026-03-20");

const reminder = () => ev(`document.querySelector('.ad-reminder')?.textContent ?? ''`);
await until(`exportFeature.unexportedMonths([]).length===2`);
await ev(`openAdmin('overview')`);
await until(`document.getElementById('admin-pin-dialog').open`);
await ev(`unlockAdmin()`);
await until(`adminAccess.isUnlocked() && !document.getElementById('admin-app').hidden && !document.getElementById('admin-pin-dialog').open`);
let text = await reminder();
check("Erinnerung: noch keine Gesamtsicherung, Februar und März nicht als ZIP exportiert", text.includes("Es gibt noch keine Gesamtsicherung") && text.includes("Noch nicht als ZIP exportiert: Februar 2026, März 2026"));
check("Gesamtsicherung gut sichtbar in der Übersicht", await ev(`document.getElementById('admin-app').textContent.includes('Noch keine Gesamtsicherung auf diesem Gerät erstellt')&&!!document.querySelector('.ad-panel [data-admin-action="backup-restore"]')`));
await screenshot("sicherung-uebersicht");

// Export March as ZIP: only February remains in the hint.
await ev(`navigator.canShare=()=>true;navigator.share=async(d)=>{window.__shared=d.files[0]};openAdminAuthorized('export')`);
await ev(`(()=>{const el=document.getElementById('export-month');el.value='2026-03';el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
await until(`!document.getElementById('export-save').disabled`);
await ev(`document.getElementById('export-save').click()`);
await until(`window.__shared?.name==='Inkform_2026-03.zip'`);
await ev(`openAdminAuthorized('overview')`);
text = await reminder();
check("Nach dem März-Export erinnert die Übersicht nur noch an Februar", text.includes("Noch nicht als ZIP exportiert: Februar 2026.") && !text.includes("März"));

// Settings, deadlines, theme and interval that the backup must carry.
await ev(`openAdminAuthorized('studio');(l=>{l.value='Sicherungsort';l.dispatchEvent(new Event('input',{bubbles:true}))})(document.getElementById('admin-studio-location'));saveAdmin()`);
await ev(`writeRetention(localStorage,{pdfYears:10,incomeYears:null});setTheme('light');openAdminAuthorized('overview')`);
await ev(`(()=>{const el=document.getElementById('backup-interval');el.value='1';el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
check("Erinnerungsabstand gespeichert", await ev(`localStorage.getItem(BACKUP_INTERVAL_KEY)==='1'&&document.getElementById('backup-interval').value==='1'`));

// Create and save the backup -----------------------------------------------------------------
await ev(`window.__shared=null;document.querySelector('.ad-panel [data-admin-action="backup-create"]').click()`);
await until(`!document.querySelector('[data-admin-action="backup-save"]').hidden`);
check("Vor dem Speichern: Anzahl und Größe", /Sicherung bereit: 2 Einträge, 2 PDFs, \d+ KB/.test(await ev(`document.getElementById('backup-note').textContent`)));
await ev(`document.querySelector('[data-admin-action="backup-save"]').click()`);
await until(`!!window.__shared && document.getElementById('admin-app').textContent.includes('Letzte Gesamtsicherung vor 0 Tagen')`);
const name = await ev(`window.__shared.name`);
const json = await ev(`window.__shared.text()`);
await writeFile(`${OUT}/${name}`, json);
const backup = JSON.parse(json);
check(
  "Sicherung enthält Einstellungen, Farbschema, Fristen, Einnahmen, Export-Protokoll, Abstand und beide PDFs",
  /^Inkform_Sicherung_\d{4}-\d{2}-\d{2}\.json$/.test(name) &&
    backup.settings.studio.location === "Sicherungsort" &&
    backup.theme === "light" &&
    backup.retention.pdfYears === 10 &&
    backup.income.records.length === 2 &&
    backup.exports.length === 1 &&
    backup.backupDays === 1 &&
    backup.pdfs.length === 2 &&
    backup.pdfs.every((p) => Buffer.from(p.pdf, "base64").subarray(0, 5).toString() === "%PDF-"),
);
check("Keine PIN in der Sicherung", !/839274|"salt"|"hash"/.test(json));
check("Nach der Sicherung keine Sicherungs-Erinnerung", !(await reminder()).includes("Gesamtsicherung"));

// Interval: two days old is overdue with 1 day, not with 3 days.
await ev(`localStorage.setItem(LAST_BACKUP_KEY,new Date(Date.now()-2*864e5-60000).toISOString());openAdminAuthorized('overview')`);
check("Abstand 1 Tag: zwei Tage alte Sicherung wird angemahnt", (await reminder()).includes("Die letzte Gesamtsicherung ist 2 Tage alt"));
await ev(`(()=>{const el=document.getElementById('backup-interval');el.value='3';el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
check("Abstand 3 Tage: keine Erinnerung", !(await reminder()).includes("Gesamtsicherung"));

// Change data after the backup --------------------------------------------------------------
await ev(`openAdminAuthorized('income');(()=>{const el=document.getElementById('income-filter-year');el.value='';el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
await ev(`document.querySelector('[data-income-remove="'+incomeRecords().find(r=>r.customer==='Gül Şahin').id+'"]').click()`);
await until(`incomeRecords().length===1`);
await until(`createIndexedDbFiles(indexedDB, ARCHIVE_DB).keys().then(k=>k.length===1)`);
await ev(`openAdminAuthorized('studio');(l=>{l.value='Anders';l.dispatchEvent(new Event('input',{bubbles:true}))})(document.getElementById('admin-studio-location'));saveAdmin();setTheme('dark');openAdminAuthorized('overview')`);
const restore = (source) =>
  ev(`(()=>{const dt=new DataTransfer();dt.items.add(new File([${source}],'sicherung.json',{type:'application/json'}));const i=document.getElementById('backup-file');i.files=dt.files;i.dispatchEvent(new Event('change'))})()`);
const unchanged = () => ev(`incomeRecords().length===1&&JSON.parse(localStorage.getItem(SETTINGS_KEY)).studio.location==='Anders'&&localStorage.getItem(THEME_KEY)==='dark'`);

await ev(`window.__confirm=window.confirm;window.confirm=(m)=>{window.__question=m;return false}`);
await ev(`window.__shared.text().then(t=>window.__backupText=t)`);
await until(`!!window.__backupText`);
await restore(`window.__backupText`);
await until(`!!window.__question`);
const question = await ev(`window.__question`);
check(
  "Rückfrage nennt Datum, Inhalt und was ersetzt wird",
  question.includes("wiederherstellen?") && question.includes("2 Einträge, 2 PDFs") && question.includes("aktuell 1 Einträge") && question.includes("nicht rückgängig") && question.includes("Die PIN bleibt"),
);
check("Abbrechen ändert nichts", (await unchanged()) && (await archived()) === 1);

await ev(`window.confirm=window.__confirm`);
await restore(`window.__backupText.replace(/"id":"[^"]+","pdf"/,'"id":"fremd","pdf"')`);
await until(`!document.getElementById('toast').hidden&&document.getElementById('toast').textContent.includes('Wiederherstellen nicht möglich')`);
check("Beschädigte Sicherung wird abgelehnt, nichts geändert", (await ev(`document.getElementById('toast').textContent.includes('ohne passenden Einnahmeneintrag')`)) && (await unchanged()) && (await archived()) === 1);
await restore(`'{"kind":"etwas"}'`);
await until(`document.getElementById('toast').textContent.includes('keine INKFORM-Gesamtsicherung')`);
check("Fremde JSON-Datei wird abgelehnt", await unchanged());

// Confirmed restore: everything replaced, page reloads, PIN unchanged.
await restore(`window.__backupText`);
await until(`typeof adminAccess!=='undefined' && document.readyState==='complete' && document.getElementById('toast').textContent.includes('Sicherung wiederhergestellt')`);
await ev(HELPERS);
check("Nach dem Wiederherstellen neu geladen, mit Hinweis", await ev(`!window.__backupText`));
check(
  "Einnahmen, PDFs, Einstellungen, Farbschema, Fristen, Abstand und Export-Protokoll wie in der Sicherung",
  (await ev(`incomeRecords().length===2&&settings.studio.location==='Sicherungsort'&&document.documentElement.dataset.theme==='light'&&readRetention(localStorage).pdfYears===10&&localStorage.getItem(BACKUP_INTERVAL_KEY)==='1'&&readExportLog(localStorage).length===1`)) &&
    (await archived()) === 2,
);
await ev(`openAdmin('export')`);
await until(`document.getElementById('admin-pin-dialog').open`);
await ev(`unlockAdmin()`);
await until(`adminAccess.isUnlocked()`);
check("Die PIN des Geräts gilt weiter", await ev(`adminAccess.isUnlocked()`));
await ev(`(()=>{const el=document.getElementById('export-month');el.value='2026-03';el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
await until(`document.getElementById('export-preview').textContent.includes('Davon')`);
check("Wiederhergestelltes PDF steht wieder für den Export bereit", await ev(`document.getElementById('export-preview').textContent.includes('Davon 1 Einwilligung.')`));

check("Keine Netzwerkzugriffe außer der lokalen Vorschau", requests.every((u) => !/^https?:/.test(u) || u.startsWith(ORIGIN)));
check("Keine JavaScript- oder CSP-Fehler", errors.length === 0);
process.exit(0);
