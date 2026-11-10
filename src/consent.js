// Pure helpers of the customer form (no DOM), shared by app.js and the unit tests.

// Completed years between two ISO dates (YYYY-MM-DD).
export function ageAt(birth, reference) {
  const [by, bm, bd] = birth.split("-").map(Number),
    [ry, rm, rd] = reference.split("-").map(Number);
  return ry - by - (rm < bm || (rm === bm && rd < bd) ? 1 : 0);
}

// Valid birth date for an adult customer: today and on the appointment date (if given).
export function birthDateValid(birth, today, appointment = "") {
  return (
    !!birth &&
    /^\d{4}-\d{2}-\d{2}$/.test(birth) &&
    birth >= "1900-01-01" &&
    birth <= today &&
    ageAt(birth, today) >= 18 &&
    (!appointment || ageAt(birth, appointment) >= 18)
  );
}

// Euros as integer cents so subtraction never introduces rounding errors.
// "" -> null (not given), invalid -> NaN.
export function moneyCents(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!/^\d{1,7}(?:[,.]\d{1,2})?$/.test(text)) return NaN;
  const [euros, cents = ""] = text.split(/[,.]/);
  return Number(euros) * 100 + Number(cents.padEnd(2, "0"));
}

// Two initials from the first two words that start with a letter or digit
// ("Atelier (Nord)" -> "AN", "Łukasz Ćwik" -> "ŁĆ").
export function studioInitials(name, fallback = "IS") {
  const letters = String(name ?? "")
    .normalize("NFC")
    .split(/\s+/)
    .map((word) => word.match(/[\p{L}\p{N}]/u)?.[0])
    .filter(Boolean)
    .slice(0, 2);
  return letters.length ? letters.join("").toLocaleUpperCase("de-DE") : fallback;
}

// File-name part from customer names: letters and digits of any script are kept.
export function fileSlug(text, max = 100) {
  return String(text ?? "")
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}_-]/gu, "_")
    .slice(0, max);
}
