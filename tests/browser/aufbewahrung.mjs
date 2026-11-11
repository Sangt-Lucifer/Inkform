// Phase 4: retention page, deletion list, anonymization, reminders and security checklist in the
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
check("Sicherheits-Checkliste mit Gerätecode, Geführtem Zugriff, iCloud und Warnung „noch keine Sicherung“", await ev(`(()=>{const t=document.getElementById('admin-app').textContent;return t.includes('Geführter Zugriff')&&t.includes('Gerätecode')&&t.includes('iCloud-Backup')&&t.includes('Noch keine Einnahmen-Sicherung')})()`));
await screenshot("aufbewahrung-uebersicht");

// Retention page without deadlines: nothing listed.
await ev(`openAdminAuthorized('retention')`);
check("Ohne Fristen wird nichts zur Löschung oder Anonymisierung angezeigt", await ev(`!document.querySelector('[data-retention-deleted]')&&document.getElementById('retention-content').textContent.includes('Keine Frist eingetragen')`));
await ev(`document.getElementById('retention-pdf-years').value='0';document.querySelector('[data-retention-action="save"]').click()`);
check("Ungültige Frist wird abgelehnt", await ev(`document.getElementById('toast').textContent.includes('ganze Jahre')`));
await ev(`document.getElementById('retention-pdf-years').value='3';document.getElementById('retention-income-years').value='10';document.querySelector('[data-retention-action="save"]').click()`);
check("Löschliste zeigt nur fällige PDFs (älter als 3 Jahre, ohne „PDF fehlt“)", await ev(`JSON.stringify([...document.querySelectorAll('[data-retention-deleted]')].map(b=>b.dataset.retentionDeleted))===JSON.stringify(['r1','r2'])`));
await screenshot("aufbewahrung-seite");
await ev(`document.querySelector('[data-retention-deleted="r1"]').click()`);
check("Als gelöscht markiert: Datum gespeichert, Eintrag verschwindet aus der Liste", await ev(`incomeRecords().find(r=>r.id==='r1').pdfDeletedAt===localDate()&&!document.querySelector('[data-retention-deleted="r1"]')`));

// Anonymization after 10 years: r1 and r4.
check("Vorschau: 2 Einträge zur Anonymisierung", await ev(`document.querySelector('[data-retention-action="anonymize"]').textContent.includes('2 Einträge')`));
await ev(`document.querySelector('[data-retention-action="anonymize"]').click()`);
check("Anonymisiert: Name und PDF-Dateiname entfernt, Beträge erhalten", await ev(`(()=>{const r=incomeRecords();const a=r.filter(x=>x.anonymizedAt);return a.length===2&&a.every(x=>x.customer==='anonymisiert'&&x.source===''&&x.totalCents===20000)&&r.find(x=>x.id==='r2').customer==='Alt r2'})()`));
check("Zweiter Durchlauf findet nichts mehr", await ev(`document.querySelector('[data-retention-action="anonymize"]').disabled`));
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
await ev(`document.querySelector('[data-income-action="backup"]').click();openAdminAuthorized('overview')`);
check("Nach der Sicherung: Checkliste zeigt „vor 0 Tagen“, keine Erinnerung an offene Einwilligung", await ev(`document.getElementById('admin-app').textContent.includes('Letzte Einnahmen-Sicherung vor 0 Tagen')&&!document.querySelector('.ad-reminder')?.textContent.includes('seit')`));
check("Einnahmenliste zeigt „PDF gelöscht am“", await ev(`(openAdminAuthorized('income'),(()=>{const el=document.getElementById('income-filter-year');el.value='';el.dispatchEvent(new Event('change',{bubbles:true}));return document.querySelector('.income-table').textContent.includes('PDF gelöscht am')})())`));
await ev(`finishAdminLeave()`);

check("Keine Netzwerkzugriffe außer der lokalen Vorschau", requests.every((u) => !/^https?:/.test(u) || u.startsWith(ORIGIN)));
check("Keine JavaScript- oder CSP-Fehler", errors.length === 0);
process.exit(0);
