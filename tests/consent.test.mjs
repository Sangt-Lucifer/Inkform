// Pure customer-form logic from app.js (src/consent.js).
import assert from "node:assert/strict";
import test from "node:test";
import { ageAt, birthDateValid, fileSlug, moneyCents, studioInitials } from "../src/consent.js";

test("age counts completed years, including leap days", () => {
  assert.equal(ageAt("2008-11-10", "2026-11-10"), 18);
  assert.equal(ageAt("2008-11-11", "2026-11-10"), 17);
  assert.equal(ageAt("2008-02-29", "2026-02-28"), 17);
  assert.equal(ageAt("2008-02-29", "2026-03-01"), 18);
});

test("birth date: adult today and on the appointment, plausible range", () => {
  const today = "2026-11-10";
  assert.equal(birthDateValid("1990-01-02", today), true);
  assert.equal(birthDateValid("2008-11-10", today), true);
  assert.equal(birthDateValid("2008-11-11", today), false, "17 today");
  assert.equal(birthDateValid("2008-11-11", today, "2026-11-12"), false, "17 today, 18 at appointment");
  assert.equal(birthDateValid("2008-11-10", today, "2026-11-09"), false, "appointment before 18th birthday");
  assert.equal(birthDateValid("1899-12-31", today), false);
  assert.equal(birthDateValid("2030-01-01", today), false);
  assert.equal(birthDateValid("", today), false);
  assert.equal(birthDateValid("10.11.1990", today), false);
});

test("money: euros to cents without float errors; empty is null, invalid is NaN", () => {
  assert.equal(moneyCents("450,50"), 45050);
  assert.equal(moneyCents("450.5"), 45050);
  assert.equal(moneyCents(" 0 "), 0);
  assert.equal(moneyCents("0,1") + moneyCents("0,2"), 30);
  assert.equal(moneyCents(""), null);
  assert.equal(moneyCents(undefined), null);
  for (const bad of ["-5", "1.000,00", "12,345", "abc", "12345678", "1e3"]) assert.ok(Number.isNaN(moneyCents(bad)), bad);
});

test("studio initials skip punctuation and keep non-ASCII letters", () => {
  assert.equal(studioInitials("Musterstudio (Beispiel)"), "MB");
  assert.equal(studioInitials("Musterstudio (Beispiel) · Max Mustermann"), "MB");
  assert.equal(studioInitials("Łukasz Ćwik"), "ŁĆ");
  assert.equal(studioInitials("ink & art"), "IA");
  assert.equal(studioInitials("  "), "IS");
  assert.equal(studioInitials("— ·"), "IS");
});

test("file names keep letters of any script and replace everything else", () => {
  assert.equal(fileSlug("Şahin_Gül"), "Şahin_Gül");
  assert.equal(fileSlug("Yıldız_Ayşe"), "Yıldız_Ayşe");
  assert.equal(fileSlug("O'Brien/../x y"), "O_Brien____x_y");
  assert.equal(fileSlug("a".repeat(150)).length, 100);
});
