// Own ZIP routine (src/zip.js): CRC-32, UTF-8 names, and that the Mac's own tools unpack it.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { crc32, createZip } from "../src/zip.js";

const bytes = (text) => new TextEncoder().encode(text);
const FILES = [
  { name: "Einwilligungen/2026-03-05_Müller_Jürgen.pdf", data: bytes("%PDF-1.7 Jürgen") },
  { name: "Einwilligungen/2026-03-06_Şahin_Gül.pdf", data: bytes("%PDF-1.7 Gül") },
  { name: "Einwilligungen/2026-03-07_Ćwik_Łukasz.pdf", data: new Uint8Array(70_000).map((_, i) => i % 251) },
  { name: "Einnahmen/Einnahmen_2026-03.csv", data: bytes("Termin;Name\n2026-03-05;Jürgen Müller\n") },
  { name: "leer.txt", data: new Uint8Array(0) },
];

test("CRC-32 matches the standard check values", () => {
  assert.equal(crc32(bytes("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
  assert.equal(crc32(bytes("The quick brown fox jumps over the lazy dog")), 0x414fa339);
});

test("ZIP structure: stored entries, UTF-8 flag, DOS date, central directory at the end", () => {
  const zip = createZip(FILES, new Date(2026, 2, 31, 23, 59, 58)),
    view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint16(6, true), 0x0800);
  assert.equal(view.getUint16(8, true), 0);
  assert.equal(view.getUint16(10, true), (23 << 11) | (59 << 5) | 29);
  assert.equal(view.getUint16(12, true), ((2026 - 1980) << 9) | (3 << 5) | 31);
  const end = zip.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), FILES.length);
  const size = view.getUint32(end + 12, true),
    offset = view.getUint32(end + 16, true);
  assert.equal(offset + size, end);
  assert.equal(view.getUint32(offset, true), 0x02014b50);
});

test("an empty list gives a valid empty archive", () => {
  const zip = createZip([]);
  assert.equal(zip.length, 22);
  assert.equal(new DataView(zip.buffer).getUint32(0, true), 0x06054b50);
});

test("the Mac unpacks the ZIP without errors: unzip -t, ditto and Python zipfile", { skip: process.platform !== "darwin" }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "inkform-zip-"));
  try {
    const file = path.join(dir, "Inkform_2026-03.zip");
    await writeFile(file, createZip(FILES));
    assert.match(execFileSync("unzip", ["-t", file], { encoding: "utf8" }), /No errors detected/);
    const listed = execFileSync(
      "python3",
      ["-I", "-c", "import sys,zipfile,json;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps([i.filename for i in z.infolist()]))", file],
      { encoding: "utf8" },
    );
    assert.deepEqual(JSON.parse(listed), FILES.map((f) => f.name));
    const out = path.join(dir, "ausgepackt");
    execFileSync("ditto", ["-x", "-k", file, out]);
    for (const { name, data } of FILES) {
      const [folder, base] = name.includes("/") ? name.split("/") : [".", name];
      const found = (await readdir(path.join(out, folder))).find((n) => n.normalize("NFC") === base);
      assert.ok(found, `${name} ausgepackt`);
      assert.deepEqual(new Uint8Array(await readFile(path.join(out, folder, found))), data);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
