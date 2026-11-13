import { t } from "./i18n.js";

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
      // background; without asking, an installed app would never get an update.
      const lookForUpdate = () => registered.update().catch(() => {});
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") lookForUpdate();
      });
      lookForUpdate();
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
