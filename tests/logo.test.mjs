// Studio logo (src/logo.js) and its place in the full backup (src/backup.js).
import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import { crc32 } from "../src/zip.js";
import { LOGO_EDGE, LOGO_MAX_BYTES, checkLogo, pngSize } from "../src/logo.js";
import { createFullBackup, readFullBackup, toBase64 } from "../src/backup.js";

// A real PNG (RGBA, deflated rows); noise makes it large.
function png(width, height, { noise = false } = {}) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]),
      out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = noise ? randomBytes((width * 4 + 1) * height) : Buffer.alloc((width * 4 + 1) * height, 200);
  for (let i = 0; i < rows.length; i += width * 4 + 1) rows[i] = 0;
  return new Uint8Array(
    Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]),
  );
}
const settings = { schemaVersion: 1, studio: { name: "Musterstudio" }, app: {} };
const backup = (logo) =>
  JSON.parse(
    JSON.stringify(
      createFullBackup({ settings, theme: "dark", logo, retention: {}, backupDays: 7, exports: [], records: [], pdfs: [], removed: new Set() }),
    ),
  );
const read = (value) => readFullBackup(value, (s) => s);

test("PNG size only for a complete PNG with correct checksums", () => {
  const good = png(300, 120);
  assert.deepEqual(pngSize(good), { width: 300, height: 120 });
  assert.equal(pngSize(good.subarray(0, 24)), null, "only the header");
  assert.equal(pngSize(good.subarray(0, good.length - 1)), null, "cut off");
  assert.equal(pngSize(new Uint8Array([...good, 0])), null, "bytes after IEND");
  const flipped = good.slice();
  flipped[40] ^= 1;
  assert.equal(pngSize(flipped), null, "damaged image data");
  assert.equal(pngSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(60).fill(0)])), null, "JPEG");
  assert.equal(pngSize(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'>" + " ".repeat(30) + "</svg>")), null, "SVG");
});

test("logo limits: edge and byte size", () => {
  assert.ok(checkLogo(png(LOGO_EDGE, LOGO_EDGE)));
  assert.throws(() => checkLogo(png(LOGO_EDGE + 1, 10)), /zu groß/);
  const noisy = png(400, 400, { noise: true });
  assert.ok(noisy.length > LOGO_MAX_BYTES);
  assert.throws(() => checkLogo(noisy), /zu groß/);
  assert.throws(() => checkLogo(new TextEncoder().encode("%PDF-1.7")), /kein vollständiges PNG/);
});

test("backup with logo: restored byte for byte", () => {
  const logo = png(200, 80);
  assert.deepEqual(read(backup(logo)).logo, logo);
});

test("backup without own logo says so: restoring removes the device's own", () => {
  const value = backup(null);
  assert.equal(value.logo, null);
  assert.equal(read(value).logo, null);
});

test("version 1 backups stay valid and leave the device's logo alone", () => {
  const value = backup(null);
  value.schemaVersion = 1;
  delete value.logo;
  assert.equal(read(value).logo, undefined);
});

test("a wrong or too large logo refuses the whole backup", () => {
  const refuse = (logo) => {
    const value = backup(null);
    value.logo = logo;
    assert.throws(() => read(value), /ungültiges Logo/);
  };
  refuse(toBase64(png(LOGO_EDGE * 2, 10)));
  refuse(toBase64(png(100, 40).subarray(0, 24)));
  refuse(toBase64(new TextEncoder().encode("<svg/>")));
  refuse("kein base64!");
  refuse(42);
  const missing = backup(null);
  delete missing.logo;
  assert.throws(() => read(missing), /ungültiges Logo/);
});
