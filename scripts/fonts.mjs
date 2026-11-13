// PDF fonts: Noto Sans Regular and Bold (SIL Open Font License 1.1, see
// public/vendor/LICENSE-NotoSans.txt). The build embeds both files into the app; jsPDF then
// writes only the glyphs a document actually uses into each PDF.
//
// The app must not print characters the font cannot show (jsPDF would silently drop them), so
// the build also embeds the set of characters both styles cover, read from the fonts' cmap.
import { readFile } from "node:fs/promises";
import path from "node:path";

const PDF_FONT_FILES = { normal: "NotoSans-Regular.ttf", bold: "NotoSans-Bold.ttf" };
// Fonts a language file may name as its "pdfFont".
export const PDF_FONT_NAMES = ["NotoSans"];

function tables(buffer) {
  const count = buffer.readUInt16BE(4),
    result = {};
  for (let i = 0; i < count; i++) {
    const o = 12 + i * 16;
    result[buffer.toString("latin1", o, o + 4)] = buffer.readUInt32BE(o + 8);
  }
  return result;
}

// Code points with a real glyph (not .notdef), from a Windows Unicode cmap (format 12 or 4).
function fontCodepoints(buffer) {
  const cmap = tables(buffer).cmap;
  if (cmap === undefined) throw new Error("Schrift ohne cmap-Tabelle.");
  const subtables = [];
  for (let i = 0; i < buffer.readUInt16BE(cmap + 2); i++) {
    const r = cmap + 4 + i * 8,
      platform = buffer.readUInt16BE(r),
      encoding = buffer.readUInt16BE(r + 2),
      offset = cmap + buffer.readUInt32BE(r + 4);
    if (platform === 3 && (encoding === 10 || encoding === 1))
      subtables.push({ format: buffer.readUInt16BE(offset), offset });
  }
  const points = new Set();
  const twelve = subtables.find((t) => t.format === 12);
  const four = subtables.find((t) => t.format === 4);
  if (twelve) {
    const o = twelve.offset,
      groups = buffer.readUInt32BE(o + 12);
    for (let g = 0; g < groups; g++) {
      const r = o + 16 + g * 12,
        start = buffer.readUInt32BE(r),
        end = buffer.readUInt32BE(r + 4),
        glyph = buffer.readUInt32BE(r + 8);
      for (let c = start; c <= end; c++) if (glyph + c - start) points.add(c);
    }
  } else if (four) {
    const o = four.offset,
      segs = buffer.readUInt16BE(o + 6) / 2;
    const ends = o + 14,
      starts = ends + segs * 2 + 2,
      deltas = starts + segs * 2,
      ranges = deltas + segs * 2;
    for (let s = 0; s < segs; s++) {
      const end = buffer.readUInt16BE(ends + s * 2),
        start = buffer.readUInt16BE(starts + s * 2),
        delta = buffer.readInt16BE(deltas + s * 2),
        rangeOffset = buffer.readUInt16BE(ranges + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let glyph;
        if (!rangeOffset) glyph = (c + delta) & 0xffff;
        else {
          const at = ranges + s * 2 + rangeOffset + (c - start) * 2;
          glyph = buffer.readUInt16BE(at);
          if (glyph) glyph = (glyph + delta) & 0xffff;
        }
        if (glyph) points.add(c);
      }
    }
  } else throw new Error("Schrift ohne unterstützte Unicode-cmap.");
  return points;
}

// Compact "start-end" hex ranges, e.g. "20-7e,a0-17f".
function encodeRanges(points) {
  const sorted = [...points].sort((a, b) => a - b),
    out = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (sorted[i + 1] === sorted[i] + 1) i++;
    out.push(start === sorted[i] ? start.toString(16) : `${start.toString(16)}-${sorted[i].toString(16)}`);
  }
  return out.join(",");
}

// jsPDF neither shapes complex scripts nor positions combining marks, so these are treated as
// unsupported even though the font has glyphs for them (they would print wrongly).
const UNSHAPED = [
  [0x0300, 0x036f], // combining diacritics (text is NFC-normalized first)
  [0x0900, 0x097f], // Devanagari
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x20d0, 0x20ff],
  [0xfe20, 0xfe2f],
];

export async function loadPdfFonts(vendorDir) {
  const [normal, bold] = await Promise.all(
    [PDF_FONT_FILES.normal, PDF_FONT_FILES.bold].map((f) => readFile(path.join(vendorDir, f))),
  );
  const boldPoints = fontCodepoints(bold);
  const both = [...fontCodepoints(normal)].filter(
    // Only the Basic Multilingual Plane: the bundled jsPDF drops characters above U+FFFF.
    (c) =>
      c >= 0x20 && c <= 0xffff && boldPoints.has(c) && !UNSHAPED.some(([a, b]) => c >= a && c <= b),
  );
  return {
    normal: normal.toString("base64"),
    bold: bold.toString("base64"),
    coverage: encodeRanges(both),
  };
}
