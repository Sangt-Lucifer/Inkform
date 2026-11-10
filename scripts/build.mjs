// Builds one self-contained app per studio profile.
//
//   node scripts/build.mjs                                   built-in profiles -> build/<id>/
//   node scripts/build.mjs --profile beispiel                built-in sample profile
//   node scripts/build.mjs --profile ../Inkform-Studios/x    studio profile outside this repo
//   node scripts/build.mjs --profile <pfad> --out <ziel>     explicit output folder
//   node scripts/build.mjs --check [...]                     fail if the output is outdated
//
// Shared code lives in src/. Studio-specific texts are %%token%% placeholders that are
// filled from <profil>/profile.json. Logo, icons, manifest and owner guide come from the
// profile folder. Nothing is fetched at runtime: every script, style and image is embedded.
//
// Studio profiles live outside this repository so that neither the code nor its history
// contains any studio's data. Their builds default to <profil>/build/ and may never be
// written into this repository.
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadPdfFonts } from "./fonts.mjs";

export const root = fileURLToPath(new URL("../", import.meta.url));
const TOKEN = /%%(\w+)%%/g;
// Values are inserted verbatim into JS string literals, template literals and HTML.
// Characters that could break out of those contexts are rejected.
const UNSAFE = /["`\\<>\r\n]|\$\{/;
const TEMPLATED = [
  "src/index.html",
  "src/styles.css",
  "src/defaults.js",
  "src/income.js",
  "src/access.js",
  "src/pdf-fonts.js",
  "src/pending.js",
  "src/consent.js",
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

// Studio profiles outside the repository: INKFORM_STUDIOS (list separated by ":"; each entry is a
// profile folder or a folder of profiles), otherwise ../Inkform-Studios next to this repository.
export async function discoverStudioProfiles(env = process.env) {
  const roots = env.INKFORM_STUDIOS
    ? env.INKFORM_STUDIOS.split(path.delimiter).filter(Boolean).map((p) => path.resolve(p))
    : [path.resolve(root, "..", "Inkform-Studios")];
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

export async function loadProfile(ref) {
  const dir = resolveProfileDir(ref);
  const id = path.basename(dir);
  const profile = JSON.parse(await readFile(path.join(dir, "profile.json"), "utf8"));
  if (profile.id !== id) throw new Error(`${dir}/profile.json: id muss "${id}" sein (Ordnername).`);
  if (inside(dir, root) && !isBuiltin(dir))
    throw new Error("Studio-Profile gehören nicht in das Kern-Repo, sondern nach ../Inkform-Studios/.");
  if (!Array.isArray(profile.markers) || profile.markers.length === 0)
    throw new Error(`${id}: profile.json braucht eine Liste "markers" mit den eigenen Kennzeichen.`);
  for (const [key, value] of Object.entries(profile.text ?? {})) {
    if (typeof value !== "string") throw new Error(`${id}: text.${key} muss Text sein.`);
    if (UNSAFE.test(value))
      throw new Error(`${id}: text.${key} enthält nicht erlaubte Zeichen (" \` \\ < > \${ oder Zeilenumbruch).`);
  }
  return { ...profile, dir };
}

export function fillTokens(source, text, name, used = new Set()) {
  return source.replace(TOKEN, (_, key) => {
    if (!Object.hasOwn(text, key)) throw new Error(`Platzhalter %%${key}%% in ${name} fehlt im Profil.`);
    used.add(key);
    return text[key];
  });
}

export async function buildProfile(ref) {
  const profile = await loadProfile(ref);
  const id = profile.id;
  const read = (name) => readFile(path.join(root, name), "utf8");
  const used = new Set();
  const filled = {};
  for (const name of TEMPLATED) filled[name] = fillTokens(await read(name), profile.text, name, used);
  const unused = Object.keys(profile.text).filter((key) => !used.has(key));
  if (unused.length) throw new Error(`${id}: ungenutzte Profiltexte: ${unused.join(", ")}`);

  const [registration, workerTemplate, tailwind, jspdf, logo, guide, pdfFonts] = await Promise.all([
    read("src/register-worker.js"),
    read("src/service-worker.js"),
    read("public/vendor/tailwind-browser.js"),
    read("public/vendor/jspdf.umd.min.js"),
    readFile(path.join(profile.dir, profile.logo)),
    readFile(path.join(profile.dir, "Anleitung-iPad-und-Admin.pdf")),
    loadPdfFonts(path.join(root, "public/vendor")),
  ]);
  const template = filled["src/index.html"],
    css = filled["src/styles.css"],
    defaults = filled["src/defaults.js"],
    income = filled["src/income.js"],
    access = filled["src/access.js"],
    fonts = filled["src/pdf-fonts.js"]
      .replace("__PDF_FONT_REGULAR__", () => pdfFonts.normal)
      .replace("__PDF_FONT_BOLD__", () => pdfFonts.bold)
      .replace("__PDF_FONT_COVERAGE__", () => pdfFonts.coverage),
    pending = filled["src/pending.js"],
    consent = filled["src/consent.js"],
    app = filled["src/app.js"];
  const exported = /^export\s+(?=(?:const|(?:async\s+)?function)\s)/gm;

  // Both outputs include the logo and every library. No CDN or sibling file is needed.
  const bundledJs = [
    defaults.replace(/^export\s+(?=const\s)/gm, ""),
    access.replace(/^export\s+(?=(?:const|(?:async\s+)?function)\s)/gm, ""),
    income.replace(/^export\s+(?=(?:const|function)\s)/gm, ""),
    fonts.replace(exported, ""),
    pending.replace(exported, ""),
    consent.replace(exported, ""),
    // All modules above are concatenated into one script, so app.js imports them directly.
    app.replace(/^import\s*\{[^}]*\}\s*from\s*["']\.\/[\w-]+\.js["'];?\s*/gm, ""),
  ].join("\n");
  if (/^\s*(?:import|export)\s/m.test(bundledJs) || /__PDF_FONT_\w+__/.test(bundledJs))
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
  portable = portable.replaceAll("__OWNER_GUIDE__", guide.toString("base64"));
  if (
    /<script\b[^>]*\bsrc\s*=/i.test(portable) ||
    portable.includes("__STUDIO_LOGO__") ||
    portable.includes("__OWNER_GUIDE__") ||
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
    () => `  <script data-hosted-only>\n${escapeScript(registration)}\n</script>\n</body>`,
  );
  const hash = createHash("sha256").update(hosted).update(workerTemplate).digest("hex").slice(0, 12);
  const worker = workerTemplate.replace("__BUILD_HASH__", hash);

  // Map of output path (relative to build/<id>/) -> contents.
  const files = new Map([
    ["index.html", portable],
    ["dist/index.html", hosted],
    ["dist/sw.js", worker],
    ["dist/manifest.webmanifest", await readFile(path.join(profile.dir, "manifest.webmanifest"))],
    ["dist/licenses/jsPDF.txt", await readFile(path.join(root, "public/vendor/LICENSE-jsPDF.txt"))],
    [
      "dist/licenses/Tailwind.txt",
      await readFile(path.join(root, "public/vendor/LICENSE-Tailwind.txt")),
    ],
    ["dist/licenses/NotoSans.txt", await readFile(path.join(root, "public/vendor/LICENSE-NotoSans.txt"))],
  ]);
  for (const icon of (await readdir(path.join(profile.dir, "icons"))).sort()) {
    if (icon.startsWith(".")) continue;
    files.set(`dist/icons/${icon}`, await readFile(path.join(profile.dir, "icons", icon)));
  }
  return { profile, files, bundledJs };
}

export function assertOutAllowed(profileDir, out) {
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
    const { files, profile } = await buildProfile(dir);
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
