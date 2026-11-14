// Check of the neutral "blanko" build before it may leave this Mac. Two layers:
//   1. Origin: the core is committed without changes and every file is byte for byte the build
//      that build.mjs makes from it. Private content could then only come from committed core
//      files, which the leak tests check together with the whole Git history.
//   2. Search: markers, profile texts, logos, icons, guides and other images of the sample profile
//      and of every studio; this Mac's user, host, home folder and Git e-mail address;
//      certificates and keys; Werkstatt and on-site mode; e-mail addresses other than the known
//      placeholders and the library credits; an embedded configuration; image metadata. The text
//      is also searched after percent, HTML and JavaScript decoding, without zero-width
//      characters, as UTF-16 and in short base64 blocks.
// The names to look for are read from the studios and this Mac at check time, never stored here.
//
//   node scripts/blanko-pruefen.mjs                     builds blanko in memory and checks it
//   node scripts/blanko-pruefen.mjs --dir <ordner>      checks a written build (index.html, dist/)
//   ... --sha256 <datei>                                writes the checksums of the checked files
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir, hostname, userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileMarkers, filesBelow, findFingerprints, findMarkers, fingerprints, scanText } from "../tests/lib/leaks.mjs";
import { STUDIOS_FALLBACK, buildProfile, resolveProfileDir, root, studioRoots } from "./build.mjs";

export const BLANKO_FILES = [
  "index.html",
  "dist/index.html",
  "dist/sw.js",
  "dist/manifest.webmanifest",
  "dist/icons/icon-192.png",
  "dist/icons/icon-512.png",
  "dist/licenses/jsPDF.txt",
  "dist/licenses/Tailwind.txt",
  "dist/licenses/NotoSans.txt",
];
const BLANKO_DIRS = ["dist", "dist/icons", "dist/licenses"];
const STUDIO_FIELDS = ["studioName", "studioAddress", "studioContact", "studioLocation"];
// Texts of a profile that name the studio; searched in addition to its markers.
const STUDIO_TEXTS = [
  ...STUDIO_FIELDS,
  "customerStudioName",
  "reportStudio",
  "metaName",
  "photoChannels",
  "photoStudio",
  "healthStudio",
  "welcomeStudio",
  "revocationContact",
  "wordmarkLabel",
  "titlePrefix",
  "eyebrowPrefix",
  "filesFolder",
];
const PLACEHOLDER_EMAILS = ["du@beispiel.de", "kontakt@dein-studio.de", "you@example.com", "contact@your-studio.com"];
const PNG_CHUNKS = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]);
const FIXED = [
  { label: "PEM-Block (Zertifikat oder Schlüssel)", rx: /-----BEGIN [A-Z0-9 ]+-----/ },
  { label: "Werkstatt", rx: /werkstatt/i },
  { label: "Vor-Ort-Modus", rx: /vor-ort|inkform-app\.local/i },
  { label: "lokaler Pfad", rx: /\/Users\/|\/private\/var\/|~\/Library/ },
];
// Bounded like real addresses; unbounded runs would make the search quadratic in long base64 blocks.
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}/g;
const IMAGE = /\.(png|jpe?g|heic|heif|gif|webp|pdf|svg)$/i;
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß" };

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const escapeRx = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pem = (text) =>
  [...text.matchAll(/-----BEGIN [^-]+-----([\s\S]*?)-----END/g)].map((m) => m[1].replace(/\s+/g, "")).filter(Boolean);
const printable = (text) => text.length >= 4 && /^[\p{L}\p{N}\p{P}\p{Zs}]+$/u.test(text);
const fromCode = (n) => (n <= 0x10ffff ? String.fromCodePoint(n) : "");

// Further readings of a text: decoded percent, HTML and JavaScript escapes, short base64 blocks.
export function decodedText(text) {
  const plain = text.replace(/[­᠎​-‏‪-‮⁠-⁤﻿]/g, "");
  const percent = plain.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
  const html = plain
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => fromCode(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => fromCode(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name] ?? m);
  const js = plain
    .replace(/\\u\{([0-9a-f]+)\}/gi, (_, h) => fromCode(parseInt(h, 16)))
    .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  const base64 = [...plain.matchAll(/[A-Za-z0-9+/]{24,199}={0,2}/g)]
    .map((m) => Buffer.from(m[0], "base64").toString("utf8"))
    .filter(printable);
  return [plain, percent, html, js, ...base64].join("\n");
}

// Text hidden as UTF-16 (little or big endian) in a file; printable runs only.
export function utf16Text(buffer) {
  const runs = [];
  for (const swap of [false, true]) {
    const copy = Buffer.from(buffer.subarray(0, buffer.length - (buffer.length % 2)));
    if (swap) copy.swap16();
    for (const m of copy.toString("utf16le").matchAll(/[\p{L}\p{N}\p{P}\p{Zs}]{4,}/gu)) runs.push(m[0]);
  }
  return runs.join("\n");
}

