// Inkform Werkstatt UI. All values are inserted as text (never as HTML).
const token = document.querySelector('meta[name="werkstatt-token"]').content;
const $ = (id) => document.getElementById(id);
let running = null,
  offset = 0;

// The full answer, also for errors (some carry a list of reasons or checks).
async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "X-Werkstatt-Token": token, "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  return { ok: response.ok, status: response.status, data: await response.json().catch(() => ({})) };
}
async function api(path, options = {}) {
  const { ok, status, data } = await request(path, options);
  if (!ok) throw new Error(data.error || `Fehler ${status}`);
  return data;
}
const postJson = (body) => ({ method: "POST", body: JSON.stringify(body) });
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
    el(
      "li",
      {},
      el("span", { class: "label" }, "Export"),
      s.lastExport ? el("code", {}, s.lastExport.name) : el("span", { class: "muted" }, "noch keiner"),
    ),
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
        el("button", { type: "button", disabled: busy, "data-export": s.key, "data-name": s.name || s.id }, "Exportieren …"),
        el("button", { type: "button", "data-onsite": s.key, "data-name": s.name || s.id }, "Vor Ort …"),
      )
    : el("p", { class: "lock-text" }, s.protectedReason);
  const edit =
    s.kind === "studio" && s.actionable
      ? el(
          "div",
          { class: "actions" },
          el("button", { type: "button", disabled: busy, "data-edit": s.key }, "Profil bearbeiten"),
          s.git?.repo
            ? el("button", { type: "button", disabled: busy || (s.git.clean && s.git.commit), "data-commit": s.key, "data-name": s.name || s.id, "data-first": s.git.commit ? "" : "1" }, s.git.commit ? "Änderungen committen …" : "Ersten Commit anlegen …")
            : null,
        )
      : null;
  return el(
    "article",
    { class: "card", "data-key": s.key },
    el("div", { class: "card-head" }, el("h2", {}, s.name || s.id), kindBadge),
    list,
    ...warn,
    actions,
    edit,
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

async function startRun(button) {
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
}
$("refresh").addEventListener("click", () => load(true));

// ---------- profile editor ----------
let editing = null; // { key, version, textKeys, logo, dirty }
const form = $("editor-form");
const field = (name) => form.elements.namedItem(name);
const toBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};
const blobUrl = (base64) => (base64 ? URL.createObjectURL(new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: "image/png" })) : "");

function markerRow(marker = "") {
  const isRegex = typeof marker === "object" && marker !== null;
  const kind = el("select", { "aria-label": "Art" }, el("option", { value: "text" }, "Text"), el("option", { value: "regex" }, "Regex"));
  kind.value = isRegex ? "regex" : "text";
  const value = el("input", { value: isRegex ? marker.regex : marker, "aria-label": "Kennzeichen", maxLength: 200 });
  const flags = el("input", { value: isRegex ? (marker.flags ?? "i") : "", "aria-label": "Schalter", placeholder: "i", maxLength: 4, hidden: !isRegex });
  kind.addEventListener("change", () => (flags.hidden = kind.value !== "regex"));
  const remove = el("button", { type: "button", "aria-label": "Kennzeichen entfernen" }, "Entfernen");
  const row = el("div", { class: "marker" }, kind, value, flags, remove, el("p", { class: "probe muted" }));
  remove.addEventListener("click", () => {
    row.remove();
    editing.dirty = true;
  });
  return row;
}

function fill(data) {
  const d = data.draft;
  field("name").value = d.name;
  field("description").value = d.description;
  field("guide.header").value = d.guide.header;
  field("guide.date").value = d.guide.date;
  field("guide.author").value = d.guide.author;
  field("guideMd").value = d.guideMd;
  for (const k of ["name", "short_name", "description", "theme_color", "background_color"]) field(`manifest.${k}`).value = d.manifest[k];
  syncColors();
  $("markers").replaceChildren(...d.markers.map(markerRow));
  $("texts").replaceChildren(
    ...data.textKeys.map((k) =>
      el(
        "label",
        {},
        el("span", { class: "key" }, k),
        el("textarea", { name: `text.${k}`, rows: (d.text[k] ?? "").length > 140 ? 4 : 1, value: d.text[k] ?? "" }),
      ),
    ),
  );
  $("icon-192").src = blobUrl(data.icons[192]);
  $("icon-512").src = blobUrl(data.icons[512]);
  $("logo-preview").hidden = true;
  $("logo-file").value = "";
  $("logo-caption").textContent = "neues Logo";
}

