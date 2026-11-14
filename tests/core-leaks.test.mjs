// The core repository must never contain a studio's data: not in any file of the working tree and
// not anywhere in Git, on any branch (main, gh-pages): every commit, tree, blob and tag, reachable or
// not, with embedded base64 decoded, and the metadata beside the objects (branch and tag names,
// reflogs, config). The markers come from the studio profiles outside this repository (see
// studioRoots in scripts/build.mjs), so the list of what to look for is never stored here.
// Without studio profiles the check fails; INKFORM_NUR_NEUTRAL=1 runs only the neutral checks
// (private keys, home folder paths), e.g. in a clone of the public repository.
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { discoverStudioProfiles, root } from "../scripts/build.mjs";
import {
  compileMarkers,
  filesBelow,
  findFingerprints,
  findMarkers,
  fingerprints,
  gitObjects,
  gitObjectText,
  scanText,
} from "./lib/leaks.mjs";

const studioDirs = await discoverStudioProfiles();
const studios = await Promise.all(
  studioDirs.map(async (dir) => {
    const profile = JSON.parse(await readFile(path.join(dir, "profile.json"), "utf8"));
    return { id: profile.id, profile, markers: compileMarkers(profile.markers), prints: await fingerprints(dir, profile.logo) };
  }),
);
const neutralOnly = process.env.INKFORM_NUR_NEUTRAL === "1";
const skip = studios.length ? false : "keine Studio-Profile; nur die neutralen Prüfungen";
const hasGit = await stat(path.join(root, ".git")).then(() => true, () => false);
// Found in any repository, whoever clones it: private keys and paths into a home folder.
// A private key is a PEM block with key data, read from the raw bytes (encryption headers such as
// Proc-Type and DEK-Info allowed, wrapped or not); the tests name the header alone.
const PEM_KEY = /-----BEGIN ([A-Z0-9 ]*)PRIVATE KEY-----([\s\S]*?)-----END \1PRIVATE KEY-----/g;
function privateKeys(contents) {
  const text = Buffer.from(contents).toString("latin1");
  return [...text.matchAll(PEM_KEY)].filter(([, , body]) => body.replace(/^[A-Za-z-]+:.*$/gm, "").replace(/\s+/g, "").length >= 40).length;
}
const NEUTRAL = [
  {
    id: "neutral",
    markers: compileMarkers([{ regex: "(?<![\\p{L}\\p{N}._-])/(?:users|home)/[\\p{L}\\p{N}._-]+(?=/|$|[\\s\"'`)\\]>,;:])", flags: "ium" }]),
    prints: [],
    raw: (contents) => (privateKeys(contents) ? ["privater Schlüssel"] : []),
  },
];

function scanObjects(dir, sets) {
  const hits = [];
  for (const object of gitObjects(dir)) {
    const text = gitObjectText(object);
    for (const s of sets) {
      for (const m of findMarkers(text, s.markers)) hits.push(`${object.type} ${object.sha.slice(0, 10)}: ${s.id} Kennzeichen ${m}`);
      if (object.type === "blob")
        for (const f of [...findFingerprints(object.contents, s.prints), ...(s.raw?.(object.contents) ?? [])])
          hits.push(`blob ${object.sha.slice(0, 10)}: ${s.id} Datei ${f}`);
    }
  }
  return hits;
}
// Repository metadata outside the object database: refs (branch and tag names), packed refs,
// reflogs, config, worktrees, commit message drafts.
async function scanMeta(dir, sets) {
  const hits = [];
  for (const file of await filesBelow(path.join(dir, ".git"), new Set(["objects"]))) {
    const rel = path.relative(dir, file),
      contents = await readFile(file),
      text = scanText(contents) + "\n" + rel;
    for (const s of sets) for (const m of [...findMarkers(text, s.markers), ...(s.raw?.(contents) ?? [])]) hits.push(`${rel}: ${s.id} Kennzeichen ${m}`);
  }
  return hits;
}
async function scanFiles(files, sets) {
  const hits = [];
  for (const file of files) {
    const rel = path.relative(root, file);
    const contents = await readFile(file);
    const text = scanText(contents) + "\n" + rel;
    for (const s of sets) {
      for (const m of findMarkers(text, s.markers)) hits.push(`${rel}: ${s.id} Kennzeichen ${m}`);
      for (const f of [...findFingerprints(contents, s.prints), ...(s.raw?.(contents) ?? [])]) hits.push(`${rel}: ${s.id} Datei ${f}`);
    }
  }
  return hits;
}
function tempRepo(dir) {
  return (...args) => execFileSync("git", ["-C", dir, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args], { stdio: "pipe" });
}

test("studio profiles are found, or only the neutral checks are asked for", () => {
  assert.ok(
    studios.length || neutralOnly,
    "Keine Studio-Profile gefunden. Pfad über INKFORM_STUDIOS oder in .inkform-studios angeben; nur die neutralen Prüfungen: INKFORM_NUR_NEUTRAL=1.",
  );
});

test("working tree of the core contains no studio markers or studio files", { skip }, async () => {
  assert.deepEqual(await scanFiles(await filesBelow(root), studios), []);
});

test("complete Git history of the core, all branches and their metadata, contains no studio data", { skip: skip || (!hasGit && "kein .git-Ordner") }, async () => {
  assert.deepEqual([...scanObjects(root, studios), ...(await scanMeta(root, studios))], []);
});

