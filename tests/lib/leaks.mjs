// Leak scanning helpers: turn any file (text, PNG, PDF, embedded base64) into searchable text,
// match a studio's own markers and detect embedded copies of its logo, icons or guide.
// The marker lists themselves live in each studio profile (profile.json "markers"), never here.
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { inflateSync } from "node:zlib";

// ---------- PDF ----------

function ascii85(bytes) {
  const text = bytes.toString("latin1").replace(/\s+/g, "");
  const end = text.indexOf("~>");
  const body = (end >= 0 ? text.slice(0, end) : text).replace(/^<~/, "");
  const out = [];
  let group = [];
  for (const ch of body) {
    if (ch === "z" && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    group.push(ch.charCodeAt(0) - 33);
    if (group.length === 5) {
      let n = 0;
      for (const v of group) n = n * 85 + v;
      out.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
      group = [];
    }
  }
  if (group.length) {
    const len = group.length;
    while (group.length < 5) group.push(84);
    let n = 0;
    for (const v of group) n = n * 85 + v;
    out.push(...[(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].slice(0, len - 1));
  }
  return Buffer.from(out);
}

function decodeStream(dict, data) {
  const filters = (dict.match(/\/Filter\s*(\[[^\]]*\]|\/\w+)/)?.[1] ?? "").match(/\/\w+/g) ?? [];
  let bytes = data;
  for (const filter of filters) {
    if (filter === "/ASCII85Decode") bytes = ascii85(bytes);
    else if (filter === "/FlateDecode") bytes = inflateSync(bytes);
    else return null; // image codecs etc.: not text
  }
  return bytes;
}

function pdfObjects(buffer) {
  const raw = buffer.toString("latin1");
  const objects = new Map();
  for (const m of raw.matchAll(/(\d+)\s+0\s+obj\b([\s\S]*?)\bendobj/g)) {
    const body = m[2];
    const s = body.match(/^([\s\S]*?)\bstream\r?\n([\s\S]*?)\r?\n?endstream/);
    let stream = null;
    if (s) {
      try {
        stream = decodeStream(s[1], Buffer.from(s[2], "latin1"));
      } catch {
        stream = null;
      }
    }
    objects.set(m[1], { dict: s ? s[1] : body, stream });
  }
  return objects;
}

function parseCmap(text) {
  const map = new Map();
  const hex = (h) => parseInt(h, 16);
  const uni = (h) =>
    String.fromCharCode(...(h.match(/.{4}/g) ?? []).map((x) => parseInt(x, 16)).filter(Boolean));
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g))
      map.set(hex(m[1]), uni(m[2]));
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const start = hex(m[1]),
        stop = hex(m[2]),
        first = parseInt(m[3], 16);
      for (let c = start; c <= stop && c - start < 65536; c++) map.set(c, String.fromCharCode(first + c - start));
    }
  return map;
}

function pdfStrings(content) {
  // Yields [kind, value] for Tf font switches and every shown string in a content stream.
  const out = [];
  let i = 0;
  const s = content;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "(") {
      let depth = 1,
        j = i + 1,
        bytes = [];
      while (j < s.length && depth) {
        const c = s[j];
        if (c === "\\") {
          const n = s[j + 1];
          const esc = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
          if (n in esc) {
            bytes.push(esc[n]);
            j += 2;
          } else if (/[0-7]/.test(n)) {
            const oct = s.slice(j + 1, j + 4).match(/^[0-7]{1,3}/)[0];
            bytes.push(parseInt(oct, 8) & 255);
            j += 1 + oct.length;
          } else j += 2;
          continue;
        }
        if (c === "(") depth++;
        if (c === ")" && --depth === 0) break;
        bytes.push(c.charCodeAt(0));
        j++;
      }
      out.push(["str", bytes]);
      i = j + 1;
    } else if (ch === "<" && s[i + 1] !== "<") {
      const j = s.indexOf(">", i);
      const h = s.slice(i + 1, j).replace(/\s/g, "");
      out.push(["str", (h.match(/../g) ?? []).map((x) => parseInt(x, 16))]);
      i = j + 1;
    } else if (ch === "/") {
      const m = s.slice(i).match(/^\/([^\s/\[\]()<>]+)\s+[-\d.]+\s+Tf/);
      if (m) {
        out.push(["font", m[1]]);
        i += m[0].length;
      } else i++;
    } else i++;
  }
  return out;
}

export function pdfText(buffer) {
  const objects = pdfObjects(buffer);
  const cmaps = new Map(); // font resource name -> code map
  for (const { dict } of objects.values()) {
    if (!/\/Type\s*\/Font/.test(dict)) continue;
    const ref = dict.match(/\/ToUnicode\s+(\d+)\s+0\s+R/)?.[1];
    const stream = ref && objects.get(ref)?.stream;
    const map = stream ? parseCmap(stream.toString("latin1")) : null;
    for (const name of dict.matchAll(/\/Name\s*\/([^\s/\[\]()<>]+)/g)) if (map) cmaps.set(name[1], map);
  }
  // Non-stream parts (dictionaries, metadata such as /Author) plus decoded text of every stream.
  let text = buffer.toString("latin1").replace(/stream\r?\n[\s\S]*?endstream/g, " ");
  for (const { stream } of objects.values()) {
    if (!stream) continue;
    const content = stream.toString("latin1");
    if (!/\bT[jJ]\b/.test(content)) continue;
    let map = null;
    for (const [kind, value] of pdfStrings(content)) {
      if (kind === "font") map = cmaps.get(value) ?? null;
      else text += map ? value.map((b) => map.get(b) ?? "").join("") : Buffer.from(value).toString("latin1");
    }
    text += "\n";
  }
  return text;
}

