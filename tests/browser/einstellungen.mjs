// Studio settings file in the hosted build, offline after the first load:
//   - "Design & Sicherung" says what goes into the full backup, the studio settings and nowhere
//   - the export holds settings, theme, logo, deadlines and interval, and no customer data
//   - the import is checked, shows what it replaces, asks, and leaves income, PDFs and log alone
//   - an older settings-only file still imports; a full backup is pointed to "Wiederherstellen"
// Synthetic test data and an invented logo only.
import { writeFile } from "node:fs/promises";
import { HELPERS, OUT, ORIGIN, connect } from "./lib.mjs";

const { cmd, ev, until, check, navigate, reload, screenshot, offline, requests, errors } = await connect();
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

async function consent(firstName, lastName, appointment) {
  const before = await ev(`createIndexedDbFiles(indexedDB, ARCHIVE_DB).keys().then(k=>k.length)`);
  await ev(`fillConsent({firstName:${JSON.stringify(firstName)},lastName:${JSON.stringify(lastName)},appointment:'${appointment}'});form.requestSubmit()`);
  await until(`!document.getElementById('completion-screen').hidden && !!pendingConsent && (async()=>await pendingConsent.kept)()`);
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
await ev(`localStorage.setItem(EXPORT_LOG_KEY, JSON.stringify([{from:'2026-02-01',to:'2026-02-28',type:'all',at:'2026-03-02T10:00:00.000Z'}]))`);

const unlock = async (page) => {
  await ev(`openAdmin('${page}')`);
  await until(`document.getElementById('admin-pin-dialog').open || adminAccess.isUnlocked()`);
  if (await ev(`document.getElementById('admin-pin-dialog').open`)) await ev(`unlockAdmin()`);
  await until(`adminAccess.isUnlocked() && !document.getElementById('admin-pin-dialog').open && !document.getElementById('admin-app').hidden`);
};
await unlock("studio");
const chooseLogo = () =>
  ev(`(async()=>{const c=document.createElement('canvas');c.width=c.height=300;const g=c.getContext('2d');g.fillStyle='#2a6';g.fillRect(0,0,300,300);g.fillStyle='#fff';g.fillRect(60,120,180,60);const b=await new Promise(r=>c.toBlob(r,'image/png'));const dt=new DataTransfer();dt.items.add(new File([b],'logo.png',{type:'image/png'}));const i=document.getElementById('logo-file');i.files=dt.files;i.dispatchEvent(new Event('change'))})()`);
await chooseLogo();
await until(`document.querySelector('.studio-logo').src.startsWith('blob:')`);
const setLocation = (value) =>
  ev(`openAdminAuthorized('studio');(l=>{l.value=${JSON.stringify(value)};l.dispatchEvent(new Event('input',{bubbles:true}))})(document.getElementById('admin-studio-location'));saveAdmin()`);
await setLocation("Exportort");
await ev(`writeRetention(localStorage,{pdfYears:10,incomeYears:3});localStorage.setItem(BACKUP_INTERVAL_KEY,'14');setTheme('light')`);

// What goes where ---------------------------------------------------------------------------
await ev(`openAdminAuthorized('appearance')`);
const page = await ev(`document.getElementById('admin-app').textContent.replace(/\\s+/g,' ')`);
check(
  "Design & Sicherung nennt, was in Gesamtsicherung und Studio-Einstellungen steckt und was nirgends",
  page.includes("Was wohin gehört") &&
    page.includes("In der Gesamtsicherung") &&
    page.includes("In den Studio-Einstellungen") &&
    /Nirgends enthalten.*PIN, Sprache dieses Geräts, Symbol und Name auf dem Home-Bildschirm/.test(page),
);
await ev(`document.querySelector('.contents-list').scrollIntoView({block:'center'});new Promise(r=>setTimeout(r,200))`);
await screenshot("einstellungen-uebersicht");

// Export ------------------------------------------------------------------------------------
await ev(`navigator.canShare=()=>true;navigator.share=async(d)=>{window.__shared=d.files[0]};document.querySelector('[data-admin-action="export-json"]').click()`);
await until(`!!window.__shared`);
const name = await ev(`window.__shared.name`);
const json = await ev(`window.__shared.text()`);
await writeFile(`${OUT}/${name}`, json);
const file = JSON.parse(json);
check(
  "Export: Einstellungen, Farbschema, Logo, Fristen und Erinnerungsabstand",
  /^Inkform_Studio-Einstellungen_\d{4}-\d{2}-\d{2}\.json$/.test(name) &&
    file.kind === "inkform-studio-einstellungen" &&
    file.schemaVersion === 2 &&
    file.settings.studio.location === "Exportort" &&
    file.theme === "light" &&
    file.retention.pdfYears === 10 &&
    file.backupDays === 14 &&
    Buffer.from(file.logo, "base64").readUInt32BE(16) === 300,
);
const keys = [];
(function walk(value) {
  if (value && typeof value === "object") for (const [key, inner] of Object.entries(value)) keys.push(key.toLowerCase()), walk(inner);
})(file);
check(
  "Export enthält keine Kundendaten: keine Einträge, PDFs, Unterschriften, Namen, kein Export-Protokoll, keine PIN",
  !["income", "records", "pdfs", "pdf", "pdfremoved", "exports", "signature", "pending", "salt", "hash"].some((k) => keys.includes(k)) &&
    !/Jürgen|Müller|Şahin|%PDF|JVBERi|839274|2026-02-28/.test(json) &&
    (json.match(/iVBORw0KGgo/g) || []).length === 1,
);

// Change everything, then import --------------------------------------------------------------
await ev(`window.__c=window.confirm;window.confirm=()=>true;openAdminAuthorized('studio');document.querySelector('[data-admin-action="logo-remove"]').click();window.confirm=window.__c`);
await until(`!document.querySelector('.studio-logo').src.startsWith('blob:')`);
await setLocation("Anders");
await ev(`writeRetention(localStorage,{pdfYears:null,incomeYears:null});localStorage.setItem(BACKUP_INTERVAL_KEY,'3');setTheme('dark');openAdminAuthorized('appearance')`);
const customerData = () =>
  ev(`createIndexedDbFiles(indexedDB, ARCHIVE_DB).keys().then(k=>JSON.stringify([localStorage.getItem(INCOME_KEY),localStorage.getItem(EXPORT_LOG_KEY),localStorage.getItem(PDF_REMOVED_KEY),k.sort()]))`);
const before = await customerData();
const pick = (source) =>
  ev(`(()=>{const dt=new DataTransfer();dt.items.add(new File([${source}],'einstellungen.json',{type:'application/json'}));const i=document.getElementById('admin-import-file');i.files=dt.files;i.dispatchEvent(new Event('change'))})()`);
const adminError = () => ev(`document.getElementById('admin-error').hidden?'':document.getElementById('admin-error').textContent`);
const unchanged = () => ev(`settings.studio.location==='Anders'&&localStorage.getItem(THEME_KEY)==='dark'&&localStorage.getItem(BACKUP_INTERVAL_KEY)==='3'&&!document.querySelector('.studio-logo').src.startsWith('blob:')`);

await pick(`JSON.stringify({kind:'inkform-gesamtsicherung',schemaVersion:2,createdAt:new Date().toISOString()})`);
await until(`!document.getElementById('admin-error').hidden`);
check("Gesamtsicherung im Studio-Import: Hinweis auf „Wiederherstellen“, nichts geändert", (await adminError()).includes("in der Übersicht unter „Wiederherstellen“") && (await unchanged()));
await ev(`document.getElementById('admin-error').hidden=true`);
await pick(`JSON.stringify({...${JSON.stringify(file)},logo:'AAAA'})`);
await until(`!document.getElementById('admin-error').hidden`);
check("Beschädigtes Logo: ganze Datei abgelehnt, nichts geändert", (await adminError()).includes("ungültiges Logo") && (await unchanged()));
await ev(`document.getElementById('admin-error').hidden=true`);

await ev(`window.confirm=(m)=>{window.__question=m;return false}`);
await ev(`window.__studioText=${JSON.stringify(json)}`);
await pick(`window.__studioText`);
await until(`!!window.__question`);
const question = await ev(`window.__question`),
  studioName = file.settings.studio.name;
check(
  "Rückfrage nennt Datum, was ersetzt wird und was unberührt bleibt",
  /Studio-Einstellungen vom .* übernehmen\?/.test(question) &&
    question.includes(`Ersetzt werden: Studioangaben (${studioName}`) &&
    question.includes("Farbschema: hell") &&
    question.includes("Logo: das Logo aus der Datei") &&
    question.includes("Fristen: PDFs 10 Jahre, Namen in der Einnahmenliste 3 Jahre") &&
    question.includes("nach: 14 Tagen") &&
    question.includes("Nicht berührt: Einnahmen, PDFs, Export-Protokoll und PIN."),
);
check("Abbrechen ändert nichts", await unchanged());

await ev(`window.confirm=()=>true`);
await pick(`window.__studioText`);
await until(`typeof adminAccess!=='undefined' && !window.__studioText && document.readyState==='complete' && document.getElementById('toast').textContent.includes('Studio-Einstellungen übernommen')`);
await ev(HELPERS);
await until(`document.querySelector('.studio-logo').src.startsWith('blob:')`);
check(
  "Nach dem Import: Einstellungen, Farbschema, Logo, Fristen und Abstand aus der Datei",
  await ev(`settings.studio.location==='Exportort'&&document.documentElement.dataset.theme==='light'&&readRetention(localStorage).pdfYears===10&&readRetention(localStorage).incomeYears===3&&localStorage.getItem(BACKUP_INTERVAL_KEY)==='14'`),
);
check("Einnahmen, PDFs, Export-Protokoll und gelöschte Kopien unverändert", (await customerData()) === before);
check("PIN unverändert", await ev(`adminAccess.configured()`));

// An older settings-only file: settings and theme, the logo stays.
await unlock("appearance");
await ev(`window.__oldFile=${JSON.stringify(JSON.stringify({ ...file.settings, studio: { ...file.settings.studio, location: "Altdatei" }, theme: "dark" }))}`);
await pick(`window.__oldFile`);
await until(`typeof adminAccess!=='undefined' && !window.__oldFile && document.readyState==='complete' && document.getElementById('toast').textContent.includes('Studio-Einstellungen übernommen')`);
await ev(HELPERS);
await until(`document.querySelector('.studio-logo').src.startsWith('blob:')`);
check("Ältere Einstellungsdatei: übernommen, Logo und Fristen bleiben", await ev(`settings.studio.location==='Altdatei'&&document.documentElement.dataset.theme==='dark'&&readRetention(localStorage).pdfYears===10&&localStorage.getItem(BACKUP_INTERVAL_KEY)==='14'`));
check("Auch danach Einnahmen und PDFs unverändert", (await customerData()) === before);

// The HTML app file keeps the built-in logo; the own one travels in the studio settings file.
await unlock("appearance");
await ev(`window.__exported=null;window.__createObjectURL=URL.createObjectURL;URL.createObjectURL=(blob)=>{window.__exported=blob;return window.__createObjectURL(blob)};exportHtml()`);
await until(`!!window.__exported`);
check("HTML-Datei behält das eingebaute Logo", await ev(`Promise.all([window.__exported.text(),storedLogo().then(b=>blobBase64(new Blob([b])))]).then(([html,logo])=>html.includes('src="'+BUILT_IN_LOGO+'"')&&!html.includes(logo))`));

// Customer form in progress or a consent open: no import.
await ev(`(f=>{f.value='Halb';f.dispatchEvent(new Event('input',{bubbles:true}))})(document.getElementById('firstName'));document.getElementById('admin-error').hidden=true`);
await ev(`window.__c3=window.confirm;window.confirm=()=>{window.__asked=true;return true};window.__studioText2=${JSON.stringify(json)}`);
await pick(`window.__studioText2`);
await until(`!document.getElementById('admin-error').hidden`);
check("Angefangenes Kundenformular: Import gesperrt, keine Rückfrage", (await adminError()).includes("Kundenformular abschließen oder leeren") && !(await ev(`!!window.__asked`)) && (await ev(`settings.studio.location==='Altdatei'`)));
await ev(`resetCustomerForm();window.confirm=window.__c3`);

check("Keine Netzwerkzugriffe außer der lokalen Vorschau", requests.every((u) => !/^https?:/.test(u) || u.startsWith(ORIGIN)));
check("Keine JavaScript- oder CSP-Fehler", errors.length === 0);
process.exit(0);
