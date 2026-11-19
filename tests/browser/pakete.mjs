// Ready-made language packs on the page "Sprachen" of a German instance, whatever the device
// language: install, offline reload, use as a customer language once the studio texts exist;
// removing the active pack brings the form back consistently in the studio language; the
// standalone HTML file carries the packs it uses and starts with them offline in a fresh profile.
// Synthetic data only.
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { HELPERS, OUT, ORIGIN, connect } from "./lib.mjs";

const { cmd, ev, until, check, navigate, reload, offline, screenshot, requests, errors, answer } = await connect();
await cmd("Emulation.setDeviceMetricsOverride", { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
const WIPE = `try{localStorage.clear();sessionStorage.clear();for(const n of ['inkform-pending','inkform-archive','inkform-logo'])indexedDB.deleteDatabase(n)}catch(_){}`;
const german = `Object.defineProperty(Navigator.prototype,'languages',{configurable:true,get:()=>['de-DE']});Object.defineProperty(Navigator.prototype,'language',{configurable:true,get:()=>'de-DE'});`;
await cmd("Page.addScriptToEvaluateOnNewDocument", { source: german });
const wipe = await cmd("Page.addScriptToEvaluateOnNewDocument", { source: WIPE });
await navigate(ORIGIN + "/index.html");
await cmd("Page.removeScriptToEvaluateOnNewDocument", { identifier: wipe.identifier });
await until(`navigator.serviceWorker.ready.then(() => true)`);
await reload();
await ev(HELPERS);
await until(`document.getElementById('admin-pin-dialog')?.open`);
await ev(`document.getElementById('admin-pin').value='839274';document.getElementById('admin-pin-repeat').value='839274';document.getElementById('admin-pin-form').requestSubmit()`);
await until(`adminAccess.isUnlocked()`);

// 1. The list of the app's packs, independent of the (German) device language -------------------
await ev(`openAdminAuthorized('languages')`);
await until(`!!document.querySelector('[data-install-pack]')`);
check("Deutsche Instanz: alle Pakete der App zur Installation angeboten", await ev(`document.documentElement.lang==='de'&&['es','fr','it','pl','ru','tr'].every(c=>!!document.querySelector('[data-install-pack="'+c+'"]'))`));
check("Installieren und eigene Übersetzung sind getrennte Aktionen", await ev(`!!document.querySelector('[data-admin-action="language-add"]')&&!document.querySelector('[data-install-pack]').closest('section').querySelector('[data-admin-action="language-add"]')`));
await screenshot("pakete-liste");
await ev(`document.querySelector('[data-install-pack="fr"]').click()`);
await until(`!!installedPacks.fr && !!document.querySelector('[data-compare-pack="fr"]')`);
check("Paket installiert, Gerätespeicher hat es, Admin bleibt deutsch", await ev(`hasLanguage('fr')&&!!JSON.parse(localStorage.getItem('inkform.sprachpakete.v1')).fr&&document.documentElement.lang==='de'`));
// An own change on the device, then "Mit Paket abgleichen": the import preview shows it first.
await ev(`changePacks({...installedPacks,fr:{...installedPacks.fr,texts:{...installedPacks.fr.texts,'personal.firstName':'Prénom (eigen)'}}});renderAdminSection()`);
await ev(`document.querySelector('[data-compare-pack="fr"]').click()`);
await until(`!!translationImport && !!document.querySelector('[data-admin-action="translation-apply"]')`);
check("Abgleich mit eigener Übersetzung: Vorschau zeigt die Änderung, noch nichts übernommen", await ev(`translationImport.changed.some(c=>c.key==='personal.firstName')&&installedPacks.fr.texts['personal.firstName']==='Prénom (eigen)'`));
await ev(`document.querySelector('[data-admin-action="translation-apply"]').click()`);
await until(`!translationImport`);
check("Nach „Übernehmen“: Text aus dem Paket", await ev(`installedPacks.fr.texts['personal.firstName']!=='Prénom (eigen)'`));
await ev(`translateCode=null;renderAdminSection()`);

// 2. Offline reload keeps it -----------------------------------------------------------------
await offline(true);
await reload();
await ev(HELPERS);
check("Offline neu geladen: Paket weiter da", await ev(`hasLanguage('fr')&&translator('fr').name==='Français'`));
await ev(`openAdmin('languages')`);
await until(`document.getElementById('admin-pin-dialog').open`);
await ev(`unlockAdmin()`);
await until(`adminAccess.isUnlocked() && !!document.querySelector('.app-lang-list')`);
await until(`!!document.querySelector('[data-admin-action="pack-index-reload"]') || !!document.querySelector('[data-compare-pack]')`);
check("Offline: die Liste meldet sich als nicht erreichbar, das installierte Paket bleibt", await ev(`!!document.querySelector('[data-admin-action="pack-index-reload"]')&&!!document.querySelector('[data-remove-language="fr"]')`));

// 3. Studio texts in French, offered to customers -------------------------------------------
const frenchStudio = `(() => {
  const p = (x) => x ? '[fr] ' + x : x, s = JSON.parse(JSON.stringify(settings));
  const items = (list, keys) => Object.fromEntries(list.map((i) => [i.id, Object.fromEntries(keys.map((k) => [k, p(i[k])]))]));
  s.translations = { ...s.translations, fr: {
    app: Object.fromEntries(TRANSLATED.app.map((k) => [k, p(s.app[k])])),
    studio: Object.fromEntries(TRANSLATED.studio.map((k) => [k, p(s.studio[k])])),
    medical: items(s.medical, TRANSLATED.medical),
    legal: items(s.legal, TRANSLATED.legal),
  } };
  s.locale.customer = [s.locale.studio, 'fr'];
  adminDraft = s;
  return saveAdmin();
})()`;
await ev(frenchStudio);
check("Mit Studio-Texten: Französisch als Kundensprache angeboten", await ev(`offeredLanguages(settings).includes('fr')`));
await ev(`finishAdminLeave()`);
await until(`!document.getElementById('customer-app').hidden`);
await ev(`fillConsent({lastName:'Qzxpakete'})`);
await ev(`document.querySelector('[data-customer-language="fr"]').click()`);
await until(`document.documentElement.lang==='fr'`);
const label = (code) => `document.querySelector('label[for="firstName"]').textContent.includes(inLanguage('${code}',()=>t('personal.firstName')))`;
check("Kundenformular auf Französisch: Feldtexte und Studiotexte", await ev(`document.getElementById('customer-headline').textContent.startsWith('[fr] ')&&inLanguage('fr',()=>t('personal.firstName'))!==inLanguage('de',()=>t('personal.firstName'))&&${label("fr")}`));
await ev(`fillConsent({lastName:'Qzxpakete'})`);
check("Ausgefüllt und unterschrieben auf Französisch", await ev(`hasSignature()&&validate()`));

// 4. Remove the active pack; on the way back the form is German throughout -----------------
await ev(`openAdmin('languages')`);
await until(`document.getElementById('admin-pin-dialog').open`);
await ev(`unlockAdmin()`);
await until(`adminAccess.isUnlocked() && !!document.querySelector('[data-remove-language="fr"]')`);
check("In der Verwaltung bleibt die Oberfläche deutsch", await ev(`document.documentElement.lang==='de'`));
await ev(`document.querySelector('[data-remove-language="fr"]').click()`);
await answer();
await until(`!hasLanguage('fr')`);
check(
  "Paket entfernt: gespeicherte Einstellungen und Entwurf ohne Französisch, Formular zurück auf Deutsch",
  await ev(`!settings.locale.customer.includes('fr')&&!JSON.parse(localStorage.getItem(SETTINGS_KEY)).locale.customer.includes('fr')&&!adminDraft.locale.customer.includes('fr')&&customerLanguage==='de'&&!adminChanged()`),
);
check("Verwaltung bleibt deutsch und bedienbar", await ev(`document.documentElement.lang==='de'&&adminOpen&&!!document.querySelector('.app-lang-list')`));
await ev(`requestAdminLeave()`);
await until(`!document.getElementById('customer-app').hidden`);
check(
  "Zurück im Formular: Feldtexte und Studiotexte deutsch, keine Sprachauswahl mehr",
  await ev(`document.documentElement.lang==='de'&&document.getElementById('customer-headline').textContent===settings.app.headline&&${label("de")}&&document.querySelector('.question-title').textContent.trim().startsWith(MEDICAL[0].title.trim())&&document.getElementById('customer-language').hidden`),
);
check(
  "Eingaben und Gesundheitsangaben bleiben, Erklärungen, Foto und Unterschrift neu einzuholen",
  await ev(`document.getElementById('firstName').value==='Test'&&MEDICAL.every((q)=>choiceValue(q.id)==='no')&&LEGAL.every((i)=>!document.getElementById(i.id).checked)&&!choiceValue('photo')&&!hasSignature()&&!!document.getElementById('signature-error').textContent`),
);
await screenshot("pakete-entfernt-formular");
await ev(`resetCustomerForm()`);

// 5. Standalone HTML file with the installed pack, in a fresh profile, offline -------------------
await offline(false);
await ev(`openAdmin('languages')`);
await until(`document.getElementById('admin-pin-dialog').open`);
await ev(`unlockAdmin()`);
await until(`adminAccess.isUnlocked() && !!document.querySelector('.app-lang-list')`);
await ev(`document.querySelector('[data-admin-action="pack-index-reload"]')?.click()`);
await until(`!!document.querySelector('[data-install-pack="fr"]')`);
await ev(`document.querySelector('[data-install-pack="fr"]').click()`);
await until(`!!installedPacks.fr && !!document.querySelector('[data-compare-pack="fr"]')`);
await ev(frenchStudio);
check("Wieder installiert und als Kundensprache gewählt", await ev(`offeredLanguages(settings).includes('fr')`));
await ev(`window.__html=null;const o=URL.createObjectURL;URL.createObjectURL=(b)=>{if(b.type.startsWith('text/html'))b.text().then(t=>window.__html=t);return o(b)};exportHtml()`);
await until(`!!window.__html`);
const html = await ev(`window.__html`);
const pin = await ev(`localStorage.getItem(ADMIN_PIN_KEY)`);
const file = `${OUT}/pakete-studio.html`;
await writeFile(file, html);
check("HTML enthält das verwendete Paket, aber weder PIN noch Kundendaten", html.includes('"languages":{"fr":') && !!pin && !html.includes(pin) && !html.includes("Qzxpakete"));
await offline(true);
const fresh = await cmd("Page.addScriptToEvaluateOnNewDocument", { source: WIPE });
await navigate(pathToFileURL(file).href);
await cmd("Page.removeScriptToEvaluateOnNewDocument", { identifier: fresh.identifier });
await ev(HELPERS);
check("Frisches Profil, offline: Datei startet mit Französisch als Kundensprache", await ev(`location.protocol==='file:'&&!localStorage.getItem('inkform.sprachpakete.v1')&&hasLanguage('fr')&&offeredLanguages(settings).includes('fr')&&!!document.querySelector('#customer-language [data-customer-language="fr"]')`));
await ev(`document.querySelector('[data-customer-language="fr"]').click()`);
await until(`document.documentElement.lang==='fr'`);
check("Formular in der Datei auf Französisch", await ev(`document.getElementById('customer-headline').textContent.startsWith('[fr] ')`));

check("Keine Netzwerkzugriffe außer der lokalen Vorschau", requests.every((u) => !/^https?:/.test(u) || u.startsWith(ORIGIN)));
if (errors.length) console.log("Fehler:", JSON.stringify(errors).slice(0, 1500));
check("Keine JavaScript- oder CSP-Fehler", errors.length === 0);
process.exit(0);
