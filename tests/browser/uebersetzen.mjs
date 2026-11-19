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
  "Seite in der Leiste unter Formular, eingebaute Sprachen ohne Knöpfe",
  await ev(`!!document.querySelector('#admin-nav [data-admin-page="languages"][aria-current="page"]')
    &&document.querySelectorAll('.app-lang-list:not([data-pack-index]) .app-lang-row').length===languageCodes().length&&!document.querySelector('[data-remove-language="de"],[data-remove-language="en"]')`),
);
check(
  "Oben: Sprache der Verwaltung, Studiosprache und Sprachen für Kunden",
  await ev(`!!document.getElementById('operator-language')&&!!document.querySelector('#admin-section [data-locale-customer="en"]')`),
);
await ev(`(()=>{const b=document.querySelector('#admin-section [data-locale-customer="en"]');b.click()})()`);
check("Kundensprache umschalten: Speichern-Leiste erscheint", await ev(`adminChanged()&&!document.getElementById('admin-savebar').hidden`));
await ev(`adminDraft=JSON.parse(JSON.stringify(settings));renderAdminSection()`);
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

// Translation file: download, translate outside, upload with a preview ---------------------------
let saved = null;
await ev(`window.__saveFile=saveFile;saveFile=async(f)=>{window.__savedFile=f;return 'download'}`);
await ev(`document.querySelector('[data-admin-action="translation-download"]').click()`);
await until(`!!window.__savedFile`);
saved = await ev(`(async()=>({name:window.__savedFile.name,text:await window.__savedFile.text()}))()`);
await ev(`saveFile=window.__saveFile`);
const file = JSON.parse(saved.text);
check(
  "Datei zum Übersetzen: Name mit Sprache, jeder Text mit Deutsch, Englisch und Übersetzung",
  saved.name.endsWith(`_${await ev(`t('file.translation')`)}_es-MX.json`) && file.kind === "inkform-uebersetzung" && file.code === "es-MX"
    && file.texts["customer.newForm"].translation === "Nuevo formulario" && file.texts["customer.admin"].translation === "" && typeof file.texts["customer.admin"].en === "string",
);
file.texts["customer.newForm"].translation = "Formulario nuevo";
file.texts["customer.admin"].translation = "Consola de administración";
file.texts["customer.progressLabel"].translation = "sin número";
const upload = (value, name, target) =>
  ev(`(()=>{translationTarget=${JSON.stringify(target)};const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(JSON.stringify(value))}],${JSON.stringify(name)},{type:'application/json'}));const i=document.getElementById('translation-file');i.files=dt.files;i.dispatchEvent(new Event('change'))})()`);
await upload(file, "uebersetzt.json", "es-MX");
await until(`!!translationImport&&!!document.querySelector('[data-admin-action="translation-apply"]')`);
check(
  "Vorschau: 1 neu, 1 geändert, 1 abgelehnt mit Grund, noch nichts gespeichert",
  await ev(`translationImport.added.length===1&&translationImport.changed.length===1&&translationImport.refused.length===1
    &&document.getElementById('admin-section').textContent.includes('{anzahl}')
    &&JSON.parse(localStorage.getItem(PACKS_KEY))['es-MX'].texts['customer.newForm']==='Nuevo formulario'`),
);
await screenshot("uebersetzen-vorschau");
await ev(`document.querySelector('[data-admin-action="translation-apply"]').click()`);
await until(`!translationImport`);
check(
  "Übernehmen: Texte gespeichert, Bearbeiten und Datei gemischt",
  await ev(`(()=>{const p=JSON.parse(localStorage.getItem(PACKS_KEY))['es-MX'].texts;return p['customer.newForm']==='Formulario nuevo'&&p['customer.admin']==='Consola de administración'&&!('customer.progressLabel' in p)&&p['pdf.metaConsent']?.many})()`),
);
await upload({ ...file, code: "fr" }, "falsch.json", "es-MX");
await until(`!document.getElementById('toast').hidden&&document.getElementById('toast').textContent.toLowerCase().includes('français')`);
check("Datei einer anderen Sprache: abgelehnt mit Hinweis", await ev(`!translationImport`));
await ev(`translateCode=null;renderAdminSection()`);
await upload({ ...file, code: "pt-BR", name: "Português (Brasil)", locale: "pt-BR" }, "pt.json", null);
await until(`!!translationImport`);
check("Neue Sprache aus Datei: Vorschau sagt es an", await ev(`translationImport.isNew&&translationImport.code==='pt-BR'&&!hasLanguage('pt-BR')`));
await ev(`document.querySelector('[data-admin-action="translation-apply"]').click()`);
await until(`hasLanguage('pt-BR')`);
check("Übernommen: Sprache angelegt, Übersetzen offen", await ev(`translateCode==='pt-BR'&&translator('pt-BR').name==='Português (Brasil)'&&t('customer.admin')!==''`));
await ev(`chooseOperatorLanguage('es-MX')`);
await until(`document.documentElement.lang==='es-MX'`);
check(
  "Verwaltung auf es-MX: Übersetztes auf Spanisch, Fehlendes auf Englisch",
  await ev(`t('customer.newForm')==='Formulario nuevo'&&t('admin.save')===translator('en').t('admin.save')&&t('pdf.metaConsent',{anzahl:2,kb:9})==='2 páginas · A4 · 9 KB · con firma'`),
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
// One place for languages: iPad & Settings and Studio & Contact only point to it -----------------
await ev(`chooseOperatorLanguage('de');translateCode=null;openAdmin('ipad')`);
await until(`adminPage==='ipad'`);
check(
  "iPad & Einstellungen und Studio & Kontakt: keine Sprachfelder, nur der Verweis auf Sprachen",
  await ev(`!document.getElementById('operator-language')&&!document.querySelector('[data-locale-customer]')&&!!document.querySelector('#admin-section .ad-notice [data-admin-page="languages"]')`)
    && (await ev(`(openAdmin('studio'),!document.getElementById('operator-language')&&!document.querySelector('[data-locale-customer],#admin-locale-currency')&&!!document.querySelector('#admin-section .ad-notice [data-admin-page="languages"]'))`)),
);
await ev(`document.querySelector('#admin-section .ad-notice [data-admin-page="languages"]').click()`);
await until(`adminPage==='languages'`);
check(
  "Seite Sprachen: Gerätesprache, Studiosprache, Kundensprachen und Währung an einem Ort",
  await ev(`!!document.getElementById('operator-language')&&!!document.querySelector('[data-locale-customer="en"]')&&!!document.getElementById('admin-locale-currency')`),
);
await ev(`document.querySelector('[data-edit-texts="en"]').click()`);
check("„Studio-Texte übersetzen“ öffnet die Texte in dieser Sprache", await ev(`adminPage==='content'&&editLanguage==='en'&&!!document.querySelector('[data-translation-field]')`));
await ev(`editLanguage=null;openAdmin('languages')`);
await upload({ ...file, code: "pt-BR", name: "Português (Brasil)", locale: "pt-BR" }, "pt2.json", null);
await until(`adminPage==='languages'&&!!translationImport`);
check("Datei-Upload aus der Liste: Vorschau", await ev(`translationImport.code==='pt-BR'&&!translationImport.isNew`));
await ev(`document.querySelector('[data-admin-action="translation-cancel"]').click()`);
await screenshot("uebersetzen-ein-ort");
await ev(`chooseOperatorLanguage('de');storePacks({});adminDraft=JSON.parse(JSON.stringify(settings));finishAdminLeave()`);
check("Keine JavaScript- oder CSP-Fehler", errors.length === 0, JSON.stringify(errors));
process.exit(0);
