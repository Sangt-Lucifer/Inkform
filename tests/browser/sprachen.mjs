// A language added as a file only: the test-only pseudo language (right to left, about 60 % longer
// texts) is built next to the real ones. As the device language it turns the admin area into that
// language while the customer form stays in the studio language; with translated form texts it is
// offered to customers, switches the form and goes back to the studio language for the next form.
// Every marked text is translated and nothing gets wider than the screen (iPad portrait, phone).
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
const UNTRANSLATED = (root) => `(() => {
  const bad = [], root = document.querySelector('${root}');
  // These show the studio's or the customer's name once known, not an interface text.
  for (const el of root.querySelectorAll('[data-t]:not(#admin-workspace-name):not(#signature-name)'))
    if (!el.textContent.includes('[')) bad.push(el.dataset.t);
  for (const el of root.querySelectorAll('*'))
    for (const a of el.attributes)
      if (a.name.startsWith('data-t-') && !['data-t-slot', 'data-t-part', 'data-t-href'].includes(a.name) &&
          !(el.getAttribute(a.name.slice(7)) ?? '').includes('[')) bad.push(a.name + '=' + a.value);
  return bad;
})()`;
const translated = async (name, root) => {
  const missing = await ev(UNTRANSLATED(root));
  if (missing.length) console.log("Nicht übersetzt:", missing.slice(0, 20));
  check(name, missing.length === 0);
};
const WIDE = `(() => {
  const out = [];
  // Inside a box that scrolls sideways (wide tables) running past the edge is intended.
  const scrolls = (el) => { for (let p = el.parentElement; p; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowX)) return true; return false; };
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width && getComputedStyle(el).visibility !== 'hidden' && (r.right > innerWidth + 1 || r.left < -1) && !el.closest('[hidden],dialog:not([open]),.sr-only,.visually-hidden') && !scrolls(el))
      out.push((el.id || el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : '') + '<' + (el.parentElement.closest('[id]')?.id ?? '')) + ':' + Math.round(r.left) + '..' + Math.round(r.right));
  }
  return { page: document.documentElement.scrollWidth > innerWidth, elements: out.slice(0, 8) };
})()`;
const fits = async (name) => {
  const wide = await ev(WIDE);
  if (wide.page || wide.elements.length) console.log(name, JSON.stringify(wide));
  return !wide.page && !wide.elements.length;
};

