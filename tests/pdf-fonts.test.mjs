// Unicode PDF output: Noto Sans coverage and real jsPDF documents with the embedded fonts.
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadPdfFonts } from "../scripts/fonts.mjs";
import { root } from "../scripts/build.mjs";
import { PDF_FONT, createPdfDocument, parseCoverage, unsupportedPdfChars } from "../src/pdf-fonts.js";
import { pdfText } from "./lib/leaks.mjs";

const fonts = await loadPdfFonts(path.join(root, "public/vendor"));
const ranges = parseCoverage(fonts.coverage);
const NAMES = ["Gül Şahin", "Łukasz Ćwik", "Ayşe Yıldız"];

async function jsPDF() {
  const context = { navigator: { userAgent: "node" }, console, atob, btoa, TextEncoder, TextDecoder, setTimeout, clearTimeout };
  context.window = context.self = context;
  vm.createContext(context);
  vm.runInContext(await readFile(path.join(root, "public/vendor/jspdf.umd.min.js"), "utf8"), context);
  return context.jspdf.jsPDF;
}

test("test names and common German/European characters are covered by both styles", () => {
  for (const name of NAMES) assert.deepEqual(unsupportedPdfChars(name, ranges), [], name);
  const european = "äöüÄÖÜß ÀÉÈÊËÎÏÔÙÛÇ ĄĆĘŁŃÓŚŹŻ ČĎĚŇŘŠŤŮŽ ĞİıŞ ÅÆØ ÑÁÍÚ ŐŰ ȘȚ € „“ ‚‘ – — … · ° §";
  assert.deepEqual(unsupportedPdfChars(european, ranges), []);
  assert.deepEqual(unsupportedPdfChars("Ελένη Παπαδοπούλου Анна Иванова", ranges), []);
});

test("characters the font cannot print are reported once each", () => {
  assert.deepEqual(unsupportedPdfChars("✓ ok ✓ → 😀", ranges), ["✓", "→", "😀"]);
  // Scripts jsPDF cannot shape are rejected although the font has glyphs.
  assert.deepEqual(unsupportedPdfChars("नमस्ते", ranges).length > 0, true);
  assert.deepEqual(unsupportedPdfChars("محمد", ranges), ["م", "ح", "د"]);
});

test("decomposed input is normalized (e + combining acute = é) before the check", () => {
  assert.deepEqual(unsupportedPdfChars("Renée", ranges), []);
  assert.deepEqual(unsupportedPdfChars("x̶", ranges), ["̶"]);
});

test("line breaks and tabs are allowed, other control characters are not", () => {
  assert.deepEqual(unsupportedPdfChars("a\nb\tc\r\n", ranges), []);
  assert.deepEqual(unsupportedPdfChars("a\u0007", ranges), ["\u0007"]);
});

test("a jsPDF document with Noto Sans prints the test names correctly in both styles", async () => {
  const doc = createPdfDocument(await jsPDF(), { unit: "mm", format: "a4", compress: true }, fonts);
  doc.setFontSize(12);
  doc.text(`Regulär: ${NAMES.join(" · ")}`, 20, 20);
  doc.setFont(PDF_FONT, "bold");
  doc.text(`Fett: ${NAMES.join(" · ")}`, 20, 30);
  const pdf = Buffer.from(doc.output("arraybuffer"));
  const text = pdfText(pdf);
  assert.match(text, new RegExp(`Regulär: ${NAMES.join(" · ")}`));
  assert.match(text, new RegExp(`Fett: ${NAMES.join(" · ")}`));
  // Two embedded font subsets, not the full 800 KB files.
  assert.equal((pdf.toString("latin1").match(/\/FontFile2/g) ?? []).length, 2);
  assert.ok(pdf.length < 200_000, `PDF zu groß: ${pdf.length} Bytes`);
});

// ---------- characters jsPDF cannot render ----------
test("characters above U+FFFF are rejected (jsPDF would drop them)", () => {
  assert.deepEqual(unsupportedPdfChars("Before \u{10780} After", ranges), ["\u{10780}"]);
  assert.ok(ranges.every(([, end]) => end <= 0xffff));
});

test("every character the app accepts really comes out of jsPDF, in both styles", async () => {
  const chars = ranges.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => String.fromCharCode(a + i)));
  const PDF = await jsPDF();
  for (const style of ["normal", "bold"]) {
    const doc = createPdfDocument(PDF, { unit: "mm", format: "a4" }, fonts);
    doc.setFont(PDF_FONT, style);
    doc.setFontSize(8);
    let y = 10;
    for (const c of chars) {
      doc.text(`[${c}]`, 10, y);
      if ((y += 3) > 290) {
        doc.addPage();
        y = 10;
      }
    }
    const text = pdfText(Buffer.from(doc.output("arraybuffer")));
    const lost = chars.filter((c) => !text.includes(`[${c}]`));
    assert.deepEqual(lost, [], `${style}: ${lost.length} Zeichen fehlen im PDF`);
  }
});
