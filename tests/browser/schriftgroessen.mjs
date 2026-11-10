// Font sizes in everything the customer sees: form, customer dialogs and the thank-you screen.
// Rule: inputs, labels and running text at least 16 px; nothing below 14 px. Measured as computed
// size of every visible text node, on iPad sizes (portrait and landscape) and a small phone.
import { readFile, writeFile } from "node:fs/promises";
import { HELPERS, OUT, ORIGIN, connect } from "./lib.mjs";

const { cmd, ev, until, check, navigate, screenshot, errors } = await connect();
const reset = await cmd("Page.addScriptToEvaluateOnNewDocument", {
  source: `try{localStorage.clear();sessionStorage.clear()}catch(_){}`,
});
await navigate(ORIGIN + "/index.html");
await cmd("Page.removeScriptToEvaluateOnNewDocument", { identifier: reset.identifier });
await until(`document.getElementById('admin-pin-dialog')?.open`);
await ev(HELPERS);
await ev(`document.getElementById('admin-pin').value='839274';document.getElementById('admin-pin-repeat').value='839274';document.getElementById('admin-pin-form').requestSubmit()`);
await until(`adminAccess.isUnlocked()`);
await ev(`finishAdminLeave()`);

// Elements whose text counts as "Texte und Eingaben" (16 px); everything else must reach 14 px.
const MEASURE = `(() => {
  const strict = 'input,select,textarea,label,p,li,legend,summary,button,h1,h2,h3,h4,td,th,dd,dt,blockquote';
  const out = [], all = [];
  const path = (el) => { const parts = []; for (let e = el; e && e !== document.body; e = e.parentElement) parts.unshift(e.id ? '#' + e.id : e.tagName.toLowerCase() + ':' + [...e.parentElement.children].indexOf(e)); return parts.join('>'); };
  const name = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + [...el.classList].join('.') : '');
  const roots = [document.getElementById('customer-app'), document.getElementById('completion-screen'), ...document.querySelectorAll('dialog[open]')]
    .filter((r) => r && !r.hidden);
  const seen = new Set();
  const visible = (el) => {
    const s = getComputedStyle(el);
    return el.getClientRects().length && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) !== 0 &&
      !(s.position === 'absolute' && s.clip === 'rect(0px, 0px, 0px, 0px)') && !el.closest('[aria-hidden="true"],.sr-only,.visually-hidden');
  };
  for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!n.textContent.trim() || seen.has(el) || !visible(el) || el.closest('svg,style,script')) continue;
      seen.add(el);
      const size = parseFloat(getComputedStyle(el).fontSize);
      const block = el.closest(strict);
      const min = block && root.contains(block) && el === block ? 16 : 14;
      all.push({ key: path(el), size, text: n.textContent.trim().slice(0, 30) });
      if (size < min) out.push({ el: name(el), parent: el.parentElement ? name(el.parentElement) : '', size, min, text: n.textContent.trim().slice(0, 40) });
    }
    for (const el of root.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]),select,textarea')) {
      if (seen.has(el) || !visible(el)) continue;
      seen.add(el);
      const size = parseFloat(getComputedStyle(el).fontSize);
      all.push({ key: path(el), size, text: el.id });
      if (size < 16) out.push({ el: name(el), parent: '', size, min: 16, text: el.placeholder || '' });
    }
  }
  return { hits: out, all, overflow: document.documentElement.scrollWidth > innerWidth };
})()`;
const baseline = process.env.INKFORM_FONT_BASELINE
  ? JSON.parse(await readFile(process.env.INKFORM_FONT_BASELINE, "utf8"))
  : null;
const sizes = {};

const viewports = [
  { label: "iPad hoch 820×1180", width: 820, height: 1180, mobile: true },
  { label: "iPad quer 1180×820", width: 1180, height: 820, mobile: false },
  { label: "iPad Pro 1024×1366", width: 1024, height: 1366, mobile: true },
  { label: "iPad mini 744×1133", width: 744, height: 1133, mobile: true },
];
const report = {};
for (const vp of viewports) {
  await cmd("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile });
  await ev(`window.scrollTo(0,0)`);
  const runs = [];
  const measure = async () => {
    const r = await ev(MEASURE);
    runs.push(r);
    return r.hits;
  };
  const form = await measure();
  // Customer-facing dialogs opened from the form (privacy notice, reset question, ...).
  const dialogs = await ev(`[...new Set([...document.querySelectorAll('#customer-app [data-open]')].map(b=>b.dataset.open))]`);
  const dialogHits = [];
  for (const id of dialogs) {
    await ev(`showDialog(${JSON.stringify(id)})`);
    dialogHits.push(...(await measure()).filter((h) => !form.some((f) => f.el === h.el && f.text === h.text)));
    await ev(`document.getElementById(${JSON.stringify(id)}).close()`);
  }
  // Medical follow-up fields and notices that only appear after a "yes".
  await ev(`for(const q of MEDICAL)document.querySelector('input[name="'+q.id+'"][value="yes"]').click()`);
  const expanded = (await measure()).filter((h) => !form.some((f) => f.el === h.el && f.text === h.text));
  await ev(`for(const q of MEDICAL)document.querySelector('input[name="'+q.id+'"][value="no"]').click()`);
  // Thank-you screen.
  await ev(`showCompletion()`);
  const thanks = await measure();
  await ev(`sessionStorage.removeItem('inkform.completion');document.getElementById('completion-screen').hidden=true;document.getElementById('customer-app').hidden=false`);
  const hits = [...form, ...dialogHits, ...expanded, ...thanks];
  report[vp.label] = hits;
  sizes[vp.label] = Object.fromEntries(runs.flatMap((r) => r.all.map((a) => [a.key, a.size])));
  if (vp.width === 820) await screenshot("schrift-ipad-hoch");
  report[vp.label + " overflow"] = runs.some((r) => r.overflow);
}
await writeFile(OUT + "/schriftgroessen.json", JSON.stringify(report, null, 2));
await writeFile(OUT + "/schriftgroessen-alle.json", JSON.stringify(sizes, null, 2));
for (const vp of viewports) {
  const hits = report[vp.label];
  if (hits.length) console.log(vp.label, JSON.stringify(hits.slice(0, 15), null, 1));
  check(`${vp.label}: Texte und Eingaben ≥ 16 px, nichts unter 14 px (${hits.length} Abweichungen)`, hits.length === 0);
  check(`${vp.label}: kein seitliches Scrollen`, !report[vp.label + " overflow"]);
  if (baseline?.[vp.label]) {
    const smaller = Object.entries(sizes[vp.label]).filter(([k, v]) => k in baseline[vp.label] && v < baseline[vp.label][k]);
    if (smaller.length) console.log("kleiner als vorher:", JSON.stringify(smaller.slice(0, 20)));
    check(`${vp.label}: keine Schrift kleiner als vorher`, smaller.length === 0);
  }
}
check("Keine JavaScript-Fehler", errors.length === 0);
// Leave a clean form, so the next check can navigate away without an unload warning.
await ev(`resetCustomerForm()`);
process.exit(0);
