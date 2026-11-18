// Page "Sprachen": add a language, translate its app texts in the app, check each text like a pack,
// English for what is missing in the admin area, customers only once the form is complete and the
// PDF font can print it, remove it again. Synthetic data.
import { HELPERS, ORIGIN, connect } from "./lib.mjs";

const { cmd, ev, until, check, navigate, screenshot, errors, answer } = await connect();
await cmd("Emulation.setDeviceMetricsOverride", { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
const reset = await cmd("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.clear();sessionStorage.clear()}catch(_){}` });
await navigate(ORIGIN + "/index.html");
await cmd("Page.removeScriptToEvaluateOnNewDocument", { identifier: reset.identifier });
await ev(HELPERS);
await until(`document.getElementById('admin-pin-dialog')?.open`);
await ev(`(()=>{for(const id of ['admin-pin','admin-pin-repeat'])document.getElementById(id).value='839274';document.getElementById('admin-pin-form').requestSubmit()})()`);
await until(`adminAccess.isUnlocked()`);
await ev(`chooseOperatorLanguage('de')`);
await ev(`openAdmin('languages')`);
await until(`adminPage==='languages'&&document.getElementById('add-language')`);

check(
  "Seite in der Leiste unter Gerät, eingebaute Sprachen ohne Knöpfe",
  await ev(`!!document.querySelector('#admin-nav [data-admin-page="languages"][aria-current="page"]')
    &&document.querySelectorAll('.app-lang-row').length===languageCodes().length&&!document.querySelector('[data-remove-language="de"],[data-remove-language="en"]')`),
);
const set = (id, value) => ev(`(()=>{const el=document.getElementById('${id}');el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
await set("add-language", "es");
await set("add-region", "MX");
await ev(`document.querySelector('[data-admin-action="language-add"]').click()`);
await until(`translateCode==='es-MX'`);
check(
  "Spanisch mit Land Mexiko: Paket es-MX, Name in sich selbst, gespeichert, Flagge 🇲🇽",
  await ev(`hasLanguage('es-MX')&&translator('es-MX').name.startsWith('Español')&&!!JSON.parse(localStorage.getItem(PACKS_KEY))['es-MX']
    &&languageMark('es-MX').includes('🇲🇽')&&!!document.getElementById('app-tr-name')`),
);
await screenshot("uebersetzen-neu");
check("Erster Bereich: Formular, alle Texte noch offen", await ev(`translateGroup.startsWith('f:')&&document.querySelectorAll('.app-tr.missing').length===document.querySelectorAll('.app-tr').length`));

const write = (key, value, form = "") =>
  ev(`(()=>{const el=document.querySelector('[data-app-text="${key}"][data-app-form="${form}"]');el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));return el.closest('.app-tr').querySelector('.ad-field-error').hidden})()`);
const stored = (key) => ev(`JSON.parse(localStorage.getItem(PACKS_KEY))['es-MX'].texts[${JSON.stringify(key)}]`);
await ev(`(()=>{const el=document.getElementById('app-tr-group');el.value='f:customer';el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
await until(`translateGroup==='f:customer'`);
check("Falscher Platzhalter: Hinweis, nichts gespeichert", !(await write("customer.progressLabel", "{zahl} de 4 secciones")) && (await stored("customer.progressLabel")) === undefined);
check(
  "Hinweis nennt die Platzhalter",
  await ev(`document.querySelector('[data-app-key="customer.progressLabel"] .ad-field-error').textContent.includes('{anzahl}')`),
);
check("Richtiger Platzhalter: gespeichert", (await write("customer.progressLabel", "{anzahl} de 4 secciones completas")) && (await stored("customer.progressLabel")) === "{anzahl} de 4 secciones completas");
check("Fremde Auszeichnung abgelehnt", !(await write("customer.newForm", "<i>Nuevo</i>")) && (await stored("customer.newForm")) === undefined);
check("Fortschritt und Bereich zählen mit", await ev(`document.getElementById('app-tr-progress').textContent.includes(' 1 ')&&/\\(1\\/\\d+\\)$/.test(document.getElementById('app-tr-group').selectedOptions[0].textContent)`));

await ev(`(()=>{const el=document.getElementById('app-tr-group');el.value='f:pdf';el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
await until(`translateGroup==='f:pdf'`);
check(
  "Mehrzahl: ein Feld je Form der Sprache (Spanisch: one, many, other)",
  await ev(`[...document.querySelectorAll('[data-app-text="pdf.metaConsent"]')].map(e=>e.dataset.appForm).join()===new Intl.PluralRules('es-MX').resolvedOptions().pluralCategories.join()`),
);
check("Mehrzahl halb ausgefüllt: Hinweis", !(await write("pdf.metaConsent", "{anzahl} página · A4 · {kb} KB · con firma", "one")));
await write("pdf.metaConsent", "{anzahl} páginas · A4 · {kb} KB · con firma", "many");
check(
  "Alle Formen: gespeichert",
  (await write("pdf.metaConsent", "{anzahl} páginas · A4 · {kb} KB · con firma", "other")) && Object.keys((await stored("pdf.metaConsent")) ?? {}).length === 3,
);
await ev(`(()=>{const el=document.getElementById('app-tr-group');el.value='f:customer';el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
await until(`translateGroup==='f:customer'`);
await write("customer.progressLabel", "");
check("Leeres Feld: Text wieder offen", (await stored("customer.progressLabel")) === undefined);
await write("customer.newForm", "Nuevo formulario");
await ev(`(()=>{const el=document.getElementById('app-tr-missing');el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
check("Nur fehlende: übersetzte Texte ausgeblendet", await ev(`translateMissing&&!document.querySelector('[data-app-key="customer.newForm"]')&&!!document.querySelector('[data-app-key="customer.progressLabel"]')`));

await ev(`chooseOperatorLanguage('es-MX')`);
await until(`document.documentElement.lang==='es-MX'`);
check(
  "Verwaltung auf es-MX: Übersetztes auf Spanisch, Fehlendes auf Englisch",
  await ev(`t('customer.newForm')==='Nuevo formulario'&&t('admin.save')===translator('en').t('admin.save')&&t('pdf.metaConsent',{anzahl:2,kb:9})==='2 páginas · A4 · 9 KB · con firma'`),
);
await screenshot("uebersetzen-spanisch");

check("Englische Texte fürs PDF sind alle druckbar", await ev(`baseKeys().every(k=>{const v=builtinLanguage('en').texts[k];return !['pdf','common','health','personal','tattoo'].includes(k.split('.')[0])||!unsupportedPdfChars(typeof v==='string'?v:Object.values(v).join(' ')).length})`));
check("Kunden: unvollständige Sprache nicht wählbar", await ev(`!formReady('es-MX')&&!hasAllTexts(settings,'es-MX')`));
await ev(`(()=>{const p=installedPacks['es-MX'],en=builtinLanguage('en').texts,texts={...p.texts};for(const k of baseKeys())if(isFormKey(k)&&!(k in texts))texts[k]=typeof en[k]==='string'?en[k]:{one:en[k].one,many:en[k].other,other:en[k].other};storePacks({...installedPacks,'es-MX':{...p,texts}})})()`);
check("Alle Formulartexte da: für Kunden bereit", await ev(`formReady('es-MX')&&languageProgress('es-MX').form===languageProgress('es-MX').formTotal`));
await ev(`(()=>{const p=newPack('zh');p.texts['customer.newForm']='新表格';p.texts['pdf.headerLabel']='纹身同意书';storePacks({...installedPacks,zh:p})})()`);
check("Chinesisch: PDF-Schrift fehlt, nicht für Kunden", await ev(`languageProgress('zh').unprintable.join()==='pdf.headerLabel'&&!formReady('zh')`));

await ev(`chooseOperatorLanguage('de')`);
await ev(`translateCode=null;openAdmin('languages')`);
await until(`document.querySelector('[data-remove-language="es-MX"]')`);
check("Liste zeigt Stand und Hinweis zur PDF-Schrift", await ev(`document.querySelector('[data-remove-language="zh"]').closest('.app-lang-row').textContent.includes(t('appLanguages.unprintable'))`));
await screenshot("uebersetzen-liste");
await ev(`chooseOperatorLanguage('es-MX');openAdmin('languages')`);
await until(`document.querySelector('[data-remove-language="es-MX"]')`);
await ev(`document.querySelector('[data-remove-language="es-MX"]').click()`);
const question = await answer(true);
await until(`!hasLanguage('es-MX')`);
check(
  "Entfernen nach Rückfrage: weg aus Gerät und Speicher, Verwaltung zurück auf Englisch",
  question.includes("Español") && (await ev(`!JSON.parse(localStorage.getItem(PACKS_KEY))['es-MX']&&language().code==='en'&&!document.querySelector('[data-remove-language="es-MX"]')`)),
);
await ev(`chooseOperatorLanguage('de');storePacks({});adminDraft=JSON.parse(JSON.stringify(settings));finishAdminLeave()`);
check("Keine JavaScript- oder CSP-Fehler", errors.length === 0, JSON.stringify(errors));
process.exit(0);