export function pngChunks(buffer) {
  const chunks = [];
  for (let i = 8; i + 8 <= buffer.length; i += 12 + buffer.readUInt32BE(i)) chunks.push(buffer.toString("latin1", i + 4, i + 8));
  return chunks;
}

// A written build: only the expected files and folders, no hidden entries, no links.
export async function readBuildDir(dir) {
  const files = new Map(),
    problems = [];
  async function walk(rel) {
    for (const entry of await readdir(path.join(dir, rel))) {
      const name = rel ? `${rel}/${entry}` : entry,
        info = await lstat(path.join(dir, name));
      if (info.isSymbolicLink()) problems.push(`${name}: Verknüpfung`);
      else if (info.isDirectory()) {
        if (BLANKO_DIRS.includes(name)) await walk(name);
        else problems.push(`${name}/: Ordner gehört nicht zum Build`);
      } else if (!info.isFile()) problems.push(`${name}: keine normale Datei`);
      else if (!BLANKO_FILES.includes(name)) problems.push(`${name}: gehört nicht zum Build`);
      else files.set(name, await readFile(path.join(dir, name)));
    }
  }
  await walk("");
  return { files, problems };
}

// Everything private this check knows about, read now from the studios and this Mac. A studio
// folder that cannot be read stops the check instead of being skipped.
// withoutStudios: a missing default folder (nothing named one) counts as no studios.
export async function collectPrivate({ env = process.env, home = homedir(), withoutStudios = false, places = {} } = {}) {
  const studios = [],
    fallback = places.fallback ?? STUDIOS_FALLBACK;
  for (const dir of await studioRoots(env, places)) {
    const entries = await readdir(dir, { withFileTypes: true }).catch((error) => {
      if (withoutStudios && error.code === "ENOENT" && dir === fallback) return [];
      throw new Error(`Studio-Ordner nicht lesbar: ${dir} (${error.code})`);
    });
    if (entries.some((e) => e.name === "profile.json")) studios.push(dir);
    else
      for (const e of entries)
        if (e.isDirectory() && !e.name.startsWith(".")) {
          const dirPath = path.join(dir, e.name);
          if ((await readdir(dirPath)).includes("profile.json")) studios.push(dirPath);
        }
  }
  const blanko = JSON.parse(await readFile(path.join(resolveProfileDir("blanko"), "profile.json"), "utf8"));
  const neutral = new Set(Object.values(blanko.text).flatMap((v) => v.split(" · ")).map((v) => v.trim().toLowerCase()));
  const profiles = [];
  for (const dir of [resolveProfileDir("beispiel"), ...studios.sort()]) {
    const profile = JSON.parse(await readFile(path.join(dir, "profile.json"), "utf8")),
      prints = await fingerprints(dir, profile.logo);
    for (const file of await filesBelow(dir, new Set([".git", "node_modules", "build", "test-results"])))
      if (IMAGE.test(file)) {
        const bytes = await readFile(file);
        prints.push({ label: path.relative(dir, file), bytes, base64: bytes.toString("base64") });
      }
    const texts = STUDIO_TEXTS.flatMap((key) => String(profile.text?.[key] ?? "").split(" · "))
      .map((v) => v.trim().replace(/[\s·|,.:;-]+$/, ""))
      .filter((v) => v.length >= 4 && !neutral.has(v.toLowerCase()));
    profiles.push({ id: profile.id, markers: compileMarkers([...profile.markers, ...new Set(texts)]), prints });
  }
  const certs = [];
  for (const sub of ["zertifikat", "zertifikate"]) {
    const dir = path.join(home, "Library", "Application Support", "Inkform", sub);
    const files = await filesBelow(dir).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw new Error(`Zertifikatsordner nicht lesbar: ${dir} (${error.code})`);
    });
    for (const file of files) {
      const bytes = await readFile(file),
        label = `${sub}/${path.relative(dir, file)}`;
      if (bytes.length >= 64) certs.push({ label, bytes, base64: bytes.toString("base64") });
      for (const body of pem(bytes.toString("latin1"))) certs.push({ label, bytes: Buffer.from(body, "base64"), base64: body });
    }
  }
  const words = [userInfo().username, hostname().replace(/\.local$/i, "")],
    plain = [home];
  try {
    words.push((await readFile(path.join(home, "Library", "Application Support", "Inkform", "zertifikat", "host.txt"), "utf8")).trim().replace(/\.local$/i, ""));
  } catch {}
  try {
    plain.push(execFileSync("git", ["config", "--get", "user.email"], { cwd: root, encoding: "utf8" }).trim());
  } catch {}
  const local = compileMarkers([
    ...words.filter((w) => w.length >= 3).map((w) => ({ regex: `(?<![\\p{L}\\p{N}])${escapeRx(w)}(?![\\p{L}\\p{N}])`, flags: "iu" })),
    ...plain.filter(Boolean),
  ]);
  return { studios: studios.map((d) => path.basename(d)), profiles, certs, local };
}

// E-mail addresses allowed in the build: the two placeholders and the credits in the libraries.
async function allowedEmails() {
  const found = new Set(PLACEHOLDER_EMAILS);
  for (const file of await filesBelow(path.join(root, "public", "vendor")))
    for (const m of (await readFile(file, "latin1")).matchAll(EMAIL)) found.add(m[0].toLowerCase());
  return found;
}

