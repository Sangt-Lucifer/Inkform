import { applyTexts, t } from "./i18n.js";

export const ADMIN_PIN_KEY = "inkform.admin.pin.v1";
// Failed attempts and the lockout survive a reload, so reloading does not reset the counter.
export const ADMIN_LOCK_KEY = "inkform.admin.lock.v1";
export const MAX_PIN_FAILURES = 5;
export const PIN_LOCK_MS = 30000;
// Known limits (accepted, see README "PIN-Sperre"): with two app windows open at the same time AND
// failing storage writes, one window can overwrite a lock the other just set; with two windows
// correcting a set-back clock at different moments, a running lock can last up to one extra
// period. On the iPad the home-screen app runs in a single window, where all cases are handled.
export function createPinLockout(storage, now = () => Date.now()) {
  // Normally the stored record wins, so a reload or a second window sees the same counter.
  // If a write fails (e.g. storage full), memory becomes authoritative; the stored record seen at
  // that moment is remembered as stale. Only a newer record (written by another window) is merged
  // in, and then without dropping a lock or failures from either side.
  let memory = { failures: 0, blockedUntil: 0 },
    unsynced = false,
    staleRaw = null;
  const raw = () => {
    try {
      return storage.getItem(ADMIN_LOCK_KEY);
    } catch (_) {
      return null;
    }
  };
  function parse(text) {
    try {
      const value = JSON.parse(text || "null");
      if (
        value &&
        Number.isInteger(value.failures) &&
        value.failures >= 0 &&
        Number.isFinite(value.blockedUntil)
      )
        return { failures: value.failures, blockedUntil: value.blockedUntil };
    } catch (_) {}
    return null;
  }
  function write(value) {
    memory = value;
    try {
      storage.setItem(ADMIN_LOCK_KEY, JSON.stringify(value));
      unsynced = false;
      staleRaw = null;
    } catch (_) {
      unsynced = true;
      staleRaw = raw();
    }
  }
  function read() {
    const current = raw();
    if (!unsynced) memory = parse(current) ?? memory;
    // Storage unchanged since our failed write: retry persisting our state (storage may work again).
    else if (current === staleRaw) write(memory);
    else {
      const saved = parse(current);
      staleRaw = current;
      if (saved) {
        const merged = {
          failures: Math.max(memory.failures, saved.failures),
          blockedUntil: Math.max(memory.blockedUntil, saved.blockedUntil),
        };
        if (merged.failures === saved.failures && merged.blockedUntil === saved.blockedUntil) {
          memory = saved;
          unsynced = false;
          staleRaw = null;
        } else write(merged);
      }
    }
    // A clock set back must not extend the lockout beyond one period. The corrected deadline is
    // stored (or kept in memory if storing fails), so it is not renewed on every check.
    if (memory.blockedUntil > now() + PIN_LOCK_MS)
      write({ failures: memory.failures, blockedUntil: now() + PIN_LOCK_MS });
    return memory;
  }
  return {
    remainingMs: () => Math.max(0, read().blockedUntil - now()),
    fail() {
      const current = read(),
        failures = current.failures + 1;
      if (failures >= MAX_PIN_FAILURES) write({ failures: 0, blockedUntil: now() + PIN_LOCK_MS });
      else write({ failures, blockedUntil: current.blockedUntil });
    },
    reset() {
      const current = read();
      if (current.failures || current.blockedUntil) write({ failures: 0, blockedUntil: 0 });
    },
  };
}
async function deriveAdminPinHash(pin, salt) {
  if (!globalThis.crypto?.subtle)
    throw Error(t("pin.noCrypto"));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: Uint8Array.from(salt), iterations: 150000, hash: "SHA-256" },
    key,
    256,
  );
  return [...new Uint8Array(bits)].map((n) => n.toString(16).padStart(2, "0")).join("");
}
export function createAdminPinStore(storage) {
  function config() {
    const raw = storage.getItem(ADMIN_PIN_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (
      value.version !== 1 ||
      !Array.isArray(value.salt) ||
      value.salt.length !== 16 ||
      !value.salt.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ||
      !/^[a-f0-9]{64}$/.test(value.hash)
    )
      throw Error(t("pin.damaged"));
    return value;
  }
  return {
    configured: () => !!config(),
    async setup(pin, repeat) {
      if (config()) throw Error(t("pin.exists"));
      if (/\D/.test(pin)) throw Error(t("pin.digitsOnly"));
      if (pin.length < 6) throw Error(t("pin.tooShort"));
      if (pin.length > 12) throw Error(t("pin.tooLong"));
      if (!/^\d{6,12}$/.test(pin)) throw Error(t("pin.length"));
      if (pin !== repeat) throw Error(t("pin.mismatch"));
      const salt = [...crypto.getRandomValues(new Uint8Array(16))],
        hash = await deriveAdminPinHash(pin, salt);
      if (config())
        throw Error(t("pin.otherWindow"));
      storage.setItem(ADMIN_PIN_KEY, JSON.stringify({ version: 1, salt, hash }));
    },
    async verify(pin) {
      const c = config();
      return !!c && /^\d{6,12}$/.test(pin) && (await deriveAdminPinHash(pin, c.salt)) === c.hash;
    },
  };
}
export function createAdminAccess({ storage, onExternalLock, now = () => Date.now() }) {
  const pins = createAdminPinStore(storage),
    lockout = createPinLockout(storage, now);
  let unlocked = false,
    pending = null,
    busy = false,
    epoch = 0;
  const dialog = document.createElement("dialog");
  dialog.id = "admin-pin-dialog";
  dialog.setAttribute("aria-labelledby", "admin-pin-title");
  dialog.innerHTML = `<div class="dialog-head"><h2 id="admin-pin-title" data-t="completion.unlock"></h2><button class="close-button" type="button" id="admin-pin-close" data-t-aria-label="common.closeDialog">×</button></div>
  <form id="admin-pin-form" class="dialog-body" novalidate><p id="admin-pin-copy" class="ad-section-copy"></p><div class="ad-fields">
  <div class="ad-field"><label for="admin-pin" data-t="pin.label"></label><input id="admin-pin" name="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="12" required></div>
  <div class="ad-field" id="admin-pin-repeat-field"><label for="admin-pin-repeat" data-t="pin.repeat"></label><input id="admin-pin-repeat" name="repeat" type="password" inputmode="numeric" autocomplete="off" maxlength="12"></div></div>
  <p id="admin-pin-error" class="ad-error" role="alert" hidden></p><div class="dialog-actions"><button class="primary-button" type="submit" id="admin-pin-submit" data-t="pin.unlock"></button></div>
  <p class="ad-preview-note" data-t="pin.note"></p></form>`;
  applyTexts(dialog);
  document.body.append(dialog);
  const form = dialog.querySelector("form"),
    errorNode = dialog.querySelector("#admin-pin-error");
  function close() {
    epoch++;
    pending = null;
    form.reset();
    dialog.close();
  }
  dialog.querySelector("#admin-pin-close").addEventListener("click", close);
  // Only digits can be entered (also pasted text); a removed character is explained at once.
  for (const input of [form.elements.pin, form.elements.repeat])
    input.addEventListener("input", () => {
      const digits = input.value.replace(/\D/g, "");
      if (digits === input.value) return;
      input.value = digits;
      errorNode.textContent = t("pin.digitsOnly");
      errorNode.hidden = false;
    });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    const token = epoch,
      button = dialog.querySelector("#admin-pin-submit");
    button.disabled = true;
    errorNode.hidden = true;
    try {
      const wait = lockout.remainingMs();
      if (wait)
        throw Error(t("pin.wait", { anzahl: Math.ceil(wait / 1000) }));
      const configured = pins.configured();
      if (configured) {
        if (!(await pins.verify(form.elements.pin.value))) {
          lockout.fail();
          throw Error(
            t(lockout.remainingMs() ? "pin.wrongLocked" : "pin.wrong"),
          );
        }
      } else await pins.setup(form.elements.pin.value, form.elements.repeat.value);
      if (token !== epoch || !dialog.open) return;
      lockout.reset();
      unlocked = true;
      const action = pending;
      pending = null;
      form.reset();
      dialog.close();
      action?.();
    } catch (error) {
      if (token === epoch) {
        errorNode.textContent = error.message;
        errorNode.hidden = false;
      }
    } finally {
      busy = false;
      button.disabled = false;
    }
  });
  function request(action) {
    if (unlocked) {
      action();
      return;
    }
    pending = action;
    epoch++;
    form.reset();
    errorNode.hidden = true;
    try {
      const configured = pins.configured();
      dialog.querySelector("#admin-pin-title").textContent = t(configured ? "completion.unlock" : "pin.setupTitle");
      dialog.querySelector("#admin-pin-copy").textContent = t(configured ? "pin.copy" : "pin.setupCopy");
      dialog.querySelector("#admin-pin-repeat-field").hidden = configured;
      dialog.querySelector("#admin-pin-submit").textContent = t(configured ? "pin.unlock" : "pin.save");
    } catch (error) {
      errorNode.textContent = error.message;
      errorNode.hidden = false;
    }
    if (!dialog.open) dialog.showModal();
    form.elements.pin.focus();
  }
  function lock() {
    unlocked = false;
    close();
  }
  window.addEventListener("storage", (event) => {
    if (event.key === ADMIN_PIN_KEY || event.key === null) {
      lock();
      onExternalLock?.();
    }
  });
  return { request, lock, isUnlocked: () => unlocked, configured: pins.configured };
}
