// The core repository must never contain a studio's data: not in any file of the working tree and
// not anywhere in the Git object database (every commit, tree, blob and tag, reachable or not, with
// embedded base64 decoded). The markers come from the studio profiles outside this repository, so
// the list of what to look for is never stored here.
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
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
const skip = studios.length ? false : "keine Studio-Profile neben dem Kern gefunden (../Inkform-Studios oder INKFORM_STUDIOS)";
const hasGit = await stat(path.join(root, ".git")).then(() => true, () => false);

function scanRepo(dir) {
  const hits = [];
  for (const object of gitObjects(dir)) {
    const text = gitObjectText(object);
    for (const s of studios) {
      for (const m of findMarkers(text, s.markers)) hits.push(`${object.type} ${object.sha.slice(0, 10)}: ${s.id} Kennzeichen ${m}`);
      if (object.type === "blob")
        for (const f of findFingerprints(object.contents, s.prints)) hits.push(`blob ${object.sha.slice(0, 10)}: ${s.id} Datei ${f}`);
    }
  }
  return hits;
}

test("working tree of the core contains no studio markers or studio files", { skip }, async () => {
  const hits = [];
  for (const file of await filesBelow(root)) {
    const rel = path.relative(root, file);
    const contents = await readFile(file);
    const text = scanText(contents) + "\n" + rel;
    for (const s of studios) {
      for (const m of findMarkers(text, s.markers)) hits.push(`${rel}: ${s.id} Kennzeichen ${m}`);
      for (const f of findFingerprints(contents, s.prints)) hits.push(`${rel}: ${s.id} Datei ${f}`);
    }
  }
  assert.deepEqual(hits, []);
});

test("complete Git history of the core contains no studio markers or studio files", { skip: skip || (!hasGit && "kein .git-Ordner") }, async () => {
  const hits = scanRepo(root);
  // Repository metadata outside the object database: config, refs, reflogs, commit message draft.
  for (const file of await filesBelow(path.join(root, ".git"), new Set(["objects"]))) {
    const text = scanText(await readFile(file)) + "\n" + path.relative(root, file);
    for (const s of studios) for (const m of findMarkers(text, s.markers)) hits.push(`${path.relative(root, file)}: ${s.id} Kennzeichen ${m}`);
  }
  assert.deepEqual(hits, []);
});

test("counter-test: history scan finds studio data even after it was deleted again", { skip }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "inkform-leak-"));
  try {
    const git = (...args) =>
      execFileSync("git", ["-C", dir, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args], { stdio: "pipe" });
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
    const hits = scanRepo(dir);
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
