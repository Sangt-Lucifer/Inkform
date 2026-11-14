// Small PNG images for tests.
import { crc32, deflateSync } from "node:zlib";

function chunk(type, data) {
  const len = Buffer.alloc(4),
    sum = Buffer.alloc(4),
    body = Buffer.concat([Buffer.from(type), data]);
  len.writeUInt32BE(data.length);
  sum.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, sum]);
}
// A plain single-colour RGB image.
export function solidPng(width, height = width, shade = 0x40) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, shade)]);
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
