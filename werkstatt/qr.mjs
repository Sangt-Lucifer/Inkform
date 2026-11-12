// Minimal QR code encoder without any dependency: byte mode, error correction level M, versions 1
// to 5 (up to 84 bytes, enough for the iPad address). Follows ISO/IEC 18004; the tests decode the
// result with macOS's own QR reader (CoreImage) and compare fixed reference matrices.
const VERSIONS = {
  // version: [total codewords, EC codewords per block, number of blocks] for level M
  1: [26, 10, 1],
  2: [44, 16, 1],
  3: [70, 26, 1],
  4: [100, 18, 2],
  5: [134, 24, 2],
};
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30] };

// ---------- Reed-Solomon over GF(256), polynomial 0x11D ----------
const EXP = new Array(512),
  LOG = new Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
function generator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}
export function reedSolomon(data, degree) {
  const gen = generator(degree);
  const rem = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.shift();
    rem.push(0);
    for (let i = 0; i < degree; i++) rem[i] ^= mul(gen[i + 1], factor);
  }
  return rem;
}

// ---------- data codewords ----------
function codewords(bytes, version) {
  const [total, ecPerBlock, blocks] = VERSIONS[version];
  const dataCount = total - ecPerBlock * blocks;
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  const capacity = dataCount * 8;
  push(0, Math.min(4, capacity - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < dataCount; pad ^= 0xec ^ 0x11) data.push(pad);
  // Split into blocks (the first ones may be one codeword shorter), add EC, interleave.
  const shortLen = Math.floor(dataCount / blocks),
    longCount = dataCount % blocks;
  const parts = [];
  let k = 0;
  for (let b = 0; b < blocks; b++) {
    const len = shortLen + (b >= blocks - longCount ? 1 : 0);
    const block = data.slice(k, k + len);
    k += len;
    parts.push({ data: block, ec: reedSolomon(block, ecPerBlock) });
  }
  const out = [];
  for (let i = 0; i <= shortLen; i++) for (const p of parts) if (i < p.data.length) out.push(p.data[i]);
  for (let i = 0; i < ecPerBlock; i++) for (const p of parts) out.push(p.ec[i]);
  return out;
}

// ---------- matrix ----------
const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function base(version) {
  const size = 17 + 4 * version;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (r, c, dark) => {
    m[r][c] = dark;
    fn[r][c] = true;
  };
  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++)
      for (let c = -1; c <= 7; c++) {
        const rr = r0 + r,
          cc = c0 + c;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
        set(rr, cc, ring !== 2 && ring !== 4);
      }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const al = ALIGN[version];
  for (const r of al)
    for (const c of al) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
  // Reserve format areas (filled later) and the dark module.
  for (let i = 0; i < 9; i++) {
    fn[8][i] = fn[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    fn[8][size - 1 - i] = fn[size - 1 - i][8] = true;
  }
  set(size - 8, 8, true);
  return { size, m, fn };
}

function place(matrix, data) {
  const { size, m, fn } = matrix;
  let bit = 0;
  const total = data.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? size - 1 - v : v;
        if (fn[r][c]) continue;
        m[r][c] = bit < total ? ((data[bit >>> 3] >>> (7 - (bit & 7))) & 1) === 1 : false;
        bit++;
      }
    }
  }
}

function formatBits(mask) {
  const data = (0b00 << 3) | mask; // level M = 00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}
function drawFormat({ size, m }, mask) {
  const bits = formatBits(mask);
  const b = (i) => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) m[i][8] = b(i);
  m[7][8] = b(6);
  m[8][8] = b(7);
  m[8][7] = b(8);
  for (let i = 9; i < 15; i++) m[8][14 - i] = b(i);
  for (let i = 0; i < 8; i++) m[8][size - 1 - i] = b(i);
  for (let i = 8; i < 15; i++) m[size - 15 + i][8] = b(i);
  m[size - 8][8] = true;
}

function penalty(m) {
  const size = m.length;
  let score = 0;
  const lines = (get) => {
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b <= size; b++) {
        if (b < size && get(a, b) === get(a, b - 1)) run++;
        else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      for (let b = 0; b + 10 < size; b++) {
        const seq = Array.from({ length: 11 }, (_, i) => (get(a, b + i) ? 1 : 0)).join("");
        if (seq === "10111010000" || seq === "00001011101") score += 40;
      }
    }
  };
  lines((r, c) => m[r][c]);
  lines((c, r) => m[r][c]);
  for (let r = 0; r + 1 < size; r++)
    for (let c = 0; c + 1 < size; c++) {
      const v = m[r][c];
      if (v === m[r + 1][c] && v === m[r][c + 1] && v === m[r + 1][c + 1]) score += 3;
    }
  const dark = m.flat().filter(Boolean).length;
  score += Math.floor(Math.abs((dark * 20) / (size * size) - 10)) * 10;
  return score;
}

// Returns the module matrix (true = dark), without the quiet zone.
export function qrMatrix(text) {
  const bytes = [...Buffer.from(String(text), "utf8")];
  const version = Object.keys(VERSIONS)
    .map(Number)
    .find((v) => {
      const [total, ec, blocks] = VERSIONS[v];
      return 4 + 8 + bytes.length * 8 <= (total - ec * blocks) * 8;
    });
  if (!version) throw new Error("Text zu lang für den QR-Code.");
  const data = codewords(bytes, version);
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const matrix = base(version);
    place(matrix, data);
    for (let r = 0; r < matrix.size; r++) for (let c = 0; c < matrix.size; c++) if (!matrix.fn[r][c] && MASKS[mask](r, c)) matrix.m[r][c] = !matrix.m[r][c];
    drawFormat(matrix, mask);
    const score = penalty(matrix.m);
    if (!best || score < best.score) best = { score, m: matrix.m, mask, version };
  }
  return { version: best.version, mask: best.mask, modules: best.m };
}
