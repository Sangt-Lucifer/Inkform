// Builds one self-contained app per studio profile.
//
//   node scripts/build.mjs                                   built-in profiles -> build/<id>/
//   node scripts/build.mjs --profile beispiel                built-in sample profile
//   node scripts/build.mjs --profile <studio-ordner>         studio profile outside this repo
//   node scripts/build.mjs --profile <pfad> --out <ziel>     explicit output folder
//   node scripts/build.mjs --check [...]                     fail if the output is outdated
//
// Shared code lives in src/. Studio-specific texts are %%token%% placeholders that are
// filled from <profil>/profile.json. Interface texts come from the language files in src/sprachen/
// (see scripts/sprachen.mjs); every file there is one language of the app. Logo, icons, manifest and owner guide come from the
// profile folder. Nothing is fetched at runtime: every script, style and image is embedded.
// A profile with "blank": true is the neutral edition without a studio: no owner guide, a setup
// assistant at the first start and optional sample data.
//
// Studio profiles live outside this repository so that neither the code nor its history
// contains any studio's data. Their builds default to <profil>/build/ and may never be
// written into this repository.
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadPdfFonts } from "./fonts.mjs";
import { DEFAULT_SETTINGS } from "../src/defaults.js";
import { dropField, fieldOf, readTranslation, translatedFields, validCurrency } from "../src/languages.js";
import { BASE_LANGUAGE, checkKeyUsage, checkLanguages, languagesForApp, loadLanguages } from "./sprachen.mjs";

