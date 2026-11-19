import { t } from "./i18n.js";

// The last update checks with the network state the browser reported, for „Offline-Details“.
const UPDATE_CHECKS_KEY = "inkform.update-checks.v1";
// Day of the last automatic check: the app asks by itself only once a day.
const UPDATE_DAY_KEY = "inkform.update-day.v1";
const today = () => new Date().toDateString();
function askedToday() {
  try {
    return localStorage.getItem(UPDATE_DAY_KEY) === today();
  } catch {
    return false;
  }
}
function noteUpdateCheck(reason, asked) {
  try {
    const checks = JSON.parse(localStorage.getItem(UPDATE_CHECKS_KEY) || "[]");
    checks.push({ at: new Date().toISOString(), reason, online: navigator.onLine, asked });
    localStorage.setItem(UPDATE_CHECKS_KEY, JSON.stringify(checks.slice(-5)));
  } catch {}
}
// Only the hosted app has this script; the single file reads none.
window.inkformUpdateChecks = () => {
  try {
    return JSON.parse(localStorage.getItem(UPDATE_CHECKS_KEY) || "[]");
  } catch {
    return [];
  }
};

// Whether the cached app is newer than this page: the worker took over after this page started
// (e.g. while the app lay in the background), so only reloading shows the new version.
async function pageOutdated(scope) {
  const own = document.querySelector('meta[name="inkform-page"]')?.content;
  const cached = await caches.match(new URL("index.html", scope).href);
  if (!own || !cached) return false;
  const copy = /<meta name="inkform-page" content="([0-9a-f]+)"/.exec(await cached.text());
  return !!copy && copy[1] !== own;
}

if ("serviceWorker" in navigator && window.isSecureContext && location.protocol !== "file:") {
  const updateStatus = (ready, text) => {
    document.documentElement.dataset.offlineReady = String(ready);
    const status = document.getElementById("offline-status");
    if (status) status.textContent = text;
    document.querySelectorAll("[data-offline-status]").forEach((node) => {
      node.textContent = text;
    });
  };
  updateStatus(false, t("offline.preparing"));
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "INKFORM_OFFLINE_READY")
      updateStatus(true, t("offline.ready"));
  });
  window.addEventListener("load", async () => {
    try {
      const registered = await navigator.serviceWorker.register("./sw.js");
      // A newer version is installed and waiting: let it take over as soon as the app is idle.
      const takeOver = () => {
        if (registered.waiting && navigator.serviceWorker.controller && window.inkformIdle?.())
          registered.waiting.postMessage({ type: "SKIP_WAITING" });
      };
      registered.addEventListener("updatefound", () =>
        registered.installing?.addEventListener("statechange", takeOver),
      );
      // Safari does not look for a new worker by itself; without asking, an installed app would
      // never get an update. Each request shows iPadOS's airplane mode notice when offline, and
      // navigator.onLine stays true there. So the app asks by itself only at its first start of
      // the day, and only between customers; otherwise via „Nach Update suchen“.
      const lookForUpdate = (reason) => {
        if (askedToday()) return;
        const asked = navigator.onLine && window.inkformIdle?.() !== false;
        noteUpdateCheck(reason, asked);
        if (!asked) return;
        try {
          localStorage.setItem(UPDATE_DAY_KEY, today());
        } catch {}
        registered.update().catch(() => {});
      };
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") lookForUpdate("visible");
      });
      lookForUpdate("start");
      // „Nach Update suchen“: "loading" (the page reloads into the new version), "busy" (found,
      // but a form or unsaved change holds it up), "none", or a rejection without connection.
      // Being idle is checked again after the installation and right before the reload; new
      // input then holds the update back ("busy", or the event "inkform-update-deferred").
      let reloadOnTakeOver = false,
        tookOver = false;
      window.inkformLookForUpdate = async () => {
        noteUpdateCheck("button", true);
        await registered.update();
        const next = registered.installing || registered.waiting;
        if (!next && !tookOver && !(await pageOutdated(registered.scope))) return "none";
        if (!window.inkformIdle?.()) return "busy";
        if (!next) {
          location.reload();
          return "loading";
        }
        reloadOnTakeOver = true;
        try {
          await new Promise((resolve, reject) => {
            const check = () => {
              if (next.state === "redundant") reject(Error("redundant"));
              else if (next.state !== "installing") resolve();
            };
            next.addEventListener("statechange", check);
            check();
          });
        } catch (error) {
          // A failed installation leaves no wish to reload behind.
          reloadOnTakeOver = false;
          throw error;
        }
        // Installing takes a while: a customer may have started a form meanwhile.
        if (!window.inkformIdle?.()) {
          reloadOnTakeOver = false;
          return "busy";
        }
        next.postMessage({ type: "SKIP_WAITING" });
        return "loading";
      };
      setInterval(takeOver, 15000);
      takeOver();
      const firstController = navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        tookOver = Boolean(firstController);
        // Checked again right before reloading: input made since the button was tapped stays.
        if (reloadOnTakeOver && window.inkformIdle?.()) {
          location.reload();
          return;
        }
        if (reloadOnTakeOver) {
          reloadOnTakeOver = false;
          window.dispatchEvent(new Event("inkform-update-deferred"));
        }
        navigator.serviceWorker.ready.then((r) => r.active?.postMessage({ type: "CHECK_OFFLINE" }));
      });
      const registration = await navigator.serviceWorker.ready;
      registration.active?.postMessage({ type: "CHECK_OFFLINE" });
    } catch (error) {
      updateStatus(false, t("offline.failed"));
      console.info("Offline-App konnte nicht vorbereitet werden:", error.message);
    }
  });
}