function collect() {
  const value = (n) => field(n).value;
  return {
    name: value("name"),
    description: value("description"),
    markers: [...$("markers").querySelectorAll(".marker")]
      .map((row) => {
        const [kind, text, flags] = row.querySelectorAll("select, input");
        return kind.value === "regex" ? { regex: text.value, flags: flags.value || "i" } : text.value;
      })
      .filter((m) => (typeof m === "string" ? m !== "" : m.regex !== "")),
    guide: { header: value("guide.header"), date: value("guide.date"), author: value("guide.author") },
    text: Object.fromEntries(editing.textKeys.map((k) => [k, value(`text.${k}`)])),
    guideMd: value("guideMd"),
    manifest: Object.fromEntries(["name", "short_name", "description", "theme_color", "background_color"].map((k) => [k, value(`manifest.${k}`)])),
  };
}

function showResult({ errors = [], warnings = [], probe = [] }, okText) {
  form.querySelectorAll("[aria-invalid]").forEach((n) => n.removeAttribute("aria-invalid"));
  for (const e of errors) {
    const m = e.match(/^(Text|Manifest|Anleitung) ([\w.]+)/);
    const alias = { Kopfzeile: "header", Datum: "date", Autor: "author", Name: "name", Kurzname: "short_name", Beschreibung: "description" };
    const key = m && (alias[m[2]] ?? m[2]);
    const name = m ? (m[1] === "Text" ? `text.${key}` : m[1] === "Manifest" ? `manifest.${key}` : key === "Anleitung.md" ? "guideMd" : `guide.${key}`) : e.startsWith("Anleitung.md") ? "guideMd" : e.startsWith("Name:") ? "name" : e.startsWith("Beschreibung:") ? "description" : null;
    if (name && field(name)) field(name).setAttribute("aria-invalid", "true");
  }
  const rows = [...$("markers").querySelectorAll(".marker")];
  probe.forEach((p, i) => {
    const line = rows[i]?.querySelector(".probe");
    if (!line) return;
    const parts = [p.inBuild.length ? `im Build gefunden: ${p.inBuild.join(", ")}` : "nicht im Build gefunden"];
    if (p.inSample) parts.push("auch in der Beispiel-Fassung (zu allgemein)");
    if (p.inOthers.length) parts.push(`auch im Studio ${p.inOthers.join(", ")}`);
    line.textContent = parts.join(" · ");
    line.className = `probe ${p.inBuild.length && !p.inSample && !p.inOthers.length ? "muted" : "bad-text"}`;
  });
  $("editor-result").replaceChildren(
    errors.length
      ? el("div", { class: "error" }, `${errors.length} Fehler – nichts gespeichert:`, el("ul", { class: "result-list" }, ...errors.map((e) => el("li", {}, e))))
      : el("p", { class: "badge ok" }, okText),
    ...(warnings.length ? [el("div", { class: "note warn-box" }, el("ul", { class: "result-list" }, ...warnings.map((w) => el("li", {}, w))))] : []),
  );
}

async function openEditor(key) {
  showError("");
  try {
    const data = await api(`/api/studio?key=${encodeURIComponent(key)}`);
    editing = { key, version: data.version, textKeys: data.textKeys, logo: null, dirty: false };
    $("editor-title").textContent = `Profil bearbeiten · ${data.draft.name || data.id}`;
    $("editor-folder").textContent = data.folder;
    $("editor-result").replaceChildren();
    fill(data);
    $("editor").hidden = false;
    $("editor").scrollIntoView({ block: "start" });
  } catch (error) {
    showError(error.message);
  }
}

