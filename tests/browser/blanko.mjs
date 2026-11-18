// Neutral edition (profile "blanko") in the hosted build: loaded once online, then in airplane mode:
//   - no Mac hints and no owner guide; PIN input takes digits only, with separate messages
//   - setup assistant at the first start, saved only on this device, not shown again
//   - sample data can be loaded and removed completely
//   - a consent works offline and carries the studio from the assistant
// Synthetic test data only.
import { pdfText } from "../lib/leaks.mjs";
import { HELPERS, ORIGIN, connect } from "./lib.mjs";

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
check("Offline geladen: Service Worker liefert die App im Flugmodus", await ev(`!!navigator.serviceWorker.controller&&BLANK_EDITION===true`));
check("Neutrales Logo und Symbol gehen nicht in Sicherungen", await ev(`builtInIcon().then(i=>builtInLogo===null&&i===null)`));
check("Seitentitel ohne Studionamen beginnt mit der Marke", await ev(`document.title==='INKFORM — Tattoo-Einwilligung'||document.title==='INKFORM — Admin-Konsole'`));
check("Keine Mac-Hinweise und keine Anleitung", await ev(`[...document.querySelectorAll('[data-studio-only]')].every(n=>n.hidden)&&[...document.querySelectorAll('[data-admin-action="guide"]')].every(n=>n.hidden)`));

// PIN at the first start -------------------------------------------------------------------
await until(`document.getElementById('admin-pin-dialog')?.open`);
const type = (id, value) => ev(`(()=>{const el=document.getElementById('${id}');el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));return el.value})()`);
const pinError = () => ev(`document.getElementById('admin-pin-error').hidden?'':document.getElementById('admin-pin-error').textContent`);
check("Beschriftung nennt Länge und nur Ziffern", await ev(`document.querySelector('label[for="admin-pin"]').textContent==='PIN (6 bis 12 Ziffern, nur Zahlen 0–9)'`));
check("Buchstaben und Zeichen werden beim Tippen entfernt, mit Hinweis", (await type("admin-pin", "83a9-2 74")) === "839274" && (await pinError()).includes("Nur Ziffern 0–9 erlaubt"));
check("Auch im Wiederholungsfeld", (await type("admin-pin-repeat", "8392x74")) === "839274");
await type("admin-pin", "12345");
await type("admin-pin-repeat", "12345");
await ev(`document.getElementById('admin-pin-form').requestSubmit()`);
await until(`document.getElementById('admin-pin-error').textContent.includes('zu kurz')`);
check("Zu kurze PIN: eigene Meldung", (await pinError()).includes("mindestens 6 Ziffern"));
await type("admin-pin", "839274");
await type("admin-pin-repeat", "839274");
await ev(`document.getElementById('admin-pin-form').requestSubmit()`);
await until(`adminAccess.isUnlocked() && adminPage==='setup' && !!document.querySelector('[data-admin-action="setup-new"]')`);

