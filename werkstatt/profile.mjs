// Create a new studio and edit its profile. Only studios released in
// <state>/freigegeben.json can be edited; Beispiel (the sample in the core) and every other studio
// are never written to. Every save is checked with the same rules as build.mjs plus the
// cross-studio marker rules, by building the draft in a temporary folder first. Nothing is saved
// while an error is open. No customer data is read or written here.
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFile, cp, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { UNSAFE, buildProfile, discoverStudioProfiles, root } from "../scripts/build.mjs";
import { compileMarkers, findMarkers, scanText } from "../tests/lib/leaks.mjs";
import { matchInWorker, probeMarkers, regexShapeError } from "./markers.mjs";
import { SAFE_GIT, STUDIO_ID, cleanEnv, inside, readJson, realLocation, releasedStudios } from "./status.mjs";

const run = promisify(execFile);
const SAMPLE = path.join(root, "profiles", "beispiel");
const AUTHOR = { name: "Sven", email: "sven@inkform.invalid" };
const CONTROL = /[\u0000-\u001f\u007f]/;
const MAX_LOGO = 2 * 1024 * 1024;
const RESERVED = new Set(["beispiel", "blanko", "build", "dist", "profiles"]);

// Files a studio profile consists of; the editor only ever writes these.
const FILES = {
  profile: "profile.json",
  manifest: "manifest.webmanifest",
  guide: path.join("Dokumente", "Anleitung.md"),
  logo: "logo.png",
};
// Manifest fields the editor may change. id, start_url, scope and display stay fixed: the address
// and the behaviour of the installed app on the iPad depend on them.
const MANIFEST_FIELDS = ["name", "short_name", "description", "theme_color", "background_color"];

const sampleProfile = () => readJson(path.join(SAMPLE, FILES.profile));

function studiosRoot(env = process.env) {
  const first = (env.INKFORM_STUDIOS ?? "").split(path.delimiter).find(Boolean);
  return first ? path.resolve(first) : path.resolve(root, "..", "Inkform-Studios");
}

