// Loaded before every Node test (--import): registers the language files as they are, without the
// profile texts, so modules imported from src/ behave like the unfilled sources.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLanguages, languagesForApp } from "../../scripts/sprachen.mjs";
import { registerLanguages } from "../../src/i18n.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src/sprachen");
registerLanguages(languagesForApp(await loadLanguages(dir), (text) => text));
