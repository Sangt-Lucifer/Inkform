// Studio logo and home screen icon chosen on this device. Kept in IndexedDB: localStorage holds
// only a few megabytes, shared with the income list. Both are stored as PNG within their edge and
// byte limits; without one, the logo or icon built into the app is used. The icon is square and
// opaque: iPadOS fills transparent parts black.
import { t } from "./i18n.js";
import { crc32 } from "./zip.js";

export const LOGO_DB = "inkform-logo";
export const LOGO_KEY = "logo";
export const LOGO_EDGE = 512;
export const LOGO_MAX_BYTES = 300 * 1024;
export const ICON_KEY = "icon";
export const ICON_EDGE = 512;
const ICON_SMALLEST = 180;
export const ICON_MAX_BYTES = 300 * 1024;
export const ICON_BACKGROUNDS = { light: "#ffffff", dark: "#000000" };
const UPLOAD_MAX_MB = 20;
const PNG = [137, 80, 78, 71, 13, 10, 26, 10];
const isPng = (bytes) => PNG.every((b, i) => bytes[i] === b);
const isJpeg = (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

// Width and height of a complete PNG, or null: IHDR first, image data, IEND at the very end and
// every chunk's checksum right. Checked without decoding, so a restore can refuse a damaged
// logo before anything is written.
export function pngSize(bytes) {
  if (bytes.length < 57 || !isPng(bytes)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8,
    size = null,
    data = false;
  while (at + 12 <= bytes.length) {
    const length = view.getUint32(at),
      type = String.fromCharCode(...bytes.subarray(at + 4, at + 8)),
      end = at + 12 + length;
    if (end > bytes.length || crc32(bytes.subarray(at + 4, end - 4)) !== view.getUint32(end - 4)) return null;
    if (at === 8) {
      if (type !== "IHDR" || length !== 13) return null;
      size = { width: view.getUint32(16), height: view.getUint32(20) };
    } else if (type === "IDAT") data = true;
    else if (type === "IEND") return end === bytes.length && data ? size : null;
    at = end;
  }
  return null;
}

// A stored or restored logo: a PNG within the edge and byte limits.
export function checkLogo(bytes) {
  const size = pngSize(bytes);
  if (!size) throw Error(t("logo.notPng"));
  if (bytes.length > LOGO_MAX_BYTES || !size.width || !size.height || size.width > LOGO_EDGE || size.height > LOGO_EDGE)
    throw Error(t("logo.tooLarge", { pixel: LOGO_EDGE, kb: LOGO_MAX_BYTES / 1024 }));
  return bytes;
}

// A stored or restored icon: a square PNG between ICON_SMALLEST and ICON_EDGE within the byte limit.
export function checkIcon(bytes) {
  const size = pngSize(bytes);
  if (!size) throw Error(t("icon.notPng"));
  if (bytes.length > ICON_MAX_BYTES || size.width !== size.height || size.width < ICON_SMALLEST || size.width > ICON_EDGE)
    throw Error(t("icon.wrongSize", { min: ICON_SMALLEST, max: ICON_EDGE, kb: ICON_MAX_BYTES / 1024 }));
  return bytes;
}

// A PNG or JPEG chosen by the owner, recognised by its content.
async function decode(file) {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (!isPng(head) && !isJpeg(head)) throw Error(t("logo.wrongType"));
  if (file.size > UPLOAD_MAX_MB * 1024 * 1024) throw Error(t("logo.fileTooLarge", { mb: UPLOAD_MAX_MB }));
  try {
    return await createImageBitmap(file);
  } catch {
    throw Error(t("logo.unreadable"));
  }
}
const toPng = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, "image/png"));

// The logo, drawn smaller until it fits.
export async function shrinkLogo(file) {
  const image = await decode(file);
  try {
    for (const edge of [LOGO_EDGE, 384, 256, 192, 128]) {
      const scale = Math.min(1, edge / Math.max(image.width, image.height)),
        canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await toPng(canvas);
      if (blob && blob.size <= LOGO_MAX_BYTES) return blob;
    }
  } finally {
    image.close?.();
  }
  throw Error(t("logo.tooLarge", { pixel: LOGO_EDGE, kb: LOGO_MAX_BYTES / 1024 }));
}

// The icon: the largest square from the middle of the picture, on a light or dark background,
// drawn smaller until it fits.
export async function squareIcon(file, background = "light") {
  const image = await decode(file),
    side = Math.min(image.width, image.height);
  try {
    for (const edge of [ICON_EDGE, 384, 256, ICON_SMALLEST]) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = edge;
      const context = canvas.getContext("2d");
      context.fillStyle = ICON_BACKGROUNDS[background] ?? ICON_BACKGROUNDS.light;
      context.fillRect(0, 0, edge, edge);
      context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, edge, edge);
      const blob = await toPng(canvas);
      if (blob && blob.size <= ICON_MAX_BYTES) return blob;
    }
  } finally {
    image.close?.();
  }
  throw Error(t("icon.wrongSize", { min: ICON_SMALLEST, max: ICON_EDGE, kb: ICON_MAX_BYTES / 1024 }));
}
