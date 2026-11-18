// Customer language as flag buttons: hidden with one language, one button per offered language
// with its name for screen readers, switching keeps the entries, in light and dark and on narrow
// screens in one row. Synthetic data.
import { HELPERS, ORIGIN, connect } from "./lib.mjs";

const { cmd, ev, until, check, navigate, screenshot, errors } = await connect();
await cmd("Emulation.setDeviceMetricsOverride", { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
const reset = await cmd("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.clear();sessionStorage.clear()}catch(_){}` });
await navigate(ORIGIN + "/index.html");
await cmd("Page.removeScriptToEvaluateOnNewDocument", { identifier: reset.identifier });
await ev(HELPERS);
await until(`document.getElementById('admin-pin-dialog')?.open`);
await ev(`(()=>{for(const id of ['admin-pin','admin-pin-repeat'])document.getElementById(id).value='839274';document.getElementById('admin-pin-form').requestSubmit()})()`);
await until(`adminAccess.isUnlocked()`);
const offer = (codes) =>
  ev(`(()=>{adminDraft=JSON.parse(JSON.stringify(settings));adminDraft.locale.customer=${JSON.stringify(codes)};saveAdmin();finishAdminLeave()})()`);
const group = `document.getElementById('customer-language')`;
const button = (code) => `document.querySelector('[data-customer-language="${code}"]')`;

await offer(["de"]);
await until(`!document.getElementById('customer-app').hidden`);
check("Eine Sprache: keine Sprachknöpfe", await ev(`${group}.hidden && ${group}.offsetWidth === 0`));

await offer(["de", "en"]);
await until(`!document.getElementById('customer-app').hidden && !${group}.hidden`);
check(
  "Gruppe mit Namen, ein Knopf je Sprache mit lang, Name und Zustand",
  await ev(`(()=>{const g=${group},b=[...g.querySelectorAll('button')];
    return g.getAttribute('role')==='group'&&g.getAttribute('aria-label')===t('customer.language')&&b.length===2
      &&b.map(x=>[x.dataset.customerLanguage,x.lang,x.getAttribute('aria-label'),x.title,x.getAttribute('aria-pressed')].join()).join('|')==='de,de,Deutsch,Deutsch,true|en,en,English,English,false'})()`),
);
check("Flaggen als SVG, ohne eigenen Text für Vorleseprogramme", await ev(`[...${group}.querySelectorAll('svg')].length===2&&[...${group}.querySelectorAll('svg')].every(s=>s.getAttribute('aria-hidden')==='true')`));
check("Sprache ohne Flagge: Kürzel als Text", await ev(`languageMark('qaa').includes('>QAA<')&&!languageMark('q"a').includes('"a')`));
const layout = `(()=>{const b=[...${group}.querySelectorAll('button')].map(x=>x.getBoundingClientRect());
  return {size:b.every(r=>r.width>=44&&r.height>=44),row:b.every(r=>Math.abs(r.top-b[0].top)<1),inside:[...document.querySelectorAll('.topbar-inner > *, .top-actions > *:not([hidden])')].every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth}),page:document.documentElement.scrollWidth<=innerWidth}})()`;
const fits = async () => Object.values(await ev(layout)).every(Boolean);
check("iPad quer: mindestens 44 × 44, eine Reihe", await fits());

await ev(`fillConsent()`);
await ev(`${button("en")}.click()`);
await until(`document.documentElement.lang === 'en'`);
check(
  "Deutsch → Englisch: Eingaben bleiben, Englisch gedrückt, Fokus auf dem Knopf",
  await ev(`document.getElementById('firstName').value==='Test'&&document.getElementById('motif').value==='Testmotiv'
    &&${button("en")}.getAttribute('aria-pressed')==='true'&&${button("de")}.getAttribute('aria-pressed')==='false'&&document.activeElement===${button("en")}`),
);
check("Gruppenname in der neuen Sprache", await ev(`${group}.getAttribute('aria-label')===t('customer.language')`));
const ring = (theme) =>
  ev(`(()=>{setTheme('${theme}',false);const a=getComputedStyle(${button("en")}),b=getComputedStyle(${button("de")});return a.borderColor!==b.borderColor&&a.boxShadow!=='none'})()`);
check("Hell: gewählte Sprache mit Ring", await ring("light"));
await screenshot("flaggen-hell");
check("Dunkel: gewählte Sprache mit Ring", await ring("dark"));
await screenshot("flaggen-dunkel");
for (const [label, width, height] of [
  ["iPad hochkant", 820, 1180],
  ["Smartphone", 375, 812],
  ["Schmales Smartphone", 320, 640],
]) {
  await cmd("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  check(`${label}: Knöpfe 44 × 44 in einer Reihe, nichts breiter als der Bildschirm`, await fits(), JSON.stringify(await ev(layout)));
  await screenshot(`flaggen-${width}`);
}
// Other languages: the country flag as an emoji, from the region in the code or the language;
// without a clear country the code as text.
check(
  "Flaggen für weitere Sprachen: Emoji nach Region oder Sprache, sonst Kürzel",
  await ev(`languageMark('fr').includes('\u{1F1EB}\u{1F1F7}')&&languageMark('pt-BR').includes('\u{1F1E7}\u{1F1F7}')&&languageMark('sr-Latn-RS').includes('\u{1F1F7}\u{1F1F8}')
    &&languageMark('ar').includes('>AR<')&&languageMark('qaa').includes('>QAA<')&&languageName('fr')==='français'`),
);
// Three languages still as buttons on the narrowest screen.
await ev(`renderLanguageChoice(['de','en','fr'])`);
check(
  "Drei Sprachen auf 320 px: drei Knöpfe in einer Reihe, Kopfzeile passt",
  (await fits()) && (await ev(`${group}.querySelectorAll('button').length===3&&!document.getElementById('customer-language-select')&&!!${group}.querySelector('.language-flag')`)),
  JSON.stringify(await ev(layout)),
);
await screenshot("flaggen-drei-320");
// From four on a list with flag and name; choosing switches like a button and keeps the entries.
await ev(`renderLanguageChoice(['de','en','fr','qaa'])`);
const list = `document.getElementById('customer-language-select')`;
check(
  "Vier Sprachen: Liste statt Knöpfe, mit Flagge und Name, aktuelle Sprache gewählt",
  await ev(`!!${list}&&${group}.querySelectorAll('button').length===0&&${list}.options.length===4&&${list}.value===customerLanguage
    &&${list}.options[0].textContent==='\u{1F1E9}\u{1F1EA} Deutsch'&&${list}.getAttribute('aria-label')===t('customer.language')`),
);
const listFits = `(()=>{const r=${list}.getBoundingClientRect();return r.height>=44&&r.right<=innerWidth&&document.documentElement.scrollWidth<=innerWidth})()`;
check("Liste auf 320 px: 44 px hoch, nichts breiter als der Bildschirm", (await fits()) && (await ev(listFits)), JSON.stringify(await ev(layout)));
await screenshot("flaggen-liste-320");
await cmd("Emulation.setDeviceMetricsOverride", { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
check("Liste auf dem iPad quer passt", (await fits()) && (await ev(listFits)));
await ev(`(()=>{const l=${list};l.value='de';l.dispatchEvent(new Event('change',{bubbles:true}))})()`);
await until(`document.documentElement.lang==='de'`);
check("Wahl in der Liste wechselt die Sprache, Eingaben bleiben", await ev(`customerLanguage==='de'&&document.getElementById('firstName').value==='Test'`));
await ev(`renderLanguageChoice()`);
// Leave no unsaved entries behind for the next check in this browser.
await ev(`form.reset();dirty=false`);
await ev(`setTheme('light',false)`);
check("Keine JavaScript- oder CSP-Fehler", errors.length === 0, JSON.stringify(errors));
process.exit(0);