async function submitDraft(save) {
  const buttons = [$("editor-check"), $("editor-save")];
  buttons.forEach((b) => (b.disabled = true));
  $("editor-result").replaceChildren(el("p", { class: "badge busy" }, save ? "Speichert und prüft …" : "Prüft …"));
  try {
    const { ok, status, data } = await request(
      save ? "/api/studio/save" : "/api/studio/check",
      postJson({ studio: editing.key, draft: collect(), logo: editing.logo, version: editing.version }),
    );
    if (!ok && !data.errors) throw new Error(data.error || `Fehler ${status}`);
    showResult(data, save ? "Gespeichert und geprüft. Jetzt neu bauen und prüfen." : "Keine Fehler. Kann gespeichert werden.");
    if (save && ok) {
      editing.version = data.version;
      editing.dirty = false;
      if (editing.logo) {
        const fresh = await api(`/api/studio?key=${encodeURIComponent(editing.key)}`);
        $("icon-192").src = blobUrl(fresh.icons[192]);
        $("icon-512").src = blobUrl(fresh.icons[512]);
        editing.logo = null;
      }
      load(true);
    }
  } catch (error) {
    $("editor-result").replaceChildren(el("p", { class: "error" }, error.message));
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

function syncColors() {
  form.querySelectorAll("input[type=color]").forEach((picker) => {
    const text = field(picker.dataset.for);
    if (/^#[0-9a-fA-F]{6}$/.test(text.value)) picker.value = text.value.toLowerCase();
  });
}
form.addEventListener("input", (event) => {
  if (!editing) return;
  editing.dirty = true;
  if (event.target.type === "color") field(event.target.dataset.for).value = event.target.value;
  else if (event.target.name?.endsWith("_color")) syncColors();
});
form.addEventListener("submit", (event) => event.preventDefault());
$("marker-add").addEventListener("click", () => {
  $("markers").append(markerRow(""));
  editing.dirty = true;
});
$("logo-file").addEventListener("change", async () => {
  const file = $("logo-file").files[0];
  if (!file) return;
  editing.logo = toBase64(await file.arrayBuffer());
  editing.dirty = true;
  $("logo-preview").src = URL.createObjectURL(file);
  $("logo-preview").hidden = false;
  $("logo-caption").textContent = "neues Logo (wird beim Speichern übernommen)";
});
$("editor-check").addEventListener("click", () => submitDraft(false));
$("editor-save").addEventListener("click", () => submitDraft(true));
$("editor-close").addEventListener("click", () => {
  if (editing?.dirty && !confirm("Ungespeicherte Änderungen verwerfen?")) return;
  editing = null;
  $("editor").hidden = true;
});

// ---------- new studio ----------
$("new-studio").addEventListener("click", () => {
  $("new-form").reset();
  $("new-error").hidden = true;
  $("new-dialog").showModal();
});
$("new-cancel").addEventListener("click", () => $("new-dialog").close());
$("new-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData($("new-form"));
  try {
    const { key } = await api("/api/studio/new", { method: "POST", body: JSON.stringify({ id: data.get("id"), name: data.get("name") }) });
    $("new-dialog").close();
    await load(true);
    openEditor(key);
  } catch (error) {
    $("new-error").textContent = error.message;
    $("new-error").hidden = false;
  }
});

// ---------- commit ----------
let committing = null;
$("commit-cancel").addEventListener("click", () => $("commit-dialog").close());
$("commit-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const { commit, warning } = await api("/api/studio/commit", {
      method: "POST",
      body: JSON.stringify({ studio: committing.key, message: new FormData($("commit-form")).get("message"), files: committing.files }),
    });
    $("commit-dialog").close();
    await load(true);
    $("run").hidden = true;
    showError("");
    $("cert").insertAdjacentElement("afterend", el("p", { class: `note${warning ? " warn-box" : ""}`, id: "commit-done" }, `Committet: ${commit}${warning ? ` · ${warning}` : ""}`));
    setTimeout(() => document.getElementById("commit-done")?.remove(), 8000);
  } catch (error) {
    $("commit-error").textContent = error.message;
    $("commit-error").hidden = false;
  }
});

