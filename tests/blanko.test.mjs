// Neutral edition "blanko": the profile, its build and the build check (scripts/blanko-pruefen.mjs).
// The check runs against a throwaway studio and a throwaway certificate folder; every kind of
// private content is injected once and must be found.
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildProfile, root } from "../scripts/build.mjs";
import { BLANKO_FILES, checkBlanko, collectPrivate } from "../scripts/blanko-pruefen.mjs";
import { solidPng } from "./lib/werkstatt.mjs";

const base = await mkdtemp(path.join(tmpdir(), "inkform-blanko-"));
test.after(() => rm(base, { recursive: true, force: true }));
const studio = path.join(base, "studios", "nordlicht"),
  home = path.join(base, "home");
await cp(path.join(root, "profiles", "beispiel"), studio, { recursive: true });
const studioProfile = JSON.parse(await readFile(path.join(studio, "profile.json"), "utf8"));
await writeFile(
  path.join(studio, "profile.json"),
  JSON.stringify({ ...studioProfile, id: "nordlicht", markers: ["Testatelier Nordlicht", { regex: "nordlicht-tattoo\\.example" }] }),
);
const logo = solidPng(64, 64, 0x5a);
await writeFile(path.join(studio, "logo.png"), logo);
await mkdir(path.join(studio, "Fotos"));
const photo = solidPng(32, 32, 0x77);
await writeFile(path.join(studio, "Fotos", "studio.png"), photo);
const certBody = Buffer.from("Testzertifikat für die Blanko-Prüfung ".repeat(8)).toString("base64");
await mkdir(path.join(home, "Library", "Application Support", "Inkform", "zertifikat"), { recursive: true });
await writeFile(
  path.join(home, "Library", "Application Support", "Inkform", "zertifikat", "test.crt"),
  `-----BEGIN CERTIFICATE-----\n${certBody.match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`,
);

const profile = JSON.parse(await readFile(path.join(root, "profiles", "blanko", "profile.json"), "utf8"));
const { files } = await buildProfile("blanko");
const priv = await collectPrivate({ env: { INKFORM_STUDIOS: path.join(base, "studios") }, home });
const check = (change = () => {}, p = profile) => {
  const copy = new Map(files);
  change(copy);
  return checkBlanko(copy, p, priv);
};
const inject = (text, name = "dist/index.html") => (copy) => copy.set(name, String(copy.get(name)).replace("</body>", `${text}</body>`));

test("blanko profile: neutral edition without studio details and without guide", () => {
  assert.equal(profile.blank, true);
  assert.equal(profile.guide, undefined);
  for (const key of ["studioName", "studioAddress", "studioContact", "studioLocation"]) assert.equal(profile.text[key], "", key);
  assert.deepEqual([...files.keys()].sort(), [...BLANKO_FILES].sort());
});

test("blanko build: flag set, no guide embedded, sample build unchanged", async () => {
  assert.match(String(files.get("dist/index.html")), /const BLANK_EDITION = "true" === "true";/);
  assert.match(String(files.get("dist/index.html")), /const OWNER_GUIDE_BASE64 = "";/);
  const sample = await buildProfile("beispiel");
  assert.match(String(sample.files.get("dist/index.html")), /const BLANK_EDITION = "false" === "true";/);
  assert.doesNotMatch(String(sample.files.get("dist/index.html")), /const OWNER_GUIDE_BASE64 = "";/);
});

test("the private data used by the check comes from the studios and this Mac", () => {
  assert.equal(priv.studios, 1);
  assert.deepEqual(priv.profiles.map((p) => p.id), ["beispiel", "nordlicht"]);
  assert.ok(priv.profiles[1].prints.some((p) => p.label === path.join("Fotos", "studio.png")));
  assert.equal(priv.certs.length, 1);
});

test("the clean blanko build passes", async () => {
  assert.deepEqual(await check(), []);
});

test("counter-tests: every kind of private content is found", async () => {
  const cases = [
    [inject("Testatelier Nordlicht"), /Kennzeichen von nordlicht: Testatelier Nordlicht/],
    [inject("www.nordlicht-tattoo.example"), /Kennzeichen von nordlicht/],
    [inject(Buffer.from("x".repeat(160) + " Testatelier Nordlicht " + "y".repeat(160)).toString("base64")), /Kennzeichen von nordlicht/],
    [inject("Musterstudio"), /Kennzeichen von beispiel: Musterstudio/],
    [(c) => c.set("dist/icons/icon-192.png", logo), /Datei von nordlicht: logo\.png/],
    [inject(`<img src="data:image/png;base64,${photo.toString("base64")}">`), /Datei von nordlicht: Fotos\/studio\.png/],
    [inject("-----BEGIN PRIVATE KEY-----"), /PEM-Block/],
    [inject(certBody), /Zertifikat oder Schlüssel zertifikat\/test\.crt/],
    [inject(userInfo().username), /Kennung dieses Macs/],
    [inject(path.join(home, "x")), /lokaler Pfad|Kennung dieses Macs/],
    [inject("Werkstatt"), /Werkstatt/],
    [inject("https://inkform-app.local:8443/"), /Vor-Ort-Modus/],
    [inject("kunde@example.org"), /fremde E-Mail-Adresse kunde@example\.org/],
    [(c) => c.set("dist/kunden.json", "[]"), /dist\/kunden\.json: gehört nicht zum Build/],
    [(c) => c.delete("dist/sw.js"), /dist\/sw\.js: fehlt/],
    [
      (c) => c.set("index.html", String(c.get("index.html")).replace(/(id="inkform-config">)\s*null\s*/, '$1{"studio":{"name":"X"}}')),
      /index\.html: eingebettete Studio-Konfiguration/,
    ],
  ];
  for (const [change, expected] of cases) {
    const problems = await check(change);
    assert.ok(problems.some((p) => expected.test(p)), `${expected} nicht gefunden: ${JSON.stringify(problems)}`);
  }
  const named = await check(undefined, { ...profile, text: { ...profile.text, studioName: "Irgendwer" } });
  assert.ok(named.some((p) => /text\.studioName muss leer sein/.test(p)));
  assert.ok((await check(undefined, { ...profile, blank: false })).some((p) => /"blank": true fehlt/.test(p)));
});
