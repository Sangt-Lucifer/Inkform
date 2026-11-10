import test from "node:test";
import assert from "node:assert/strict";
import { createAdminPinStore, ADMIN_PIN_KEY } from "../src/access.js";
const memory = () => {
  const map = new Map();
  return { getItem: (k) => map.get(k) || null, setItem: (k, v) => map.set(k, v) };
};
test("first setup requires matching six-or-more digit PIN", async () => {
  const p = createAdminPinStore(memory());
  await assert.rejects(p.setup("123", "123"));
  await assert.rejects(p.setup("123456", "654321"));
  assert.equal(p.configured(), false);
});
test("PIN is salted and hashed, never persisted as plaintext", async () => {
  const storage = memory(),
    p = createAdminPinStore(storage);
  await p.setup("839274", "839274");
  const config = JSON.parse(storage.getItem(ADMIN_PIN_KEY));
  assert.equal(config.hash.length, 64);
  assert.equal(config.salt.length, 16);
  assert.equal(storage.getItem(ADMIN_PIN_KEY).includes("839274"), false);
  assert.equal(await p.verify("839274"), true);
  assert.equal(await p.verify("000000"), false);
});
test("existing PIN cannot be silently replaced", async () => {
  const p = createAdminPinStore(memory());
  await p.setup("839274", "839274");
  await assert.rejects(p.setup("111111", "111111"));
  assert.equal(await p.verify("839274"), true);
});
test("blocked storage and malformed PIN configuration fail closed", async () => {
  const p = createAdminPinStore({
    getItem: () => null,
    setItem: () => {
      throw Error("blocked");
    },
  });
  await assert.rejects(p.setup("839274", "839274"), /blocked/);
  const broken = createAdminPinStore({ getItem: () => "{bad" });
  assert.throws(() => broken.configured());
  await assert.rejects(broken.verify("839274"));
});

// ---------- persistent lockout (Phase 3) ----------
import { createPinLockout, ADMIN_LOCK_KEY, MAX_PIN_FAILURES, PIN_LOCK_MS } from "../src/access.js";

test("five failures lock for 30 seconds, and a reload (new instance) keeps the lock", () => {
  const storage = memory();
  let clock = 1_000_000;
  const now = () => clock;
  const first = createPinLockout(storage, now);
  for (let i = 0; i < MAX_PIN_FAILURES - 1; i++) first.fail();
  assert.equal(first.remainingMs(), 0);
  // Reload after four failures: the counter is not reset.
  const reloaded = createPinLockout(storage, now);
  reloaded.fail();
  assert.equal(reloaded.remainingMs(), PIN_LOCK_MS);
  // Reload during the lock: still locked.
  clock += 10_000;
  assert.equal(createPinLockout(storage, now).remainingMs(), PIN_LOCK_MS - 10_000);
  clock += PIN_LOCK_MS;
  assert.equal(createPinLockout(storage, now).remainingMs(), 0);
});

test("a correct PIN resets the failure counter", () => {
  const storage = memory(),
    now = () => 5000,
    lock = createPinLockout(storage, now);
  for (let i = 0; i < MAX_PIN_FAILURES - 1; i++) lock.fail();
  lock.reset();
  lock.fail();
  assert.equal(lock.remainingMs(), 0);
  assert.deepEqual(JSON.parse(storage.getItem(ADMIN_LOCK_KEY)), { failures: 1, blockedUntil: 0 });
});

test("setting the clock back cannot extend the lock beyond one period", () => {
  const storage = memory();
  let clock = 10_000_000;
  const lock = createPinLockout(storage, () => clock);
  for (let i = 0; i < MAX_PIN_FAILURES; i++) lock.fail();
  clock -= 3_600_000;
  assert.equal(lock.remainingMs(), PIN_LOCK_MS);
});

test("lockout still works in memory when storage is blocked or corrupt", () => {
  const blocked = {
    getItem: () => "{kaputt",
    setItem: () => {
      throw Error("blocked");
    },
  };
  const lock = createPinLockout(blocked, () => 0);
  for (let i = 0; i < MAX_PIN_FAILURES; i++) lock.fail();
  assert.equal(lock.remainingMs(), PIN_LOCK_MS);
});

// ---------- Review findings ----------
test("readable but unwritable storage (e.g. full) still locks after five failures", () => {
  const map = new Map([[ADMIN_LOCK_KEY, JSON.stringify({ failures: 0, blockedUntil: 0 })]]);
  const storage = { getItem: (k) => map.get(k) ?? null, setItem: () => { throw Error("QuotaExceededError"); } };
  const lock = createPinLockout(storage, () => 1000);
  for (let i = 0; i < MAX_PIN_FAILURES; i++) lock.fail();
  assert.equal(lock.remainingMs(), PIN_LOCK_MS);
  for (let i = 0; i < 20; i++) lock.fail();
  assert.ok(lock.remainingMs() > 0);
});

test("after the clock is set back, the lock still ends one period later (checked repeatedly)", () => {
  const storage = memory();
  let clock = 10_000_000;
  const lock = createPinLockout(storage, () => clock);
  for (let i = 0; i < MAX_PIN_FAILURES; i++) lock.fail();
  clock -= 3_600_000; // one hour back
  assert.equal(lock.remainingMs(), PIN_LOCK_MS);
  clock += 10_000;
  assert.equal(lock.remainingMs(), PIN_LOCK_MS - 10_000);
  clock += 25_000;
  assert.equal(lock.remainingMs(), 0, "not renewed by repeated checks");
  assert.equal(createPinLockout(storage, () => clock).remainingMs(), 0, "nor by a reload");
});

test("a window whose write failed does not ignore or overwrite another window's lock (re-review)", () => {
  const map = new Map();
  let broken = true;
  const storage = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      if (broken) throw Error("QuotaExceededError");
      map.set(k, v);
    },
  };
  const clock = () => 50_000;
  const first = createPinLockout(storage, clock);
  first.fail(); // write fails -> first is unsynced with 1 failure
  broken = false; // storage recovers
  const second = createPinLockout(storage, clock);
  for (let i = 0; i < MAX_PIN_FAILURES; i++) second.fail();
  assert.equal(second.remainingMs(), PIN_LOCK_MS);
  assert.equal(first.remainingMs(), PIN_LOCK_MS, "first window sees the lock");
  first.fail();
  assert.equal(second.remainingMs(), PIN_LOCK_MS, "lock not overwritten");
});