function startEdit(button) {
  if (editing?.dirty && editing.key !== button.dataset.edit && !confirm("Ungespeicherte Änderungen verwerfen?")) return;
  openEditor(button.dataset.edit);
}
async function openCommit(button) {
  showError("");
  try {
    const { files, forbidden } = await api(`/api/studio/changes?key=${encodeURIComponent(button.dataset.commit)}`);
    committing = { key: button.dataset.commit, files: files.map((f) => f.path) };
    $("commit-studio").textContent = `${button.dataset.name}: ${files.length} Dateien`;
    $("commit-files").replaceChildren(...files.map((f) => el("li", { class: forbidden.includes(f.path) ? "bad-text" : "" }, el("code", {}, `${f.state} ${f.path}`))));
    $("commit-form").reset();
    $("commit-form").elements.namedItem("message").value = button.dataset.first ? "Erstes Profil" : "Profil aktualisiert";
    $("commit-error").textContent = forbidden.length ? `Diese Dateien gehören nicht ins Repo: ${forbidden.join(", ")}` : "";
    $("commit-error").hidden = !forbidden.length;
    $("commit-ok").disabled = !files.length || forbidden.length > 0;
    $("commit-dialog").showModal();
  } catch (error) {
    showError(error.message);
  }
}
// ---------- export ----------
let exporting = null;
$("export-cancel").addEventListener("click", () => $("export-dialog").close());
$("export-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("export-ok").disabled = true;
  $("export-result").replaceChildren(el("p", { class: "badge busy" }, "Exportiert und prüft …"));
  try {
    const { ok, status, data } = await request("/api/export", postJson({ studio: exporting, zip: $("export-zip").checked }));
    if (!ok) {
      $("export-result").replaceChildren(
        el("div", { class: "error" }, data.error || `Fehler ${status}`, ...(data.reasons?.length ? [el("ul", { class: "result-list" }, ...data.reasons.map((r) => el("li", {}, r)))] : [])),
      );
      return;
    }
    $("export-result").replaceChildren(
      el("p", { class: "badge ok" }, "Exportiert"),
      el("p", {}, el("code", {}, data.folder)),
      ...(data.zip ? [el("p", {}, el("code", {}, data.zip))] : []),
      ...(data.warning ? [el("p", { class: "warn-text" }, data.warning)] : []),
    );
    load(true);
  } catch (error) {
    $("export-result").replaceChildren(el("p", { class: "error" }, error.message));
  }
});
async function openExport(button) {
  showError("");
  try {
    const ready = await api(`/api/export?key=${encodeURIComponent(button.dataset.export)}`);
    exporting = button.dataset.export;
    $("export-studio").textContent = button.dataset.name;
    $("export-reasons").replaceChildren(
      ready.ok
        ? el("p", { class: "badge ok" }, "Alle Voraussetzungen erfüllt")
        : el("div", { class: "note warn-box" }, "Noch nicht möglich:", el("ul", { class: "result-list" }, ...ready.reasons.map((r) => el("li", {}, r)))),
    );
    $("export-result").replaceChildren();
    $("export-ok").disabled = !ready.ok;
    $("export-zip").checked = false;
    $("export-dialog").showModal();
  } catch (error) {
    showError(error.message);
  }
}

// ---------- on-site mode ----------
let onsiteKey = null,
  onsiteData = null,
  onsiteTimer = null;