// Setup assistant ---------------------------------------------------------------------------
check(
  "Nach der PIN: zwei Wege (neu, aus Datei für Gesamtsicherung oder Studio-Einstellungen) mit Hinweis auf Gesundheitsdaten",
  await ev(`document.querySelectorAll('.setup-way').length===2&&document.getElementById('admin-app').textContent.includes('Aus Datei übernehmen')&&document.getElementById('admin-app').textContent.includes('Eine Gesamtsicherung (alles, auch Einnahmen und PDFs) oder Studio-Einstellungen')&&document.getElementById('admin-app').textContent.includes('Gesundheitsangaben und Unterschriften')`),
);
await screenshot("blanko-zwei-wege");
check("Bei der Auswahl keine Speicherleiste", await ev(`document.getElementById('admin-savebar').hidden`));
await ev(`document.querySelector('[data-admin-action="setup-new"]').click()`);
await until(`!!document.getElementById('admin-studio-name')`);
check(
  "Pflichtfelder mit Stern und aria-required, die Fristen ohne",
  await ev(`['name','contact','address','location'].every(k=>{const f=document.getElementById('admin-studio-'+k);return f.getAttribute('aria-required')==='true'&&document.querySelector('label[for="admin-studio-'+k+'"] .required')?.textContent==='*'})&&!document.querySelector('label[for="setup-pdf-years"] .required')`),
);
check("Neu einrichten öffnet den Einrichtungsassistenten, Felder leer", await ev(`document.getElementById('admin-page-title').textContent==='Einrichtung'&&['name','contact','address','location'].every(k=>document.getElementById('admin-studio-'+k).value==='')`));
await ev(`(async()=>{const c=document.createElement('canvas');c.width=c.height=64;c.getContext('2d').fillRect(8,8,48,48);const b=await new Promise(r=>c.toBlob(r,'image/png'));const dt=new DataTransfer();dt.items.add(new File([b],'logo.png',{type:'image/png'}));const i=document.getElementById('logo-file');i.files=dt.files;i.dispatchEvent(new Event('change'))})()`);
await until(`document.querySelector('.studio-logo').src.startsWith('blob:')`);
check("Logo schon im Assistenten hochladbar, gilt sofort", await ev(`adminPage==='setup'&&!!document.querySelector('[data-admin-action="logo-remove"]')&&document.querySelector('.ad-brand .studio-logo').src.startsWith('blob:')`));
await screenshot("blanko-einrichtung");
check("Assistent bietet App-Symbol und den Weg zurück zur Auswahl", await ev(`adminPage==='setup'&&!!document.querySelector('#admin-app [data-admin-action="icon-choose"]')&&!!document.querySelector('#admin-app [data-admin-action="setup-back"]')`));
await ev(`openAdminAuthorized('export')`);
check("Vor der Einrichtung führt jede Admin-Seite zum Assistenten", await ev(`adminPage==='setup'`));
await ev(`document.querySelector('[data-admin-action="setup-finish"]').click()`);
check("Ohne Angaben: klare Meldung, nichts gespeichert", await ev(`!document.getElementById('admin-error').hidden&&document.getElementById('admin-error').textContent.startsWith('Bitte noch prüfen.')&&!localStorage.getItem(SETTINGS_KEY)`));
const marked = `['name','contact','address','location'].filter(k=>document.getElementById('admin-studio-'+k).getAttribute('aria-invalid')==='true'&&document.getElementById('admin-studio-'+k).parentElement.querySelector('.setup-required'))`;
check(
  "Fehlende Pflichtfelder rot markiert, in der Meldung als Sprung-Knöpfe genannt, Fokus auf dem ersten",
  await ev(`${marked}.length===4&&document.activeElement.id==='admin-studio-name'&&[...document.querySelectorAll('#admin-error [data-jump-field]')].map(b=>b.dataset.jumpField).join()==='admin-studio-name,admin-studio-contact,admin-studio-address,admin-studio-location'&&document.getElementById('admin-error').textContent.includes(t('studioPage.location'))`),
);
await ev(`document.querySelector('#admin-error [data-jump-field="admin-studio-location"]').click()`);
check("Knopf in der Meldung springt zum Feld", await ev(`document.activeElement.id==='admin-studio-location'`));
check("Meldung bleibt beim Scrollen sichtbar", await ev(`getComputedStyle(document.getElementById('admin-error')).position==='sticky'`));
await screenshot("blanko-pflichtfelder");
await type("admin-studio-name", "Atelier Probe · Kim Test");
check("Eingetragen: Markierung und Knopf weg, die anderen bleiben", await ev(`${marked}.join()==='contact,address,location'&&!document.querySelector('#admin-error [data-jump-field="admin-studio-name"]')&&!document.getElementById('admin-error').hidden`));
check(
  "Unten nur „Einrichtung abschließen“, kein Speichern in Teilen",
  await ev(`(()=>{const v=id=>{const e=document.getElementById(id);return !e.hidden&&e.getBoundingClientRect().width>0};return v('admin-savebar')&&v('admin-setup-finish')&&!v('admin-save')&&!v('admin-discard')&&document.getElementById('admin-save-state').textContent==='Einrichtung noch nicht abgeschlossen'&&document.querySelectorAll('#admin-section [data-admin-action="setup-finish"]').length===0})()`),
);
await ev(`document.querySelector('#admin-nav [data-admin-page="overview"]').click()`);
check("Navigation führt weiter zum Assistenten, Eingabe bleibt, nichts gespeichert", await ev(`adminPage==='setup'&&needsSetup()&&document.getElementById('admin-studio-name').value==='Atelier Probe · Kim Test'&&!localStorage.getItem(SETTINGS_KEY)`));
await ev(`document.getElementById('admin-error').hidden=true;window.dispatchEvent(new KeyboardEvent('keydown',{key:'s',metaKey:true,cancelable:true}))`);
check("⌘S im Assistenten: kein Speichern in Teilen, Hinweis auf Pflichtangaben", await ev(`!document.getElementById('admin-error').hidden&&adminPage==='setup'&&!localStorage.getItem(SETTINGS_KEY)`));
await ev(`document.querySelector('[data-admin-action="setup-back"]').click()`);
check("Zurück zur Auswahl mit Eingaben: Rückfrage, Eingaben bleiben", await ev(`document.getElementById('admin-discard-dialog').open&&adminPage==='setup'&&document.getElementById('admin-studio-name').value==='Atelier Probe · Kim Test'`));
await ev(`document.getElementById('admin-discard-confirm').click()`);
check("Zurück zur Auswahl verwirft die Eingaben: Datei einspielen nicht blockiert", await ev(`!adminChanged()&&!replaceBlocker()&&!!document.querySelector('[data-admin-action="setup-file"]')`));
check("Einrichtung: zwei Wege, ein Knopf „Aus Datei übernehmen“ für beide Dateiarten", await ev(`document.querySelectorAll('.setup-way').length===2&&document.querySelectorAll('[data-admin-action="setup-file"]').length===1&&document.querySelector('[data-admin-action="setup-file"] strong').textContent===t('setup.restore')`));
await ev(`document.querySelector('[data-admin-action="setup-new"]').click()`);
await type("admin-studio-name", "Atelier Probe · Kim Test");
await type("setup-pdf-years", "abc");
await ev(`document.querySelector('[data-admin-action="sample-load"]').click()`);
await until(`!!document.querySelector('[data-admin-action="sample-remove"]')`);
check("Neu gezeichneter Assistent behält eingetippte Fristen", await ev(`document.getElementById('setup-pdf-years').value==='abc'`));
await ev(`document.querySelector('[data-admin-action="sample-remove"]').click()`);
await until(`!!document.querySelector('[data-admin-action="sample-load"]') && incomeRecords().length===0`);
for (const [id, value] of [
  ["admin-studio-contact", "kontakt-ohne-at"],
  ["admin-studio-address", "Probeweg 2, 54321 Teststadt"],
  ["admin-studio-location", "Teststadt"],
])
  await type(id, value);
