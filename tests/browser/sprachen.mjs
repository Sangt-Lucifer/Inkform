// A language added as a file only: the test-only pseudo language (right to left, about 60 % longer
// texts) is built next to the real ones, chosen via the stored language and must translate every
// marked text without pushing the layout wider than the screen. Customer form, PIN dialog and every
// admin page, on iPad portrait and a small phone.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildProfile } from "../../scripts/build.mjs";
import { PSEUDO, writePseudoLanguages } from "../lib/pseudo.mjs";
import { HELPERS, OUT, connect } from "./lib.mjs";

const languages = await mkdtemp(path.join(OUT, "sprachen-"));
await writePseudoLanguages(languages);
const { files } = await buildProfile(path.dirname(process.env.INKFORM_PROFILE), { languages });
const page = path.join(OUT, "sprachen", "index.html");
await mkdir(path.dirname(page), { recursive: true });
await writeFile(page, files.get("index.html"));
await rm(languages, { recursive: true, force: true });

const { cmd, ev, until, check, navigate, reload, screenshot, errors } = await connect();
await navigate(pathToFileURL(page).href);
await ev(`localStorage.clear(); localStorage.setItem('inkform.language.v1', '${PSEUDO}')`);
await reload();
await ev(HELPERS);

// Elements and attributes marked for translation that still show something else.
const UNTRANSLATED = `(() => {
  const bad = [];
  for (const el of document.querySelectorAll('[data-t]'))
    if (!el.textContent.includes('[')) bad.push(el.dataset.t);
  for (const el of document.querySelectorAll('*'))
    for (const a of el.attributes)
      if (a.name.startsWith('data-t-') && !['data-t-slot', 'data-t-part', 'data-t-href'].includes(a.name) &&
          !(el.getAttribute(a.name.slice(7)) ?? '').includes('[')) bad.push(a.name + '=' + a.value);
  return bad;
})()`;
const WIDE = `(() => {
  const out = [];
  // Inside a box that scrolls sideways (wide tables) running past the edge is intended.
  const scrolls = (el) => { for (let p = el.parentElement; p; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowX)) return true; return false; };
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width && getComputedStyle(el).visibility !== 'hidden' && (r.right > innerWidth + 1 || r.left < -1) && !el.closest('[hidden],dialog:not([open]),.sr-only,.visually-hidden') && !scrolls(el))
      out.push((el.id || el.tagName.toLowerCase()) + ':' + Math.round(r.left) + '..' + Math.round(r.right));
  }
  return { page: document.documentElement.scrollWidth > innerWidth, elements: out.slice(0, 8) };
})()`;
const fits = async (name) => {
  const wide = await ev(WIDE);
  if (wide.page || wide.elements.length) console.log(name, JSON.stringify(wide));
  return !wide.page && !wide.elements.length;
};

check("Pseudosprache erkannt: lang und dir gesetzt", await ev(`document.documentElement.lang === '${PSEUDO}' && document.documentElement.dir === 'rtl'`));
const missing = await ev(UNTRANSLATED);
if (missing.length) console.log("Nicht übersetzt:", missing.slice(0, 20));
check("Alle markierten Texte und Attribute übersetzt", missing.length === 0);

await until(`document.getElementById('admin-pin-dialog')?.open`);
check("PIN-Dialog in der Pseudosprache", await ev(`document.getElementById('admin-pin-dialog').textContent.includes('[')`));
await ev(`document.getElementById('admin-pin').value='839274';document.getElementById('admin-pin-repeat').value='839274';document.getElementById('admin-pin-form').requestSubmit()`);
await until(`adminAccess.isUnlocked()`);

const viewports = [
  ["iPad hochkant", 820, 1180],
  ["Smartphone", 375, 812],
];
const size = (width, height) =>
  cmd("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
const pages = await ev(`Object.keys(ADMIN_PAGES).filter((id) => id !== 'setup')`);
for (const [label, width, height] of viewports) {
  await size(width, height);
  let ok = true;
  for (const id of pages) {
    await ev(`openAdminAuthorized('${id}')`);
    await until(`adminPage === '${id}' && document.getElementById('admin-page-title').textContent.includes('[')`);
    ok = (await fits(`${label} admin/${id}`)) && ok;
  }
  check(`${label}: alle Admin-Seiten übersetzt und nicht breiter als der Bildschirm`, ok);
  await screenshot(`sprachen-admin-${width}`);
}
await ev(`finishAdminLeave()`);
await until(`!document.getElementById('customer-app').hidden`);
for (const [label, width, height] of viewports) {
  await size(width, height);
  check(`${label}: Kundenformular nicht breiter als der Bildschirm`, await fits(`${label} Formular`));
  await screenshot(`sprachen-formular-${width}`);
}
await cmd("Emulation.clearDeviceMetricsOverride");
if (errors.length) console.log("Fehler:", JSON.stringify(errors).slice(0, 1500));
check("Keine JavaScript-Fehler", errors.length === 0);
await ev(`resetCustomerForm()`);
process.exit(0);