export const root = fileURLToPath(new URL("../", import.meta.url));
const TOKEN = /%%(\w+)%%/g;
// Values are inserted verbatim into JS string literals, template literals and HTML.
// Characters that could break out of those contexts are rejected.
export const UNSAFE = /["`\\<>\r\n]|\$\{/;
const TEMPLATED = [
  "src/index.html",
  "src/i18n.js",
  "src/languages.js",
  "src/styles.css",
  "src/defaults.js",
  "src/income.js",
  "src/access.js",
  "src/pdf-fonts.js",
  "src/pending.js",
  "src/consent.js",
  "src/retention.js",
  "src/zip.js",
  "src/export.js",
  "src/logo.js",
  "src/backup.js",
  "src/sample.js",
  "src/app.js",
];

const inside = (dir, parent) => {
  const rel = path.relative(parent, dir);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

export async function listBuiltinProfiles() {
  const entries = await readdir(path.join(root, "profiles"), { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => path.join(root, "profiles", e.name))
    .sort();
}

// Where the studio profiles lie, always outside the repository; each entry is a profile folder or a
// folder of profiles. In this order: INKFORM_STUDIOS (separated by ":"), the file .inkform-studios
// in the repository (one path per line, relative to the repository; ignored by Git), otherwise
// ../Inkform-Studios next to the repository.
export const STUDIOS_FILE = ".inkform-studios";
// places (file, fallback) exist for the tests. A root is "fallback" when nothing named it.
export const STUDIOS_FALLBACK = path.resolve(root, "..", "Inkform-Studios");
export async function studioRoots(env = process.env, { file = path.join(root, STUDIOS_FILE), fallback = STUDIOS_FALLBACK } = {}) {
  if (env.INKFORM_STUDIOS) return env.INKFORM_STUDIOS.split(path.delimiter).filter(Boolean).map((p) => path.resolve(p));
  const listed = await readFile(file, "utf8").then(
    (text) => text.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#")),
    () => [],
  );
  return listed.length ? listed.map((p) => path.resolve(path.dirname(file), p)) : [fallback];
}
export async function discoverStudioProfiles(env = process.env) {
  const roots = await studioRoots(env);
  const found = [];
  for (const dir of roots) {
    const has = (d) => readFile(path.join(d, "profile.json")).then(() => true, () => false);
    if (await has(dir)) found.push(dir);
    else
      for (const e of await readdir(dir, { withFileTypes: true }).catch(() => []))
        if (e.isDirectory() && (await has(path.join(dir, e.name)))) found.push(path.join(dir, e.name));
  }
  return found.filter((d) => !inside(d, root)).sort();
}

// "beispiel" = built-in profile in profiles/; anything else with a slash or dot is a path.
export function resolveProfileDir(ref) {
  if (/^[a-z0-9-]+$/.test(ref)) return path.join(root, "profiles", ref);
  return path.resolve(ref);
}

export const isBuiltin = (dir) => inside(dir, path.join(root, "profiles"));

export function defaultOut(dir) {
  return isBuiltin(dir) ? path.join(root, "build", path.basename(dir)) : path.join(dir, "build");
}

async function loadProfile(ref) {
  const dir = resolveProfileDir(ref);
  const id = path.basename(dir);
  const profile = JSON.parse(await readFile(path.join(dir, "profile.json"), "utf8"));
  if (profile.id !== id) throw new Error(`${dir}/profile.json: id muss "${id}" sein (Ordnername).`);
  if (inside(dir, root) && !isBuiltin(dir))
    throw new Error("Studio-Profile gehören nicht in das Kern-Repo, sondern in einen Ordner außerhalb.");
  if (profile.blank !== undefined && typeof profile.blank !== "boolean")
    throw new Error(`${id}: "blank" muss true oder false sein.`);
  if (!profile.blank && !profile.guide) throw new Error(`${id}: profile.json braucht "guide" (Anleitung als PDF).`);
  if (!Array.isArray(profile.markers) || profile.markers.length === 0)
    throw new Error(`${id}: profile.json braucht eine Liste "markers" mit den eigenen Kennzeichen.`);
  for (const [key, value] of Object.entries(profile.text ?? {})) {
    if (typeof value !== "string") throw new Error(`${id}: text.${key} muss Text sein.`);
    if (UNSAFE.test(value))
      throw new Error(`${id}: text.${key} enthält nicht erlaubte Zeichen (" \` \\ < > \${ oder Zeilenumbruch).`);
  }
  return { ...profile, dir };
}

function fillTokens(source, text, name, used = new Set()) {
  return source.replace(TOKEN, (_, key) => {
    if (!Object.hasOwn(text, key)) throw new Error(`Platzhalter %%${key}%% in ${name} fehlt im Profil.`);
    used.add(key);
    return text[key];
  });
}

export const LANGUAGE_DIR = path.join(root, "src", "sprachen");
// Language packs: languages not built into the app, published next to it as sprachen/<code>.json
// with the list sprachen/index.json. The app loads one only when it is needed (e.g. the device
// language under "Automatisch") and keeps it on the device. Same file format and rules as
// src/sprachen/; a code built into the app cannot also be a pack.
export const PACK_DIR = path.join(root, "sprachpakete");
export function packCodes(dir = PACK_DIR) {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".js"))
      .map((f) => f.slice(0, -3))
      .sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
export async function readPacks(builtins, dir = PACK_DIR) {
  if (!packCodes(dir).length) return {};
  const packs = await loadLanguages(dir);
  const errors = Object.keys(packs)
    .filter((code) => Object.hasOwn(builtins, code))
    .map((code) => `${code}.js: ist schon in src/sprachen/ eingebaut.`);
  errors.push(...checkLanguages({ [BASE_LANGUAGE]: builtins[BASE_LANGUAGE], ...packs }));
  if (errors.length) throw new Error(`Sprachpakete in ${path.relative(root, dir) || dir}:\n${errors.join("\n")}`);
  return packs;
}

// Language files of the app, checked against each other and against the code.
export async function readLanguages(dir = LANGUAGE_DIR) {
  const languages = await loadLanguages(dir);
  const sources = {};
  for (const name of [...TEMPLATED, "src/register-worker.js"])
    sources[name] = await readFile(path.join(root, name), "utf8");
  const errors = checkLanguages(languages);
  if (!errors.length) errors.push(...checkKeyUsage(languages[BASE_LANGUAGE].texts, sources));
  if (errors.length) throw new Error(`Sprachdateien in ${path.relative(root, dir) || dir}:\n${errors.join("\n")}`);
  return languages;
}

// profile.json "languages" ({ content, studio, customer, note }) and "currency", checked against the
// language files. content: language of the profile's own texts; studio: language the app starts in.
function profileLocale(profile, languages, manifest) {
  const where = `${profile.id}: profile.json`;
  const input = profile.languages ?? {};
  const known = (code, field) => {
    if (!Object.hasOwn(languages, code))
      throw new Error(`${where}: languages.${field} "${code}" hat keine Sprachdatei in src/sprachen/.`);
    return code;
  };
  const content = known(input.content ?? BASE_LANGUAGE, "content");
  const studio = known(input.studio ?? content, "studio");
  if (input.customer !== undefined && !Array.isArray(input.customer))
    throw new Error(`${where}: languages.customer muss eine Liste sein.`);
  const customer = [...new Set([studio, ...(input.customer ?? []).map((c) => known(c, "customer"))])];
  const note = input.note ?? {};
  for (const [code, text] of Object.entries(note)) {
    known(code, "note");
    if (typeof text !== "string" || text.length > 500 || UNSAFE.test(text))
      throw new Error(`${where}: languages.note.${code} muss ein kurzer Text ohne " \` \\ < > \${ sein.`);
  }
  const currency = profile.currency ?? "EUR";
  if (!validCurrency(currency)) throw new Error(`${where}: currency muss ein Währungscode wie EUR sein.`);
  const manifestLang = manifest.lang;
  if (manifestLang !== undefined && manifestLang !== studio && !manifestLang.startsWith(studio + "-"))
    throw new Error(`${where}: manifest.webmanifest "lang" (${manifestLang}) passt nicht zur Studiosprache ${studio}.`);
  return { content, studio, customer, currency, note };
}

// profile.json "translations": the default settings.translations for additional languages, read like
// validateTranslations at runtime. A language is still only offered once the owner picks it.
// Translations spell out what profile texts (%%token%%) say in the base language; "basedOn" records
// those texts as they were when translated. A translated field whose profile text has changed since
// is left out with a warning, so the language is no longer complete and not offered.
const TOKEN_USE = new Map([...translatedFields(DEFAULT_SETTINGS)].map(([field, text]) => [field, [...new Set([...text.matchAll(TOKEN)].map((m) => m[1]))]]));
function profileTranslations(profile, languages, content) {
  const where = `${profile.id}: profile.json`;
  const value = profile.translations;
  const output = {},
    warnings = [];
  if (value === undefined) return { translations: output, warnings };
  if (!value || typeof value !== "object") throw new Error(`${where}: translations muss ein Objekt sein.`);
  for (const [code, tr] of Object.entries(value)) {
    if (code === content) continue;
    if (!Object.hasOwn(languages, code))
      throw new Error(`${where}: translations.${code} hat keine Sprachdatei in src/sprachen/.`);
    if (!tr || typeof tr !== "object") throw new Error(`${where}: translations.${code} muss ein Objekt sein.`);
    if (tr.draft !== undefined && typeof tr.draft !== "boolean")
      throw new Error(`${where}: translations.${code}.draft muss true oder false sein.`);
    const own = readTranslation(tr, DEFAULT_SETTINGS, (input, max, field) => {
      if (input === undefined || input === "") return undefined;
      if (typeof input !== "string" || input.length > max || /[<>]/.test(input))
        throw new Error(`${where}: translations.${code}.${field} ist ungültig, zu lang oder enthält < oder >.`);
      return input.normalize("NFC").trim() || undefined;
    });
    delete own.stale;
    delete own.staleBase;
    const basedOn = tr.basedOn ?? {};
    if (typeof basedOn !== "object" || Array.isArray(basedOn))
      throw new Error(`${where}: translations.${code}.basedOn muss ein Objekt sein.`);
    const used = [...TOKEN_USE].filter(([field]) => fieldOf(own, field) !== undefined);
    const missing = [...new Set(used.flatMap(([, tokens]) => tokens))].filter((k) => typeof basedOn[k] !== "string");
    if (missing.length)
      throw new Error(`${where}: translations.${code}.basedOn fehlt für ${missing.join(", ")} (der Profiltext, von dem übersetzt wurde).`);
    for (const [field, tokens] of used) {
      const changed = tokens.filter((k) => basedOn[k] !== profile.text[k]);
      if (!changed.length) continue;
      dropField(own, field);
      warnings.push(`${where}: translations.${code}.${field} passt nicht mehr zu ${changed.join(", ")} und wird weggelassen; ${code} wird erst wieder angeboten, wenn die Übersetzung nachgezogen ist.`);
    }
    output[code] = own;
  }
  return { translations: output, warnings };
}

// `languages` (a folder of language files) is for tests only; a real build reads src/sprachen/.
export async function buildProfile(ref, { languages: languageDir = LANGUAGE_DIR, packs: packDir = PACK_DIR } = {}) {
  const profile = await loadProfile(ref);
  const id = profile.id;
  const read = (name) => readFile(path.join(root, name), "utf8");
  const used = new Set();
  const filled = {};
  for (const name of TEMPLATED) filled[name] = fillTokens(await read(name), profile.text, name, used);
  const builtins = await readLanguages(languageDir);
  const languages = languagesForApp(builtins, (text) => fillTokens(text, profile.text, "src/sprachen", used));
  const packs = languagesForApp(await readPacks(builtins, packDir), (text) => fillTokens(text, profile.text, "sprachpakete", new Set()));
  const locale = profileLocale(
    profile,
    languages,
    JSON.parse(await readFile(path.join(profile.dir, "manifest.webmanifest"), "utf8")),
  );
  const { translations, warnings } = profileTranslations(profile, languages, locale.content);
  const unused = Object.keys(profile.text).filter((key) => !used.has(key));
  if (unused.length) throw new Error(`${id}: ungenutzte Profiltexte: ${unused.join(", ")}`);

  const [registration, workerTemplate, tailwind, jspdf, logo, guide, pdfFonts] = await Promise.all([
    read("src/register-worker.js"),
    read("src/service-worker.js"),
    read("public/vendor/tailwind-browser.js"),
    read("public/vendor/jspdf.umd.min.js"),
    readFile(path.join(profile.dir, profile.logo)),
    profile.blank ? Buffer.alloc(0) : readFile(path.join(profile.dir, "Anleitung-iPad-und-Admin.pdf")),
    loadPdfFonts(path.join(root, "public/vendor")),
  ]);
  const template = filled["src/index.html"],
    css = filled["src/styles.css"],
    defaults = filled["src/defaults.js"]
      .replace('"__PROFILE_LOCALE__"', () => JSON.stringify(JSON.stringify(locale)))
      .replace('"__PROFILE_TRANSLATIONS__"', () => JSON.stringify(JSON.stringify(translations))),
    income = filled["src/income.js"],
    access = filled["src/access.js"],
    i18n = filled["src/i18n.js"],
    studioLanguages = filled["src/languages.js"],
    fonts = filled["src/pdf-fonts.js"]
      .replace("__PDF_FONT_REGULAR__", () => pdfFonts.normal)
      .replace("__PDF_FONT_BOLD__", () => pdfFonts.bold)
      .replace("__PDF_FONT_COVERAGE__", () => pdfFonts.coverage),
    pending = filled["src/pending.js"],
    consent = filled["src/consent.js"],
    retention = filled["src/retention.js"],
    zip = filled["src/zip.js"],
    exporter = filled["src/export.js"],
    logoModule = filled["src/logo.js"],
    backup = filled["src/backup.js"],
    sample = filled["src/sample.js"],
    app = filled["src/app.js"].replace('"__BLANK_EDITION__"', profile.blank ? '"true"' : '"false"');
  const exported = /^export\s+(?=(?:const|(?:async\s+)?function)\s)/gm;

  // Both outputs include the logo and every library. No CDN or sibling file is needed.
  // All modules are concatenated into one script, so their imports of each other are removed.
  const local = /^import\s*\{[^}]*\}\s*from\s*["']\.\/[\w-]+\.js["'];?\s*/gm;
  const bundledJs = [
    i18n.replace(exported, "") + `\nregisterLanguages(${JSON.stringify(languages)});`,
    studioLanguages,
    defaults,
    access,
    retention,
    income,
    fonts,
    pending,
    consent,
    zip,
    exporter,
    logoModule,
    backup,
    sample,
    app,
  ]
    .map((source) => source.replace(local, "").replace(exported, ""))
    .join("\n");
  if (/^\s*(?:import|export)\s/m.test(bundledJs) || /__PDF_FONT_\w+__|__BLANK_EDITION__|__PROFILE_LOCALE__|__PROFILE_TRANSLATIONS__/.test(bundledJs))
    throw new Error("Bundle enthält noch Modul-Importe/-Exporte oder Schrift-Platzhalter.");
  const escapeScript = (source) => source.replace(/<\/script/gi, "<\\/script");
  let portable = template
    .replaceAll("__STUDIO_LOGO__", `data:image/png;base64,${logo.toString("base64")}`)
    .replace(
      /<link\s+rel="stylesheet"\s+href="\.\/styles\.css"\s*\/?\s*>/,
      () => `<style>\n${css}\n</style>`,
    )
    .replace(
      /<script\s+src="\.\.\/public\/vendor\/tailwind-browser\.js"\s*><\/script>/,
      () => `<script>\n${escapeScript(tailwind)}\n</script>`,
    )
    .replace(
      /<script\s+defer\s+src="\.\.\/public\/vendor\/jspdf\.umd\.min\.js"\s+id="pdf-library"\s*><\/script>/,
      () => `<script id="pdf-library">\n${escapeScript(jspdf)}\n</script>`,
    )
    .replace(
      /<script\s+type="module"\s+src="\.\/app\.js"\s*><\/script>/,
      () => `<script>\n${escapeScript(bundledJs)}\n</script>`,
    );
  portable = portable
    .replaceAll("__OWNER_GUIDE__", guide.toString("base64"))
    .replace("__OWNER_GUIDE_PAGES__", String((guide.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length));
  if (
    /<script\b[^>]*\bsrc\s*=/i.test(portable) ||
    portable.includes("__STUDIO_LOGO__") ||
    portable.includes("__OWNER_GUIDE__") ||
    portable.includes("__OWNER_GUIDE_PAGES__") ||
    portable.includes('href="./styles.css"') ||
    /%%\w+%%/.test(portable)
  ) {
    throw new Error("Portable output must embed all scripts, styles and studio logos.");
  }
  let hosted = portable
    .replace("img-src data: blob:", "img-src 'self' data: blob:")
    .replace(
      "</head>",
      `  <link rel="manifest" href="./manifest.webmanifest" data-hosted-only>\n  <link rel="apple-touch-icon" href="./icons/icon-192.png" data-hosted-only>\n</head>`,
    );
  hosted = hosted.replace(
    "</body>",
    () => `  <script data-hosted-only>\n${escapeScript(registration.replace(local, ""))}\n</script>\n</body>`,
  );
  // The page's own version, so it can tell that the worker already holds a newer copy of it.
  const pageVersion = createHash("sha256").update(hosted).digest("hex").slice(0, 12);
  hosted = hosted.replace("</head>", `  <meta name="inkform-page" content="${pageVersion}" data-hosted-only>\n</head>`);
  // Every file the service worker caches goes into its version: a changed manifest or icon alone
  // also makes a new worker, so installed iPads pick it up.
  const assets = [
    ["dist/manifest.webmanifest", await readFile(path.join(profile.dir, "manifest.webmanifest"))],
    ["dist/licenses/Inkform.txt", await readFile(path.join(root, "LICENSE"))],
    ["dist/licenses/jsPDF.txt", await readFile(path.join(root, "public/vendor/LICENSE-jsPDF.txt"))],
    ["dist/licenses/Tailwind.txt", await readFile(path.join(root, "public/vendor/LICENSE-Tailwind.txt"))],
    ["dist/licenses/NotoSans.txt", await readFile(path.join(root, "public/vendor/LICENSE-NotoSans.txt"))],
  ];
  for (const icon of (await readdir(path.join(profile.dir, "icons"))).sort()) {
    if (icon.startsWith(".")) continue;
    assets.push([`dist/icons/${icon}`, await readFile(path.join(profile.dir, "icons", icon))]);
  }
  const versionHash = createHash("sha256").update(hosted).update(workerTemplate);
  for (const [name, contents] of assets) versionHash.update(name).update(contents);
  const worker = workerTemplate.replace("__BUILD_HASH__", versionHash.digest("hex").slice(0, 12));

  // Map of output path (relative to build/<id>/) -> contents.
  const files = new Map([
    ["index.html", portable],
    ["dist/index.html", hosted],
    ["dist/sw.js", worker],
    ...assets,
    // Packs are fetched on demand, not cached with the app: a new pack needs no app update.
    [
      "dist/sprachen/index.json",
      JSON.stringify({ schemaVersion: 1, packs: Object.fromEntries(Object.entries(packs).map(([code, pack]) => [code, { name: pack.name }])) }),
    ],
    ...Object.entries(packs).map(([code, pack]) => [`dist/sprachen/${code}.json`, JSON.stringify(pack)]),
  ]);
  return { profile, files, bundledJs, warnings };
}

function assertOutAllowed(profileDir, out) {
  if (!isBuiltin(profileDir) && inside(out, root))
    throw new Error(
      "Ein Studio-Build darf nicht im Kern-Repo landen. Bitte --out außerhalb wählen oder weglassen (Standard: <profil>/build).",
    );
}

async function main(argv) {
  const check = argv.includes("--check");
  const refs = argv.flatMap((arg, i) => (arg === "--profile" ? [argv[i + 1]] : []));
  const outs = argv.flatMap((arg, i) => (arg === "--out" ? [argv[i + 1]] : []));
  if (refs.some((r) => !r) || outs.some((o) => !o)) throw new Error("--profile und --out brauchen einen Wert.");
  if (outs.length > 1 || (outs.length && refs.length !== 1))
    throw new Error("--out nur zusammen mit genau einem --profile angeben.");
  const selected = refs.length ? refs : await listBuiltinProfiles();
  for (const ref of selected) {
    const dir = resolveProfileDir(ref);
    const out = outs.length ? path.resolve(outs[0]) : defaultOut(dir);
    assertOutAllowed(dir, out);
    const { files, profile, warnings } = await buildProfile(dir);
    for (const warning of warnings) console.warn(`Warnung: ${warning}`);
    const id = profile.id;
    const shown = path.relative(process.cwd(), out) || ".";
    if (check) {
      for (const [name, expected] of files) {
        const actual = await readFile(path.join(out, name)).catch(() => null);
        if (!actual || !actual.equals(Buffer.from(expected)))
          throw new Error(`${shown}/${name} (${id}) is outdated. Run the build again.`);
      }
      console.log(`${shown} (${id}): up to date. All libraries and studio logos are embedded.`);
    } else {
      // Only replace a previous build: never delete a folder that holds anything else.
      const existing = await readdir(out).catch(() => []);
      const foreign = existing.filter((n) => !["index.html", "dist", ".DS_Store"].includes(n));
      if (foreign.length)
        throw new Error(`${shown} enthält fremde Dateien (${foreign.join(", ")}). Bitte einen leeren Zielordner wählen.`);
      await rm(path.join(out, "index.html"), { force: true });
      await rm(path.join(out, "dist"), { recursive: true, force: true });
      for (const [name, contents] of files) {
        await mkdir(path.dirname(path.join(out, name)), { recursive: true });
        await writeFile(path.join(out, name), contents);
      }
      console.log(`${shown} (${id}): self-contained index.html and offline-capable dist/.`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
