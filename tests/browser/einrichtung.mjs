// Fresh installation of the neutral edition: after the PIN the assistant offers three ways (set up
// here, full backup, studio settings), with the same checks as on the admin pages. Then the page
// a Safari tab on the iPad shows first, which only chooses the home screen icon. Synthetic data.
import { HELPERS, ORIGIN, connect } from "./lib.mjs";

const { cmd, ev, until, check, navigate, reload, screenshot, errors, answer } = await connect();
await cmd("Emulation.setDeviceMetricsOverride", { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
const WIPE = `try{localStorage.clear();sessionStorage.clear();for(const n of ['inkform-pending','inkform-archive','inkform-logo'])indexedDB.deleteDatabase(n)}catch(_){}`;
// A new device: storage wiped before the app starts, then the PIN dialog of the first start.
const freshDevice = async (extra = "") => {
  const reset = await cmd("Page.addScriptToEvaluateOnNewDocument", { source: WIPE + extra });
  await reload();
  await cmd("Page.removeScriptToEvaluateOnNewDocument", { identifier: reset.identifier });
  await ev(HELPERS);
};
const setPin = async (pin = "839274") => {
  await until(`document.getElementById('admin-pin-dialog')?.open`);
  await ev(`(()=>{for(const id of ['admin-pin','admin-pin-repeat'])document.getElementById(id).value='${pin}';document.getElementById('admin-pin-form').requestSubmit()})()`);
  await until(`adminAccess.isUnlocked() && adminPage==='setup' && !!document.querySelector('[data-admin-action="setup-new"]')`);
};
const unlockAfterReload = async (pin = "839274") => {
  await until(`typeof adminAccess!=='undefined' && document.readyState==='complete' && document.getElementById('admin-pin-dialog')?.open`);
  await ev(HELPERS);
  await ev(`unlockAdmin('${pin}')`);
  await until(`adminAccess.isUnlocked() && !document.getElementById('admin-app').hidden`);
};
const type = (id, value) => ev(`(el=>{el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}))})(document.getElementById('${id}'))`);
const pickSetup = (source) =>
  ev(`(()=>{const dt=new DataTransfer();dt.items.add(new File([${source}],'datei.json',{type:'application/json'}));const i=document.getElementById('setup-file');i.files=dt.files;i.dispatchEvent(new Event('change'))})()`);
const pickImage = (id, draw) =>
  ev(`(async()=>{const c=document.createElement('canvas');c.width=300;c.height=200;const g=c.getContext('2d');${draw};const b=await new Promise(r=>c.toBlob(r,'image/png'));const dt=new DataTransfer();dt.items.add(new File([b],'bild.png',{type:'image/png'}));const i=document.getElementById('${id}');i.files=dt.files;i.dispatchEvent(new Event('change'))})()`);
// Everything a restore must bring back, as one string.
const state = () =>
  ev(`Promise.all([logoStore.get(LOGO_KEY),logoStore.get(ICON_KEY)].map(p=>p.then(b=>b&&b.arrayBuffer().then(a=>toBase64(new Uint8Array(a)))))).then(async([logo,icon])=>JSON.stringify({settings:JSON.parse(localStorage.getItem(SETTINGS_KEY)),theme:document.documentElement.dataset.theme,retention:readRetention(localStorage),income:incomeRecords(),pdfs:(await createIndexedDbFiles(indexedDB,ARCHIVE_DB).keys()).sort(),logo,icon}))`);

// The original device -------------------------------------------------------------------------
await navigate(ORIGIN + "/index.html");
await until(`navigator.serviceWorker.ready.then(() => true)`);
await freshDevice();
await setPin();
await ev(`document.querySelector('[data-admin-action="setup-new"]').click()`);
await until(`!!document.getElementById('admin-studio-name')`);
for (const [id, value] of [
  ["admin-studio-name", "Atelier Ursprung · Lio Test"],
  ["admin-studio-contact", "kontakt@atelier-ursprung.example"],
  ["admin-studio-address", "Quellweg 1, 54321 Teststadt"],
  ["admin-studio-location", "Teststadt"],
  ["setup-pdf-years", "10"],
])
  await type(id, value);
await ev(`document.querySelector('[data-admin-action="setup-finish"]').click()`);
await until(`adminPage==='overview'`);
check("Nach der Einrichtung keine Flaggen in der Kopfzeile", await ev(`document.getElementById('admin-language').hidden`));
await ev(`openAdminAuthorized('studio')`);
await pickImage("logo-file", "g.fillStyle='#284';g.fillRect(20,20,260,160)");
await until(`!!ownLogo`);
await pickImage("icon-file", "g.fillStyle='#63c';g.fillRect(50,0,200,200)");
await until(`!!document.querySelector('[data-admin-action="icon-accept"]')`);
await ev(`document.querySelector('[data-admin-action="icon-accept"]').click()`);
await until(`!!ownIcon`);
await ev(`openAdminAuthorized('overview');document.querySelector('[data-admin-action="sample-load"]').click()`);
await until(`incomeRecords().length===6 && !!document.querySelector('[data-admin-action="sample-remove"]')`);
await until(`createIndexedDbFiles(indexedDB, ARCHIVE_DB).keys().then(k=>k.length===6)`);
await ev(`openAdminAuthorized('backup')`);
await ev(`navigator.canShare=()=>true;navigator.share=async(d)=>{window.__shared=d.files[0]};window.__shared=null;document.querySelector('.ad-panel [data-admin-action="backup-create"]').click()`);
await until(`!document.querySelector('[data-backup-ready]').hidden`);
await ev(`document.querySelector('[data-admin-action="backup-save"]').click()`);
await until(`!!window.__shared`);
const backupText = await ev(`window.__shared.text()`);
await ev(`window.__shared=null;openAdminAuthorized('backup');document.querySelector('[data-admin-action="export-json"]').click()`);
await until(`!!window.__shared`);
const studioText = await ev(`window.__shared.text()`);
const original = await state();
check("Ausgangsgerät: Einrichtung, Logo, Symbol, 6 Einträge mit PDFs", JSON.parse(original).income.length === 6 && !!JSON.parse(original).icon && !!JSON.parse(original).logo);

// Wrong, damaged and cancelled files: nothing written, the choice stays ---------------------
// This device gets a PIN of its own, which the restore below must keep.
await freshDevice();
await setPin("517306");
const ownPin = await ev(`localStorage.getItem('inkform.admin.pin.v1')`);
const nothingWritten = () => ev(`!localStorage.getItem(SETTINGS_KEY)&&incomeRecords().length===0&&adminPage==='setup'&&!!document.querySelector('[data-admin-action="setup-new"]')`);
const setupError = () => ev(`(e=>e.hidden?'':e.textContent)(document.getElementById('setup-file-error'))`);
await pickSetup(`'{"kind":"etwas"}'`);
await until(`!document.getElementById('setup-file-error').hidden`);
check("Fremde Datei: verständliche Meldung, nichts geschrieben, Auswahl bleibt", (await setupError()).includes("weder eine INKFORM-Gesamtsicherung noch") && (await setupError()).includes("nichts geändert") && (await nothingWritten()));
await pickSetup(`${JSON.stringify(JSON.stringify({ ...JSON.parse(backupText), pdfs: [{ id: "fremd", pdf: "JVBERi0=" }] }))}`);
await until(`(document.getElementById('setup-file-error')?.textContent||'').includes('Einnahmeneintrag')`);
check("Beschädigte Gesamtsicherung: Meldung, nichts geschrieben", await nothingWritten());
await pickSetup(`'kein json'`);
await until(`(document.getElementById('setup-file-error')?.textContent||'').includes('kein gültiges JSON')`);
check("Kein JSON: Meldung, nichts geschrieben", await nothingWritten());
await ev(`askWith((m)=>{window.__question=m;return false})`);
await ev(`window.__question=null;window.__text=${JSON.stringify(backupText)}`);
await pickSetup(`window.__text`);
await until(`!!window.__question`);
const question = await ev(`window.__question`);
check(
  "Vorschau der Gesamtsicherung: Datum, Einträge und PDFs, Studio, Sprachen, Logo, Symbol, Version",
  /Sicherung vom .* wiederherstellen\?/.test(question) &&
    question.includes("6 Einträge, 6 PDFs") &&
    question.includes("Studioangaben (Atelier Ursprung · Lio Test)") &&
    question.includes("Sprachen (Deutsch") &&
    question.includes("Logo: das Logo aus der Datei") &&
    question.includes("App-Symbol: das Symbol aus der Datei") &&
    question.includes("Dateiversion 4"),
);
check("Abbrechen in der Vorschau: nichts geschrieben", (await nothingWritten()) && (await ev(`!sessionStorage.getItem('inkform.fromSetup')`)));

// Full backup on a new device: identical, then straight on to the overview ------------------
await ev(`askReal();window.__text=${JSON.stringify(backupText)}`);
await pickSetup(`window.__text`);
await answer();
await unlockAfterReload("517306");
await until(`adminPage==='overview'`);
check("Nach der Gesamtsicherung: direkt die Übersicht, Meldung", (await ev(`document.getElementById('toast').textContent`)).includes("Sicherung wiederhergestellt"));
const restoredState = await state();
check("Alles wie auf dem Ausgangsgerät: Einstellungen, Farbschema, Logo, Symbol, Einnahmen, PDFs", restoredState === original);
check(
  "PIN dieses Geräts bleibt, nicht die des Ausgangsgeräts",
  (await ev(`localStorage.getItem('inkform.admin.pin.v1')`)) === ownPin && !/839274|salt|hash/.test(backupText) && (await ev(`adminAccess.isUnlocked()`)),
);

// Studio settings on a new device: customisations only, then what is still missing ----------
await freshDevice();
await setPin();
await ev(`askWith((m)=>{window.__question=m;return true});window.__text=${JSON.stringify(studioText)}`);
await pickSetup(`window.__text`);
await unlockAfterReload();
await until(`adminPage==='overview'`);
const afterStudio = JSON.parse(await state()),
  before = JSON.parse(original);
check(
  "Studio-Einstellungen: Anpassungen mit Logo und Symbol da, keine Kundendaten, Einnahmenliste leer",
  JSON.stringify(afterStudio.settings.studio) === JSON.stringify(before.settings.studio) &&
    afterStudio.logo === before.logo &&
    afterStudio.icon === before.icon &&
    afterStudio.income.length === 0 &&
    afterStudio.pdfs.length === 0,
);
check("Danach „Was fehlt noch?“ in der Übersicht", await ev(`document.getElementById('admin-app').textContent.includes('Was fehlt noch?')&&document.getElementById('admin-app').textContent.includes('Test-PDF')`));
await screenshot("einrichtung-was-fehlt");
await ev(`finishAdminLeave()`);

// An older backup without icon (version 2) is migrated ----------------------------------------
await freshDevice();
await setPin();
const old = JSON.parse(backupText);
old.schemaVersion = 2;
delete old.icon;
await ev(`askWith(()=>true);window.__text=${JSON.stringify(JSON.stringify(old))}`);
await pickSetup(`window.__text`);
await unlockAfterReload();
await until(`adminPage==='overview'`);
const migrated = JSON.parse(await state());
check("Ältere Gesamtsicherung ohne Symbol: übernommen, eingebautes Symbol, Logo und Einträge da", migrated.icon === null && migrated.logo === before.logo && migrated.income.length === 6);
await ev(`finishAdminLeave()`);

// The page a Safari tab on the iPad shows first ----------------------------------------------
const SAFARI = `Object.defineProperty(Navigator.prototype,'standalone',{configurable:true,get:()=>false});`;
const safari = await cmd("Page.addScriptToEvaluateOnNewDocument", { source: SAFARI });
await freshDevice();
await until(`!document.getElementById('install-screen').hidden`);
check("Safari-Tab, frisch: Seite „Auf den Home-Bildschirm“ statt PIN", await ev(`!document.getElementById('admin-pin-dialog').open&&document.getElementById('install-screen').textContent.includes('getrennte Speicher')`));
check("Darunter nichts bedienbar", await ev(`document.getElementById('customer-app').inert`));
await screenshot("installieren");
const pickInstall = (id, source, name, mime) =>
  ev(`(()=>{const dt=new DataTransfer();dt.items.add(new File([${source}],'${name}',{type:'${mime}'}));const i=document.getElementById('${id}');i.files=dt.files;i.dispatchEvent(new Event('change'))})()`);
const touch = () => ev(`document.querySelector('link[rel="apple-touch-icon"]').getAttribute('href')`);
await ev(`window.__text=${JSON.stringify(backupText)}`);
await pickInstall("install-studio", "window.__text", "sicherung.json", "application/json");
await until(`!document.querySelector('.install-error').hidden`);
check("Gesamtsicherung im Safari-Tab abgelehnt, Hinweis auf die App", (await ev(`document.querySelector('.install-error').textContent`)).includes("Gesamtsicherung mit Kundendaten") && (await touch()) === "./icons/icon-192.png");
await ev(`window.__text=${JSON.stringify(studioText)}`);
await pickInstall("install-studio", "window.__text", "studio.json", "application/json");
await until(`document.querySelector('link[rel="apple-touch-icon"]').getAttribute('href').startsWith('data:image/png')`);
check("Symbol aus den Studio-Einstellungen gesetzt, nichts gespeichert", await ev(`!localStorage.getItem(SETTINGS_KEY)&&!adminAccess.configured()&&logoStore.get(ICON_KEY).then(b=>b===null)`));
await pickImage("install-picture", "g.fillStyle='#c33';g.fillRect(100,50,100,100)");
await until(`!!document.querySelector('[data-install="background"]')`);
const firstPicture = await touch();
await ev(`document.querySelector('[data-install="background"][data-background="dark"]').click()`);
await until(`document.querySelector('[data-install="background"][data-background="dark"]')?.getAttribute('aria-pressed')==='true'`);
check("Symbol aus einem Bild, Hintergrund umschaltbar", firstPicture.startsWith("data:image/png") && (await touch()) !== firstPicture);
await ev(`window.__square=squareIcon;squareIcon=async(f,b)=>{if(b==='dark')await new Promise(r=>setTimeout(r,500));return window.__square(f,b)}`);
await ev(`document.querySelector('[data-install="background"][data-background="dark"]').click();document.querySelector('[data-install="background"][data-background="light"]').click()`);
await until(`document.querySelector('[data-install="background"][data-background="light"]')?.getAttribute('aria-pressed')==='true'`);
await ev(`new Promise(r=>setTimeout(r,800))`);
check(
  "Späte ältere Umwandlung überschreibt die neuere Wahl nicht",
  (await touch()) === firstPicture && (await ev(`document.querySelector('[data-install="background"][data-background="light"]').getAttribute('aria-pressed')==='true'`)),
);
await ev(`squareIcon=window.__square`);
const flag = (group, code) => `document.querySelector('#${group} [data-operator-language="${code}"]')`;
check("Installationsseite: Flaggen für Deutsch und Englisch, Deutsch gewählt", await ev(`${flag("install-language", "de")}.getAttribute('aria-pressed')==='true'&&${flag("install-language", "en")}.getAttribute('aria-pressed')==='false'`));
await ev(`${flag("install-language", "en")}.click()`);
await until(`document.documentElement.lang==='en'`);
check(
  "Englisch gewählt: Seite auf Englisch, Symbol bleibt, Wahl nur in der Adresse, nichts gespeichert",
  await ev(`location.search==='?sprache=en'&&document.getElementById('install-screen-title').textContent===t('installPage.title')&&${flag("install-language", "en")}.getAttribute('aria-pressed')==='true'
    &&document.activeElement===${flag("install-language", "en")}&&localStorage.getItem('inkform.language.v1')===null&&!!document.querySelector('.install-preview img')`),
);
await screenshot("installieren-englisch");
await ev(`document.querySelector('[data-install="skip"]').click()`);
await until(`document.getElementById('admin-pin-dialog')?.open`);
check("Im Safari-Tab weiter: Seite weg, PIN wie gewohnt", await ev(`document.getElementById('install-screen').hidden&&!document.getElementById('customer-app').inert`));
check("PIN-Dialog in der gewählten Sprache", await ev(`document.getElementById('admin-pin-title').textContent===t('pin.setupTitle')&&document.documentElement.lang==='en'`));
await cmd("Page.removeScriptToEvaluateOnNewDocument", { identifier: safari.identifier });
// The home screen app opens the address the tab had, with the language chosen there.
await freshDevice();
check("Ohne Safari auf dem iPad (z. B. Mac, Home-Bildschirm-App): keine Installationsseite", await ev(`document.getElementById('install-screen').hidden`));
await until(`document.getElementById('admin-pin-dialog')?.open`);
check(
  "Home-Bildschirm-App mit ?sprache=en: erster PIN-Dialog auf Englisch, Flaggen oben",
  await ev(`document.documentElement.lang==='en'&&document.getElementById('admin-pin-title').textContent===t('pin.setupTitle')&&!document.getElementById('admin-pin-language').hidden
    &&${flag("admin-pin-language", "en")}.getAttribute('aria-pressed')==='true'&&document.getElementById('completion-title').textContent===t('completion.setupTitle')`),
);
await ev(`document.getElementById('admin-pin').value='12';${flag("admin-pin-language", "de")}.click()`);
await until(`document.documentElement.lang==='de'`);
check(
  "Im PIN-Dialog auf Deutsch: Texte und Hintergrund deutsch, Eingabe bleibt, Wahl gespeichert",
  await ev(`document.getElementById('admin-pin-title').textContent==='PIN bei der ersten Einrichtung festlegen'&&document.getElementById('admin-pin').value==='12'&&localStorage.getItem('inkform.language.v1')==='de'
    &&document.getElementById('completion-title').textContent===t('completion.setupTitle')&&document.activeElement===${flag("admin-pin-language", "de")}`),
);
const keyIn = async (id, key, shift = false) => {
  await ev(`document.getElementById('${id}').focus()`);
  const code = key === "Enter" ? 13 : 9;
  for (const type of ["rawKeyDown", "keyUp"])
    await cmd("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0, ...(key === "Enter" && type === "rawKeyDown" ? { text: "\r" } : {}) });
  return ev(`document.activeElement.id`);
};
check(
  "Erste PIN: Tab und Enter springen ins Wiederholungsfeld, Umschalt+Tab zurück, nichts abgeschickt",
  (await keyIn("admin-pin", "Tab")) === "admin-pin-repeat" && (await keyIn("admin-pin", "Enter")) === "admin-pin-repeat" && (await keyIn("admin-pin-repeat", "Tab", true)) === "admin-pin" &&
    (await ev(`document.getElementById('admin-pin-dialog').open&&!adminAccess.configured()`)),
);
check(
  "Flaggen im PIN-Dialog auf 320 px ganz sichtbar",
  await (async () => {
    await cmd("Emulation.setDeviceMetricsOverride", { width: 320, height: 640, deviceScaleFactor: 1, mobile: true });
    const ok = await ev(`[...document.querySelectorAll('#admin-pin-language button')].every(b=>{const r=b.getBoundingClientRect(),g=b.parentElement.getBoundingClientRect();return r.width>=44&&r.left>=g.left-1&&r.right<=g.right+1&&r.right<=innerWidth})`);
    await screenshot("pin-dialog-320");
    await cmd("Emulation.setDeviceMetricsOverride", { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
    return ok;
  })(),
);
await ev(`${flag("admin-pin-language", "en")}.click()`);
await setPin();
check("Assistent auf Englisch, Flaggen oben in der Kopfzeile", await ev(`document.documentElement.lang==='en'&&!document.getElementById('admin-language').hidden&&${flag("admin-language", "en")}.getAttribute('aria-pressed')==='true'`));
await ev(`document.querySelector('[data-admin-action="setup-new"]').click()`);
await until(`!!document.getElementById('admin-studio-name')`);
check("Neu einrichten auf Englisch: Studiosprache Englisch", await ev(`document.getElementById('locale-studio').value==='en'&&adminDraft.locale.customer.includes('en')`));
await screenshot("einrichtung-englisch");
await ev(`${flag("admin-language", "de")}.click()`);
await until(`document.documentElement.lang==='de'`);
check("Zurück auf Deutsch: Assistent und Studiosprache deutsch", await ev(`document.getElementById('locale-studio').value==='de'&&document.getElementById('admin-page-title').textContent===t('admin.page.setup.title')`));
await ev(`${flag("admin-language", "en")}.click()`);
await until(`document.documentElement.lang==='en'`);
// Leave nothing unsaved behind for the next check in this browser.
await ev(`adminDraft=JSON.parse(JSON.stringify(settings));finishAdminLeave()`);
await until(`!document.getElementById('customer-app').hidden`);
check(
  "„Zum Formular“ vor Abschluss der Einrichtung: Formular in der gewählten Sprache",
  await ev(`document.documentElement.lang==='en'&&customerLanguage==='en'&&document.getElementById('customer-headline').textContent===contentIn(settings,'en').app.headline&&settings.locale.studio==='de'`),
);
await screenshot("formular-englisch-vor-einrichtung");

// "Automatisch": the device language if the app has it, otherwise English with a note -----------
const deviceLanguages = (tags) =>
  `Object.defineProperty(Navigator.prototype,'languages',{configurable:true,get:()=>${JSON.stringify(tags)}});Object.defineProperty(Navigator.prototype,'language',{configurable:true,get:()=>${JSON.stringify(tags[0])}});`;
await navigate(ORIGIN + "/index.html");
for (const [tags, expected] of [
  [["de-AT", "en"], "de"],
  [["en-US"], "en"],
]) {
  await freshDevice(deviceLanguages(tags));
  await until(`document.getElementById('admin-pin-dialog')?.open`);
  await ev(`${flag("admin-pin-language", "auto")}.click()`);
  check(
    `Automatisch mit Gerätesprache ${tags[0]}: ${expected}, ohne Hinweis, Wahl gespeichert`,
    await ev(`document.documentElement.lang==='${expected}'&&localStorage.getItem('inkform.language.v1')==='auto'&&${flag("admin-pin-language", "auto")}.getAttribute('aria-pressed')==='true'
      &&[...document.querySelectorAll('#admin-pin-language [data-operator-language]:not([data-operator-language="auto"])')].every(b=>b.getAttribute('aria-pressed')==='false')&&document.getElementById('admin-pin-language-note').hidden`),
  );
}
const chinese = await cmd("Page.addScriptToEvaluateOnNewDocument", { source: deviceLanguages(["zh-CN"]) });
await freshDevice();
await until(`document.getElementById('admin-pin-dialog')?.open`);
check("Erster PIN-Dialog: Deutsch, Englisch und Automatisch", await ev(`[...document.querySelectorAll('#admin-pin-language button')].map(b=>b.dataset.operatorLanguage).join()==='de,en,auto'`));
await ev(`${flag("admin-pin-language", "auto")}.click()`);
// First it looks for a pack on the app's own site; the note follows the answer.
await until(`document.getElementById('admin-pin-language-note').textContent.startsWith('Chinese (China) has')`);
check(
  "Automatisch mit Chinesisch: Englisch, Hinweis „noch nicht übersetzt“ mit dem Namen der Sprache",
  await ev(`document.documentElement.lang==='en'&&!document.getElementById('admin-pin-language-note').hidden&&document.getElementById('admin-pin-language-note').textContent.startsWith('Chinese')&&localStorage.getItem('inkform.language.v1')==='auto'`),
);
await screenshot("automatisch-chinesisch");
await setPin();
check("Danach Assistent auf Englisch, Automatisch gedrückt", await ev(`document.documentElement.lang==='en'&&${flag("admin-language", "auto")}.getAttribute('aria-pressed')==='true'`));
await ev(`adminPage='ipad';renderAdminSection()`);
check("Seite iPad: „Sprache dieses Geräts“ zeigt Automatisch", (await ev(`document.getElementById('operator-language').value`)) === "auto");
await ev(`(()=>{const s=document.getElementById('operator-language');s.value='de';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
check("Dort Deutsch gewählt: Verwaltung deutsch, gespeichert", await ev(`document.documentElement.lang==='de'&&localStorage.getItem('inkform.language.v1')==='de'`));
await ev(`(()=>{const s=document.getElementById('operator-language');s.value='auto';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
await until(`document.getElementById('toast').textContent.startsWith('Chinese')`);
check("Wieder Automatisch: Englisch mit Meldung", await ev(`document.documentElement.lang==='en'&&localStorage.getItem('inkform.language.v1')==='auto'&&document.getElementById('toast').textContent.startsWith('Chinese')`));
await ev(`adminPage='setup';renderAdminSection()`);
await cmd("Page.removeScriptToEvaluateOnNewDocument", { identifier: chinese.identifier });
const german = await cmd("Page.addScriptToEvaluateOnNewDocument", { source: deviceLanguages(["de-DE"]) });
await reload();
await unlockAfterReload();
check("Automatisch folgt dem Gerät bei jedem Start: jetzt Deutsch", await ev(`document.documentElement.lang==='de'&&localStorage.getItem('inkform.language.v1')==='auto'`));
await cmd("Page.removeScriptToEvaluateOnNewDocument", { identifier: german.identifier });
await ev(`adminDraft=JSON.parse(JSON.stringify(settings));finishAdminLeave()`);
check("Keine JavaScript- oder CSP-Fehler", errors.length === 0, JSON.stringify(errors));
process.exit(0);
