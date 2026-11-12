// Shared helpers for the Werkstatt tests. Everything works in temporary folders only.
import { execFileSync } from "node:child_process";
import { request } from "node:http";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { root } from "../../scripts/build.mjs";
import { buildState, gitInfo } from "../../werkstatt/status.mjs";

// ---------- PNG images ----------
function crc(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
}
// rows: one Buffer per line (filter byte included); colorType 2 = RGB, 0 = grey.
function encodePng(width, height, rows, colorType) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
// A plain single-colour RGB image (logo uploads).
export function solidPng(width, height = width, shade = 0x40) {
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, shade)]);
  return encodePng(width, height, Array.from({ length: height }, () => row), 2);
}
// A QR module matrix as a black-on-white greyscale image with a quiet zone.
export function qrPng(modules, scale = 8, quiet = 4) {
  const n = (modules.length + 2 * quiet) * scale;
  const rows = [];
  for (let y = 0; y < n; y++) {
    const row = Buffer.alloc(1 + n, 255);
    row[0] = 0;
    for (let x = 0; x < n; x++) {
      const r = Math.floor(y / scale) - quiet,
        c = Math.floor(x / scale) - quiet;
      if (r >= 0 && c >= 0 && r < modules.length && c < modules.length && modules[r][c]) row[1 + x] = 0;
    }
    rows.push(row);
  }
  return encodePng(n, n, rows, 0);
}

// ---------- folders ----------
// Names, sizes and modification times of everything below dir: equal snapshots = nothing changed.
export async function snapshot(dir) {
  const out = [];
  for (const name of (await readdir(dir, { recursive: true })).sort()) {
    const s = await stat(path.join(dir, name));
    out.push(`${name}:${s.size}:${s.mtimeMs}`);
  }
  return out.join("\n");
}

// ---------- studio data ----------
// The sample texts with every sample-studio marker replaced by the given studio name.
export function neutralTexts(text, name) {
  return Object.fromEntries(
    Object.entries(text).map(([k, v]) => [
      k,
      v
        .replace(/musterstudio\.example/gi, `${name.toLowerCase().replace(/\s+/g, "-")}.example`)
        .replace(/12345 Musterstadt/g, "54321 Nordstadt")
        .replace(/Max Mustermann/g, "Erika Nordmann")
        .replace(/musterstudio/gi, name),
    ]),
  );
}

// The core reported as cleanly committed (the tests must not depend on uncommitted work in the
// core); studio folders are read with the real Git.
export const fakeGit = async (dir) =>
  path.resolve(dir) === path.resolve(root) ? { repo: true, commit: "c0ffee1", clean: true, changes: 0, remotes: [] } : gitInfo(dir);

// ---------- Werkstatt API ----------
// One API call with the right Host header and session token; returns status and parsed JSON.
export function callApi(server, token, method, pathname, body) {
  const port = server.address().port;
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, method, path: pathname, headers: { host: `127.0.0.1:${port}`, "x-werkstatt-token": token, "content-type": "application/json" } },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(text || "{}") }));
      },
    );
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Exporting Beispiel needs a current Beispiel build in the core (build/beispiel). After a change in src/
// it is outdated, so tests that export Beispiel build it first themselves.
export async function ensureBeispielBuild() {
  if ((await buildState(path.join(root, "profiles", "beispiel"))).state !== "aktuell")
    execFileSync(process.execPath, [path.join(root, "scripts", "build.mjs"), "--profile", "beispiel"], { stdio: "ignore" });
}
