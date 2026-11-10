// Unicode PDF output with the embedded Noto Sans (SIL Open Font License 1.1). The build replaces
// the placeholders with the font files and the list of characters both styles can print.
export const PDF_FONT = "NotoSans";
const PDF_FONT_DATA = { normal: "__PDF_FONT_REGULAR__", bold: "__PDF_FONT_BOLD__" };
const PDF_FONT_COVERAGE = "__PDF_FONT_COVERAGE__";

export function parseCoverage(text) {
  return text
    .split(",")
    .filter(Boolean)
    .map((part) => {
      const [start, end = start] = part.split("-").map((hex) => parseInt(hex, 16));
      return [start, end];
    });
}
let coverage = null;

// Distinct characters of `text` the PDF font cannot print (line breaks and tabs are fine).
export function unsupportedPdfChars(text, ranges = (coverage ??= parseCoverage(PDF_FONT_COVERAGE))) {
  const missing = new Set();
  for (const ch of String(text ?? "").normalize("NFC")) {
    if (ch === "\n" || ch === "\r" || ch === "\t") continue;
    const code = ch.codePointAt(0);
    let lo = 0,
      hi = ranges.length - 1,
      found = false;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (code < ranges[mid][0]) hi = mid - 1;
      else if (code > ranges[mid][1]) lo = mid + 1;
      else {
        found = true;
        break;
      }
    }
    if (!found) missing.add(ch);
  }
  return [...missing];
}

// New jsPDF document with Noto Sans registered and selected. jsPDF embeds only the used glyphs.
export function createPdfDocument(jsPDF, options, fonts = PDF_FONT_DATA) {
  const doc = new jsPDF(options);
  for (const style of ["normal", "bold"]) {
    const file = `${PDF_FONT}-${style}.ttf`;
    doc.addFileToVFS(file, fonts[style]);
    doc.addFont(file, PDF_FONT, style);
  }
  doc.setFont(PDF_FONT, "normal");
  return doc;
}