// files: Map of build path -> contents; profile: the blanko profile.json; reference: the files
// build.mjs makes (null skips the origin check, only for tests of the search layer); extra: further
// file names allowed besides the build (e.g. the README of the build repository), searched alike.
export async function checkBlanko(files, profile, priv, { reference = null, extra = [] } = {}) {
  const problems = [];
  if (profile.blank !== true) problems.push('profile.json: "blank": true fehlt');
  if (profile.guide) problems.push("profile.json: Blanko hat keine Anleitung");
  for (const key of STUDIO_FIELDS) if (profile.text?.[key]) problems.push(`profile.json: text.${key} muss leer sein`);
  for (const name of files.keys()) if (!BLANKO_FILES.includes(name) && !extra.includes(name)) problems.push(`${name}: gehört nicht zum Build`);
  for (const name of BLANKO_FILES) if (!files.has(name)) problems.push(`${name}: fehlt`);
  if (reference)
    for (const [name, contents] of files)
      if (reference.has(name) && !Buffer.from(contents).equals(Buffer.from(reference.get(name))))
        problems.push(`${name}: weicht vom Build aus dem committeten Kern ab`);
  const allowed = await allowedEmails();
  for (const [name, contents] of files) {
    const buffer = Buffer.from(contents),
      raw = buffer.toString("latin1"),
      searched = scanText(buffer),
      text = [searched, decodedText(searched), utf16Text(buffer)].join("\n");
    for (const p of priv.profiles) {
      for (const m of findMarkers(text + "\n" + name, p.markers)) problems.push(`${name}: Kennzeichen von ${p.id}: ${m}`);
      for (const f of findFingerprints(buffer, p.prints)) problems.push(`${name}: Datei von ${p.id}: ${f}`);
    }
    for (const f of findFingerprints(buffer, priv.certs)) problems.push(`${name}: Zertifikat oder Schlüssel ${f}`);
    for (const m of findMarkers(text + "\n" + raw, priv.local)) problems.push(`${name}: Kennung dieses Macs: ${m}`);
    for (const { label, rx } of FIXED) if (rx.test(text) || rx.test(raw)) problems.push(`${name}: ${label}`);
    for (const m of new Set([...(text + "\n" + raw).matchAll(EMAIL)].map((m) => m[0].toLowerCase())))
      if (!allowed.has(m)) problems.push(`${name}: fremde E-Mail-Adresse ${m}`);
    if (name.endsWith(".png"))
      for (const chunk of pngChunks(buffer)) if (!PNG_CHUNKS.has(chunk)) problems.push(`${name}: Bild-Metadaten (${chunk})`);
    if (name.endsWith("index.html")) {
      const config = /<script type="application\/json" id="inkform-config">([\s\S]*?)<\/script>/.exec(raw);
      if (!config || config[1].trim() !== "null") problems.push(`${name}: eingebettete Studio-Konfiguration`);
    }
  }
  return [...new Set(problems)];
}

export function assertCleanCore() {
  const changes = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
  if (changes.trim()) throw new Error(`Der Kern hat nicht committete Änderungen; geprüft wird nur ein committeter Stand:\n${changes}`);
}

export const studiosText = (studios) => `${studios.length} ${studios.length === 1 ? "Studio" : "Studios"} (${studios.join(", ") || "keine"})`;

export const checksums = (files) =>
  [...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, contents]) => `${sha256(Buffer.from(contents))}  ${name}`).join("\n") + "\n";

async function main(argv) {
  const arg = (name) => (argv.includes(name) ? path.resolve(argv[argv.indexOf(name) + 1]) : null);
  const dir = arg("--dir"),
    sums = arg("--sha256");
  assertCleanCore();
  const profile = JSON.parse(await readFile(path.join(resolveProfileDir("blanko"), "profile.json"), "utf8")),
    reference = (await buildProfile("blanko")).files;
  const { files, problems: layout } = dir ? await readBuildDir(dir) : { files: reference, problems: [] };
  const priv = await collectPrivate({ withoutStudios: argv.includes("--ohne-studios") });
  if (!priv.studios.length && !argv.includes("--ohne-studios"))
    throw new Error("Keine Studio-Profile gefunden. Ohne sie ist die Prüfung unvollständig; bewusst ohne: --ohne-studios.");
  const problems = [...layout, ...(await checkBlanko(files, profile, priv, { reference }))];
  if (problems.length) {
    console.error(`Blanko-Prüfung fehlgeschlagen (${problems.length}):\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  if (sums) await writeFile(sums, checksums(files), { flag: "wx" });
  console.log(
    `Blanko-Prüfung bestanden: ${files.size} Dateien, identisch mit dem Build aus dem committeten Kern, geprüft gegen das Beispiel und ${studiosText(priv.studios)}, ${priv.certs.length} Zertifikats- und Schlüsselblöcke und ${priv.local.length} Kennungen dieses Macs.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
