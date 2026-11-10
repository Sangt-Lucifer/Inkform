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