await ev(`document.querySelector('[data-admin-action="setup-finish"]').click()`);
const flagged = `[...document.querySelectorAll('#admin-section [aria-invalid="true"]')].map(e=>e.id).join()`;
check("Falsche E-Mail und falsche Frist: am Feld markiert, Sprung-Knöpfe, Fokus auf der E-Mail", await ev(`${flagged}==='admin-studio-contact,setup-pdf-years'&&document.getElementById('admin-studio-contact').parentElement.querySelector('.setup-required').textContent===t('setup.invalidEmail')&&document.getElementById('setup-pdf-years').parentElement.querySelector('.setup-required').textContent===t('setup.invalidYears')&&document.querySelectorAll('#admin-error [data-jump-field]').length===2&&document.activeElement.id==='admin-studio-contact'`));
check("Ungültige Angaben: Einrichtung und Fristen nicht gespeichert", await ev(`!document.getElementById('admin-error').hidden&&adminPage==='setup'&&needsSetup()&&!localStorage.getItem(RETENTION_KEY)`));
await screenshot("blanko-falsche-angaben");
await type("admin-studio-contact", "kontakt@atelier-probe.example");
check("Pflichtfelder richtig: nur die Frist bleibt markiert", await ev(`${flagged}==='setup-pdf-years'`));
for (const [id, value] of [
  ["admin-studio-name", "Atelier Probe · Kim Test"],
  ["admin-studio-contact", "kontakt@atelier-probe.example"],
  ["admin-studio-address", "Probeweg 2, 54321 Teststadt"],
  ["admin-studio-location", "Teststadt"],
  ["setup-pdf-years", "10"],
])
  await type(id, value);
