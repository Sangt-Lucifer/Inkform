// Stored settings of today's and older formats: loaded unchanged and never rewritten by loading,
// missing fields and default questions migrated, unreadable settings kept as they are with the
// customer form locked until a backup or studio settings are restored. Fixtures from
// tests/fixtures/ (invented studio, invented logo and icon).
import { readFileSync } from "node:fs";
import { HELPERS, ORIGIN, connect } from "./lib.mjs";

const raw = (name) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
const today = raw("einstellungen-v1.json"),
  expected = JSON.parse(today);
const { cmd, ev, until, check, navigate, screenshot, errors } = await connect();
await cmd("Emulation.setDeviceMetricsOverride", { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
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

const stored = () => ev(`localStorage.getItem(SETTINGS_KEY)`);
// Starts the app with these stored settings, in the customer form.
const startWith = async (text) => {
  await ev(`localStorage.setItem(SETTINGS_KEY,${JSON.stringify(text)});sessionStorage.clear();window.__old=true;history.replaceState(null,'',location.pathname);location.reload();0`);
  await until(`!window.__old&&typeof adminAccess!=='undefined'&&document.readyState==='complete'`);
  await ev(HELPERS);
};
const unlock = async () => {
  await ev(`openAdmin('overview');0`);
  await until(`document.getElementById('admin-pin-dialog').open`);
  await ev(`unlockAdmin()`);
  await until(`adminAccess.isUnlocked()&&adminOpen`);
};
const own = (value) => JSON.stringify(["studio", "app", "medical", "legal", "locale"].map((key) => value[key]));
const ownKept = async () =>
  (await ev(`JSON.stringify(['studio','app','medical','legal','locale'].map(k=>settings[k]))`)) === own(expected) &&
  (await ev(`settings.translations.en.app.headline===${JSON.stringify(expected.translations.en.app.headline)}&&settings.translations.en.medical.customMedical_fixtur1.title===${JSON.stringify(expected.translations.en.medical.customMedical_fixtur1.title)}`));
const locked = () => ev(`!document.getElementById('settings-locked').hidden&&!document.getElementById('start').checkVisibility()&&!document.querySelector('#customer-app>.bottom-bar').checkVisibility()`);
const open = () => ev(`document.getElementById('settings-locked').hidden&&document.getElementById('start').checkVisibility()&&document.querySelector('#customer-app>.bottom-bar').checkVisibility()`);

// Today's format -------------------------------------------------------------------------------
await startWith(today);
check("Heutiges Format: eigene Texte, Fragen, Sprachen und Übersetzungen unverändert geladen", await ownKept());
check("Heutiges Format: Formular offen, zeigt die eigene Überschrift", (await open()) && (await ev(`document.getElementById('customer-app').textContent.includes(${JSON.stringify(expected.app.headline)})`)));
check("Laden schreibt die gespeicherten Einstellungen nicht neu (Byte für Byte gleich)", (await stored()) === today);

// Missing field and missing default question ----------------------------------------------------
const gaps = raw("einstellungen-v1-luecken.json");
await startWith(gaps);
check(
  "Fehlende Felder erhalten den Standard, fehlende Standardfragen stehen wieder an ihrem Platz",
  await ev(`settings.studio.location===DEFAULT_SETTINGS.studio.location&&settings.app.photoDeniedText===DEFAULT_SETTINGS.app.photoDeniedText&&JSON.stringify(settings.medical.map(i=>i.id))===${JSON.stringify(JSON.stringify(expected.medical.map((i) => i.id)))}&&JSON.stringify(settings.legal.map(i=>i.id))===${JSON.stringify(JSON.stringify(expected.legal.map((i) => i.id)))}`),
);
check(
  "Eigene Texte und Fragen bleiben bei der Migration erhalten",
  await ev(`settings.app.headline===${JSON.stringify(expected.app.headline)}&&settings.medical[0].title===${JSON.stringify(expected.medical[0].title)}&&settings.medical.at(-1).id==='customMedical_fixtur1'&&settings.legal.at(-1).id==='customLegal_fixtur1'`),
);
check("Migrierte Einstellungen: Formular offen, gespeichert bleibt unverändert bis zum Speichern", (await open()) && (await stored()) === gaps);
await unlock();
await ev(`saveAdmin()`);
check(
  "Nach dem Speichern liegen die migrierten Einstellungen vor",
  await ev(`(()=>{const s=JSON.parse(localStorage.getItem(SETTINGS_KEY));return s.schemaVersion===SETTINGS_VERSION&&s.studio.location===DEFAULT_SETTINGS.studio.location&&s.medical.length===${expected.medical.length}&&s.legal.length===${expected.legal.length}})()`),
);

// Unreadable settings ---------------------------------------------------------------------------
const broken = [
  ["leerer Eintrag", ""],
  ["abgeschnittene Datei", today.slice(0, 400)],
  ["neuere Version", JSON.stringify({ ...expected, schemaVersion: 99 })],
  ["ungültige Frage", JSON.stringify({ ...expected, medical: [...expected.medical, { id: "fremd", title: "X", hint: "Y" }] })],
];
for (const [name, text] of broken) {
  await startWith(text);
  check(`Unlesbar (${name}): Kundenformular gesperrt, Verwaltung fragt nach der PIN`, (await locked()) && (await ev(`document.getElementById('admin-pin-dialog').open`)));
  await unlock();
  check(`Unlesbar (${name}): Hinweis oben in der Verwaltung, keine Speicherleiste`, await ev(`!!document.querySelector('#admin-section > .ad-broken-notice[role="alert"]')&&!document.getElementById('admin-savebar').checkVisibility()`));
  check(`Unlesbar (${name}): Speichern verweigert, gespeicherte Daten unverändert`, (await ev(`saveAdmin()`)) === false && (await stored()) === text && (await ev(`!document.getElementById('admin-error').hidden&&document.getElementById('admin-error').textContent.includes(t('settingsLocked.noSave'))`)));
}
await screenshot("migration-unlesbar-verwaltung");
await ev(`openAdminAuthorized('studio')`);
check("Hinweis auch auf den anderen Seiten", await ev(`!!document.querySelector('#admin-section > .ad-broken-notice')`));
await ev(`window.__saved=null;saveFile=(f)=>{window.__saved=f;return Promise.resolve('download')};document.querySelector('[data-admin-action="broken-save"]').click()`);
await until(`!!window.__saved`);
check(
  "„Unlesbare Einstellungen als Datei sichern“: Datei mit den gespeicherten Daten, Byte für Byte",
  await ev(`window.__saved.text().then(s=>/^\\d{8}_\\d{4}_Inkform_Einstellungen_unlesbar\\.json$/.test(window.__saved.name)&&s===localStorage.getItem(SETTINGS_KEY))`),
);
await ev(`document.querySelector('.ad-broken-notice [data-admin-page="backup"]').click()`);
check("Knopf führt zu „Sichern & Wiederherstellen“", await ev(`adminPage==='backup'`));
await ev(`saveFile=(f)=>{window.__exported=f;return Promise.resolve('download')};downloadFile=(b,n)=>{window.__exported=n};window.__exported=null;createBackup().then(()=>window.__backupDone=true);exportStudioSettings();exportHtml();0`);
await until(`window.__backupDone`);
check(
  "Keine Gesamtsicherung, Studio-Einstellungen oder HTML-Datei aus der Standardvorlage",
  await ev(`window.__exported===null&&!preparedBackup&&document.getElementById('backup-note').textContent===t('settingsLocked.noExport')&&document.getElementById('admin-error').textContent===t('settingsLocked.noExport')`),
);
await ev(`finishAdminLeave()`);
check("Zurück beim Kunden: Formular bleibt gesperrt", await locked());
await screenshot("migration-unlesbar-kunde");
await ev(`document.getElementById('consent-form').requestSubmit()`);
check("Absenden bei gesperrtem Formular tut nichts", await ev(`!document.querySelector('[aria-invalid="true"]')&&document.getElementById('error-summary').hidden&&!pendingConsent`));
check("Nach allem: gespeicherte Daten unverändert", (await stored()) === broken.at(-1)[1]);

// Restoring older formats over unreadable settings ------------------------------------------------
for (const name of ["gesamtsicherung-v1.json", "gesamtsicherung-v2.json", "gesamtsicherung-v3.json", "studio-einstellungen-v2.json", "studio-einstellungen-v3.json"]) {
  await startWith(broken[0][1]);
  await unlock();
  await ev(`askWith(()=>true);window.__old=true;applyChosenFile(new File([${JSON.stringify(raw(name))}],'datei.json',{type:'application/json'})).catch(e=>window.__failed=e.message);0`);
  await until(`!window.__old&&typeof adminAccess!=='undefined'&&document.readyState==='complete'`);
  check(`${name}: eingespielt, Einstellungen unverändert übernommen, Sperre aufgehoben`, (await ownKept()) && !(await locked()) && !(await ev(`!!document.querySelector('.ad-broken-notice')`)));
}
const migrated = JSON.parse(raw("gesamtsicherung-v3.json"));
migrated.settings = JSON.parse(gaps);
await startWith(broken[0][1]);
await unlock();
await ev(`askWith(()=>true);window.__old=true;applyChosenFile(new File([${JSON.stringify(JSON.stringify(migrated))}],'datei.json',{type:'application/json'}));0`);
await until(`!window.__old&&typeof adminAccess!=='undefined'&&document.readyState==='complete'`);
check(
  "Sicherung mit älteren Einstellungen: beim Einspielen migriert",
  await ev(`(()=>{const s=JSON.parse(localStorage.getItem(SETTINGS_KEY));return s.medical.length===${expected.medical.length}&&s.studio.location===DEFAULT_SETTINGS.studio.location})()`),
);
check("Keine JavaScript- oder CSP-Fehler", errors.length === 0, JSON.stringify(errors));
process.exit(0);