test("neutral: no private keys and no home folder paths, in the tracked files and the whole history", async () => {
  const tracked = hasGit ? execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean).map((f) => path.join(root, f)) : await filesBelow(root);
  const hits = await scanFiles(tracked, NEUTRAL);
  if (hasGit) hits.push(...scanObjects(root, NEUTRAL), ...(await scanMeta(root, NEUTRAL)));
  assert.deepEqual(hits, []);
});

test("counter-test: branch names and reflogs are searched, also of a deleted branch", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "inkform-leak-"));
  try {
    const git = tempRepo(dir),
      sets = [{ id: "probe", markers: compileMarkers(["zweig-geheimwort", "notiz geheimwort"]), prints: [] }];
    git("init", "-q", "-b", "main");
    await writeFile(path.join(dir, "a.txt"), "neutral\n");
    git("add", "-A");
    git("commit", "-q", "-m", "neutral");
    git("branch", "zweig-geheimwort");
    git("commit", "-q", "--amend", "-m", "notiz geheimwort");
    git("commit", "-q", "--amend", "-m", "neutral");
    const hits = await scanMeta(dir, sets);
    assert.ok(hits.some((h) => h.startsWith(path.join(".git", "refs", "heads", "zweig-geheimwort"))), "Zweigname");
    assert.ok(hits.some((h) => h.startsWith(path.join(".git", "logs")) && h.includes("notiz geheimwort")), "Reflog");
    git("pack-refs", "--all");
    assert.ok((await scanMeta(dir, sets)).some((h) => h.startsWith(path.join(".git", "packed-refs"))), "gepackte Zweignamen");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("counter-test: neutral check finds private keys of every kind and home folder paths, not similar text", async () => {
  const { privateKey: pkcs8 } = generateKeyPairSync("ec", { namedCurve: "P-256", privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const { privateKey: encrypted } = generateKeyPairSync("rsa", {
    modulusLength: 1024,
    privateKeyEncoding: { type: "pkcs1", format: "pem", cipher: "aes-256-cbc", passphrase: "probe" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  assert.match(encrypted, /Proc-Type/);
  const unwrapped = pkcs8.replace(/\n(?!-----)/g, "").replace(/-----\n?$/, "-----\n");
  const found = {
    "pkcs8.pem": pkcs8,
    "verschluesselt.pem": encrypted,
    "einzeilig.pem": unwrapped,
    "pfad-mac.txt": `Ablage: ${"/"}Users/André/Documents/x\n`,
    "pfad-linux.txt": `HOME=${"/"}home/alice\n`,
  };
  const clean = {
    "nur-kopf.txt": ["-----BEGIN", "PRIVATE KEY-----"].join(" ") + "\n",
    "api.txt": "GET https://example.invalid/api/users/42 und users/abc\n",
    "ordner.txt": `Der Ordner ${"/"}Users allein\n`,
  };
  const dir = await mkdtemp(path.join(tmpdir(), "inkform-leak-"));
  try {
    const git = tempRepo(dir);
    git("init", "-q", "-b", "main");
    for (const [name, text] of Object.entries({ ...found, ...clean })) await writeFile(path.join(dir, name), text);
    git("add", "-A");
    git("commit", "-q", "-m", "x");
    const hits = scanObjects(dir, NEUTRAL),
      blobOf = (name) => execFileSync("git", ["-C", dir, "rev-parse", `HEAD:${name}`], { encoding: "utf8" }).slice(0, 10);
    for (const name of Object.keys(found)) assert.ok(hits.some((h) => h.startsWith(`blob ${blobOf(name)}`)), `${name} nicht gefunden`);
    for (const name of Object.keys(clean)) assert.ok(!hits.some((h) => h.startsWith(`blob ${blobOf(name)}`)), `${name} fälschlich gefunden`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("counter-test: history scan finds studio data even after it was deleted again", { skip }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "inkform-leak-"));
  try {
    const git = tempRepo(dir);
    git("init", "-q");
    for (const s of studios) {
      const marker = s.profile.markers.find((m) => typeof m === "string");
      const logo = s.prints.find((f) => f.label === s.profile.logo);
      await writeFile(path.join(dir, `${s.id}-notiz.txt`), `Hinweis: ${marker}\n`);
      await writeFile(path.join(dir, `${s.id}-seite.html`), `<img src="data:image/png;base64,${logo.base64}">`);
    }
    git("add", "-A");
    git("commit", "-q", "-m", "versehentlich");
    git("rm", "-q", "-r", ".");
    git("commit", "-q", "-m", "wieder entfernt");
    assert.equal(execFileSync("git", ["-C", dir, "ls-files"]).toString(), "", "Arbeitsstand ist leer");
    const hits = scanObjects(dir, studios);
    for (const s of studios) {
      assert.ok(hits.some((h) => h.includes(`${s.id} Kennzeichen`)), `${s.id}: Kennzeichen nicht gefunden`);
      assert.ok(hits.some((h) => h.includes(`${s.id} Datei ${s.profile.logo}`)), `${s.id}: Logo nicht gefunden`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("counter-test: each studio's markers flag its own guide PDF text", { skip }, async () => {
  for (const s of studios) {
    const guide = s.prints.find((f) => f.label.endsWith(".pdf"));
    assert.ok(findMarkers(scanText(guide.bytes), s.markers).length > 0, s.id);
  }
});
