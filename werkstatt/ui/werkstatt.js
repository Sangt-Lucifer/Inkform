// Inkform Werkstatt UI. All values are inserted as text (never as HTML).
const token = document.querySelector('meta[name="werkstatt-token"]').content;
const $ = (id) => document.getElementById(id);
let running = null,
  offset = 0;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "X-Werkstatt-Token": token, "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Fehler ${response.status}`);
  return data;
}
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("data-")) node.setAttribute(k, v);
    else node[k] = v;
  }
  for (const c of children.flat()) if (c != null) node.append(c instanceof Node ? c : String(c));
  return node;
}
const date = (iso) =>
  iso ? new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "–";
function showError(message) {
  $("error").textContent = message || "";
  $("error").hidden = !message;
}

const BUILD = {
  aktuell: ["ok", "aktuell"],
  veraltet: ["warn", "veraltet – neu bauen"],
  fehlt: ["warn", "noch nicht gebaut"],
  fehler: ["bad", "Fehler beim Prüfen"],
};
function runLine(label, run) {
  if (!run) return el("li", {}, el("span", { class: "label" }, label), el("span", { class: "muted" }, "noch nicht gelaufen"));
  return el(
    "li",
    {},
    el("span", { class: "label" }, label),
    el("span", { class: `badge ${run.ok ? "ok" : "bad"}` }, run.ok ? "grün" : "rot"),
    el("span", { class: "muted" }, ` ${run.text} · ${date(run.at)}`),
  );
}

function card(s, busy) {
  const kindBadge =
    s.kind === "blanko"
      ? el("span", { class: "badge demo" }, "Blanko · Demo mit Musterstudio")
      : s.actionable
        ? el("span", { class: "badge" }, "Studio")
        : el("span", { class: "badge lock" }, "geschützt · nur Anzeige");
  const [buildClass, buildText] = BUILD[s.build?.state] ?? ["muted", "unbekannt"];
  const git = s.git?.repo
    ? `${s.git.clean ? "sauber" : `${s.git.changes} ungespeicherte Änderungen`} · ${s.git.commit} ${s.git.subject ?? ""}${s.git.remotes.length ? " · ACHTUNG: Remote vorhanden" : ""}`
    : "kein Git-Repo";
  const list = el(
    "ul",
    { class: "facts" },
    el("li", {}, el("span", { class: "label" }, "Ordner"), el("code", {}, s.folder)),
    el("li", {}, el("span", { class: "label" }, "Git"), el("span", {}, git)),
    el(
      "li",
      {},
      el("span", { class: "label" }, "Build"),
      el("span", { class: `badge ${buildClass}` }, buildText),
      el("span", { class: "muted" }, s.build?.builtAt ? ` · gebaut ${date(s.build.builtAt)}` : ""),
    ),
    runLine("Tests", s.runs?.test),
    runLine("Browser", s.runs?.browser),
    el("li", {}, el("span", { class: "label" }, "Export"), el("span", { class: "muted" }, "folgt in Phase 3")),
  );
  const warn = (s.warnings ?? []).map((w) => el("p", { class: "warn-text" }, w));
  const actions = s.actionable
    ? el(
        "div",
        { class: "actions" },
        ...[
          ["alles", "Bauen & alles prüfen", "primary"],
          ["build", "Nur bauen", ""],
          ["test", "Unit- & Leak-Tests", ""],
          ["browser", "Browser-Prüfungen", ""],
        ].map(([kind, label, cls]) =>
          el("button", { type: "button", class: cls, disabled: busy, "data-studio": s.key, "data-kind": kind }, label),
        ),
      )
    : el("p", { class: "lock-text" }, s.protectedReason);
  return el(
    "article",
    { class: "card", "data-key": s.key },
    el("div", { class: "card-head" }, el("h2", {}, s.name || s.id), kindBadge),
    list,
    ...warn,
    actions,
  );
}

async function load(refresh = false) {
  showError("");
  $("refresh").disabled = true;
  $("studios").setAttribute("aria-busy", "true");
  try {
    const data = await api(`/api/overview${refresh ? "?refresh=1" : ""}`);
    const busy = !!data.running;
    $("studios").replaceChildren(...data.studios.map((s) => card(s, busy)));
    if (data.cert) {
      $("cert").hidden = false;
      $("cert").className = `note${data.cert.daysLeft !== null && data.cert.daysLeft < 60 ? " warn-box" : ""}`;
      $("cert").textContent = `Vor-Ort-Zertifikat (bisher): ${data.cert.host} · gültig bis ${date(data.cert.until)} (${data.cert.daysLeft} Tage)`;
    } else $("cert").hidden = true;
    if (data.running && !running) follow(data.running.id);
  } catch (error) {
    showError(error.message);
  } finally {
    $("refresh").disabled = false;
    $("studios").removeAttribute("aria-busy");
  }
}

function renderSteps(steps) {
  $("run-steps").replaceChildren(
    ...steps.map((s) =>
      el(
        "li",
        {},
        el("span", { class: `badge ${s.ok ? "ok" : "bad"}` }, s.ok ? "grün" : "rot"),
        el("strong", {}, ` ${s.label}: `),
        s.text,
        ...(s.failing?.length ? [el("div", { class: "detail" }, "Fehlgeschlagen: ", s.failing.join(", "))] : []),
        ...(s.leaks?.length ? [el("div", { class: "detail bad-text" }, "Leak: ", s.leaks.join(" · "))] : []),
        ...(s.reasons?.length ? [el("div", { class: "detail" }, "Grund: ", s.reasons.join(" · "))] : []),
      ),
    ),
  );
}

async function follow(id) {
  running = id;
  offset = 0;
  $("run").hidden = false;
  $("run-log").textContent = "";
  while (running === id) {
    try {
      const r = await api(`/api/run?id=${encodeURIComponent(id)}&from=${offset}`);
      $("run-title").textContent = `${r.label} · ${r.name}`;
      $("run-log").textContent += r.log;
      offset = r.offset;
      renderSteps(r.steps);
      const done = !!r.endedAt;
      $("run-state").className = `badge ${done ? (r.ok ? "ok" : "bad") : "busy"}`;
      $("run-state").textContent = done ? (r.ok ? "alles grün" : "fehlgeschlagen") : "läuft …";
      if (done) {
        running = null;
        await load(true);
        break;
      }
    } catch (error) {
      showError(error.message);
      running = null;
      break;
    }
    await new Promise((r) => setTimeout(r, 700));
  }
}

$("studios").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-kind]");
  if (!button) return;
  showError("");
  try {
    const { id } = await api("/api/run", {
      method: "POST",
      body: JSON.stringify({ studio: button.dataset.studio, kind: button.dataset.kind }),
    });
    document.querySelectorAll("button[data-kind]").forEach((b) => (b.disabled = true));
    follow(id);
  } catch (error) {
    showError(error.message);
  }
});
$("refresh").addEventListener("click", () => load(true));
load(true);
