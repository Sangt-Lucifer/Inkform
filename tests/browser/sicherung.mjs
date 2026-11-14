// Full backup, restore and reminders in the hosted build, offline after the first load:
//   - reminder without a backup and after the chosen interval; hint for months not yet exported
//   - the backup holds settings, theme, deadlines, income, export log, interval and PDFs
//   - restore: cancel and damaged files change nothing; a confirmed restore replaces everything
//     and keeps the PIN
//   - own logo: shrunk on upload, kept across restarts, part of the backup; an older backup
//     without a logo leaves it in place
// Synthetic test data only.
import { writeFile } from "node:fs/promises";
import { HELPERS, OUT, ORIGIN, connect } from "./lib.mjs";

const { cmd, ev, until, check, navigate, reload, screenshot, offline, requests, errors, answer } = await connect();
await cmd("Emulation.setDeviceMetricsOverride", { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
const reset = await cmd("Page.addScriptToEvaluateOnNewDocument", {
  source: `try{localStorage.clear();sessionStorage.clear();indexedDB.deleteDatabase('inkform-pending');indexedDB.deleteDatabase('inkform-archive');indexedDB.deleteDatabase('inkform-logo')}catch(_){}`,
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
check("Übersicht zeigt den Stand der Gesamtsicherung und führt zu „Sichern & Wiederherstellen“", await ev(`document.getElementById('admin-app').textContent.includes('Noch keine Gesamtsicherung auf diesem Gerät erstellt')&&!!document.querySelector('.ad-panel [data-admin-page="backup"]')&&!document.querySelector('[data-admin-action="backup-restore"]')`));
await ev(`document.querySelector('.ad-panel [data-admin-page="backup"]').click()`);
check(
  "Ein Ort: Sichern, Wiederherstellen mit einer Dateiauswahl, Studio-Einstellungen weitergeben",
  await ev(`adminPage==='backup'&&document.querySelectorAll('[data-admin-action="backup-create"]').length===1&&document.querySelectorAll('[data-admin-action="backup-restore"]').length===1&&!!document.querySelector('[data-admin-action="export-json"]')&&!!document.querySelector('[data-admin-action="export-html"]')&&!document.querySelector('[data-admin-action="import-json"]')`),
);
await ev(`openAdminAuthorized('ipad')`);
check("„iPad & Einstellungen“ mit Farbschema, ohne Sicherung und Dateien", await ev(`!document.querySelector('#admin-section [data-admin-action^="backup"],#admin-section [data-admin-action^="export"]')&&!!document.querySelector('[data-set-theme="dark"]')&&document.querySelector('#admin-nav [aria-current="page"]').textContent.trim()==='iPad & Einstellungen'`));
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
await ev(`writeRetention(localStorage,{pdfYears:10,incomeYears:null});setTheme('light');openAdminAuthorized('backup')`);
await ev(`(()=>{const el=document.getElementById('backup-interval');el.value='1';el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
check("Erinnerungsabstand gespeichert", await ev(`localStorage.getItem(BACKUP_INTERVAL_KEY)==='1'&&document.getElementById('backup-interval').value==='1'`));

// Own logo: an invented 900 × 300 JPEG, stored as a PNG of at most 512 pixels -----------------
const chooseLogo = (file) =>
  ev(`(async()=>{const dt=new DataTransfer();dt.items.add(await (${file}));const i=document.getElementById('logo-file');i.files=dt.files;i.dispatchEvent(new Event('change'))})()`);
const toastSays = (text) => until(`!document.getElementById('toast').hidden&&document.getElementById('toast').textContent.includes(${JSON.stringify(text)})`);
const ownLogo = () =>
  ev(`storedLogo().then(b=>{const s=b&&pngSize(b);const shown=[...document.querySelectorAll('.studio-logo')].every(i=>i.src.startsWith('blob:'))&&document.querySelector('link[rel="icon"]').href.startsWith('blob:');return s?s.width+'x'+s.height+(shown?' sichtbar':' unsichtbar'):'keins'})`);
await ev(`openAdminAuthorized('studio')`);
check("Logo-Bereich unter Studio & Kontakt mit Hinweis auf das eigene App-Symbol", await ev(`!!document.querySelector('[data-admin-action="logo-choose"]')&&document.getElementById('admin-app').textContent.includes('Für den Home-Bildschirm gibt es darunter ein eigenes App-Symbol')`));
// Report with the logo drawn on page 1 (addImage with the logo alias), and the image it embeds.
const reportLogo = (width, height) =>
  ev(`(async()=>{let drawn=false;const Original=window.jspdf.jsPDF;window.jspdf.jsPDF=function(...args){const doc=new Original(...args);const add=doc.addImage.bind(doc);doc.addImage=(...a)=>{if(a[6]==='studio-logo'&&doc.getCurrentPageInfo().pageNumber===1)drawn=true;return add(...a)};return doc};try{const t=await incomeFeature.reportPdf(incomeRecords(),'Test').text();return drawn&&t.includes('/Width '+${width})&&t.includes('/Height '+${height})}finally{window.jspdf.jsPDF=Original}})()`);
check("Einnahmenübersicht zeigt das eingebaute Logo", await reportLogo("builtInPdfLogo.width", "builtInPdfLogo.height"));
await chooseLogo(`new File(['%PDF-1.7 kein Bild'],'logo.png',{type:'image/png'})`);
await toastSays("Logo nicht übernommen");
check("Falsche Datei als Logo abgelehnt", (await ev(`document.getElementById('toast').textContent.includes('PNG- oder JPEG')`)) && (await ownLogo()) === "keins");
await chooseLogo(`new Promise(r=>{const c=document.createElement('canvas');c.width=900;c.height=300;const g=c.getContext('2d');g.fillStyle='#c33';g.fillRect(0,0,900,300);g.fillStyle='#fff';g.fillRect(100,100,300,100);c.toBlob(b=>r(new File([b],'logo.jpg',{type:'image/jpeg'})),'image/jpeg',0.9)})`);
await toastSays("Logo gespeichert");
check("Logo verkleinert gespeichert und überall angezeigt", (await ownLogo()) === "512x171 sichtbar" && (await ev(`!!document.querySelector('[data-admin-action="logo-remove"]')`)));
check("Einnahmenübersicht zeigt das eigene Logo", await reportLogo(512, 171));
await writeFile(`${OUT}/einnahmen-mit-logo.pdf`, Buffer.from(await ev(`blobBase64(incomeFeature.reportPdf(incomeRecords(),'Test'))`), "base64"));
await writeFile(`${OUT}/einwilligung-eingebautes-logo.pdf`, Buffer.from(await ev(`createIndexedDbFiles(indexedDB, ARCHIVE_DB).keys().then(k=>createIndexedDbFiles(indexedDB, ARCHIVE_DB).get(k[0])).then(blobBase64)`), "base64"));
await ev(`document.querySelector('.logo-setting').closest('.ad-panel').scrollIntoView({block:'start'});new Promise(r=>setTimeout(r,300))`);
await screenshot("logo-studio");
await reload();
await ev(HELPERS);
await until(`document.querySelector('.studio-logo').src.startsWith('blob:')&&document.querySelector('.studio-logo').complete`);
check("Nach dem Neustart (offline) ist das Logo noch da", (await ownLogo()) === "512x171 sichtbar" && (await ev(`document.querySelector('.studio-logo').naturalWidth===512`)));
await ev(`openAdmin('studio')`);
await until(`document.getElementById('admin-pin-dialog').open`);
await ev(`unlockAdmin()`);
await until(`adminAccess.isUnlocked() && !document.getElementById('admin-pin-dialog').open`);
// Drawn before the stored logo has loaded, the panel follows as soon as it has.
await ev(`showLogo(null)`);
const removeShown = () => ev(`!!document.querySelector('[data-admin-action="logo-remove"]')`);
const beforeLoad = await removeShown();
await ev(`loadLogo()`);
await until(`!!document.querySelector('[data-admin-action="logo-remove"]')`);
check("Logo-Bereich zeigt „Logo entfernen“, sobald das gespeicherte Logo geladen ist", !beforeLoad && (await ownLogo()) === "512x171 sichtbar");
await ev(`openAdminAuthorized('backup');navigator.canShare=()=>true;navigator.share=async(d)=>{window.__shared=d.files[0];window.__shareKeys=Object.keys(d).join()}`);

// Create and save the backup -----------------------------------------------------------------
await ev(`adminDraft.studio.location='Ungespeichert';updateAdminChrome();window.__shared=null;document.querySelector('.ad-panel [data-admin-action="backup-create"]').click()`);
check(
  "Offene Änderungen: keine Sicherung, Hinweis am Knopf",
  await ev(`document.getElementById('backup-note').textContent===t('backup.unsaved')&&document.querySelector('[data-backup-ready]').hidden&&!window.__shared`),
);
await ev(`adminDraft=clone(settings);renderAdminSection()`);
await ev(`window.__shared=null;document.querySelector('.ad-panel [data-admin-action="backup-create"]').click()`);
await until(`!document.querySelector('[data-backup-ready]').hidden`);
check("Vor dem Speichern: Anzahl und Größe", /✓ Sicherung bereit: 2 Einträge, 2 PDFs, \d+ KB/.test(await ev(`document.getElementById('backup-summary').textContent`)));
await ev(`document.querySelector('[data-admin-action="backup-save"]').click()`);
await until(`!!window.__shared && document.getElementById('admin-app').textContent.includes('Letzte Gesamtsicherung heute')`);
// One tap: a backup ready while the tap still counts opens the share sheet at once.
await ev(`window.__firstShared=window.__shared;window.__shared=null;openAdminAuthorized('backup')`);
const panelTop = () => ev(`Math.round(document.getElementById('backup-flow').getBoundingClientRect().top)`);
await ev(`document.getElementById('backup-flow').scrollIntoView({block:'center'})`);
const topBefore = await panelTop();
await cmd("Runtime.evaluate", { expression: `document.querySelector('.ad-panel [data-admin-action="backup-create"]').click()`, userGesture: true });
await until(`!!window.__shared`);
check("Ein Tipp genügt, wenn die Sicherung schnell bereit ist: Teilen öffnet sofort, ohne Sprung", (await ev(`[window.__shared,window.__firstShared].every(f=>/^\\d{8}_\\d{4}_Inkform_Sicherung\\.json$/.test(f.name))`)) && Math.abs((await panelTop()) - topBefore) < 120);
check("Sicherung: nur die Datei ans Teilen-Menü, kein Titel (keine zusätzliche Textdatei)", (await ev(`window.__shareKeys`)) === "files");
await ev(`window.__shared=window.__firstShared`);
const name = await ev(`window.__shared.name`);
const json = await ev(`window.__shared.text()`);
await writeFile(`${OUT}/${name}`, json);
const backup = JSON.parse(json);
const stampOf = (iso) => {
  const d = new Date(iso), two = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}_${two(d.getHours())}${two(d.getMinutes())}`;
};
check(
  "Dateiname Datum_Uhrzeit_Inkform_Sicherung; Sicherung enthält Einstellungen, Farbschema, Fristen, Einnahmen, Export-Protokoll, Abstand und beide PDFs",
  /^\d{8}_\d{4}_Inkform_Sicherung\.json$/.test(name) &&
    name.slice(0, 13) === stampOf(backup.createdAt) &&
    backup.settings.studio.location === "Sicherungsort" &&
    backup.theme === "light" &&
    backup.retention.pdfYears === 10 &&
    backup.income.records.length === 2 &&
    backup.exports.length === 1 &&
    backup.backupDays === 1 &&
    backup.pdfs.length === 2 &&
    backup.pdfs.every((p) => Buffer.from(p.pdf, "base64").subarray(0, 5).toString() === "%PDF-"),
);
check("Sicherung enthält das Logo (PNG, 512 × 171)", backup.schemaVersion === 3 && Buffer.from(backup.logo, "base64").readUInt32BE(16) === 512 && Buffer.from(backup.logo, "base64").readUInt32BE(20) === 171);
check("Keine PIN in der Sicherung", !/839274|"salt"|"hash"/.test(json));
await ev(`openAdminAuthorized('overview')`);
check("Nach der Sicherung keine Sicherungs-Erinnerung", (await ev(`!!document.querySelector('.ad-stats')`)) && !(await reminder()).includes("Gesamtsicherung"));
check("Status nach der Sicherung: „heute“ statt „vor 0 Tagen“", await ev(`document.getElementById('admin-app').textContent.includes(t('backup.ageToday'))&&!document.getElementById('admin-app').textContent.includes('vor 0 Tagen')`));
// Page switched while the share sheet is open: no error, the message comes as a toast.
await ev(`openAdminAuthorized('backup');navigator.share=()=>new Promise(r=>{window.__finishShare=r});document.querySelector('[data-admin-action="backup-create"]').click()`);
await until(`!document.querySelector('[data-backup-ready]').hidden`);
await ev(`document.querySelector('[data-admin-action="backup-save"]').click();openAdminAuthorized('overview');window.__finishShare()`);
await until(`document.getElementById('toast').textContent.includes('Gesichert')`);
check("Seite während des Teilens gewechselt: Meldung als Hinweis, Übersicht zeigt „heute“", await ev(`adminPage==='overview'&&document.getElementById('admin-app').textContent.includes(t('backup.ageToday'))`));
await ev(`navigator.share=async(d)=>{window.__shared=d.files[0]}`);

// Interval: two days old is overdue with 1 day, not with 3 days.
await ev(`localStorage.setItem(LAST_BACKUP_KEY,new Date(Date.now()-2*864e5-60000).toISOString());openAdminAuthorized('overview')`);
check("Abstand 1 Tag: zwei Tage alte Sicherung wird angemahnt", (await reminder()).includes("Die letzte Gesamtsicherung ist 2 Tage alt"));
await ev(`openAdminAuthorized('backup');(()=>{const el=document.getElementById('backup-interval');el.value='3';el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
await ev(`openAdminAuthorized('overview')`);
check("Abstand 3 Tage: keine Erinnerung", !(await reminder()).includes("Gesamtsicherung"));
await ev(`(()=>{const d=new Date();d.setHours(0,0,0,0);localStorage.setItem(LAST_BACKUP_KEY,new Date(d-60000).toISOString());openAdminAuthorized('overview')})()`);
check("Sicherung kurz vor Mitternacht: nicht „heute“", await ev(`!document.getElementById('admin-app').textContent.includes(t('backup.ageToday'))`));

// Change data after the backup --------------------------------------------------------------
await ev(`openAdminAuthorized('income');(()=>{const el=document.getElementById('income-filter-year');el.value='';el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
await ev(`document.querySelector('[data-income-remove="'+incomeRecords().find(r=>r.customer==='Gül Şahin').id+'"]').click()`);
await answer();
await until(`incomeRecords().length===1`);
await until(`createIndexedDbFiles(indexedDB, ARCHIVE_DB).keys().then(k=>k.length===1)`);
await ev(`openAdminAuthorized('studio');askWith(()=>true);document.querySelector('[data-admin-action="logo-remove"]').click();askReal()`);
await toastSays("Eigenes Logo entfernt");
check("Logo entfernt: wieder das eingebaute", (await ownLogo()) === "keins" && (await ev(`document.querySelector('.studio-logo').src.startsWith('data:image/png')`)));
await ev(`openAdminAuthorized('studio');(l=>{l.value='Anders';l.dispatchEvent(new Event('input',{bubbles:true}))})(document.getElementById('admin-studio-location'));saveAdmin();setTheme('dark');openAdminAuthorized('overview')`);
const restore = (source) =>
  ev(`(()=>{const dt=new DataTransfer();dt.items.add(new File([${source}],'sicherung.json',{type:'application/json'}));const i=document.getElementById('backup-file');i.files=dt.files;i.dispatchEvent(new Event('change'))})()`);
const unchanged = () => ev(`incomeRecords().length===1&&JSON.parse(localStorage.getItem(SETTINGS_KEY)).studio.location==='Anders'&&localStorage.getItem(THEME_KEY)==='dark'`);

await ev(`askWith((m)=>{window.__question=m;return false})`);
await ev(`window.__shared.text().then(t=>window.__backupText=t)`);
await until(`!!window.__backupText`);
await restore(`window.__backupText`);
await until(`!!window.__question`);
const question = await ev(`window.__question`);
check(
  "Rückfrage nennt Datum, Inhalt und was ersetzt wird",
  question.includes("wiederherstellen?") && question.includes("2 Einträge, 2 PDFs") && question.includes("aktuell 1 Einträge") && question.includes("nicht rückgängig") && question.includes("Die PIN bleibt"),
);
check("Abbrechen ändert nichts", (await unchanged()) && (await archived()) === 1 && (await ownLogo()) === "keins");

await ev(`askReal()`);
await restore(`window.__backupText.replace(/"id":"[^"]+","pdf"/,'"id":"fremd","pdf"')`);
await until(`!document.getElementById('toast').hidden&&document.getElementById('toast').textContent.includes('Wiederherstellen nicht möglich')`);
check("Beschädigte Sicherung wird abgelehnt, nichts geändert", (await ev(`document.getElementById('toast').textContent.includes('ohne passenden Einnahmeneintrag')`)) && (await unchanged()) && (await archived()) === 1);
await restore(`'{"kind":"etwas"}'`);
await until(`document.getElementById('toast').textContent.includes('weder eine INKFORM-Gesamtsicherung noch')`);
check("Fremde JSON-Datei wird abgelehnt", await unchanged());

// A restore that fails after the logo was written puts the device's own logo back.
await ev(`window.__restorePdfs=exportFeature.restore;exportFeature.restore=()=>Promise.reject(Error('Testfehler'));askWith(()=>true)`);
await restore(`window.__backupText`);
await toastSays("Testfehler");
check("Scheitert das Wiederherstellen nach dem Logo, bleibt das Logo des Geräts", (await ownLogo()) === "keins" && (await unchanged()));
await ev(`exportFeature.restore=window.__restorePdfs`);
// Storage full while the settings are written, after PDFs and the list of deleted copies: every
// key goes back, so the income list does not change without its settings.
await ev(`window.__set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===SETTINGS_KEY&&!window.__failed){window.__failed=true;throw new DOMException('voll','QuotaExceededError')}return window.__set.call(this,k,v)}`);
await restore(`window.__backupText`);
await toastSays("voll");
check("Speicher voll beim Wiederherstellen: Einnahmen, Einstellungen und Logo wie vorher", (await unchanged()) && (await ownLogo()) === "keins");
await ev(`Storage.prototype.setItem=window.__set;askReal()`);

// Confirmed restore: everything replaced, page reloads, PIN unchanged.
await restore(`window.__backupText`);
await answer();
await until(`typeof adminAccess!=='undefined' && document.readyState==='complete' && document.getElementById('toast').textContent.includes('Sicherung wiederhergestellt')`);
await ev(HELPERS);
check("Nach dem Wiederherstellen neu geladen, mit Hinweis", await ev(`!window.__backupText`));
check(
  "Einnahmen, PDFs, Einstellungen, Farbschema, Fristen, Abstand und Export-Protokoll wie in der Sicherung",
  (await ev(`incomeRecords().length===2&&settings.studio.location==='Sicherungsort'&&document.documentElement.dataset.theme==='light'&&readRetention(localStorage).pdfYears===10&&localStorage.getItem(BACKUP_INTERVAL_KEY)==='1'&&readExportLog(localStorage).length===1`)) &&
    (await archived()) === 2,
);
await until(`document.querySelector('.studio-logo').src.startsWith('blob:')`);
check("Logo wie in der Sicherung", (await ownLogo()) === "512x171 sichtbar");
await ev(`openAdmin('export')`);
await until(`document.getElementById('admin-pin-dialog').open`);
await ev(`unlockAdmin()`);
await until(`adminAccess.isUnlocked()`);
check("Die PIN des Geräts gilt weiter", await ev(`adminAccess.isUnlocked()`));
await ev(`(()=>{const el=document.getElementById('export-month');el.value='2026-03';el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
await until(`document.getElementById('export-preview').textContent.includes('Davon')`);
check("Wiederhergestelltes PDF steht wieder für den Export bereit", await ev(`document.getElementById('export-preview').textContent.includes('Davon 1 Einwilligung.')`));

// A backup from before the logo (version 1) still restores and leaves the logo in place.
const old = JSON.parse(json);
old.schemaVersion = 1;
delete old.logo;
await ev(`window.__oldBackup=${JSON.stringify(JSON.stringify(old))}`);
await restore(`window.__oldBackup`);
await answer();
await until(`typeof adminAccess!=='undefined' && !window.__oldBackup && document.readyState==='complete' && document.getElementById('toast').textContent.includes('Sicherung wiederhergestellt')`);
await ev(HELPERS);
await until(`document.querySelector('.studio-logo').src.startsWith('blob:')`);
check("Ältere Sicherung ohne Logo: wiederhergestellt, Logo bleibt", (await ev(`incomeRecords().length===2`)) && (await ownLogo()) === "512x171 sichtbar");

// A copy deleted in another window while the question is open stays deleted after the restore.
await ev(`openAdmin('backup')`);
await until(`document.getElementById('admin-pin-dialog').open`);
await ev(`unlockAdmin()`);
await until(`adminAccess.isUnlocked() && !!document.getElementById('backup-file')`);
await ev(`window.__again=${JSON.stringify(json)};askWith(()=>{window.__gone=incomeRecords()[0].id;sessionStorage.setItem('probe.gone',window.__gone);addRemovedIds(localStorage,[window.__gone]);return true})`);
await restore(`window.__again`);
await until(`typeof adminAccess!=='undefined' && !window.__again && document.readyState==='complete' && document.getElementById('toast').textContent.includes('Sicherung wiederhergestellt')`);
await ev(HELPERS);
check(
  "Während der Rückfrage anderswo gelöschte Kopie bleibt gelöscht",
  await ev(`(async()=>{const id=sessionStorage.getItem('probe.gone');const keys=await createIndexedDbFiles(indexedDB, ARCHIVE_DB).keys();return !!id&&!keys.some(k=>String(k).startsWith(id))&&!!incomeRecords().find(r=>r.id===id).pdfRemovedAt&&readRemovedIds(localStorage).has(id)&&keys.length===1})()`),
);

check("Keine Netzwerkzugriffe außer der lokalen Vorschau", requests.every((u) => !/^https?:/.test(u) || u.startsWith(ORIGIN)));
check("Keine JavaScript- oder CSP-Fehler", errors.length === 0);
process.exit(0);
