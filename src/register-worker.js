import { t } from "./i18n.js";

// The last update checks with the network state the browser reported, for „Offline-Details“.
const UPDATE_CHECKS_KEY = "inkform.update-checks.v1";
function noteUpdateCheck(reason) {
  try {
    const checks = JSON.parse(localStorage.getItem(UPDATE_CHECKS_KEY) || "[]");
    checks.push({ at: new Date().toISOString(), reason, online: navigator.onLine });
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
      // Safari does not look for a new worker by itself when the app starts or returns from the
      // background; without asking, an installed app would never get an update. Not while
      // offline: in airplane mode iPadOS would answer the request with its own notice.
      const lookForUpdate = (reason) => {
        noteUpdateCheck(reason);
        if (navigator.onLine) registered.update().catch(() => {});
      };
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") lookForUpdate("visible");
      });
      window.addEventListener("online", () => lookForUpdate("online"));
      lookForUpdate("start");
      setInterval(takeOver, 15000);
      takeOver();
      navigator.serviceWorker.addEventListener("controllerchange", () =>
        navigator.serviceWorker.ready.then((r) => r.active?.postMessage({ type: "CHECK_OFFLINE" })),
      );
      const registration = await navigator.serviceWorker.ready;
      registration.active?.postMessage({ type: "CHECK_OFFLINE" });
    } catch (error) {
      updateStatus(false, t("offline.failed"));
      console.info("Offline-App konnte nicht vorbereitet werden:", error.message);
    }
  });
}
