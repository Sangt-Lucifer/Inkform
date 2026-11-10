export const ADMIN_PIN_KEY = "inkform.admin.pin.v1";
// Failed attempts and the lockout survive a reload, so reloading does not reset the counter.
export const ADMIN_LOCK_KEY = "inkform.admin.lock.v1";
export const MAX_PIN_FAILURES = 5;
export const PIN_LOCK_MS = 30000;
export function createPinLockout(storage, now = () => Date.now()) {
  let memory = { failures: 0, blockedUntil: 0 };
  function read() {
    try {
      const value = JSON.parse(storage.getItem(ADMIN_LOCK_KEY) || "null");
      if (
        value &&
        Number.isInteger(value.failures) &&
        value.failures >= 0 &&
        Number.isFinite(value.blockedUntil)
      )
        memory = { failures: value.failures, blockedUntil: value.blockedUntil };
    } catch (_) {}
    // A clock set back must not extend the lockout beyond one period.
    if (memory.blockedUntil > now() + PIN_LOCK_MS) memory.blockedUntil = now() + PIN_LOCK_MS;
    return memory;
  }
  function write(value) {
    memory = value;
    try {
      storage.setItem(ADMIN_LOCK_KEY, JSON.stringify(value));
    } catch (_) {}
  }
  return {
    remainingMs: () => Math.max(0, read().blockedUntil - now()),
    fail() {
      const failures = read().failures + 1;
      if (failures >= MAX_PIN_FAILURES) write({ failures: 0, blockedUntil: now() + PIN_LOCK_MS });
      else write({ failures, blockedUntil: read().blockedUntil });
    },
    reset() {
      const current = read();
      if (current.failures || current.blockedUntil) write({ failures: 0, blockedUntil: 0 });
    },
  };
}
export async function deriveAdminPinHash(pin, salt) {
  if (!globalThis.crypto?.subtle)
    throw Error("Bitte einen aktuellen Browser mit lokaler WebCrypto-Unterstützung verwenden.");
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
      throw Error(
        "Die lokale PIN-Konfiguration ist beschädigt. Vorhandene Daten werden nicht überschrieben. Bitte die separate Einnahmensicherung auf einem anderen Browser wiederherstellen.",
      );
    return value;
  }
  return {
    configured: () => !!config(),
    async setup(pin, repeat) {
      if (config()) throw Error("Für diesen Browser ist bereits eine PIN eingerichtet.");
      if (!/^\d{6,12}$/.test(pin)) throw Error("Bitte eine PIN mit 6 bis 12 Ziffern wählen.");
      if (pin !== repeat) throw Error("Die beiden PIN-Eingaben stimmen nicht überein.");
      const salt = [...crypto.getRandomValues(new Uint8Array(16))],
        hash = await deriveAdminPinHash(pin, salt);
      if (config())
        throw Error(
          "In einem anderen Fenster wurde bereits eine PIN eingerichtet. Bitte neu öffnen.",
        );
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
  dialog.innerHTML = `<div class="dialog-head"><h2 id="admin-pin-title">Studio entsperren</h2><button class="close-button" type="button" id="admin-pin-close" aria-label="Dialog schließen">×</button></div>
  <form id="admin-pin-form" class="dialog-body" novalidate><p id="admin-pin-copy" class="ad-section-copy"></p><div class="ad-fields">
  <div class="ad-field"><label for="admin-pin">PIN (6 bis 12 Ziffern)</label><input id="admin-pin" name="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="12" required></div>
  <div class="ad-field" id="admin-pin-repeat-field"><label for="admin-pin-repeat">PIN wiederholen</label><input id="admin-pin-repeat" name="repeat" type="password" inputmode="numeric" autocomplete="off" maxlength="12"></div></div>
  <p id="admin-pin-error" class="ad-error" role="alert" hidden></p><div class="dialog-actions"><button class="primary-button" type="submit" id="admin-pin-submit">Entsperren</button></div>
  <p class="ad-preview-note">Die PIN schützt die Admin-Oberfläche auf diesem Gerät. Sie verschlüsselt keine Browserdaten und ersetzt keine Gerätesperre. Es gibt keinen Online-Reset. Einnahmen regelmäßig separat sichern.</p></form>`;
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
        throw Error(`Zu viele Fehlversuche. Bitte noch ${Math.ceil(wait / 1000)} Sekunden warten.`);
      const configured = pins.configured();
      if (configured) {
        if (!(await pins.verify(form.elements.pin.value))) {
          lockout.fail();
          throw Error(
            lockout.remainingMs()
              ? "PIN nicht korrekt. Zu viele Fehlversuche: Bitte 30 Sekunden warten."
              : "PIN nicht korrekt.",
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
      dialog.querySelector("#admin-pin-title").textContent = configured
        ? "Studio entsperren"
        : "PIN bei der ersten Einrichtung festlegen";
      dialog.querySelector("#admin-pin-copy").textContent = configured
        ? "Nur der Inhaber darf den Admin-Bereich öffnen. Bitte die lokale PIN eingeben."
        : "Lege als Inhaber jetzt die PIN für den gesamten Admin-Bereich fest. Gib diese PIN nicht an Kunden weiter und verwahre sie sicher.";
      dialog.querySelector("#admin-pin-repeat-field").hidden = configured;
      dialog.querySelector("#admin-pin-submit").textContent = configured
        ? "Entsperren"
        : "PIN lokal speichern";
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
