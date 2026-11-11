// Werkstatt, part 3: create a new studio and edit its profile. Only studios released in
// <state>/freigegeben.json can be edited; Blanko (the sample in the core) and every other studio
// are never written to. Every save is checked with the same rules as build.mjs plus the
// cross-studio marker rules, by building the draft in a temporary folder first. Nothing is saved
// while an error is open. No customer data is read or written here.
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { UNSAFE, buildProfile, discoverStudioProfiles, root } from "../scripts/build.mjs";
import { compileMarkers, findMarkers, scanText } from "../tests/lib/leaks.mjs";
import { releasedStudios } from "./status.mjs";

const run = promisify(execFile);
const SAMPLE = path.join(root, "profiles", "beispiel");
const AUTHOR = { name: "Sven", email: "sven@inkform.invalid" };
const CONTROL = /[\u0000-\u001f\u007f]/;
const MAX_LOGO = 2 * 1024 * 1024;
export const ID_RULE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
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

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const sampleProfile = () => readJson(path.join(SAMPLE, FILES.profile));

export function studiosRoot(env = process.env) {
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
  for (const name of Object.values(FILES)) hash.update(name).update(await readFile(path.join(dir, name)).catch(() => Buffer.alloc(0)));
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

export function logoErrors(bytes) {
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
export function staticErrors(draft, textKeys) {
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
  // The sample (Blanko) build is the neutral reference: a studio marker found there is too general.
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
    let markers = [];
    try {
      markers = compileMarkers(p.markers);
    } catch {}
    others.push({ id: p.id, markers, text: JSON.stringify(p.text ?? {}) + "\n" + (p.name ?? "") });
  }
  return others;
}

// Copies what build.mjs reads into a temporary folder, with the draft applied.
async function trialFolder(dir, id, draft, logo) {
  const base = await mkdtemp(path.join(tmpdir(), "inkform-entwurf-"));
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
    await writeFile(path.join(trial, current.logo ?? FILES.logo), logo.logo);
    for (const [size, bytes] of Object.entries(logo.icons)) await writeFile(path.join(trial, "icons", `icon-${size}.png`), bytes);
  } else {
    await cp(path.join(dir, "icons"), path.join(trial, "icons"), { recursive: true });
    await copyFile(path.join(dir, current.logo ?? FILES.logo), path.join(trial, current.logo ?? FILES.logo));
  }
  return { base, trial };
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
export async function prepareLogo(base64) {
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
  const warnings = await sampleFileWarnings(dir, logo);
  if (errors.length) return { errors, probe, logo, warnings };

  // Sample-studio texts and other studios' markers must not appear anywhere in the draft.
  const sampleMarkers = compileMarkers(sample.markers);
  const others = await otherStudios(dir, env);
  for (const [label, value] of fields(draft)) {
    const hits = findMarkers(value, sampleMarkers);
    if (hits.length) errors.push(`${label}: enthält noch Text des Musterstudios (${hits.join(", ")}).`);
    for (const o of others) {
      const foreign = findMarkers(value, o.markers);
      if (foreign.length) errors.push(`${label}: enthält Kennzeichen des Studios „${o.id}“ (${foreign.join(", ")}).`);
    }
  }
  const own = compileMarkers(draft.markers);
  const ownStrings = draft.markers.map((m) => (typeof m === "string" ? m : m.regex)).join("\n");
  const fromSample = findMarkers(ownStrings, sampleMarkers);
  if (fromSample.length) errors.push(`Kennzeichen: Musterstudio-Kennzeichen übernommen (${fromSample.join(", ")}).`);

  // Build the draft for real (catches missing or unused texts) and probe each marker.
  const { base, trial } = await trialFolder(dir, id, draft, logo);
  try {
    let files;
    try {
      ({ files } = await buildProfile(trial));
    } catch (error) {
      errors.push(`Bauen: ${error.message.replace(trial, "<entwurf>")}`);
      return { errors, probe, logo, warnings };
    }
    const scanned = [...files].map(([name, contents]) => [name, scanText(contents)]);
    const neutral = await sampleText();
    own.forEach((m, i) => {
      const inBuild = scanned.filter(([, text]) => findMarkers(text, [m]).length).map(([name]) => name);
      const inSample = findMarkers(neutral, [m]).length > 0;
      const inOthers = others.filter((o) => findMarkers(o.text, [m]).length).map((o) => o.id);
      probe.push({ marker: m.label, inBuild, inSample, inOthers });
      if (inSample) errors.push(`Kennzeichen ${i + 1} (${m.label}): zu allgemein, kommt auch in der neutralen Beispiel-Fassung vor.`);
      if (inOthers.length) errors.push(`Kennzeichen ${i + 1} (${m.label}): kommt auch im Studio ${inOthers.map((o) => `„${o}“`).join(", ")} vor.`);
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

export async function saveDraft({ dir, id, draft, logoBase64, expectedVersion, env }) {
  if ((await version(dir)) !== expectedVersion)
    return { conflict: true, errors: ["Die Profildateien wurden inzwischen geändert. Bitte den Editor neu laden."] };
  const { errors, probe, logo, warnings } = await checkDraft({ dir, id, draft, logoBase64, env });
  if (errors.length) return { errors, probe, warnings };
  const current = await readJson(path.join(dir, FILES.profile));
  const manifest = await readJson(path.join(dir, FILES.manifest));
  if (logo) {
    await mkdir(path.join(dir, "icons"), { recursive: true });
    for (const [size, bytes] of Object.entries(logo.icons)) await writeAtomic(path.join(dir, "icons", `icon-${size}.png`), bytes);
    await writeAtomic(path.join(dir, current.logo ?? FILES.logo), logo.logo);
  }
  await mkdir(path.join(dir, "Dokumente"), { recursive: true });
  await writeAtomic(path.join(dir, FILES.manifest), manifestJson(manifest, draft));
  await writeAtomic(path.join(dir, FILES.guide), draft.guideMd);
  await writeAtomic(path.join(dir, FILES.profile), profileJson(current, draft));
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

const gitEnv = () => ({
  ...process.env,
  GIT_AUTHOR_NAME: AUTHOR.name,
  GIT_AUTHOR_EMAIL: AUTHOR.email,
  GIT_COMMITTER_NAME: AUTHOR.name,
  GIT_COMMITTER_EMAIL: AUTHOR.email,
});
const git = (dir, args) =>
  run("git", ["-C", dir, "-c", `user.name=${AUTHOR.name}`, "-c", `user.email=${AUTHOR.email}`, "-c", "commit.gpgsign=false", ...args], {
    encoding: "utf8",
    env: gitEnv(),
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
  if (typeof id !== "string" || !ID_RULE.test(id) || RESERVED.has(id))
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
  await mkdir(parent, { recursive: true });
  // Built next to the target under a temporary name and renamed at the end: no half-made studio.
  const work = path.join(parent, `.${id}.anlegen-${randomBytes(4).toString("hex")}`);
  try {
    await mkdir(path.join(work, "Dokumente"), { recursive: true });
    const sample = await sampleProfile();
    const profile = { ...sample, id, name: name.trim(), description: "", markers: [name.trim()] };
    await writeFile(path.join(work, FILES.profile), JSON.stringify(profile, null, 2) + "\n");
    for (const f of ["manifest.webmanifest", "logo.png", "Anleitung-iPad-und-Admin.pdf", FILES.guide, path.join("Dokumente", "Rechtstexte-Pruefung.md")])
      await copyFile(path.join(SAMPLE, f), path.join(work, f));
    await cp(path.join(SAMPLE, "icons"), path.join(work, "icons"), { recursive: true });
    await writeFile(
      path.join(work, "README.md"),
      `# ${name.trim()}\n\nStudio-Profil für Inkform (Kennung \`${id}\`). Bearbeitet wird es in der Werkstatt des Kerns (\`npm run werkstatt\`).\n\nKeine Kundendaten in diesen Ordner legen. Kein Remote: Git ist nur die lokale Versionsverwaltung.\n`,
    );
    await writeFile(path.join(work, ".gitignore"), GITIGNORE);
    await git(work, ["init", "-q", "-b", "main"]);
    if (await lstat(target).then(() => true, () => false)) throw new Error(`Den Ordner ${id} gibt es inzwischen.`);
    await rename(work, target);
  } catch (error) {
    await rm(work, { recursive: true, force: true }).catch(() => {});
    return { error: `Anlegen fehlgeschlagen: ${error.message}` };
  }
  await addRelease(stateDir, target);
  return { dir: target, key: `s-${id}` };
}

// ---------- commit ----------

// Paths that never belong into a studio repo, even if .gitignore were missing or changed.
const FORBIDDEN = /(^|\/)(build|test-results|Exporte|Sicherungen|Backups|Kundendaten|Einwilligungen)\/|\.(key|pem|crt|p12|csv|xlsx?|numbers|zip|jpe?g|heic|heif|mov|mp4)$|(^|\/)(Tattoo_Einwilligung_|Inkform_Einnahmen_|INKFORM_)|(^|\/)\.env/i;

async function ownRepo(dir) {
  try {
    const top = (await run("git", ["--no-optional-locks", "-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" })).stdout.trim();
    return (await realpath(top)) === (await realpath(dir));
  } catch {
    return false;
  }
}

export async function pendingChanges(dir) {
  if (!(await ownRepo(dir))) return { error: "Der Studio-Ordner ist kein eigenes Git-Repo." };
  const { stdout } = await run("git", ["--no-optional-locks", "-C", dir, "status", "--porcelain=v1", "-z", "-uall"], {
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  const files = stdout.split("\0").filter(Boolean).map((line) => ({ state: line.slice(0, 2).trim(), path: line.slice(3) }));
  return { files, forbidden: files.filter((f) => FORBIDDEN.test(f.path)).map((f) => f.path) };
}

// Commits exactly the changes the user confirmed (the list shown in the dialog), as Sven.
export async function commitStudio({ dir, message, files }) {
  if (typeof message !== "string" || !message.trim() || message.length > 200 || CONTROL.test(message))
    return { error: "Beschreibung: 1 bis 200 Zeichen, eine Zeile." };
  const now = await pendingChanges(dir);
  if (now.error) return now;
  if (!now.files.length) return { error: "Nichts zu committen." };
  if (now.forbidden.length) return { error: `Nicht committet: Diese Dateien gehören nicht ins Repo: ${now.forbidden.join(", ")}.` };
  const seen = JSON.stringify([...(Array.isArray(files) ? files : [])].map(String).sort());
  if (seen !== JSON.stringify(now.files.map((f) => f.path).sort()))
    return { conflict: true, error: "Die Änderungen haben sich seit der Anzeige geändert. Bitte neu öffnen." };
  try {
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "-m", message.trim()]);
    const { stdout } = await run("git", ["--no-optional-locks", "-C", dir, "log", "-1", "--format=%h"], { encoding: "utf8" });
    return { commit: stdout.trim() };
  } catch (error) {
    return { error: `Commit fehlgeschlagen: ${error.message}` };
  }
}

// Only released studios (not Blanko, not display-only ones) may be edited or committed.
export async function editable(entry, stateDir) {
  if (!entry) return "Studio nicht gefunden.";
  if (entry.kind === "blanko") return "Blanko ist die Beispiel-Fassung im Kern und wird in der Werkstatt nicht bearbeitet.";
  if (!entry.actionable || !(await releasedStudios(stateDir)).has(path.resolve(entry.dir)))
    return "Nur Anzeige: Dieses Studio ist nicht freigegeben und wird nicht verändert.";
  return null;
}