const SVG = "http://www.w3.org/2000/svg";
async function drawQr() {
  const { modules } = await api("/api/vor-ort/qr");
  const size = modules.length + 8;
  const svg = $("onsite-qr");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("shape-rendering", "crispEdges");
  const parts = [];
  modules.forEach((row, r) => row.forEach((dark, c) => dark && parts.push(`M${c + 4} ${r + 4}h1v1h-1z`)));
  const p = document.createElementNS(SVG, "path");
  p.setAttribute("d", parts.join(""));
  p.setAttribute("fill", "#000");
  svg.replaceChildren(p);
}
function renderOnsite() {
  const d = onsiteData;
  if (!d) return;
  const cert = d.cert;
  $("onsite-cert").textContent = cert.exists
    ? `Gültig für ${cert.host}. Server bis ${date(cert.server?.until)} (${cert.server?.daysLeft} Tage), Stammzertifikat bis ${date(cert.root?.until)}.${cert.warnings?.length ? " " + cert.warnings.join(" ") : ""}`
    : `Noch kein Zertifikat. Es wird nur für ${cert.host} gelten.`;
  $("onsite-cert-create").disabled = cert.exists;
  $("onsite-cert-renew").disabled = $("onsite-cert-show").disabled = !cert.exists;
  const s = d.session && !d.session.endedAt ? d.session : null;
  const mine = s && s.studio === onsiteKey;
  $("onsite-running").hidden = !mine;
  $("onsite-start").disabled = !!s;
  $("onsite-stop").disabled = !s;
  if (mine) {
    $("onsite-address").textContent = s.address;
    $("onsite-info").textContent = `Läuft seit ${date(s.startedAt)} auf ${s.ip} mit ${s.exportName}. Endet nach ${s.idleMinutes} Minuten ohne Anfrage oder per Knopf.`;
    $("onsite-log").replaceChildren(...[...s.requests].reverse().map((r) => el("li", {}, `${date(r.at)} · iPad hat geladen: ${r.path}`)));
  } else if (d.session?.endedAt && d.session.studio === onsiteKey) {
    $("onsite-info").textContent = `Beendet ${date(d.session.endedAt)}: ${d.session.reason}`;
  }
  $("onsite-checklist").replaceChildren(
    ...d.checklist.map(([key, label]) => {
      const box = el("input", { type: "checkbox", checked: !!d.state.checklist[key], "data-check": key });
      return el("label", { class: "check" }, box, `${label}${d.state.checklist[key] ? ` (${d.state.checklist[key]})` : ""}`);
    }),
  );
  const chosen = d.exports.find((e) => e.name === $("onsite-export").value);
  $("onsite-installed").disabled = !chosen;
  $("onsite-installed").textContent = chosen ? `Installation von ${chosen.version} bestätigen` : "Installation bestätigen";
  $("onsite-state").textContent = d.state.installed ? `Installiert: ${d.state.installed.version} am ${d.state.installed.date}.` : "Noch keine Installation bestätigt.";
  $("onsite-approve").hidden = !d.blanko || !!d.state.neutralApproved;
}
async function refreshOnsite() {
  if (!onsiteKey) return;
  onsiteData = await api(`/api/vor-ort?key=${encodeURIComponent(onsiteKey)}`);
  renderOnsite();
}
async function openOnsite(key, name) {
  showError("");
  try {
    onsiteKey = key;
    onsiteData = await api(`/api/vor-ort?key=${encodeURIComponent(key)}`);
    $("onsite-title").textContent = `Vor Ort · ${name}`;
    $("onsite-export").replaceChildren(
      ...(onsiteData.exports.length ? onsiteData.exports.map((e) => el("option", { value: e.name }, `${e.name}`)) : [el("option", { value: "" }, "noch kein gültiger Export")]),
    );
    $("onsite-checks").replaceChildren();
    $("onsite-password").value = "";
    $("onsite").hidden = false;
    renderOnsite();
    await drawQr();
    $("onsite").scrollIntoView({ block: "start" });
    clearInterval(onsiteTimer);
    onsiteTimer = setInterval(() => refreshOnsite().catch(() => {}), 2000);
  } catch (error) {
    showError(error.message);
  }
}
const onsitePost = (pathname, extra = {}) => api(pathname, { method: "POST", body: JSON.stringify({ studio: onsiteKey, ...extra }) });
async function onsiteAction(button, work) {
  button.disabled = true;
  showError("");
  try {
    await work();
    await refreshOnsite();
  } catch (error) {
    showError(error.message);
  } finally {
    renderOnsite();
    if (button.id === "onsite-check") button.disabled = false;
  }
}
$("onsite-check").addEventListener("click", () =>
  onsiteAction($("onsite-check"), async () => {
    $("onsite-checks").replaceChildren(el("li", {}, el("span", { class: "badge busy" }, "prüft …")));
    const { checks } = await onsitePost("/api/vor-ort/pruefen", { export: $("onsite-export").value });
    $("onsite-checks").replaceChildren(...checks.map((c) => el("li", {}, el("span", { class: `badge ${c.ok ? "ok" : "bad"}` }, c.ok ? "ok" : "fehlt"), " ", c.text)));
  }),
);
for (const [id, action] of [
  ["onsite-cert-create", "create"],
  ["onsite-cert-renew", "renew"],
])
  $(id).addEventListener("click", () =>
    onsiteAction($(id), async () => {
      await onsitePost("/api/vor-ort/zertifikat", { action, password: $("onsite-password").value });
      $("onsite-password").value = "";
    }),
  );