check(
  "Assistent: Studiosprache eine, Kundensprachen zum Ankreuzen (Studiosprache immer dabei)",
  await ev(`!!document.getElementById('locale-studio')&&(b=>b.de.checked&&b.de.disabled&&!b.en.checked&&!b.en.disabled)({de:document.querySelector('[data-locale-customer="de"]'),en:document.querySelector('[data-locale-customer="en"]')})`),
);
await ev(`(e=>{e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}))})(document.querySelector('[data-locale-customer="en"]'))`);
check("Angekreuzt, Eingaben bleiben", await ev(`document.querySelector('[data-locale-customer="en"]').checked&&document.getElementById('admin-studio-name').value==='Atelier Probe · Kim Test'&&document.getElementById('setup-pdf-years').value==='10'`));
check("Vor dem Abschluss: „Einrichtung“ in der Seitenleiste", await ev(`!!document.querySelector('#admin-nav [data-admin-page="setup"]')`));
await ev(`document.querySelector('[data-admin-action="setup-finish"]').click()`);
await until(`adminPage==='overview'`);
check("Nach dem Abschluss: „Einrichtung“ nicht mehr in der Seitenleiste", await ev(`!document.querySelector('#admin-nav [data-admin-page="setup"]')`));
check(
  "Einrichtung gespeichert, nur auf dem Gerät: Studio, Kontakt, Frist",
  await ev(`JSON.parse(localStorage.getItem(SETTINGS_KEY)).studio.name==='Atelier Probe · Kim Test'&&readRetention(localStorage).pdfYears===10`),
);
await ev(`openAdminAuthorized('setup')`);
check("Einrichtung danach erneut geöffnet: Auswahl statt „noch nicht abgeschlossen“", await ev(`adminPage==='setup'&&!!document.querySelector('[data-admin-action="setup-new"]')&&document.getElementById('admin-setup-finish').hidden&&document.getElementById('admin-save-state').textContent!==t('setup.barState')`));
await ev(`finishAdminLeave()`);
check("Kundenformular zeigt das eingerichtete Studio", await ev(`document.getElementById('customer-studio-name').textContent==='Atelier Probe'`));
check("Englisch aus dem Assistenten: Flaggen-Knöpfe im Formular", await ev(`JSON.parse(localStorage.getItem(SETTINGS_KEY)).locale.customer.join()==='de,en'&&!document.getElementById('customer-language').hidden&&document.querySelectorAll('[data-customer-language]').length===2`));
await reload();
await ev(HELPERS);
check("Nach dem Neuladen kein Assistent mehr", await ev(`!document.getElementById('admin-pin-dialog').open&&!document.getElementById('customer-app').hidden`));

// Studio page keeps the values editable later -------------------------------------------------
await ev(`openAdmin('studio')`);
await until(`document.getElementById('admin-pin-dialog').open`);
check("Entsperren: Buchstaben werden auch hier entfernt", (await type("admin-pin", "83a9274")) === "839274");
await ev(`document.getElementById('admin-pin-form').requestSubmit()`);
await until(`adminAccess.isUnlocked() && adminPage==='studio'`);
check("Angaben später unter „Studio & Kontakt“ änderbar", await ev(`document.getElementById('admin-studio-address').value==='Probeweg 2, 54321 Teststadt'`));

