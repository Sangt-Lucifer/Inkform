// Texts of the user interface. Each language is one file in src/sprachen/; the build embeds all of
// them through registerLanguages(), the Node tests load them in tests/lib/sprachen.mjs. German is
// the base language: a text missing in another language is taken from German.
export const BASE_LANGUAGE = "de";
export const LANGUAGE_KEY = "inkform.language.v1";
let LANGUAGES = {},
  active = null,
  currency = "EUR",
  everywhere = new Map();

export function registerLanguages(languages) {
  LANGUAGES = languages;
  everywhere = new Map();
  active = translator(active?.code);
}
// ISO 4217 code for money() and the placeholders {waehrung} (code) and {waehrungszeichen} (symbol).
export function setCurrency(code) {
  currency = code;
}
// The distinct texts of one key over all languages (e.g. to recognize generated file names).
export function textsInAllLanguages(key) {
  if (!everywhere.has(key))
    everywhere.set(key, [...new Set(languageCodes().map((code) => translator(code).t(key)))]);
  return everywhere.get(key);
}
export const languageCodes = () => Object.keys(LANGUAGES);
export const hasLanguage = (code) => Object.hasOwn(LANGUAGES, code ?? "");

// HTML that th() inserts as it is (a button or link inside a sentence).
class Markup {
  constructor(html) {
    this.html = html;
  }
}
export const markup = (html) => new Markup(html);
const RICH = /<(\/?)(b|strong|code)>/g;
const escapeMarkup = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch],
  );

// One language with its texts and Intl formats. Unknown codes give the base language.
export function translator(code) {
  const base = LANGUAGES[BASE_LANGUAGE] ?? { texts: {}, locale: "de-DE", dir: "ltr" };
  const own = hasLanguage(code) ? code : BASE_LANGUAGE;
  const lang = LANGUAGES[own] ?? base;
  const locale = lang.locale;
  const plurals = new Intl.PluralRules(locale);
  function template(key, vars) {
    let text = lang.texts[key] ?? base.texts[key];
    if (text === undefined) {
      console.error(`Text fehlt: ${key}`);
      return key;
    }
    if (typeof text === "object") text = text[plurals.select(Number(vars.anzahl))] ?? text.other;
    return text;
  }
  const symbol = () =>
    new Intl.NumberFormat(locale, { style: "currency", currency })
      .formatToParts(0)
      .find((part) => part.type === "currency").value;
  const fill = (text, own, wrap = String) => {
    const vars = { waehrung: currency, ...own };
    if (text.includes("{waehrungszeichen}")) vars.waehrungszeichen ??= symbol();
    return text.replace(/\{(\w+)\}/g, (match, name) => (Object.hasOwn(vars, name) ? wrap(vars[name]) : match));
  };
  return {
    code: own,
    name: lang.name,
    locale,
    dir: lang.dir,
    pdfFont: lang.pdfFont,
    // Plain text, for textContent, attributes and PDFs: markup tags are removed.
    t: (key, vars = {}) => fill(template(key, vars).replace(RICH, ""), vars),
    // HTML: the text keeps <b>, <strong> and <code>; every value is escaped unless made by markup().
    th: (key, vars = {}) =>
      fill(escapeMarkup(template(key, vars)).replace(/&lt;(\/?)(b|strong|code)&gt;/g, "<$1$2>"), vars, (value) =>
        value instanceof Markup ? value.html : escapeMarkup(value),
      ),
    raw: (key, vars = {}) => fill(template(key, vars), vars),
    date: (iso, options) => new Intl.DateTimeFormat(locale, options).format(new Date(iso + "T12:00:00")),
    dateTime: (date, options) => new Intl.DateTimeFormat(locale, options).format(date),
    number: (value, options) => new Intl.NumberFormat(locale, options).format(value),
    // code overrides the current currency: for an amount recorded under an earlier currency, so a
    // later change does not relabel it.
    money: (cents, code = currency) => new Intl.NumberFormat(locale, { style: "currency", currency: code }).format(cents / 100),
  };
}

export const language = () => (active ??= translator());
export function setLanguage(code) {
  active = translator(code);
  return active;
}
export const t = (key, vars) => language().t(key, vars);
export const th = (key, vars) => language().th(key, vars);

// Fills [data-t] elements and data-t-<attribute> attributes below root. A text replaces the
// element's own text nodes; child elements stay. Children marked data-t-slot="name" are placed
// where the text says {name}. <b>, <strong> and <code> in a text become elements.
export function applyTexts(root, lang = language()) {
  for (const el of root.querySelectorAll("[data-t]")) setText(el, lang.raw(el.dataset.t));
  for (const el of root.querySelectorAll("*")) {
    for (const attr of [...el.attributes]) {
      if (attr.name.startsWith("data-t-") && attr.name !== "data-t-slot" && attr.name !== "data-t-part")
        el.setAttribute(attr.name.slice(7), lang.t(attr.value));
    }
  }
}
function richNodes(doc, text) {
  const nodes = [];
  let at = 0,
    open = null;
  for (const match of text.matchAll(RICH)) {
    if (match.index > at) nodes.push([open, text.slice(at, match.index)]);
    open = match[1] ? null : match[2];
    at = match.index + match[0].length;
  }
  if (at < text.length) nodes.push([open, text.slice(at)]);
  return nodes.map(([tag, part]) => {
    if (!tag) return doc.createTextNode(part);
    const el = doc.createElement(tag);
    el.dataset.tPart = "";
    el.textContent = part;
    return el;
  });
}
function setText(el, text) {
  const doc = el.ownerDocument;
  const slots = new Map([...el.querySelectorAll(":scope > [data-t-slot]")].map((s) => [s.dataset.tSlot, s]));
  if (slots.size) {
    const parts = text.split(/\{(\w+)\}/);
    el.replaceChildren(
      ...parts.flatMap((part, i) => (i % 2 ? (slots.has(part) ? [slots.get(part)] : []) : richNodes(doc, part))),
    );
    return;
  }
  const old = [...el.childNodes].filter(
    (n) => (n.nodeType === 3 && n.data.trim()) || n.dataset?.tPart !== undefined,
  );
  // Without text so far it goes after leading icons (svg), before any other child element.
  const anchor = old[0] ?? [...el.children].find((c) => c.localName !== "svg") ?? null;
  const fresh = richNodes(doc, text);
  if (anchor) anchor.before(...fresh);
  else el.append(...fresh);
  for (const node of old) node.remove();
}