// ---------- PNG ----------

export function pngText(buffer) {
  // Only text chunks are meaningful; pixel data is compressed noise.
  let text = "",
    offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "tEXt") text += data.toString("latin1") + "\n";
    if (type === "iTXt") text += data.toString("utf8") + "\n";
    if (type === "zTXt") {
      const zero = data.indexOf(0);
      try {
        text += data.toString("latin1", 0, zero) + " " + inflateSync(data.subarray(zero + 2)).toString("latin1") + "\n";
      } catch {}
    }
    offset += 12 + length;
  }
  return text;
}

// ---------- generic ----------

const isPdf = (b) => b.subarray(0, 5).toString("latin1") === "%PDF-";
const isPng = (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47;
const isText = (b) => {
  const sample = b.subarray(0, 8192);
  let odd = 0;
  for (const c of sample) if (c === 0 || (c < 9 && c !== 0)) odd++;
  return odd === 0;
};

export function scanText(contents, depth = 0) {
  const buffer = Buffer.from(contents);
  if (isPdf(buffer)) return pdfText(buffer);
  if (isPng(buffer)) return pngText(buffer);
  if (!isText(buffer)) return ""; // other binary (fonts, git trees are handled separately)
  // Long base64 runs (embedded logo, icons, guide PDF) are random letters; scanning them as text
  // gives false hits. Replace each run by the searchable text of its decoded bytes.
  return buffer.toString("utf8").replace(/[A-Za-z0-9+/]{200,}={0,2}/g, (run) =>
    depth > 2 ? " " : " " + scanText(Buffer.from(run, "base64"), depth + 1) + " ",
  );
}

export function compileMarkers(markers) {
  return markers.map((m) => {
    if (typeof m === "string") {
      const needle = m.normalize("NFC").toLocaleLowerCase("de");
      return { label: m, test: (text) => text.includes(needle) };
    }
    const rx = new RegExp(m.regex, m.flags ?? "i");
    return { label: `/${m.regex}/`, test: (text) => rx.test(text) };
  });
}

export function findMarkers(text, compiled) {
  const hay = text.normalize("NFC").toLocaleLowerCase("de");
  return compiled.filter((m) => m.test(hay)).map((m) => m.label);
}

export async function filesBelow(dir, skip = new Set([".git", "node_modules"])) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (skip.has(entry.name) || entry.name === ".DS_Store") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesBelow(full, skip)));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

export async function fingerprints(profileDir, logo) {
  // Binary assets that identify a studio: logo, icons and the owner guide.
  const files = [path.join(profileDir, logo), path.join(profileDir, "Anleitung-iPad-und-Admin.pdf")];
  for (const icon of await readdir(path.join(profileDir, "icons"))) if (!icon.startsWith(".")) files.push(path.join(profileDir, "icons", icon));
  return Promise.all(
    files.map(async (file) => {
      const bytes = await readFile(file);
      return { label: path.relative(profileDir, file), bytes, base64: bytes.toString("base64") };
    }),
  );
}

export function findFingerprints(contents, prints) {
  const buffer = Buffer.from(contents);
  const text = isText(buffer) ? buffer.toString("latin1") : "";
  return prints
    .filter((p) => buffer.equals(p.bytes) || (text && text.includes(p.base64)) || buffer.includes(p.bytes))
    .map((p) => p.label);
}

// ---------- git ----------

export function gitObjects(repoDir) {
  // Every object in the object database, reachable or not: commits, trees, blobs, tags.
  const out = execFileSync("git", ["-C", repoDir, "cat-file", "--batch-all-objects", "--batch", "--unordered"], {
    maxBuffer: 1 << 30,
  });
  const objects = [];
  let offset = 0;
  while (offset < out.length) {
    const nl = out.indexOf(10, offset);
    const [sha, type, size] = out.toString("latin1", offset, nl).split(" ");
    const start = nl + 1,
      end = start + Number(size);
    objects.push({ sha, type, contents: out.subarray(start, end) });
    offset = end + 1;
  }
  return objects;
}

export function gitObjectText(object) {
  if (object.type === "tree") {
    // Entries are "<mode> <name>\0<20-byte sha>"; keep the names.
    const names = [];
    let i = 0;
    const b = object.contents;
    while (i < b.length) {
      const zero = b.indexOf(0, i);
      names.push(b.toString("utf8", b.indexOf(32, i) + 1, zero));
      i = zero + 21;
    }
    return names.join("\n");
  }
  if (object.type === "blob") return scanText(object.contents);
  return object.contents.toString("utf8"); // commit / tag: author, message
}