// The first start is the owner's: PIN dialog and the screen behind it in the device language.
await until(`document.getElementById('admin-pin-dialog')?.open`);
check("Gerätesprache gilt nicht für das Kundenformular", await ev(`customerLanguage === 'de' && document.getElementById('customer-headline').textContent === settings.app.headline`));
check("Erster PIN-Dialog in der Gerätesprache", await ev(`document.documentElement.lang === '${PSEUDO}' && document.getElementById('admin-pin-title').textContent.includes('[')`));
await ev(`document.getElementById('admin-pin').value='839274';document.getElementById('admin-pin-repeat').value='839274';document.getElementById('admin-pin-form').requestSubmit()`);
await until(`adminAccess.isUnlocked() && adminOpen`);
check("Verwaltung in der Gerätesprache: lang und dir", await ev(`document.documentElement.lang === '${PSEUDO}' && document.documentElement.dir === 'rtl'`));
await translated("Verwaltung: alle markierten Texte übersetzt", "#admin-app");

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
// The profile's English draft: complete, so it can be ticked, but not offered until the owner does.
await ev(`openAdminAuthorized('languages')`);
check(
  "Englischer Entwurf: wählbar, nicht angeboten, als ungeprüft gekennzeichnet",
  await ev(`(() => {
    const box = document.querySelector('[data-locale-customer="en"]');
    return !!box && !box.disabled && !box.checked && box.closest('label').querySelector('small')?.textContent === t('languages.draft')
      && !settings.locale.customer.includes('en');
  })()`),
);
check(
  "Ältere Installation ohne Übersetzungen bekommt den englischen Entwurf aus dem Profil",
  await ev(`(() => {
    const stored = JSON.parse(JSON.stringify(settings));
    stored.translations = {};
    const loaded = validateSettings(stored);
    return !!contentIn(loaded, 'en') && loaded.translations.en.draft === true;
  })()`),
);
check(
  "Als geprüft markiert: Entwurfsvermerk nach dem Speichern weg",
  await ev(`(() => {
    const box = document.querySelector('[data-locale-reviewed="en"]');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    saveAdmin();
    return settings.translations.en.draft === undefined && !document.querySelector('[data-locale-reviewed="en"]');
  })()`),
);
// A German text changed: the English one stays but is marked, English is not offered and the admin
// area points to it. Adjusting one and confirming the other makes English selectable again.
await ev(`(() => {
  adminDraft.locale.customer = [adminDraft.locale.studio, 'en'];
  saveAdmin();
  adminDraft.app.headline += ' Neu';
  adminDraft.legal.find((item) => item.id === 'privacy').text += ' Geändert.';
  saveAdmin();
  renderAdminSection();
})()`);
check(
  "Deutscher Text geändert: Übersetzung bleibt, ist markiert, Englisch nicht angeboten",
  await ev(`(() => {
    const tr = settings.translations.en;
    return !!tr.legal.privacy.text && tr.stale.length === 2 && !offeredLanguages(settings).includes('en')
      && [...document.querySelectorAll('#customer-language [data-customer-language]')].every((b) => b.dataset.customerLanguage !== 'en');
  })()`),
);
check(
  "Hinweis „2 Texte prüfen“ auf der Studio-Seite",
  await ev(`!!document.querySelector('[data-stale-jump="en"]')
    && document.querySelector('[data-locale-customer="en"]').closest('label').textContent.includes(t('translate.staleShort', { anzahl: 2 }))`),
);
check(
  "Nicht angebotene Sprache: kein Hinweis „Texte prüfen“",
  await ev(`(() => {
    adminDraft.locale.customer = [adminDraft.locale.studio];
    renderAdminSection();
    const hidden = !document.querySelector('[data-stale-notice]');
    adminDraft.locale.customer = [adminDraft.locale.studio, 'en'];
    renderAdminSection();
    return hidden && !!document.querySelector('[data-stale-jump="en"]');
  })()`),
);
await ev(`document.querySelector('[data-stale-jump="en"]').click()`);
check(
  "Sprung zum markierten Feld: alter und neuer deutscher Text stehen daneben",
  await ev(`(() => {
    const input = document.activeElement, box = input.closest('.ad-field');
    const [before, now] = [...box.querySelectorAll('.ad-compare p')].map((p) => p.textContent);
    return adminPage === 'content' && editLanguage === 'en' && input.dataset.translationField === 'app.headline'
      && box.classList.contains('stale') && now === before + ' Neu'
      && input.getBoundingClientRect().top >= 0 && input.getBoundingClientRect().bottom <= innerHeight;
  })()`),
);
check("Übersetzungsseite nicht breiter als der Bildschirm", await fits("Smartphone admin/content en"));
await screenshot("sprachen-uebersetzung-375");
check(
  "Tippen und Rückgängig bestätigt nichts",
  await ev(`(() => {
    const input = document.activeElement, saved = input.value, box = input.closest('.ad-field');
    input.value = saved + 'x';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const cleared = !box.classList.contains('stale') && box.querySelector('.ad-stale').hidden;
    input.value = saved;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return cleared && box.classList.contains('stale') && !box.querySelector('.ad-stale').hidden
      && adminDraft.translations.en.stale.includes('app.headline');
  })()`),
);
await ev(`(() => {
  const input = document.activeElement;
  input.value += ' New';
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
check(
  "Englisch angepasst: Markierung weg, Hinweis zählt einen Text",
  await ev(`!document.activeElement.closest('.ad-field').classList.contains('stale')
    && document.querySelector('[data-stale-jump="en"]').textContent.includes(t('translate.staleNotice', { sprache: 'English', anzahl: 1 }))`),
);
await ev(`document.querySelector('[data-stale-jump="en"]').click()`);
check(
  "Zweiter Text auf der Einwilligungsseite, „Übersetzung passt“ bestätigt ihn",
  await ev(`(() => {
    if (adminPage !== 'legal' || document.activeElement.dataset.translationField !== 'legal.privacy.text') return false;
    document.activeElement.closest('.ad-field').querySelector('[data-settle-field]').click();
    return !document.querySelector('[data-stale-notice]') && !adminDraft.translations.en.stale;
  })()`),
);
check(
  "Gespeichert: Englisch wieder wählbar, eigene Übersetzung erhalten",
  await ev(`(() => {
    saveAdmin();
    return offeredLanguages(settings).includes('en') && settings.translations.en.app.headline.endsWith(' New')
      && [...document.querySelectorAll('#customer-language [data-customer-language]')].some((b) => b.dataset.customerLanguage === 'en');
  })()`),
);
check(
  "Ungültige Übersetzung: Speichern nennt Sprache und Feld und springt hin",
  await ev(`(() => {
    adminDraft.translations.en.app.signatureText = 'a < b';
    const saved = saveAdmin();
    const ok = !saved && adminPage === 'content' && document.activeElement.dataset.translationField === 'app.signatureText'
      && document.activeElement.closest('.ad-field').querySelector('.ad-field-error')?.textContent.includes('English');
    adminDraft = JSON.parse(JSON.stringify(settings));
    return ok;
  })()`),
);
check(
  "Standardvorlage geladen: Englisch des Profils wird nicht als veraltet markiert",
  await ev(`(() => {
    adminDraft.app.headline += ' Eigen';
    saveAdmin();
    adminDraft = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    adminDraft.locale.customer = [adminDraft.locale.studio, 'en'];
    saveAdmin();
    return !settings.translations.en.stale && offeredLanguages(settings).includes('en');
  })()`),
);
await ev(`editLanguage = null`);

// Form texts in the pseudo language, offered to customers next to the studio language.
await ev(`(() => {
  const p = (x) => x ? '[' + x + ']' : x, s = JSON.parse(JSON.stringify(settings));
  const items = (list, keys) => Object.fromEntries(list.map((i) => [i.id, Object.fromEntries(keys.map((k) => [k, p(i[k])]))]));
  s.translations = { ${PSEUDO}: {
    app: Object.fromEntries(TRANSLATED.app.map((k) => [k, p(s.app[k])])),
    studio: Object.fromEntries(TRANSLATED.studio.map((k) => [k, p(s.studio[k])])),
    medical: items(s.medical, TRANSLATED.medical),
    legal: items(s.legal, TRANSLATED.legal),
  } };
  s.locale.customer = [s.locale.studio, '${PSEUDO}'];
  s.locale.note = { ${PSEUDO}: '[Maßgeblich ist die Fassung in der Studiosprache]' };
  adminDraft = s;
  saveAdmin();
})()`);
await ev(`openAdminAuthorized('languages')`);
check("Seite Sprachen: Kundensprache wählbar", await ev(`!document.querySelector('[data-locale-customer="${PSEUDO}"]').disabled && document.querySelector('[data-locale-customer="${PSEUDO}"]').checked`));
await ev(`finishAdminLeave()`);
await until(`!document.getElementById('customer-app').hidden`);
check("Nach der Verwaltung wieder Studiosprache", await ev(`document.documentElement.lang === 'de'`));
check("Sprachauswahl mit zwei Sprachen sichtbar", await ev(`!document.getElementById('customer-language').hidden && document.querySelectorAll('#customer-language [data-customer-language]').length === 2`));

await ev(`fillConsent()`);
await ev(`document.querySelector('[data-customer-language="${PSEUDO}"]').click()`);
check("Kundensprache gewechselt: lang und dir", await ev(`document.documentElement.lang === '${PSEUDO}' && document.documentElement.dir === 'rtl'`));
await translated("Kundenformular: alle markierten Texte übersetzt", "#customer-app");
check("Formulartexte in der Kundensprache", await ev(`document.getElementById('customer-headline').textContent.startsWith('[') && document.querySelector('.question-title').textContent.trim().startsWith('[')`));
check(
  "Eingaben und Gesundheitsangaben bleiben, Erklärungen, Foto und Unterschrift sind zurückgesetzt",
  await ev(`document.getElementById('firstName').value === 'Test' && MEDICAL.every((q) => choiceValue(q.id) === 'no') && LEGAL.every((i) => !document.getElementById(i.id).checked) && !document.getElementById('sober').checked && !choiceValue('photo') && !hasSignature()`),
);
for (const [label, width, height] of viewports) {
  await size(width, height);
  check(`${label}: Kundenformular nicht breiter als der Bildschirm`, await fits(`${label} Formular`));
  await screenshot(`sprachen-formular-${width}`);
}
await cmd("Emulation.clearDeviceMetricsOverride");
await ev(`fillConsent()`);
check("PDF-Daten vermerken die Kundensprache", await ev(`gatherData().language === '${PSEUDO}' && !!createPdf(gatherData())`));
await ev(`resetCustomerForm()`);
check("Nächstes Formular wieder in der Studiosprache", await ev(`document.documentElement.lang === 'de' && document.querySelector('[data-customer-language="de"]').getAttribute('aria-pressed') === 'true' && document.getElementById('customer-headline').textContent === settings.app.headline`));
if (errors.length) console.log("Fehler:", JSON.stringify(errors).slice(0, 1500));
check("Keine JavaScript-Fehler", errors.length === 0);
process.exit(0);
