if ("serviceWorker" in navigator && window.isSecureContext && location.protocol !== "file:") {
  const updateStatus = (ready, text) => {
    document.documentElement.dataset.offlineReady = String(ready);
    const status = document.getElementById("offline-status");
    if (status) status.textContent = text;
    document.querySelectorAll("[data-offline-status]").forEach((node) => {
      node.textContent = text;
    });
  };
  updateStatus(false, "Offline-Nutzung wird vorbereitet …");
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "INKFORM_OFFLINE_READY")
      updateStatus(true, "Offline bereit – im Flugmodus testen.");
  });
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./sw.js");
      const registration = await navigator.serviceWorker.ready;
      registration.active?.postMessage({ type: "CHECK_OFFLINE" });
    } catch (error) {
      updateStatus(false, "Offline-Vorbereitung fehlgeschlagen. Vor Einsatz erneut online öffnen.");
      console.info("Offline-App konnte nicht vorbereitet werden:", error.message);
    }
  });
}
