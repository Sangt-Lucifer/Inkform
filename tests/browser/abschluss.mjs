// Completion flow of the real app (app.js) in the hosted build, offline after the first load:
//   - Unicode names end up correctly in the signed PDF (embedded Noto Sans)
//   - income is booked only when the owner confirms the filing, exactly once
//   - a reload on "Vielen Dank" loses neither the PDF nor the income entry
//   - if the PDF cannot be restored, the entry can be booked as "PDF fehlt"
//   - the PIN lockout survives a reload
//   - characters the PDF font cannot print are rejected before anything is created
// Synthetic test data only.
import { writeFile } from "node:fs/promises";
import { pdfText } from "../lib/leaks.mjs";
import { HELPERS, OUT, ORIGIN, connect } from "./lib.mjs";

const { cmd, ev, until, check, navigate, reload, screenshot, offline, requests, errors } = await connect();
await cmd("Emulation.setDeviceMetricsOverride", { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
const reset = await cmd("Page.addScriptToEvaluateOnNewDocument", {
  source: `try{localStorage.clear();sessionStorage.clear();indexedDB.deleteDatabase('inkform-pending')}catch(_){}`,
});
await navigate(ORIGIN + "/index.html");
await cmd("Page.removeScriptToEvaluateOnNewDocument", { identifier: reset.identifier });
// From here on: airplane mode. The service worker serves every reload.
await until(`navigator.serviceWorker.ready.then(() => true)`);
await reload();
await offline(true);
await reload();
const helpers = () => ev(HELPERS);
await helpers();
await until(`document.getElementById('admin-pin-dialog')?.open`);
await ev(`document.getElementById('admin-pin').value='839274';document.getElementById('admin-pin-repeat').value='839274';document.getElementById('admin-pin-form').requestSubmit()`);
await until(`adminAccess.isUnlocked()`);
await ev(`finishAdminLeave()`);
const pendingFiles = () => ev(`createIndexedDbFiles().keys().then(k=>k.length).catch(()=>-1)`);
const unlockFromThanks = async () => {
  await ev(`document.getElementById('completion-unlock').click()`);
  await until(`document.getElementById('admin-pin-dialog').open`);
  await ev(`unlockAdmin()`);
  await until(`document.getElementById('pdf-dialog').open && !nativeShareInFlight`);
};

// 0. Validation and signature (app.js) -----------------------------------------------------
await ev(`fillConsent({birthDate:new Date(Date.now()-17*365.25*864e5).toISOString().slice(0,10)})`);
check("Unter 18: Formular wird nicht freigegeben", await ev(`!validate()&&!document.getElementById('error-summary').hidden&&!pendingConsent`));
await ev(`fillConsent();ink.strokes=[];ink.signedAt=null;redraw()`);
check("Ohne Unterschrift: kein PDF", await ev(`!validate()&&!!document.getElementById('signature-error').textContent`));
await ev(`ink.strokes=[[{x:.5,y:.5,pressure:.5}]];ink.signedAt=Date.now()`);
check("Ein einzelner Punkt gilt nicht als Unterschrift", await ev(`!hasSignature()&&!validate()`));
await ev(`fillConsent();document.getElementById(LEGAL[0].id).click()`);
check("Fehlende Pflicht-Einwilligung blockiert das PDF", await ev(`!validate()`));
await ev(`fillConsent();document.getElementById('lastName').value='Neu';document.getElementById('lastName').dispatchEvent(new Event('input',{bubbles:true}))`);
check("Änderung nach dem Unterschreiben verlangt eine neue Unterschrift", await ev(`!hasSignature()&&!validate()`));
await ev(`resetCustomerForm()`);

// 1. Unicode names in the PDF -------------------------------------------------------------
await ev(`fillConsent({firstName:'Gül',lastName:'Şahin',artist:'Łukasz Ćwik',motif:'Schriftzug „Ayşe Yıldız“ – Ąę Żółć',placement:'Unterarm'});form.requestSubmit()`);
await until(`!document.getElementById('completion-screen').hidden && !!pendingConsent`);
const pdf = Buffer.from(await ev(`blobBase64(pendingConsent.blob)`), "base64");
await writeFile(OUT + "/abschluss-unicode.pdf", pdf);
const text = pdfText(pdf);
for (const name of ["Gül Şahin", "Łukasz Ćwik", "„Ayşe Yıldız“ – Ąę Żółć"])
  check(`PDF enthält „${name}“ korrekt`, text.includes(name));
check("PDF bettet Noto Sans als Teilschrift ein (Normal und Fett)", (pdf.toString("latin1").match(/\/BaseFont \/NotoSans/g) ?? []).length >= 2 && !/Helvetica/.test(pdf.toString("latin1")));
check("Dateiname behält die Buchstaben (Şahin_Gül)", await ev(`pendingConsent.filename.includes('Şahin_Gül')`));

// 2. Not booked yet; reload on "Vielen Dank" keeps everything -----------------------------
check("Vor der Bestätigung keine Einnahme gebucht", await ev(`incomeRecords().length===0`));
await until(`(async()=>pendingConsent.kept && await pendingConsent.kept)()`);
check("Offene Einwilligung lokal gesichert (Metadaten + PDF)", (await ev(`!!localStorage.getItem(PENDING_KEY)`)) && (await pendingFiles()) === 1);
const size = pdf.length;
await reload();
await helpers();
check("Nach Neuladen: weiterhin „Vielen Dank“, Formular und Admin gesperrt", await ev(`!document.getElementById('completion-screen').hidden&&document.getElementById('completion-title').textContent==='Vielen Dank'&&document.getElementById('customer-app').hidden&&!adminAccess.isUnlocked()`));
await screenshot("abschluss-nach-neuladen");
await reload();
await helpers();
check("Mehrfaches Neuladen bucht nichts", await ev(`incomeRecords().length===0&&!document.getElementById('completion-screen').hidden`));
await unlockFromThanks();
check("Inhaber bekommt nach dem Neuladen das unveränderte PDF", await ev(`pdfArtifact===pendingConsent&&pendingConsent.blob.size===${size}&&document.getElementById('pdf-title').textContent==='Dein PDF ist bereit.'&&!document.getElementById('pdf-next').hidden&&document.getElementById('pdf-missing').hidden`));
await ev(`document.getElementById('pdf-next').click()`);
await until(`!document.getElementById('customer-app').hidden`);
await until(`(async()=>!localStorage.getItem(PENDING_KEY) && (await createIndexedDbFiles().keys()).length===0)()`);
check("Nach Bestätigung genau eine Einnahme, PDF-Kopie vom Gerät entfernt", await ev(`incomeRecords().length===1&&incomeRecords()[0].customer==='Gül Şahin'&&incomeRecords()[0].artist==='Łukasz Ćwik'&&!('pdfMissing' in incomeRecords()[0])`));
await reload();
await helpers();
check("Neuladen nach Bestätigung: Formular frei, nichts doppelt", await ev(`document.getElementById('completion-screen').hidden&&!document.getElementById('customer-app').hidden&&incomeRecords().length===1`));

// 3. Interrupted confirmation (booked, but pending not yet removed) -> no double booking ---
await ev(`fillConsent({firstName:'Łukasz',lastName:'Ćwik'});form.requestSubmit()`);
await until(`!!pendingConsent && (async()=>await pendingConsent.kept)()`);
await ev(`incomeFeature.book(pendingConsent.incomeEntry)`); // as if the app stopped right after booking
await reload();
await helpers();
await unlockFromThanks();
await ev(`document.getElementById('pdf-next').click()`);
await until(`!document.getElementById('customer-app').hidden`);
check("Abgebrochene Bestätigung wiederholt: trotzdem nur ein Eintrag", await ev(`incomeRecords().filter(r=>r.customer==='Łukasz Ćwik').length===1&&incomeRecords().length===2`));

// 4. PDF lost before confirmation -> "PDF fehlt" ------------------------------------------
await ev(`fillConsent({firstName:'Ayşe',lastName:'Yıldız',totalPrice:'300,00',depositPaid:''});form.requestSubmit()`);
await until(`!!pendingConsent && (async()=>await pendingConsent.kept)()`);
await ev(`createIndexedDbFiles().clear()`);
await reload();
await helpers();
check("Ohne PDF-Kopie: „Vielen Dank“ bleibt, Einnahme nicht verloren", await ev(`!document.getElementById('completion-screen').hidden&&JSON.parse(localStorage.getItem(PENDING_KEY)).income.customer==='Ayşe Yıldız'&&incomeRecords().length===2`));
await unlockFromThanks();
check("Inhaber sieht „PDF nicht mehr verfügbar“ und nur „PDF fehlt“ buchen", await ev(`document.getElementById('pdf-title').textContent==='PDF nicht mehr verfügbar'&&!document.getElementById('pdf-missing').hidden&&document.getElementById('pdf-next').hidden&&document.getElementById('pdf-share').hidden&&document.getElementById('pdf-download').hidden`));
await screenshot("abschluss-pdf-fehlt");
await ev(`document.getElementById('pdf-missing').click()`);
await until(`!document.getElementById('customer-app').hidden`);
check("Einnahme mit Vermerk „PDF fehlt“ gebucht", await ev(`incomeRecords().length===3&&incomeRecords().find(r=>r.customer==='Ayşe Yıldız').pdfMissing===true&&!localStorage.getItem(PENDING_KEY)`));
await ev(`openAdmin('income')`);
await until(`document.getElementById('admin-pin-dialog').open`);
await ev(`unlockAdmin()`);
await until(`!!document.getElementById('income-filter-artist')`);
await ev(`(()=>{const el=document.getElementById('income-filter-year');el.value='';el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
check("Einnahmenliste zeigt „PDF fehlt“", await ev(`[...document.querySelectorAll('.income-table tbody tr')].some(tr=>tr.textContent.includes('Ayşe Yıldız')&&tr.textContent.includes('PDF fehlt'))`));
await ev(`window.__blob=null;const o=URL.createObjectURL;URL.createObjectURL=(b)=>{window.__blob=b;return o(b)};document.querySelector('[data-income-action="pdf"]').click()`);
const report = pdfText(Buffer.from(await ev(`blobBase64(pdfArtifact.blob)`), "base64"));
check("Einnahmen-PDF mit Unicode-Namen und „PDF fehlt“", ["Gül Şahin", "Łukasz Ćwik", "Ayşe Yıldız | PDF fehlt"].every((n) => report.includes(n)));
await ev(`document.getElementById('pdf-dialog').close();finishAdminLeave()`);

// 5. Characters the font cannot print ----------------------------------------------------
await ev(`fillConsent({firstName:'Anna ✓',lastName:'Test'});form.requestSubmit()`);
await until(`!document.getElementById('toast').hidden`);
check("Nicht darstellbares Zeichen wird vor der PDF-Erstellung gemeldet", await ev(`document.getElementById('toast').textContent.includes('✓')&&!pendingConsent&&document.getElementById('completion-screen').hidden`));
await ev(`resetCustomerForm()`);

// 6. PIN lockout survives a reload -------------------------------------------------------
for (let i = 0; i < 5; i++) {
  await ev(`openAdmin('overview')`);
  await until(`document.getElementById('admin-pin-dialog').open`);
  await ev(`unlockAdmin('000000')`);
  await until(`!document.getElementById('admin-pin-error').hidden && !document.getElementById('admin-pin-submit').disabled`);
  await ev(`document.getElementById('admin-pin-close').click()`);
}
await reload();
await helpers();
await ev(`openAdmin('overview')`);
await until(`document.getElementById('admin-pin-dialog').open`);
await ev(`unlockAdmin()`);
await until(`!document.getElementById('admin-pin-error').hidden`);
check("Nach 5 Fehlversuchen + Neuladen: auch die richtige PIN ist 30 s gesperrt", await ev(`!adminAccess.isUnlocked()&&document.getElementById('admin-pin-error').textContent.includes('Zu viele Fehlversuche')`));
await ev(`(()=>{const v=JSON.parse(localStorage.getItem(ADMIN_LOCK_KEY));v.blockedUntil=Date.now()-1;localStorage.setItem(ADMIN_LOCK_KEY,JSON.stringify(v))})();unlockAdmin()`);
await until(`adminAccess.isUnlocked()`);
check("Nach Ablauf der Sperre entsperrt die richtige PIN", await ev(`adminAccess.isUnlocked()&&JSON.parse(localStorage.getItem(ADMIN_LOCK_KEY)).blockedUntil===0`));

check("Keine Netzwerkzugriffe außer der lokalen Vorschau", requests.every((u) => !/^https?:/.test(u) || u.startsWith(ORIGIN)));
check("Keine JavaScript- oder CSP-Fehler", errors.length === 0);
process.exit(0);
