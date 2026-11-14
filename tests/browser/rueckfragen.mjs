// The one confirmation window before deleting or replacing data: names what happens, the red
// button only for deleting, Cancel and Escape change nothing, and a confirmation given after the
// admin area was locked changes nothing either. Synthetic data only.
import { HELPERS, ORIGIN, connect } from "./lib.mjs";

const { cmd, ev, until, check, navigate, screenshot, errors, answer } = await connect();
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
await ev(`localStorage.setItem(INCOME_KEY,JSON.stringify({schemaVersion:1,records:[{id:'q1',date:'2026-10-02',artist:'Alex',customer:'Rita Probe',totalCents:20000,depositCents:null,source:'',updatedAt:new Date().toISOString()}]}));incomeFeature.refresh();openAdminAuthorized('income')`);
await until(`!!document.querySelector('[data-income-remove="q1"]')`);
const remove = () => ev(`document.querySelector('[data-income-remove="q1"]').click()`);
const kept = () => ev(`incomeRecords().some(r=>r.id==='q1')`);
const open = () => ev(`document.getElementById('confirm-dialog').open`);

await remove();
await until(`document.getElementById('confirm-dialog').open`);
check(
  "Fenster nennt Eintrag und Folgen, roter Knopf „Eintrag entfernen“, Abbrechen hat den Fokus",
  await ev(`document.getElementById('confirm-title').textContent.includes('Rita Probe')&&document.getElementById('confirm-title').textContent.includes('02.10.2026')&&document.getElementById('confirm-text').textContent===t('ask.entry.copy')&&document.getElementById('confirm-ok').textContent===t('ask.entry.confirm')&&document.getElementById('confirm-ok').classList.contains('danger')&&document.activeElement.id==='confirm-cancel'`),
);
await screenshot("rueckfrage-hell");
await answer(false);
check("Abbrechen: Fenster zu, Eintrag bleibt", !(await open()) && (await kept()));

await remove();
await until(`document.getElementById('confirm-dialog').open`);
await cmd("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await cmd("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await until(`!document.getElementById('confirm-dialog').open`);
check("Escape: Fenster zu, Eintrag bleibt", await kept());

// Locked while the window is open (e.g. the iPad went back to the customer form): the late
// confirmation must not delete anything.
await remove();
await until(`document.getElementById('confirm-dialog').open`);
await ev(`adminAccess.lock()`);
await answer(true);
check("Bestätigung nach dem Sperren der Verwaltung: nichts gelöscht", await kept());
await ev(`openAdmin('income')`);
await until(`document.getElementById('admin-pin-dialog').open`);
await ev(`unlockAdmin()`);
await until(`adminAccess.isUnlocked()`);

// Every way of closing answers the open question with "no".
const escape = async () => {
  await cmd("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await cmd("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
};
for (const [name, close] of [
  ["Abbrechen", () => answer(false)],
  ["Escape", escape],
  ["Schließen von außen", () => ev(`document.getElementById('confirm-dialog').close()`)],
]) {
  await ev(`window.__v=undefined;askConfirm({title:'X',text:'x',confirm:'X'}).then(v=>window.__v=v);0`);
  await until(`document.getElementById('confirm-dialog').open`);
  await close();
  await until(`window.__v!==undefined`);
  check(`${name} beantwortet die Rückfrage mit Nein`, await ev(`window.__v===false`));
}
check(
  "Neue Rückfrage direkt nach dem Bestätigen bleibt offen (verspätetes Schließen bricht sie nicht ab)",
  await ev(`(async()=>{const a=askConfirm({title:'A',text:'a',confirm:'A'});document.getElementById('confirm-ok').click();let second;const b=askConfirm({title:'B',text:'b',confirm:'B'}).then(v=>second=v);const first=await a;await new Promise(r=>setTimeout(r,100));const ok=first===true&&second===undefined&&document.getElementById('confirm-dialog').open;document.getElementById('confirm-cancel').click();await b;return ok&&second===false})()`),
);

// A second question replaces an open one; the first counts as cancelled.
check(
  "Zweite Rückfrage ersetzt die offene, die erste gilt als abgebrochen",
  await ev(`(async()=>{const a=askConfirm({title:'A',text:'a',confirm:'A'});const b=askConfirm({title:'B',text:'b',confirm:'B',danger:false});const first=await a;const shown=document.getElementById('confirm-title').textContent==='B'&&!document.getElementById('confirm-ok').classList.contains('danger');document.getElementById('confirm-ok').click();return first===false&&shown&&(await b)===true&&!document.getElementById('confirm-dialog').open})()`),
);

await ev(`setTheme('dark');openAdminAuthorized('income')`);
await until(`!!document.querySelector('[data-income-remove="q1"]')`);
await remove();
await until(`document.getElementById('confirm-dialog').open`);
check(
  "Dunkles Farbschema: Knopf bleibt rot, Fenster mittig",
  await ev(`(()=>{const b=getComputedStyle(document.getElementById('confirm-ok')).backgroundColor;const r=document.getElementById('confirm-dialog').getBoundingClientRect();return b==='rgb(177, 48, 51)'&&Math.abs(r.left+r.width/2-document.documentElement.clientWidth/2)<2})()`),
);
await screenshot("rueckfrage-dunkel");
await answer(true);
await until(`!incomeRecords().some(r=>r.id==='q1')`);
check("Bestätigt: Eintrag entfernt", !(await open()));
check("Keine Browser-Rückfragen mehr im Code", await ev(`!/window\\.confirm\\(/.test([...document.scripts].map(s=>s.textContent).join(''))`));
check("Keine JavaScript- oder CSP-Fehler", errors.length === 0, JSON.stringify(errors));
process.exit(0);