// Sample data --------------------------------------------------------------------------------
await ev(`openAdminAuthorized('overview')`);
check("Standard ist leer", await ev(`incomeRecords().length===0&&!!document.querySelector('[data-admin-action="sample-load"]')`));
await ev(`window.__keep=exportFeature.keep;let n=0;exportFeature.keep=(id,blob)=>++n===3?Promise.reject(Error('Speicher voll (Test)')):window.__keep(id,blob);document.querySelector('[data-admin-action="sample-load"]').click()`);
await until(`document.getElementById('toast').textContent.includes('Beispieldaten nicht geladen')`);
await until(`createIndexedDbFiles(indexedDB, ARCHIVE_DB).keys().then(k=>k.length===0)`);
check("Fehler beim Laden: ganz oder gar nicht, keine Einträge und keine PDFs übrig", await ev(`incomeRecords().length===0&&!!document.querySelector('[data-admin-action="sample-load"]')`));
await ev(`exportFeature.keep=window.__keep`);
await ev(`document.querySelector('[data-admin-action="sample-load"]').click()`);
await until(`!!document.querySelector('[data-admin-action="sample-remove"]')`);
check("Beispieldaten: 6 erfundene Einträge mit PDFs", (await ev(`incomeRecords().length===6&&incomeRecords().every(r=>r.id.startsWith('beispiel-'))`)) && (await ev(`createIndexedDbFiles(indexedDB, ARCHIVE_DB).keys().then(k=>k.length)`)) === 6);
await ev(`openAdminAuthorized('export');(()=>{const el=document.getElementById('export-month');el.value=previousMonth(localDate());el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
await until(`document.getElementById('export-preview').textContent.includes('Davon')`);
check("Beispieldaten lassen sich exportieren", await ev(`document.getElementById('export-preview').textContent.includes('Davon 3 Einwilligungen')`));
await ev(`openAdminAuthorized('overview');document.querySelector('[data-admin-action="sample-remove"]').click()`);
await until(`!!document.querySelector('[data-admin-action="sample-load"]')`);
await until(`createIndexedDbFiles(indexedDB, ARCHIVE_DB).keys().then(k=>k.length===0)`);
check("Beispieldaten vollständig entfernt (Einträge und PDFs)", await ev(`incomeRecords().length===0`));
await ev(`finishAdminLeave()`);

// A consent offline with the studio from the assistant ----------------------------------------
await ev(`fillConsent({firstName:'Mira',lastName:'Ölmann'});form.requestSubmit()`);
await until(`!document.getElementById('completion-screen').hidden && !!pendingConsent && (async()=>await pendingConsent.kept)()`);
const pdf = pdfText(Buffer.from(await ev(`blobBase64(pendingConsent.blob)`), "base64"));
check("Einwilligungs-PDF nennt das eingerichtete Studio und die Kundin", pdf.includes("Atelier Probe · Kim Test") && pdf.includes("Probeweg 2, 54321 Teststadt") && pdf.includes("Mira Ölmann"));
await ev(`document.getElementById('completion-unlock').click()`);
await until(`document.getElementById('admin-pin-dialog').open`);
await ev(`unlockAdmin()`);
await until(`document.getElementById('pdf-dialog').open && !nativeShareInFlight`);
await ev(`document.getElementById('pdf-next').click()`);
await until(`!document.getElementById('customer-app').hidden && incomeRecords().length===1`);
await until(`createIndexedDbFiles(indexedDB, ARCHIVE_DB).keys().then(k=>k.length===1)`);
check("Gebucht und für den Export gespeichert, alles im Flugmodus", true);

// Unreadable settings in the blank edition: no assistant over them (it would overwrite them), the
// notice instead; the customer form stays locked.
await ev(`localStorage.setItem(SETTINGS_KEY,'{"schemaVersion":1,"studio":');window.__old=true;history.replaceState(null,'',location.pathname);location.reload();0`);
await until(`!window.__old&&typeof adminAccess!=='undefined'&&document.readyState==='complete'&&document.getElementById('admin-pin-dialog').open`);
await ev(HELPERS);
await ev(`unlockAdmin()`);
await until(`adminAccess.isUnlocked()&&adminOpen`);
check(
  "Unlesbare Einstellungen: kein Assistent, Hinweis statt dessen, gespeicherte Daten unverändert",
  await ev(`adminPage==='overview'&&!needsSetup()&&!!document.querySelector('.ad-broken-notice')&&!document.querySelector('[data-admin-action="setup-new"]')&&localStorage.getItem(SETTINGS_KEY)==='{"schemaVersion":1,"studio":'`),
);
await ev(`finishAdminLeave()`);
await ev(`form.requestSubmit()`);
check(
  "Unlesbare Einstellungen: Kundenformular gesperrt, Absenden tut nichts",
  await ev(`!document.getElementById('settings-locked').hidden&&!document.getElementById('start').checkVisibility()&&!document.querySelector('#customer-app>.bottom-bar').checkVisibility()&&!document.querySelector('[aria-invalid="true"]')&&!pendingConsent`),
);
check("Keine Netzwerkzugriffe außer der lokalen Vorschau", requests.every((u) => !/^https?:/.test(u) || u.startsWith(ORIGIN)));
check("Keine JavaScript- oder CSP-Fehler", errors.length === 0);
process.exit(0);
