// Uncompressed ZIP ("stored") without a library: CRC-32, UTF-8 file names (flag bit 11), no ZIP64.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// DOS time and date in local time; the format covers the years 1980 to 2107.
function dosDateTime(date) {
  const year = date.getFullYear();
  if (year < 1980 || year > 2107) throw Error("ZIP-Dateien können nur Daten von 1980 bis 2107 speichern.");
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

// files: [{ name: "Ordner/Datei.pdf", data: Uint8Array }] -> Uint8Array of the ZIP file.
export function createZip(files, date = new Date()) {
  if (files.length > 0xffff) throw Error("Zu viele Dateien für eine ZIP-Datei.");
  const { time, day } = dosDateTime(date),
    encoder = new TextEncoder(),
    entries = files.map(({ name, data }) => ({ name: encoder.encode(name), data, crc: crc32(data) }));
  if (entries.some((e) => e.name.length > 0xffff)) throw Error("Ein Dateiname ist für eine ZIP-Datei zu lang.");
  const localSize = entries.reduce((sum, e) => sum + 30 + e.name.length + e.data.length, 0),
    centralSize = entries.reduce((sum, e) => sum + 46 + e.name.length, 0);
  if (localSize + centralSize + 22 > 0xffffffff) throw Error("Die ZIP-Datei wäre größer als 4 GB.");
  const out = new Uint8Array(localSize + centralSize + 22),
    view = new DataView(out.buffer);
  let pos = 0;
  const u16 = (v) => (view.setUint16(pos, v, true), (pos += 2)),
    u32 = (v) => (view.setUint32(pos, v, true), (pos += 4)),
    bytes = (b) => (out.set(b, pos), (pos += b.length));
  const header = (e) => {
    u16(20); // version needed: 2.0
    u16(0x0800); // file name is UTF-8
    u16(0); // stored
    u16(time);
    u16(day);
    u32(e.crc);
    u32(e.data.length);
    u32(e.data.length);
    u16(e.name.length);
    u16(0); // no extra field
  };
  for (const e of entries) {
    e.offset = pos;
    u32(0x04034b50);
    header(e);
    bytes(e.name);
    bytes(e.data);
  }
  const centralStart = pos;
  for (const e of entries) {
    u32(0x02014b50);
    u16(20); // made by: MS-DOS, 2.0
    header(e);
    u16(0); // comment
    u16(0); // disk
    u16(0); // internal attributes
    u32(0); // external attributes
    u32(e.offset);
    bytes(e.name);
  }
  u32(0x06054b50);
  u16(0);
  u16(0);
  u16(entries.length);
  u16(entries.length);
  u32(centralSize);
  u32(centralStart);
  u16(0);
  return out;
}