$("onsite-cert-show").addEventListener("click", () => onsiteAction($("onsite-cert-show"), () => onsitePost("/api/vor-ort/finder", { what: "zertifikat" })));
$("onsite-webloc").addEventListener("click", () => onsiteAction($("onsite-webloc"), () => onsitePost("/api/vor-ort/finder", { what: "webloc" })));
$("onsite-start").addEventListener("click", () =>
  onsiteAction($("onsite-start"), async () => {
    const { ok, status, data } = await request("/api/vor-ort/start", postJson({ studio: onsiteKey, export: $("onsite-export").value }));
    if (!ok) {
      if (data.checks)
        $("onsite-checks").replaceChildren(...data.checks.map((c) => el("li", {}, el("span", { class: `badge ${c.ok ? "ok" : "bad"}` }, c.ok ? "ok" : "fehlt"), " ", c.text)));
      throw new Error(data.error || `Fehler ${status}`);
    }
  }),
);
$("onsite-stop").addEventListener("click", () => onsiteAction($("onsite-stop"), () => api("/api/vor-ort/stop", { method: "POST", body: "{}" })));
$("onsite-checklist").addEventListener("change", (event) => {
  const box = event.target.closest("input[data-check]");
  if (box) onsiteAction(box, () => onsitePost("/api/vor-ort/checkliste", { key: box.dataset.check, done: box.checked }));
});
$("onsite-installed").addEventListener("click", () => {
  const chosen = onsiteData?.exports.find((e) => e.name === $("onsite-export").value);
  if (chosen && confirm(`Bestätigen, dass ${chosen.version} jetzt auf dem iPad installiert ist?`))
    onsiteAction($("onsite-installed"), () => onsitePost("/api/vor-ort/installiert", { version: chosen.version }));
});
$("onsite-approve").addEventListener("click", () => {
  if (confirm("Hat das Test-iPad die App über inkform-app.local geladen und das Zertifikat angenommen?"))
    onsiteAction($("onsite-approve"), () => onsitePost("/api/vor-ort/freigeben"));
});
$("onsite-export").addEventListener("change", renderOnsite);
$("onsite-close").addEventListener("click", () => {
  clearInterval(onsiteTimer);
  onsiteKey = null;
  $("onsite").hidden = true;
});
// One click handler for all buttons on the studio cards.
$("studios").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const d = button.dataset;
  if (d.kind) startRun(button);
  else if (d.edit) startEdit(button);
  else if (d.commit) openCommit(button);
  else if (d.export) openExport(button);
  else if (d.onsite) openOnsite(d.onsite, d.name);
});

window.addEventListener("beforeunload", (event) => {
  if (editing?.dirty) event.preventDefault();
});
load(true);
