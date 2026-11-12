// Check of the neutral "blanko" build before it may leave this Mac. Fails on anything private:
// markers, logos, icons, guides and other images of every studio and of the sample profile, this
// Mac's user, host and paths, the Git e-mail address, certificates and keys, Werkstatt and on-site
// mode, e-mail addresses that do not come from the core's own sources, an embedded studio
// configuration, studio details in the profile, and any file that does not belong to the build.
// The names to look for are read from the studios and this Mac at check time, never stored here.
//
//   node scripts/blanko-pruefen.mjs                 builds blanko in memory and checks it
//   node scripts/blanko-pruefen.mjs --dir <ordner>  checks a written build (index.html, dist/)
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir, hostname, userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileMarkers, filesBelow, findFingerprints, findMarkers, fingerprints, scanText } from "../tests/lib/leaks.mjs";
import { buildProfile, discoverStudioProfiles, resolveProfileDir, root } from "./build.mjs";

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
const STUDIO_FIELDS = ["studioName", "studioAddress", "studioContact", "studioLocation"];
const FIXED = [
  { label: "PEM-Block (Zertifikat oder Schlüssel)", rx: /-----BEGIN [A-Z0-9 ]+-----/ },
  { label: "Werkstatt", rx: /werkstatt/i },
  { label: "Vor-Ort-Modus", rx: /vor-ort|inkform-app\.local/i },
  { label: "lokaler Pfad", rx: /\/Users\/|\/private\/var\/|~\/Library/ },
];
// Bounded like real addresses; unbounded runs would make the search quadratic in long base64 blocks.
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}/g;
const IMAGE = /\.(png|jpe?g|heic|heif|gif|webp|pdf|svg)$/i;

const pem = (text) =>
  [...text.matchAll(/-----BEGIN [^-]+-----([\s\S]*?)-----END/g)].map((m) => m[1].replace(/\s+/g, "")).filter(Boolean);

// Everything private this check knows about, read now from the studios and this Mac.
export async function collectPrivate({ env = process.env, home = homedir() } = {}) {
  const studios = await discoverStudioProfiles(env),
    profiles = [];
  for (const dir of [resolveProfileDir("beispiel"), ...studios]) {
    const profile = JSON.parse(await readFile(path.join(dir, "profile.json"), "utf8")),
      prints = await fingerprints(dir, profile.logo);
    for (const file of await filesBelow(dir, new Set([".git", "node_modules", "build", "test-results"])))
      if (IMAGE.test(file)) {
        const bytes = await readFile(file);
        prints.push({ label: path.relative(dir, file), bytes, base64: bytes.toString("base64") });
      }
    profiles.push({ id: profile.id, markers: compileMarkers(profile.markers), prints });
  }
  const certs = [];
  for (const sub of ["zertifikat", "zertifikate"]) {
    const dir = path.join(home, "Library", "Application Support", "Inkform", sub);
    for (const file of await filesBelow(dir).catch(() => []))
      for (const body of pem(await readFile(file, "utf8").catch(() => "")))
        certs.push({ label: `${sub}/${path.relative(dir, file)}`, bytes: Buffer.from(body, "base64"), base64: body });
  }
  const local = [userInfo().username, hostname().replace(/\.local$/i, ""), home];
  try {
    local.push((await readFile(path.join(home, "Library", "Application Support", "Inkform", "zertifikat", "host.txt"), "utf8")).trim().replace(/\.local$/i, ""));
  } catch {}
  try {
    local.push(execFileSync("git", ["config", "--get", "user.email"], { cwd: root, encoding: "utf8" }).trim());
  } catch {}
  return { studios: studios.length, profiles, certs, local: compileMarkers(local.filter((m) => m && m.length >= 4)) };
}

// E-mail addresses the core itself contains (placeholders, library credits).
async function coreEmails() {
  const found = new Set();
  for (const file of [...(await filesBelow(path.join(root, "src"))), ...(await filesBelow(path.join(root, "public", "vendor")))])
    for (const m of (await readFile(file, "latin1")).matchAll(EMAIL)) found.add(m[0].toLowerCase());
  return found;
}

// files: Map of build path -> contents; profile: the blanko profile.json. Returns the problems.
export async function checkBlanko(files, profile, priv) {
  const problems = [];
  if (profile.blank !== true) problems.push('profile.json: "blank": true fehlt');
  if (profile.guide) problems.push("profile.json: Blanko hat keine Anleitung");
  for (const key of STUDIO_FIELDS) if (profile.text?.[key]) problems.push(`profile.json: text.${key} muss leer sein`);
  for (const name of files.keys()) if (!BLANKO_FILES.includes(name)) problems.push(`${name}: gehört nicht zum Build`);
  for (const name of BLANKO_FILES) if (!files.has(name)) problems.push(`${name}: fehlt`);
  const allowed = await coreEmails();
  for (const [name, contents] of files) {
    const buffer = Buffer.from(contents),
      text = scanText(buffer),
      raw = buffer.toString("latin1");
    for (const p of priv.profiles) {
      for (const m of findMarkers(text + "\n" + name, p.markers)) problems.push(`${name}: Kennzeichen von ${p.id}: ${m}`);
      for (const f of findFingerprints(buffer, p.prints)) problems.push(`${name}: Datei von ${p.id}: ${f}`);
    }
    for (const f of findFingerprints(buffer, priv.certs)) problems.push(`${name}: Zertifikat oder Schlüssel ${f}`);
    for (const m of findMarkers(text + "\n" + raw, priv.local)) problems.push(`${name}: Kennung dieses Macs: ${m}`);
    for (const { label, rx } of FIXED) if (rx.test(text) || rx.test(raw)) problems.push(`${name}: ${label}`);
    for (const m of new Set([...(text + "\n" + raw).matchAll(EMAIL)].map((m) => m[0].toLowerCase())))
      if (!allowed.has(m)) problems.push(`${name}: fremde E-Mail-Adresse ${m}`);
    if (name.endsWith("index.html")) {
      const config = /<script type="application\/json" id="inkform-config">([\s\S]*?)<\/script>/.exec(raw);
      if (!config || config[1].trim() !== "null") problems.push(`${name}: eingebettete Studio-Konfiguration`);
    }
  }
  return [...new Set(problems)];
}

async function main(argv) {
  const dir = argv.includes("--dir") ? path.resolve(argv[argv.indexOf("--dir") + 1]) : null;
  const profile = JSON.parse(await readFile(path.join(resolveProfileDir("blanko"), "profile.json"), "utf8"));
  let files;
  if (dir) {
    files = new Map();
    for (const file of await filesBelow(dir)) files.set(path.relative(dir, file).split(path.sep).join("/"), await readFile(file));
  } else files = (await buildProfile("blanko")).files;
  const priv = await collectPrivate();
  if (!priv.studios && !argv.includes("--ohne-studios"))
    throw new Error("Keine Studio-Profile gefunden (../Inkform-Studios oder INKFORM_STUDIOS). Ohne sie ist die Prüfung unvollständig; bewusst ohne: --ohne-studios.");
  const problems = await checkBlanko(files, profile, priv);
  if (problems.length) {
    console.error(`Blanko-Prüfung fehlgeschlagen (${problems.length}):\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  console.log(
    `Blanko-Prüfung bestanden: ${files.size} Dateien, geprüft gegen ${priv.profiles.length} Profile (${priv.studios} Studios), ${priv.certs.length} Zertifikats- und Schlüsselblöcke und ${priv.local.length} Kennungen dieses Macs.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
