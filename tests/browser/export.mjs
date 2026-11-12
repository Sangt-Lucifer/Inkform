// ZIP export by period in the hosted build, offline after the first load:
//   - every confirmed consent PDF is kept for the export, "PDF fehlt" and removed entries are not
//   - preview with count and size, clear message for an empty period
//   - month, year, free range and the document filter
//   - the ZIP unpacks on the Mac with UTF-8 names, folders and unique file names
// Synthetic test data only.
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { pdfText } from "../lib/leaks.mjs";
import { HELPERS, OUT, ORIGIN, connect } from "./lib.mjs";

const { cmd, ev, until, check, navigate, reload, screenshot, offline, requests, errors } = await connect();
await cmd("Emulation.setDeviceMetricsOverride", { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
const reset = await cmd("Page.addScriptToEvaluateOnNewDocument", {
  source: `try{localStorage.clear();sessionStorage.clear();indexedDB.deleteDatabase('inkform-pending');indexedDB.deleteDatabase('inkform-archive')}catch(_){}`,
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
const archived = () => ev(`createIndexedDbFiles(indexedDB, ARCHIVE_DB).keys().then(k=>k.length)`);

async function consent(firstName, lastName, appointment) {
  await ev(`fillConsent({firstName:${JSON.stringify(firstName)},lastName:${JSON.stringify(lastName)},appointment:'${appointment}'});form.requestSubmit()`);
  await until(`!document.getElementById('completion-screen').hidden && !!pendingConsent && (async()=>await pendingConsent.kept)()`);
  const before = await archived();
  await ev(`document.getElementById('completion-unlock').click()`);
  await until(`document.getElementById('admin-pin-dialog').open`);
  await ev(`unlockAdmin()`);
  await until(`document.getElementById('pdf-dialog').open && !nativeShareInFlight`);
  await ev(`document.getElementById('pdf-next').click()`);
  await until(`!document.getElementById('customer-app').hidden && !localStorage.getItem(PENDING_KEY)`);
  await until(`createIndexedDbFiles(indexedDB, ARCHIVE_DB).keys().then(k=>k.length===${before + 1})`);
}
await consent("Gül", "Şahin", "2026-03-01");
await consent("Anna", "Muster", "2026-03-15");
await consent("Anna", "Muster", "2026-03-15");
await consent("Ayşe", "Yıldız", "2026-03-20");
await consent("Lena", "Weg", "2026-03-10");
await consent("Jürgen", "Müller", "2026-03-31");
await consent("Łukasz", "Ćwik", "2026-04-01");
check("Jede bestätigte Einwilligung ist für den Export gespeichert, die offene Kopie entfernt", (await archived()) === 7 && (await ev(`createIndexedDbFiles().keys().then(k=>k.length)`)) === 0);

// "PDF fehlt" in the editor and removing an entry also remove the PDF kept for the export.
await ev(`openAdmin('income')`);
await until(`document.getElementById('admin-pin-dialog').open`);
await ev(`unlockAdmin()`);
await until(`!!document.getElementById('income-filter-year')`);
const idOf = (name) => `incomeRecords().find(r=>r.customer===${JSON.stringify(name)}).id`;
await ev(`document.querySelector('[data-income-edit="'+${idOf("Ayşe Yıldız")}+'"]').click()`);
await until(`document.getElementById('income-editor').open`);
await ev(`document.getElementById('income-pdf-missing').click();document.getElementById('income-edit-form').requestSubmit()`);
await until(`!document.getElementById('income-editor').open`);
await ev(`document.querySelector('[data-income-remove="'+${idOf("Lena Weg")}+'"]').click()`);
await until(`incomeRecords().length===6`);
await until(`createIndexedDbFiles(indexedDB, ARCHIVE_DB).keys().then(k=>k.length===5)`);
check("„PDF fehlt“ und entfernter Eintrag: PDF auch aus dem Export-Speicher gelöscht", (await archived()) === 5);

// Preview ---------------------------------------------------------------------------------
const preview = () =>
  until(`!!document.getElementById('export-preview') && !document.getElementById('export-preview').textContent.includes('berechnet')`).then(() =>
    ev(`document.getElementById('export-preview').textContent`),
  );
const set = (id, value) =>
  ev(`(()=>{const el=document.getElementById('${id}');el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
await ev(`openAdmin('export')`);
await set("export-month", "2026-03");
let text = await preview();
check("Vorschau März: 5 PDFs und 1 CSV mit Größe, 4 Einwilligungen, 1 Eintrag ohne PDF", /^5 PDFs und 1 CSV, \d+ KB\. Davon 4 Einwilligungen\. 1 Eintrag im Zeitraum ohne PDF/.test(text));
await screenshot("export-vorschau");
await set("export-month", "2025-01");
text = await preview();
check("Leerer Monat: klare Meldung, kein Knopf", text.startsWith("Im gewählten Zeitraum gibt es keine Dokumente") && (await ev(`document.getElementById('export-save').disabled`)));
await set("export-month", "2026-04");
await set("export-type", "consents");
check("April, nur Einwilligungen: 1 PDF", (await preview()).startsWith("1 PDF, "));
await set("export-type", "income");
check("April, nur Einnahmen: Übersicht als PDF und CSV", (await preview()).startsWith("1 PDF und 1 CSV, ") );
await set("export-type", "all");
await set("export-kind", "range");
check("Von–bis: nur die Felder für den Zeitraum sichtbar", await ev(`document.querySelector('[data-export-for="month"]').hidden&&!document.querySelector('[data-export-for="range"]').hidden`));
await set("export-from", "2026-03-31");
await set("export-to", "2026-04-01");
check("Zeitraum über den Monatswechsel: 2 Einwilligungen", (await preview()).includes("Davon 2 Einwilligungen"));
await set("export-from", "2026-04-02");
check("„Von“ nach „Bis“ wird gemeldet", (await preview()).includes("nicht nach"));
await set("export-kind", "year");
await set("export-year", "2026");
check("Ganzes Jahr: 5 Einwilligungen", (await preview()).includes("Davon 5 Einwilligungen"));

// ZIP over the iPad share sheet (stubbed) ---------------------------------------------------
await set("export-kind", "month");
await set("export-month", "2026-03");
await preview();
await ev(`navigator.canShare=()=>true;navigator.share=async(d)=>{window.__shared=d.files[0]};document.getElementById('export-save').click()`);
await until(`!!window.__shared`);
const name = await ev(`window.__shared.name`);
check("ZIP-Name Inkform_2026-03.zip, Typ application/zip", name === "Inkform_2026-03.zip" && (await ev(`window.__shared.type`)) === "application/zip");
const zip = Buffer.from(await ev(`blobBase64(window.__shared)`), "base64");
const dir = `${OUT}/export`;
await mkdir(dir, { recursive: true });
await writeFile(`${dir}/${name}`, zip);
check("unzip -t ohne Fehler", /No errors detected/.test(execFileSync("unzip", ["-t", `${dir}/${name}`], { encoding: "utf8" })));
const names = JSON.parse(
  execFileSync("python3", ["-I", "-c", "import sys,zipfile,json;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps([i.filename for i in z.infolist()]))", `${dir}/${name}`], { encoding: "utf8" }),
);
check(
  "Ordner je Dokumentart, JJJJ-MM-TT_Nachname_Vorname.pdf, doppelte Namen eindeutig",
  JSON.stringify(names) ===
    JSON.stringify([
      "Einwilligungen/2026-03-01_Şahin_Gül.pdf",
      "Einwilligungen/2026-03-15_Muster_Anna.pdf",
      "Einwilligungen/2026-03-15_Muster_Anna_2.pdf",
      "Einwilligungen/2026-03-31_Müller_Jürgen.pdf",
      "Einnahmen/Einnahmen_2026-03.pdf",
      "Einnahmen/Einnahmen_2026-03.csv",
    ]),
);
execFileSync("ditto", ["-x", "-k", `${dir}/${name}`, `${dir}/ausgepackt`]);
const read = (n) => execFileSync("python3", ["-I", "-c", "import sys,zipfile;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))", `${dir}/${name}`, n]);
check("Einwilligungs-PDF im ZIP enthält den Namen mit Umlauten", pdfText(read("Einwilligungen/2026-03-31_Müller_Jürgen.pdf")).includes("Jürgen Müller"));
const report = pdfText(read("Einnahmen/Einnahmen_2026-03.pdf"));
check("Einnahmenübersicht: Zeitraum März, ohne April und ohne entfernten Eintrag", report.includes("01.03.2026 bis 31.03.2026") && report.includes("Ayşe Yıldız | PDF fehlt") && !report.includes("Ćwik") && !report.includes("Lena Weg"));
check("Status nach dem Teilen-Dialog", (await ev(`document.getElementById('export-status').textContent`)).includes("Inkform_2026-03.zip"));

check("Keine Netzwerkzugriffe außer der lokalen Vorschau", requests.every((u) => !/^https?:/.test(u) || u.startsWith(ORIGIN)));
check("Keine JavaScript- oder CSP-Fehler", errors.length === 0);
process.exit(0);
