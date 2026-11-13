import test from "node:test";
import assert from "node:assert/strict";
import { createIncomeStore, createIncomeFeature, INCOME_KEY } from "../src/income.js";
const r = (changes = {}) => ({
  id: "one",
  date: "2026-11-06",
  artist: "Alex",
  customer: "Independent Test",
  totalCents: 50000,
  depositCents: 10000,
  source: "first.pdf",
  updatedAt: "2026-11-06T12:00:00.000Z",
  ...changes,
});
function mem() {
  let raw = null;
  return {
    getItem: () => raw,
    setItem: (k, v) => {
      assert.equal(k, INCOME_KEY);
      raw = v;
    },
  };
}
test("editing selected artist casing preserves the selected dropdown option", () => {
  const storage = mem(),
    store = createIncomeStore(storage);
  store.add(r());
  store.add(r({ id: "other", artist: "Robin" }));
  const listeners = {};
  const admin = { addEventListener: (type, fn) => (listeners[type] = fn) };
  const host = { innerHTML: "" };
  const form = { addEventListener: () => {} };
  const element = () => ({
    setAttribute: () => {},
    querySelector: () => form,
    querySelectorAll: () => [],
    addEventListener: () => {},
    close: () => {},
  });
  const previousDocument = globalThis.document,
    previousWindow = globalThis.window;
  try {
    globalThis.document = {
      createElement: element,
      body: { append: () => {} },
      getElementById: (id) => (id === "admin-app" ? admin : host),
    };
    globalThis.window = { addEventListener: () => {} };
    const feature = createIncomeFeature({
      storage,
      escape: (s) => s,
      money: (c) => String(c),
      parseMoney: Number,
      today: () => "2026-11-06",
      notify: () => {},
      download: () => {},
      showReport: () => {},
      isUnlocked: () => true,
    });
    listeners.change({ target: { id: "income-filter-artist", value: "artist:Alex" } });
    store.update(r({ artist: "ALEX", updatedAt: "2026-11-06T14:00:00Z" }), r().updatedAt);
    const html = feature.view();
    const select = html.match(/<select id="income-filter-artist">(.*?)<\/select>/s)[1];
    assert.match(select, /value="artist:ALEX" selected/);
    assert.equal((select.match(/ selected/g) || []).length, 1);
    assert.match(html, /<strong>1<small>Einwilligungen/); // All would have shown 2
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
test("currency: a captured entry keeps its own currency in the table even after the studio currency changes", () => {
  const storage = mem(),
    store = createIncomeStore(storage);
  const listeners = {};
  const admin = { addEventListener: (type, fn) => (listeners[type] = fn) };
  const host = { innerHTML: "" };
  const form = { addEventListener: () => {} };
  const element = () => ({
    setAttribute: () => {},
    querySelector: () => form,
    querySelectorAll: () => [],
    addEventListener: () => {},
    close: () => {},
  });
  const previousDocument = globalThis.document,
    previousWindow = globalThis.window;
  try {
    globalThis.document = {
      createElement: element,
      body: { append: () => {} },
      getElementById: (id) => (id === "admin-app" ? admin : host),
    };
    globalThis.window = { addEventListener: () => {} };
    let studioCurrency = "EUR";
    const feature = createIncomeFeature({
      storage,
      escape: (s) => s,
      money: (cents, code) => `${cents}${code ?? studioCurrency}`,
      parseMoney: (v) => Math.round(Number(v) * 100),
      currency: () => studioCurrency,
      today: () => "2026-11-06",
      notify: () => {},
      download: () => {},
      showReport: () => {},
      isUnlocked: () => true,
    });
    const captured = feature.capture(
      { fields: { appointment: "2026-11-06", artist: "Alex", firstName: "A", lastName: "B", totalPrice: "100", depositPaid: "" } },
      "a.pdf",
      "cur1",
    );
    assert.equal(captured.currency, "EUR");
    feature.book(captured);
    studioCurrency = "CHF"; // studio switches currency after this entry was already recorded
    const html = feature.view();
    assert.match(html, /10000EUR/); // the existing entry still shows its own currency
    const captured2 = feature.capture(
      { fields: { appointment: "2026-11-06", artist: "Alex", firstName: "C", lastName: "D", totalPrice: "50", depositPaid: "" } },
      "b.pdf",
      "cur2",
    );
    assert.equal(captured2.currency, "CHF"); // a new entry gets the now-current currency
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
