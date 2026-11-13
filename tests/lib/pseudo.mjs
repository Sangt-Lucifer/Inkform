// Test-only pseudo language "qaa" (private-use code): every German text with accents, brackets and
// about 60 % extra length, written right to left. It proves that a new file in a language folder is
// enough: no code names it. Never written into src/sprachen/.
import { copyFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { LANGUAGE_DIR } from "../../scripts/build.mjs";
import { BASE_LANGUAGE, loadLanguages } from "../../scripts/sprachen.mjs";

export const PSEUDO = "qaa";
const ACCENTS = { a: "á", e: "é", i: "í", o: "ó", u: "ú", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú", n: "ñ", c: "ç" };
const KEEP = /(\{\w+\}|%%\w+%%|<\/?(?:b|strong|code)>)/;

export function pseudo(text) {
  const parts = text.split(KEEP).map((part, i) => (i % 2 ? part : part.replace(/[aeiouAEIOUnc]/g, (ch) => ACCENTS[ch])));
  const extra = "ŵ".repeat(Math.max(2, Math.ceil(text.length * 0.6)));
  return `[${parts.join("")} ${extra.replace(/(.{8})(?=.)/g, "$1 ")}]`;
}

// Copies the real language files into dir and adds the pseudo language next to them.
export async function writePseudoLanguages(dir) {
  for (const file of await readdir(LANGUAGE_DIR))
    if (file.endsWith(".js")) await copyFile(path.join(LANGUAGE_DIR, file), path.join(dir, file));
  const base = (await loadLanguages(LANGUAGE_DIR))[BASE_LANGUAGE];
  const categories = new Intl.PluralRules(PSEUDO).resolvedOptions().pluralCategories;
  const lines = Object.entries(base.texts).map(([key, value]) => {
    const text =
      typeof value === "string"
        ? pseudo(value)
        : Object.fromEntries(categories.map((form) => [form, pseudo(value[form] ?? value.other)]));
    return `    ${JSON.stringify(key)}: ${JSON.stringify(text)},`;
  });
  await writeFile(
    path.join(dir, `${PSEUDO}.js`),
    `export default {\n  name: "Pséúdó",\n  locale: "${PSEUDO}",\n  dir: "rtl",\n  pdfFont: "NotoSans",\n  texts: {\n${lines.join("\n")}\n  },\n};\n`,
  );
}
