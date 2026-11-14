// Retention page, deletion list, anonymization, reminders and security checklist in the
// real app (hosted build, offline after the first load). Synthetic test data only.
import { HELPERS, ORIGIN, connect } from "./lib.mjs";

const { cmd, ev, until, check, navigate, reload, screenshot, offline, requests, errors } = await connect();
await cmd("Emulation.setDeviceMetricsOverride", { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
const reset = await cmd("Page.addScriptToEvaluateOnNewDocument", {
  source: `try{localStorage.clear();sessionStorage.clear();indexedDB.deleteDatabase('inkform-pending')}catch(_){}`,
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

// Old entries (as if imported from a backup) and an unconfirmed consent from 8 days ago.
const today = await ev(`localDate()`);
const year = Number(today.slice(0, 4));
const rec = (id, date, extra = {}) => ({ id, date, artist: "Alex", customer: `Alt ${id}`, totalCents: 20000, depositCents: null, source: `Tattoo_Einwilligung_${id}.pdf`, updatedAt: new Date().toISOString(), ...extra });
const records = [rec("r1", `${year - 12}-03-01`), rec("r2", `${year - 5}-06-01`), rec("r3", `${year - 1}-01-15`), rec("r4", `${year - 11}-01-01`, { pdfMissing: true })];
await ev(`localStorage.setItem(INCOME_KEY, ${JSON.stringify(JSON.stringify({ schemaVersion: 1, records }))});
localStorage.setItem(PENDING_KEY, JSON.stringify({version:1,id:'offen-1',filename:'Tattoo_Einwilligung_offen.pdf',pages:3,income:${JSON.stringify(rec("offen-1", today))},savedAt:new Date(Date.now()-8*864e5).toISOString()}))`);
await reload();
await ev(HELPERS);
check("Unbestätigte Einwilligung hält „Vielen Dank“", await ev(`!document.getElementById('completion-screen').hidden`));
await ev(`document.getElementById('completion-unlock').click()`);
await until(`document.getElementById('admin-pin-dialog').open`);
await ev(`unlockAdmin()`);
await until(`document.getElementById('pdf-dialog').open`);
await ev(`document.getElementById('pdf-dialog').close();openAdminAuthorized('overview')`);
check("Übersicht erinnert an die seit 8 Tagen offene Einwilligung", await ev(`document.querySelector('.ad-reminder')?.textContent.includes('seit 8 Tagen')`));
await ev(`document.querySelector('[data-admin-action="pending"]').click()`);
check("Knopf „Offene Einwilligung ablegen“ öffnet die offene Einwilligung", await ev(`document.getElementById('pdf-dialog').open&&pdfArtifact===pendingConsent`));
await ev(`document.getElementById('pdf-dialog').close()`);
check("Sicherheits-Checkliste mit Gerätecode, Geführtem Zugriff, iCloud und Warnung „noch keine Sicherung“", await ev(`(()=>{const t=document.getElementById('admin-app').textContent;return t.includes('Geführter Zugriff')&&t.includes('Gerätecode')&&t.includes('iCloud-Backup')&&t.includes('Noch keine Gesamtsicherung')})()`));
await screenshot("aufbewahrung-uebersicht");

// Retention page without deadlines: nothing listed.
// Deadlines are saved when a field is left (change event); the list follows.
const deadlines = async ({ pdf, income }) => {
  await ev(`(()=>{for(const [id,v] of [['retention-pdf-years',${JSON.stringify(pdf ?? null)}],['retention-income-years',${JSON.stringify(income ?? null)}]])if(v!==null){const el=document.getElementById(id);el.value=v;el.dispatchEvent(new Event('change',{bubbles:true}))}})()`);
  await ev(`new Promise(r=>setTimeout(r,50))`);
};
await ev(`openAdminAuthorized('retention')`);
check("Ohne Fristen wird nichts zur Löschung oder Anonymisierung angezeigt", await ev(`!document.querySelector('[data-retention-deleted]')&&document.getElementById('retention-content').textContent.includes('Keine Frist eingetragen')`));
await deadlines({ pdf: '0' });
check("Ungültige Frist wird abgelehnt", await ev(`document.getElementById('toast').textContent.includes('ganze Jahre')`));
await deadlines({ pdf: '3', income: '10' });
check("Löschliste zeigt nur fällige PDFs (älter als 3 Jahre, ohne „PDF fehlt“)", await ev(`JSON.stringify([...document.querySelectorAll('#retention-pdf-list [data-retention-deleted]')].map(b=>b.dataset.retentionDeleted))===JSON.stringify(['r1','r2'])`));
check("Kein eigener Speichern-Knopf für Fristen", await ev(`!document.querySelector('[data-retention-action="save"]')`));
// Typed like on the iPad, then straight to another page: the deadline is kept.
await ev(`(el=>{el.focus();el.select()})(document.getElementById('retention-income-years'))`);
await cmd("Input.insertText", { text: "12" });
const nav = await ev(`(()=>{const r=document.querySelector('#admin-nav [data-admin-page="overview"]').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
for (const type of ["mousePressed", "mouseReleased"]) await cmd("Input.dispatchMouseEvent", { type, x: nav.x, y: nav.y, button: "left", clickCount: 1 });
await until(`adminPage==='overview'`);
check("Frist eingetippt, gleich die Seite gewechselt: gespeichert", await ev(`readRetention(localStorage).incomeYears===12&&readRetention(localStorage).pdfYears===3`));
await ev(`openAdminAuthorized('retention')`);
await deadlines({ income: '10' });
// Still in the field (no change yet): already saved, so a lock or reload keeps it.
await ev(`(el=>{el.focus();el.select()})(document.getElementById('retention-income-years'))`);
await cmd("Input.insertText", { text: "11" });
check("Beim Eintippen schon gespeichert, ohne das Feld zu verlassen", await ev(`readRetention(localStorage).incomeYears===11&&document.activeElement.id==='retention-income-years'`));
// A press on a button of the same panel while the field is left: the click still arrives.
const link = await ev(`(()=>{const b=document.querySelector('#retention-content [data-admin-page="backup"]');b.scrollIntoView({block:'center',behavior:'instant'});const r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
await cmd("Input.dispatchMouseEvent", { type: "mousePressed", x: link.x, y: link.y, button: "left", clickCount: 1 });
await ev(`new Promise(r=>setTimeout(r,100))`);
await cmd("Input.dispatchMouseEvent", { type: "mouseReleased", x: link.x, y: link.y, button: "left", clickCount: 1 });
await until(`adminPage==='backup'`);
check("Frist geändert, dann „Vorher Gesamtsicherung erstellen“ gedrückt: Knopf wirkt, Frist gespeichert", await ev(`readRetention(localStorage).incomeYears===11`));
await ev(`openAdminAuthorized('retention')`);
await deadlines({ income: '10' });
await screenshot("aufbewahrung-seite");
await ev(`document.querySelector('[data-retention-deleted="r1"]').click()`);
check("Als gelöscht markiert: Datum gespeichert, Eintrag verschwindet aus der Liste", await ev(`incomeRecords().find(r=>r.id==='r1').pdfDeletedAt===localDate()&&!document.querySelector('[data-retention-deleted="r1"]')`));

// Anonymization after 10 years: r1 and r4.
check("Vor dem Anonymisieren: Verweis auf die Gesamtsicherung statt auf eine Einnahmen-Datei", await ev(`(b=>!!b&&b.textContent.trim()===t('retention.backupFirst')&&!document.querySelector('#retention-content [data-income-action="backup"]'))(document.querySelector('#retention-content [data-admin-page="backup"]'))`));
check("Vorschau: 2 Einträge zur Anonymisierung", await ev(`document.querySelector('[data-retention-action="anonymize"]').textContent.includes('2 Einträge')`));
await ev(`document.querySelector('[data-retention-action="anonymize"]').click()`);
check("Anonymisiert: Name und PDF-Dateiname entfernt, Beträge erhalten", await ev(`(()=>{const r=incomeRecords();const a=r.filter(x=>x.anonymizedAt);return a.length===2&&a.every(x=>x.customer==='anonymisiert'&&x.source===''&&x.totalCents===20000)&&r.find(x=>x.id==='r2').customer==='Alt r2'})()`));
check("Zweiter Durchlauf findet nichts mehr", await ev(`document.querySelector('[data-retention-action="anonymize"]').disabled`));
// An entry whose PDF may still exist waits; anonymized entries stay anonymized.
await deadlines({ income: '4' });
check("Eintrag mit noch vorhandenem PDF wird nicht anonymisiert, sondern als wartend angezeigt", await ev(`document.querySelector('[data-retention-action="anonymize"]').disabled&&document.getElementById('retention-content').textContent.includes('1 weitere Einträge warten')&&incomeRecords().find(r=>r.id==='r2').customer==='Alt r2'`));
await deadlines({ income: '10' });
await ev(`openAdminAuthorized('income');(()=>{const el=document.getElementById('income-filter-year');el.value='';el.dispatchEvent(new Event('change',{bubbles:true}))})();document.querySelector('[data-income-edit="r1"]').click()`);
check("Bearbeiten eines anonymisierten Eintrags: Name und Dateiname gesperrt", await ev(`document.getElementById('income-customer').readOnly&&document.getElementById('income-source').readOnly&&!document.getElementById('income-anonymized-note').hidden`));
await ev(`document.getElementById('income-customer').readOnly=false;document.getElementById('income-customer').value='Alt r1';document.getElementById('income-edit-form').requestSubmit()`);
check("Auch mit umgangener Sperre wird kein Name gespeichert", await ev(`!document.getElementById('income-edit-error').hidden&&incomeRecords().find(r=>r.id==='r1').customer==='anonymisiert'`));
await ev(`document.getElementById('income-editor').close();openAdminAuthorized('retention')`);
await reload();
await ev(HELPERS);
await until(`!document.getElementById('completion-screen').hidden`);
check("Fristen bleiben nach dem Neuladen erhalten", await ev(`JSON.parse(localStorage.getItem('inkform.retention.v1')).pdfYears===3`));

// Backup date in the checklist.
await ev(`document.getElementById('completion-unlock').click()`);
await until(`document.getElementById('admin-pin-dialog').open`);
await ev(`unlockAdmin()`);
await until(`document.getElementById('pdf-dialog').open`);
await ev(`document.getElementById('pdf-missing').click()`);
await until(`!document.getElementById('customer-app').hidden`);
await ev(`openAdmin('income')`);
await until(`document.getElementById('admin-pin-dialog').open`);
await ev(`unlockAdmin()`);
await until(`!!document.querySelector('[data-income-action="backup"]')`);
await ev(`openAdminAuthorized('backup');navigator.canShare=()=>true;navigator.share=async()=>{};document.querySelector('[data-admin-action="backup-create"]').click()`);
await until(`!document.querySelector('[data-backup-ready]').hidden`);
await ev(`document.querySelector('[data-admin-action="backup-save"]').click()`);
await until(`document.getElementById('admin-app').textContent.includes('Letzte Gesamtsicherung heute')`);
check("Nach der Gesamtsicherung: „heute“, keine Erinnerung an offene Einwilligung oder Sicherung", await ev(`!document.querySelector('.ad-reminder')?.textContent.includes('seit')&&!document.querySelector('.ad-reminder')?.textContent.includes('Gesamtsicherung')`));
check("Einnahmenliste zeigt „PDF gelöscht am“", await ev(`(openAdminAuthorized('income'),(()=>{const el=document.getElementById('income-filter-year');el.value='';el.dispatchEvent(new Event('change',{bubbles:true}));return document.querySelector('.income-table').textContent.includes('PDF gelöscht am')})())`));
await ev(`finishAdminLeave()`);

check("Keine Netzwerkzugriffe außer der lokalen Vorschau", requests.every((u) => !/^https?:/.test(u) || u.startsWith(ORIGIN)));
check("Keine JavaScript- oder CSP-Fehler", errors.length === 0);
process.exit(0);