async function writeAtomic(file, contents) {
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, contents);
    await rename(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

// Fingerprint of the editable files: a save is refused when they changed since the editor loaded them.
async function version(dir) {
  const hash = createHash("sha256");
  for (const name of [...Object.values(FILES), path.join("icons", "icon-192.png"), path.join("icons", "icon-512.png")]) hash.update(name).update(await readFile(path.join(dir, name)).catch(() => Buffer.alloc(0)));
  return hash.digest("hex").slice(0, 16);
}

export async function readEditable(dir) {
  const [profile, manifest, guide, sample] = await Promise.all([
    readJson(path.join(dir, FILES.profile)),
    readJson(path.join(dir, FILES.manifest)),
    readFile(path.join(dir, FILES.guide), "utf8").catch(() => ""),
    sampleProfile(),
  ]);
  const icon = (size) => readFile(path.join(dir, "icons", `icon-${size}.png`)).then((b) => b.toString("base64"), () => null);
  return {
    version: await version(dir),
    textKeys: Object.keys(sample.text),
    draft: {
      name: profile.name ?? "",
      description: profile.description ?? "",
      markers: profile.markers ?? [],
      guide: { header: profile.guide?.header ?? "", date: profile.guide?.date ?? "", author: profile.guide?.author ?? "" },
      text: profile.text ?? {},
      guideMd: guide,
      manifest: Object.fromEntries(MANIFEST_FIELDS.map((k) => [k, manifest[k] ?? ""])),
    },
    icons: { 192: await icon(192), 512: await icon(512) },
  };
}

// ---------- rules ----------

function pngSize(bytes) {
  const sig = "89504e470d0a1a0a";
  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== sig || bytes.toString("latin1", 12, 16) !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function logoErrors(bytes) {
  if (bytes.length > MAX_LOGO) return ["Logo: höchstens 2 MB."];
  const size = pngSize(bytes);
  if (!size) return ["Logo: nur PNG-Dateien."];
  if (size.width !== size.height) return [`Logo: muss quadratisch sein (ist ${size.width} × ${size.height}).`];
  if (size.width < 512 || size.width > 4096) return [`Logo: 512 bis 4096 Pixel Kantenlänge (ist ${size.width}).`];
  return [];
}

function markerErrors(markers) {
  const errors = [];
  if (!Array.isArray(markers) || markers.length === 0) return ["Kennzeichen: mindestens eines nötig (Studioname, Domain, Inhaber …)."];
  if (markers.length > 30) errors.push("Kennzeichen: höchstens 30.");
  markers.forEach((m, i) => {
    const where = `Kennzeichen ${i + 1}`;
    if (typeof m === "string") {
      if (m.trim().length < 3) errors.push(`${where}: mindestens 3 Zeichen.`);
      else if (m !== m.trim()) errors.push(`${where}: keine Leerzeichen am Anfang oder Ende.`);
      if (m.length > 120 || CONTROL.test(m)) errors.push(`${where}: zu lang oder mit Steuerzeichen.`);
    } else if (m && typeof m === "object" && typeof m.regex === "string") {
      const flags = m.flags ?? "i";
      if (typeof flags !== "string" || !/^[imsu]*$/.test(flags)) return errors.push(`${where}: erlaubte Schalter nur i, m, s, u.`);
      if (Object.keys(m).some((k) => !["regex", "flags"].includes(k))) errors.push(`${where}: nur "regex" und "flags".`);
      if (m.regex.length > 200) return errors.push(`${where}: Regex zu lang.`);
      const shape = regexShapeError(m.regex);
      if (shape) return errors.push(`${where}: ${shape}`);
      try {
        const rx = new RegExp(m.regex, flags);
        if (rx.test("")) errors.push(`${where}: Regex passt auf leeren Text und würde alles finden.`);
      } catch (error) {
        errors.push(`${where}: ungültige Regex (${error.message}).`);
      }
    } else errors.push(`${where}: Text oder {"regex": …}.`);
  });
  return errors;
}

// Rules without building: the same character rules as build.mjs, the same text fields as the
// sample profile, sensible manifest values.
function staticErrors(draft, textKeys) {
  const errors = [];
  const str = (value, label, { max = 200, min = 0, unsafe = false } = {}) => {
    if (typeof value !== "string") return errors.push(`${label}: muss Text sein.`);
    if (value.trim().length < min) errors.push(`${label}: darf nicht leer sein.`);
    if (value.length > max) errors.push(`${label}: höchstens ${max} Zeichen.`);
    if (unsafe && UNSAFE.test(value)) errors.push(`${label}: enthält nicht erlaubte Zeichen (" \` \\ < > \${ oder Zeilenumbruch).`);
    else if (CONTROL.test(value)) errors.push(`${label}: enthält Steuerzeichen oder Zeilenumbrüche.`);
  };
  if (!draft || typeof draft !== "object") return ["Ungültige Anfrage."];
  str(draft.name, "Name", { min: 1, max: 80 });
  str(draft.description, "Beschreibung", { max: 300 });
  const text = draft.text && typeof draft.text === "object" ? draft.text : {};
  const missing = textKeys.filter((k) => !Object.hasOwn(text, k)),
    extra = Object.keys(text).filter((k) => !textKeys.includes(k));
  if (missing.length) errors.push(`Texte fehlen: ${missing.join(", ")}.`);
  if (extra.length) errors.push(`Unbekannte Texte: ${extra.join(", ")}.`);
  for (const k of textKeys) if (Object.hasOwn(text, k)) str(text[k], `Text ${k}`, { max: 3000, unsafe: true });
  const guide = draft.guide ?? {};
  str(guide.header, "Anleitung Kopfzeile", { min: 1, max: 60, unsafe: true });
  str(guide.author, "Anleitung Autor", { min: 1, max: 60, unsafe: true });
  if (typeof guide.date !== "string" || !/^\d{2}\.\d{2}\.\d{4}$/.test(guide.date)) errors.push("Anleitung Datum: Format TT.MM.JJJJ.");
  if (typeof draft.guideMd !== "string") errors.push("Anleitung.md: muss Text sein.");
  else if (draft.guideMd.length > 300_000 || draft.guideMd.includes("\u0000")) errors.push("Anleitung.md: zu lang oder ungültig.");
  const m = draft.manifest ?? {};
  str(m.name, "Manifest Name", { min: 1, max: 60 });
  str(m.short_name, "Manifest Kurzname", { min: 1, max: 15 });
  str(m.description, "Manifest Beschreibung", { max: 200 });
  for (const k of ["theme_color", "background_color"])
    if (typeof m[k] !== "string" || !/^#[0-9a-fA-F]{6}$/.test(m[k])) errors.push(`Manifest ${k}: Farbe im Format #rrggbb.`);
  errors.push(...markerErrors(draft.markers));
  return errors;
}

// Every editable value with the place it comes from, for the marker rules.
function fields(draft) {
  const out = [
    ["Name", draft.name],
    ["Beschreibung", draft.description],
    ...Object.entries(draft.text ?? {}).map(([k, v]) => [`Text ${k}`, v]),
    ...Object.entries(draft.guide ?? {}).map(([k, v]) => [`Anleitung ${k}`, v]),
    ["Anleitung.md", draft.guideMd],
    ...Object.entries(draft.manifest ?? {}).map(([k, v]) => [`Manifest ${k}`, v]),
  ];
  return out.filter(([, v]) => typeof v === "string");
}

let sampleBuild = null;
async function sampleText() {
  // The sample (Beispiel) build is the neutral reference: a studio marker found there is too general.
  sampleBuild ??= buildProfile(SAMPLE).then(({ files }) => [...files.values()].map((c) => scanText(c)).join("\n"));
  return sampleBuild;
}

// Other studios are only read (profile.json, in memory), never written.
async function otherStudios(dir, env) {
  const others = [];
  for (const d of await discoverStudioProfiles(env)) {
    if (path.resolve(d) === path.resolve(dir)) continue;
    const p = await readJson(path.join(d, FILES.profile)).catch(() => null);
    if (!p || !Array.isArray(p.markers)) continue;
    others.push({
      id: p.id,
      markers: p.markers.filter((m) => typeof m === "string" || (m && typeof m.regex === "string")),
      text: JSON.stringify(p.text ?? {}) + "\n" + (p.name ?? ""),
    });
  }
  return others;
}

// Copies what build.mjs reads into a temporary folder, with the draft applied.
async function trialFolder(base, dir, id, draft, logo) {
  const trial = path.join(base, id);
  await mkdir(path.join(trial, "Dokumente"), { recursive: true });
  const current = await readJson(path.join(dir, FILES.profile));
  const manifest = await readJson(path.join(dir, FILES.manifest));
  await writeFile(path.join(trial, FILES.profile), profileJson(current, draft));
  await writeFile(path.join(trial, FILES.manifest), manifestJson(manifest, draft));
  await writeFile(path.join(trial, FILES.guide), draft.guideMd);
  await copyFile(path.join(dir, "Anleitung-iPad-und-Admin.pdf"), path.join(trial, "Anleitung-iPad-und-Admin.pdf"));
  if (logo) {
    await mkdir(path.join(trial, "icons"));
    await writeFile(path.join(trial, FILES.logo), logo.logo);
    for (const [size, bytes] of Object.entries(logo.icons)) await writeFile(path.join(trial, "icons", `icon-${size}.png`), bytes);
  } else {
    await cp(path.join(dir, "icons"), path.join(trial, "icons"), { recursive: true });
    await copyFile(path.join(dir, FILES.logo), path.join(trial, FILES.logo));
  }
  return trial;
}

function profileJson(current, draft) {
  const next = {
    ...current,
    name: draft.name,
    description: draft.description,
    markers: draft.markers,
    guide: { ...(current.guide ?? {}), ...draft.guide },
    text: Object.fromEntries(Object.keys(draft.text).map((k) => [k, draft.text[k]])),
  };
  return JSON.stringify(next, null, 2) + "\n";
}
function manifestJson(current, draft) {
  const next = { ...current };
  for (const k of MANIFEST_FIELDS) next[k] = draft.manifest[k];
  return JSON.stringify(next, null, 2) + "\n";
}

// Logo -> icons with macOS sips, in a temporary folder.
async function prepareLogo(base64) {
  if (typeof base64 !== "string" || base64.length > MAX_LOGO * 1.4) return { errors: ["Logo: höchstens 2 MB."] };
  const logo = Buffer.from(base64, "base64");
  const errors = logoErrors(logo);
  if (errors.length) return { errors };
  const work = await mkdtemp(path.join(tmpdir(), "inkform-logo-"));
  try {
    await writeFile(path.join(work, "logo.png"), logo);
    const icons = {};
    for (const size of [192, 512]) {
      const out = path.join(work, `icon-${size}.png`);
      await run("sips", ["-s", "format", "png", "-z", String(size), String(size), path.join(work, "logo.png"), "--out", out]);
      icons[size] = await readFile(out);
      const got = pngSize(icons[size]);
      if (!got || got.width !== size || got.height !== size) return { errors: [`Logo: Icon ${size} px konnte nicht erzeugt werden.`] };
    }
    return { errors: [], logo, icons };
  } catch (error) {
    return { errors: [`Logo: Icons konnten nicht erzeugt werden (${error.message}).`] };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

// Everything the editor writes must be a real folder or file inside the studio folder: no symbolic
// link may redirect a write into another studio (or anywhere else). Missing files are fine.
const WRITE_TARGETS = [
  FILES.profile,
  FILES.manifest,
  FILES.guide,
  FILES.logo,
  path.join("icons", "icon-192.png"),
  path.join("icons", "icon-512.png"),
];
async function treeErrors(dir) {
  const kind = (p) => lstat(p).then((s) => (s.isSymbolicLink() ? "link" : s.isDirectory() ? "dir" : s.isFile() ? "file" : "other"), () => "none");
  if ((await kind(dir)) !== "dir") return ["Der Studio-Ordner ist kein echter Ordner (Verknüpfung?). Es wird nichts gespeichert."];
  const errors = [];
  for (const sub of ["Dokumente", "icons"]) {
    const k = await kind(path.join(dir, sub));
    if (k !== "dir" && k !== "none") errors.push(`${sub}/ ist kein echter Ordner (Verknüpfung?). Es wird nichts gespeichert.`);
  }
  for (const rel of WRITE_TARGETS) {
    const k = await kind(path.join(dir, rel));
    if (k !== "file" && k !== "none") errors.push(`${rel} ist keine normale Datei (Verknüpfung oder Ordner). Es wird nichts gespeichert.`);
  }
  return errors;
}

// Full check of a draft. Returns errors (empty = may be saved) and, per marker, where it is found.
export async function checkDraft({ dir, id, draft, logoBase64, env }) {
  const sample = await sampleProfile();
  const textKeys = Object.keys(sample.text);
  const errors = staticErrors(draft, textKeys);
  let logo = null;
  if (logoBase64) {
    logo = await prepareLogo(logoBase64);
    errors.push(...logo.errors);
    if (logo.errors.length) logo = null;
  }
  const probe = [];
  errors.push(...(await treeErrors(dir)));
  const current = await readJson(path.join(dir, FILES.profile)).catch(() => ({}));
  if (current.logo !== FILES.logo) errors.push(`profile.json: "logo" muss "${FILES.logo}" sein.`);
  const warnings = errors.length ? [] : await sampleFileWarnings(dir, logo);
  if (errors.length) return { errors, probe, logo, warnings };

  // Sample-studio texts and other studios' markers must not appear anywhere in the draft.
  const sampleMarkers = compileMarkers(sample.markers);
  const others = await otherStudios(dir, env);
  const fieldList = fields(draft);
  for (const [label, value] of fieldList) {
    const hits = findMarkers(value, sampleMarkers);
    if (hits.length) errors.push(`${label}: enthält noch Text des Musterstudios (${hits.join(", ")}).`);
  }
  // Other studios' markers may be regexes: they run in the timed worker too.
  const foreign = others.flatMap((o) => o.markers.map((m) => ({ owner: o.id, marker: m })));
  const foreignHits = await matchInWorker(foreign.map((f) => f.marker), fieldList.map(([, v]) => v));
  foreignHits.forEach((h, i) => {
    const { owner, marker } = foreign[i];
    const label = typeof marker === "string" ? marker : `/${marker?.regex}/`;
    if (h === null) errors.push(`Kennzeichen ${label} des Studios „${owner}“ ist zu langsam für die Prüfung. Bitte dort vereinfachen.`);
    else for (const t of h) errors.push(`${fieldList[t][0]}: enthält Kennzeichen des Studios „${owner}“ (${label}).`);
  });
  const own = compileMarkers(draft.markers);
  const ownStrings = draft.markers.map((m) => (typeof m === "string" ? m : m.regex)).join("\n");
  const fromSample = findMarkers(ownStrings, sampleMarkers);
  if (fromSample.length) errors.push(`Kennzeichen: Musterstudio-Kennzeichen übernommen (${fromSample.join(", ")}).`);

  // Build the draft for real (catches missing or unused texts) and probe each marker. The
  // temporary folder is removed on every path, also when copying into it fails.
  const base = await mkdtemp(path.join(tmpdir(), "inkform-entwurf-"));
  try {
    let files, trial;
    try {
      trial = await trialFolder(base, dir, id, draft, logo);
      const built = await buildProfile(trial);
      files = built.files;
      warnings.push(...built.warnings.map((w) => w.replaceAll(base, "<entwurf>")));
    } catch (error) {
      errors.push(`Probe-Build: ${error.message.replaceAll(base, "<entwurf>")}`);
      return { errors, probe, logo, warnings };
    }
    const results = await probeMarkers(draft.markers, {
      build: [...files].map(([name, contents]) => [name, scanText(contents)]),
      sample: await sampleText(),
      others: others.map((o) => [o.id, o.text]),
    });
    own.forEach((m, i) => {
      const r = results[i];
      if (!r) {
        probe.push({ marker: m.label, inBuild: [], inSample: false, inOthers: [], slow: true });
        return errors.push(`Kennzeichen ${i + 1} (${m.label}): zu langsam, bitte einfacher formulieren.`);
      }
      probe.push({ marker: m.label, inBuild: r.inBuild, inSample: r.inSample, inOthers: r.inOthers });
      if (r.inSample) errors.push(`Kennzeichen ${i + 1} (${m.label}): zu allgemein, kommt auch in der neutralen Beispiel-Fassung vor.`);
      if (r.inOthers.length) errors.push(`Kennzeichen ${i + 1} (${m.label}): kommt auch im Studio ${r.inOthers.map((o) => `„${o}“`).join(", ")} vor.`);
    });
    if (!probe.some((p) => p.inBuild.length))
      errors.push("Kennzeichen: keines kommt in deinem Build vor. Der Leak-Test braucht mindestens eines, das sicher drinsteht (z. B. der Studioname).");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
  return { errors, probe, logo, warnings };
}

// Files still taken over from the sample: not a save error, but the leak test stays red until
// they are replaced (it recognises the sample's logo, icons and guide PDF in any other studio).
async function sampleFileWarnings(dir, logo) {
  const same = async (rel, bytes) => {
    const [a, b] = await Promise.all([bytes ?? readFile(path.join(dir, rel)).catch(() => null), readFile(path.join(SAMPLE, rel)).catch(() => null)]);
    return a && b && Buffer.from(a).equals(b);
  };
  const out = [];
  if (await same("logo.png", logo?.logo)) out.push("Logo und Icons sind noch die der Beispiel-Fassung: bitte ein eigenes Logo hochladen.");
  if (await same("Anleitung-iPad-und-Admin.pdf"))
    out.push("Die Anleitung als PDF ist noch die der Beispiel-Fassung. Bis sie neu erzeugt ist, bleibt der Leak-Test für dieses Studio rot.");
  return out;
}

export async function saveDraft({ dir, id, draft, logoBase64, expectedVersion, env, stateDir }) {
  if ((await version(dir)) !== expectedVersion)
    return { conflict: true, errors: ["Die Profildateien wurden inzwischen geändert. Bitte den Editor neu laden."] };
  const { errors, probe, logo, warnings } = await checkDraft({ dir, id, draft, logoBase64, env });
  if (errors.length) return { errors, probe, warnings };
  // The check takes a while: look again right before writing, for changes and for links.
  if ((await version(dir)) !== expectedVersion)
    return { conflict: true, errors: ["Die Profildateien wurden während der Prüfung geändert. Bitte den Editor neu laden."] };
  const tree = [...(await treeErrors(dir)), ...(stateDir ? [await studioGuard(dir, { env, stateDir })].filter(Boolean) : [])];
  if (tree.length) return { errors: tree, probe, warnings };
  const current = await readJson(path.join(dir, FILES.profile));
  const manifest = await readJson(path.join(dir, FILES.manifest));
  const writes = [
    [FILES.manifest, manifestJson(manifest, draft)],
    [FILES.guide, draft.guideMd],
    ...(logo ? [...Object.entries(logo.icons).map(([size, bytes]) => [path.join("icons", `icon-${size}.png`), bytes]), [FILES.logo, logo.logo]] : []),
    [FILES.profile, profileJson(current, draft)],
  ];
  // All or nothing: the previous contents are kept in memory and put back if any write fails.
  // A file that exists but cannot be read is never overwritten: it could not be put back.
  let previous;
  try {
    previous = await Promise.all(writes.map(([rel]) => readFile(path.join(dir, rel)).catch((e) => (e.code === "ENOENT" ? null : Promise.reject(e)))));
  } catch (error) {
    return { errors: [`Nicht gespeichert: eine Profildatei ist nicht lesbar (${error.message}).`], probe, warnings };
  }
  const done = [];
  try {
    for (const sub of ["Dokumente", "icons"]) await mkdir(path.join(dir, sub)).catch((e) => (e.code === "EEXIST" ? null : Promise.reject(e)));
    for (const [i, [rel, contents]] of writes.entries()) {
      await writeAtomic(path.join(dir, rel), contents);
      done.push(i);
    }
  } catch (error) {
    const notRestored = [];
    for (const i of done.reverse()) {
      const file = path.join(dir, writes[i][0]);
      await (previous[i] === null ? rm(file, { force: true }) : writeAtomic(file, previous[i])).catch(() => notRestored.push(writes[i][0]));
    }
    if (notRestored.length)
      return { errors: [`Speichern fehlgeschlagen (${error.message}). ACHTUNG: nicht wiederhergestellt: ${notRestored.join(", ")}. Bitte im Git-Stand prüfen.`], probe, warnings };
    return { errors: [`Speichern fehlgeschlagen, nichts geändert: ${error.message}`], probe, warnings };
  }
  return { errors: [], probe, warnings, version: await version(dir) };
}

// ---------- new studio ----------

const GITIGNORE = `# Erzeugte App und Prüfausgaben dieses Studios
/build/
/test-results/

# System und Logs
.DS_Store
Thumbs.db
*.log

# Kunden- und Betriebsdaten dürfen NIE in Git landen.
Tattoo_Einwilligung_*
Inkform_Einnahmen_*
INKFORM_Einstellungen_*
INKFORM_Studio_*
INKFORM_Speichertest_*

# Grundsätzlich keine PDFs, CSVs, Tabellen, JSON-Sicherungen oder Fotos.
*.pdf
*.csv
*.xlsx
*.xls
*.numbers
*.json
*.jpg
*.jpeg
*.heic
*.heif
*.mov
*.mp4
*.zip
!/profile.json
!/Anleitung-iPad-und-Admin.pdf

# Typische Ablageordner für echte Daten und Exporte
Exporte/
Sicherungen/
Backups/
Kundendaten/
Einwilligungen/

# Geheimnisse und Zertifikate
.env
.env.*
*.key
*.pem
*.crt
*.p12
secrets/
`;

const git = (dir, args, extraEnv = {}) =>
  run("git", [...SAFE_GIT, "-C", dir, "-c", `user.name=${AUTHOR.name}`, "-c", `user.email=${AUTHOR.email}`, "-c", "commit.gpgsign=false", ...args], {
    encoding: "utf8",
    env: { ...cleanEnv(), ...extraEnv },
  });

async function addRelease(stateDir, dir) {
  const file = path.join(stateDir, "freigegeben.json");
  const data = await readJson(file).catch(() => ({ studios: [] }));
  const list = Array.isArray(data.studios) ? data.studios.map(String) : [];
  if (!list.map((p) => path.resolve(p)).includes(path.resolve(dir))) list.push(path.resolve(dir));
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await writeAtomic(file, JSON.stringify({ ...data, studios: list }, null, 2) + "\n");
}

// Copies the sample into <studios>/<id>/, sets the id, writes .gitignore and runs git init (no
// remote, no commit). Never touches an existing folder.
export async function createStudio({ id, name, env, stateDir }) {
  if (typeof id !== "string" || !STUDIO_ID.test(id) || RESERVED.has(id))
    return { error: "Kennung: 3 bis 40 Zeichen, nur a–z, 0–9 und Bindestrich, nicht am Anfang oder Ende." };
  if (typeof name !== "string" || !name.trim() || name.length > 80 || CONTROL.test(name) || UNSAFE.test(name))
    return { error: "Name: 1 bis 80 Zeichen, ohne \" ` \\ < > ${." };
  const parent = studiosRoot(env);
  const target = path.join(parent, id);
  if (await lstat(target).then(() => true, () => false)) return { error: `Den Ordner ${id} gibt es schon. Er wird nicht angefasst.` };
  for (const d of await discoverStudioProfiles(env)) {
    const p = await readJson(path.join(d, FILES.profile)).catch(() => null);
    if (p?.id === id) return { error: `Ein Studio mit der Kennung ${id} gibt es schon.` };
  }
  // The studios folder may be a link, but never into the core or into an existing studio. Checked
  // on the real location of the nearest existing folder, before anything is created.
  const core = await realpath(root);
  const misplaced = async (realParent) => {
    if (inside(realParent, core)) return "Der Studios-Ordner liegt in Wirklichkeit im Kern. Dort wird kein Studio angelegt.";
    for (const d of await discoverStudioProfiles(env)) {
      const real = await realpath(d).catch(() => null);
      if (real && inside(realParent, real)) return "Der Studios-Ordner liegt in Wirklichkeit in einem bestehenden Studio. Es wird nichts angelegt.";
    }
    return null;
  };
  const before = await misplaced(await realLocation(parent));
  if (before) return { error: before };
  await mkdir(parent, { recursive: true });
  const realParent = await realpath(parent);
  const after = await misplaced(realParent);
  if (after) return { error: after };
  // Created exclusively: mkdir fails if the folder appeared in the meantime, so an existing folder
  // is never used or replaced. profile.json comes last, so a half-made folder is no studio; on
  // failure only the folder created here is removed.
  try {
    await mkdir(target);
  } catch (error) {
    return { error: error.code === "EEXIST" ? `Den Ordner ${id} gibt es schon. Er wird nicht angefasst.` : `Anlegen fehlgeschlagen: ${error.message}` };
  }
  try {
    if ((await realpath(target)) !== path.join(realParent, id)) throw new Error("Zielordner hat sich verschoben.");
    await mkdir(path.join(target, "Dokumente"));
    for (const f of ["manifest.webmanifest", "logo.png", "Anleitung-iPad-und-Admin.pdf", FILES.guide, path.join("Dokumente", "Rechtstexte-Pruefung.md")])
      await copyFile(path.join(SAMPLE, f), path.join(target, f));
    await cp(path.join(SAMPLE, "icons"), path.join(target, "icons"), { recursive: true });
    await writeFile(
      path.join(target, "README.md"),
      `# ${name.trim()}\n\nStudio-Profil für Inkform (Kennung \`${id}\`). Bearbeitet wird es in der Werkstatt des Kerns (\`npm run werkstatt\`).\n\nKeine Kundendaten in diesen Ordner legen. Kein Remote: Git ist nur die lokale Versionsverwaltung.\n`,
    );
    await writeFile(path.join(target, ".gitignore"), GITIGNORE);
    await git(target, ["init", "-q", "-b", "main"]);
    const sample = await sampleProfile();
    const profile = { ...sample, id, name: name.trim(), description: "", markers: [name.trim()] };
    // The sample's translations name the sample studio and cannot be edited in the Werkstatt.
    delete profile.translations;
    await writeFile(path.join(target, FILES.profile), JSON.stringify(profile, null, 2) + "\n", { flag: "wx" });
  } catch (error) {
    await rm(target, { recursive: true, force: true }).catch(() => {});
    return { error: `Anlegen fehlgeschlagen: ${error.message}` };
  }
  await addRelease(stateDir, target);
  return { dir: target, key: `s-${id}` };
}

// ---------- commit ----------

// Paths that never belong into a studio repo, even if .gitignore were missing or changed: the same
// rules as the generated .gitignore. Only profile.json and the guide PDF are allowed exceptions.
const FORBIDDEN_DIRS = /(^|\/)(build|dist|test-results|node_modules|Exporte|Sicherungen|Backups|Kundendaten|Einwilligungen|secrets)\//i;
const FORBIDDEN_FILES = /\.(key|pem|crt|p12|pfx|csv|xlsx?|numbers|zip|json|pdf|jpe?g|heic|heif|mov|mp4|log)$|(^|\/)(Tattoo_Einwilligung_|Inkform_Einnahmen_|INKFORM_)|(^|\/)\.env|(^|\/)(\.DS_Store|Thumbs\.db)$/i;
export const forbiddenPath = (p) => !["profile.json", "Anleitung-iPad-und-Admin.pdf"].includes(p) && (FORBIDDEN_DIRS.test(p) || FORBIDDEN_FILES.test(p));

// Everything git writes (objects, refs, logs, HEAD, index …) lives below .git. No link may appear
// anywhere in there, and no file may send git to another object store or common dir.
async function gitStorageError(gitDir) {
  for (const f of ["commondir", "gitdir", path.join("objects", "info", "alternates"), path.join("objects", "info", "http-alternates")])
    if (await lstat(path.join(gitDir, f)).then(() => true, () => false)) return `.git/${f} ist nicht erlaubt.`;
  const walk = async (dir) => {
    for (const name of await readdir(dir)) {
      const full = path.join(dir, name);
      const st = await lstat(full);
      if (st.isSymbolicLink()) return `${path.relative(gitDir, full)} ist eine Verknüpfung.`;
      if (st.isDirectory()) {
        const inner = await walk(full);
        if (inner) return inner;
      } else if (!st.isFile()) return `${path.relative(gitDir, full)} ist keine normale Datei.`;
    }
    return null;
  };
  return walk(gitDir);
}

// The studio must be its own repository: .git a real folder inside it (no link, no gitfile pointing
// elsewhere), and git must report exactly that folder as its git and common dir.
async function ownRepo(dir) {
  try {
    const dotGit = await lstat(path.join(dir, ".git"));
    if (dotGit.isSymbolicLink() || !dotGit.isDirectory()) return false;
    const { stdout } = await run(
      "git",
      [...SAFE_GIT, "--no-optional-locks", "-C", dir, "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-dir", "--git-common-dir"],
      { encoding: "utf8", env: cleanEnv() },
    );
    const [top, gitDir, common] = stdout.trim().split("\n");
    const [realDir, realGit] = [await realpath(dir), await realpath(path.join(dir, ".git"))];
    if (!((await realpath(top)) === realDir && (await realpath(gitDir)) === realGit && (await realpath(common)) === realGit)) return false;
    return (await gitStorageError(path.join(dir, ".git"))) === null;
  } catch {
    return false;
  }
}

// Git filters (filter=… in .gitattributes) run programs on "git add" and "git status". Studio repos
// never need them, so a repo that uses them is not touched.
async function usesGitFilters(dir) {
  const files = [path.join(dir, ".git", "info", "attributes")];
  const walk = async (d) => {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      if (e.isDirectory() && ![".git", "build", "test-results", "node_modules"].includes(e.name)) await walk(path.join(d, e.name));
      else if (e.name === ".gitattributes") files.push(path.join(d, e.name));
    }
  };
  await walk(dir);
  for (const f of files) if (/\bfilter\s*=/.test(await readFile(f, "utf8").catch(() => ""))) return true;
  return false;
}

export async function pendingChanges(dir) {
  if (!(await ownRepo(dir))) return { error: "Der Studio-Ordner ist kein eigenes Git-Repo." };
  if (await usesGitFilters(dir)) return { error: "Das Studio-Repo nutzt Git-Filter (.gitattributes). Die Werkstatt committet dort nicht." };
  const { stdout } = await run("git", [...SAFE_GIT, "--no-optional-locks", "-C", dir, "status", "--porcelain=v1", "-z", "-uall"], {
    encoding: "utf8",
    env: { ...cleanEnv(), GIT_OPTIONAL_LOCKS: "0" },
  });
  // -z format: "XY path", for renames and copies followed by the original path as its own entry.
  const tokens = stdout.split("\0");
  const files = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i]) continue;
    const state = tokens[i].slice(0, 2);
    files.push({ state: state.trim(), path: tokens[i].slice(3) });
    if (/[RC]/.test(state)) files.push({ state: "D", path: tokens[++i] });
  }
  return { files, forbidden: files.filter((f) => forbiddenPath(f.path)).map((f) => f.path) };
}

// Commits exactly the changes the user confirmed (the list shown in the dialog), as Sven.
export async function commitStudio({ dir, message, files, env, stateDir }) {
  if (typeof message !== "string" || !message.trim() || message.length > 200 || CONTROL.test(message))
    return { error: "Beschreibung: 1 bis 200 Zeichen, eine Zeile." };
  if (stateDir) {
    const denied = await studioGuard(dir, { env, stateDir });
    if (denied) return { error: denied };
  }
  const now = await pendingChanges(dir);
  if (now.error) return now;
  if (!now.files.length) return { error: "Nichts zu committen." };
  if (now.forbidden.length) return { error: `Nicht committet: Diese Dateien gehören nicht ins Repo: ${now.forbidden.join(", ")}.` };
  const seen = JSON.stringify([...(Array.isArray(files) ? files : [])].map(String).sort());
  if (seen !== JSON.stringify(now.files.map((f) => f.path).sort()))
    return { conflict: true, error: "Die Änderungen haben sich seit der Anzeige geändert. Bitte neu öffnen." };
  // Staged in a separate, temporary index with exactly the confirmed paths: files created after the
  // confirmation and anything staged elsewhere stay out. The staged list is compared again before
  // the commit; afterwards the real index is brought up to date for these paths only.
  const work = await mkdtemp(path.join(tmpdir(), "inkform-commit-"));
  const indexEnv = { GIT_INDEX_FILE: path.join(work, "index"), GIT_LITERAL_PATHSPECS: "1" };
  const confirmed = now.files.map((f) => f.path);
  try {
    const head = await run("git", [...SAFE_GIT, "-C", dir, "rev-parse", "--verify", "-q", "HEAD"], { encoding: "utf8", env: cleanEnv() }).then(() => true, () => false);
    if (head) await git(dir, ["read-tree", "HEAD"], indexEnv);
    await git(dir, ["add", "-A", "--", ...confirmed], indexEnv);
    const staged = (
      await git(dir, head ? ["diff", "--cached", "--name-only", "-z", "--no-renames", "HEAD"] : ["ls-files", "-z"], indexEnv)
    ).stdout.split("\0").filter(Boolean);
    if (JSON.stringify([...staged].sort()) !== JSON.stringify([...new Set(confirmed)].sort()))
      return { conflict: true, error: "Die Änderungen haben sich beim Committen geändert. Nichts committet, bitte neu öffnen." };
    const bad = staged.filter(forbiddenPath);
    if (bad.length) return { error: `Nicht committet: Diese Dateien gehören nicht ins Repo: ${bad.join(", ")}.` };
    await git(dir, ["commit", "-q", "--no-verify", "-m", message.trim()], indexEnv);
    const reset = await git(dir, ["reset", "-q", "--", ...confirmed], { GIT_LITERAL_PATHSPECS: "1" }).then(() => null, (e) => e);
    const { stdout } = await run("git", [...SAFE_GIT, "--no-optional-locks", "-C", dir, "log", "-1", "--format=%h"], { encoding: "utf8", env: cleanEnv() });
    return reset
      ? { commit: stdout.trim(), warning: "Committet. Der Git-Index ist nicht aktuell; „git reset“ im Studio-Ordner behebt das." }
      : { commit: stdout.trim() };
  } catch (error) {
    return { error: `Commit fehlgeschlagen: ${error.message}` };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

// Only released studios (not Beispiel, not display-only ones) may be edited or committed.
export async function editable(entry, stateDir, env = process.env) {
  if (!entry) return "Studio nicht gefunden.";
  if (entry.kind === "beispiel") return "Die Beispiel-Fassung gehört zum Kern und wird in der Werkstatt nicht bearbeitet.";
  if (!entry.actionable) return "Nur Anzeige: Dieses Studio ist nicht freigegeben und wird nicht verändert.";
  return studioGuard(entry.dir, { env, stateDir });
}

// Checked again right before every write. The studio folder must be released by exactly this path,
// must not be a link, must sit directly in a studios folder, and its real location must not be the
// core or any studio that is not released (a link further up could otherwise lead there).
export async function studioGuard(dir, { env = process.env, stateDir }) {
  const denied = "Nur Anzeige: Dieses Studio ist nicht freigegeben und wird nicht verändert.";
  const released = await releasedStudios(stateDir);
  if (!released.has(path.resolve(dir))) return denied;
  const isDir = await lstat(dir).then((s) => !s.isSymbolicLink() && s.isDirectory(), () => false);
  if (!isDir) return "Der Studio-Ordner ist eine Verknüpfung oder fehlt. Es wird nichts verändert.";
  const roots = (env.INKFORM_STUDIOS ? env.INKFORM_STUDIOS.split(path.delimiter).filter(Boolean) : [studiosRoot(env)]).map((r) => path.resolve(r));
  if (!roots.includes(path.dirname(path.resolve(dir)))) return "Der Studio-Ordner liegt nicht direkt im Studios-Ordner. Es wird nichts verändert.";
  const real = await realpath(dir).catch(() => null);
  if (!real) return denied;
  const realRoot = await realpath(path.dirname(path.resolve(dir))).catch(() => null);
  if (real !== path.join(realRoot ?? "", path.basename(dir))) return "Der Studio-Ordner ist eine Verknüpfung. Es wird nichts verändert.";
  const core = await realpath(root);
  if (inside(real, core)) return "Ordner im Kern werden nicht verändert.";
  for (const other of await discoverStudioProfiles(env)) {
    if (released.has(path.resolve(other))) continue;
    if ((await realpath(other).catch(() => null)) === real) return "Dieser Ordner ist in Wirklichkeit ein geschütztes Studio. Es wird nichts verändert.";
  }
  return null;
}
