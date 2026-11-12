// Werkstatt UI in the real browser: a throw-away studio (temporary folder) is shown as protected
// without buttons, Beispiel can be built, a new studio is created, edited, saved and committed,
// and the page runs under its strict CSP without errors. Everything happens in a temporary folder.
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { root } from "../../scripts/build.mjs";
import { startWerkstatt } from "../../werkstatt/server.mjs";
import { connect } from "./lib.mjs";
import { snapshot } from "../lib/werkstatt.mjs";

const base = await mkdtemp(path.join(tmpdir(), "inkform-werkstatt-ui-"));
const studioDir = path.join(base, "studios", "testatelier");
await cp(path.join(root, "profiles", "beispiel"), studioDir, { recursive: true });
const profile = JSON.parse(await readFile(path.join(studioDir, "profile.json"), "utf8"));
await writeFile(path.join(studioDir, "profile.json"), JSON.stringify({ ...profile, id: "testatelier", name: "Testatelier" }));
const { server, url } = await startWerkstatt({
  port: 0,
  env: { ...process.env, INKFORM_STUDIOS: path.join(base, "studios"), INKFORM_EXPORTE: path.join(base, "exporte"), INKFORM_ZERTIFIKATE: path.join(base, "zertifikate") },
  stateDir: path.join(base, "state"),
  certDir: path.join(base, "keine-zertifikate"),
});
const { cmd, ev, until, check, screenshot, errors } = await connect();
try {
  await cmd("Page.navigate", { url });
  await until(`document.querySelectorAll('.card').length === 2`);
  check("Werkstatt zeigt Beispiel und das Wegwerf-Studio", await ev(`[...document.querySelectorAll('.card h2')].map(h=>h.textContent).join('|').includes('Testatelier')`));
  check(
    "Nicht freigegebenes Studio: nur Anzeige, keine Knöpfe",
    await ev(`(()=>{const c=document.querySelector('.card[data-key="s-testatelier"]');return !c.querySelector('button')&&c.textContent.includes('nur Anzeige')&&c.textContent.includes('Musterstudios')})()`),
  );
  check("Beispiel hat die Knöpfe zum Bauen und Prüfen", await ev(`document.querySelectorAll('.card[data-key="beispiel"] button[data-kind]').length === 4`));
  await ev(`document.querySelector('button[data-studio="beispiel"][data-kind="build"]').click()`);
  await until(`document.getElementById('run-state').textContent === 'alles grün'`, 300);
  check("Bauen über die Oberfläche: Ergebnis verständlich angezeigt", await ev(`document.getElementById('run-steps').textContent.includes('Gebaut')`));
  await screenshot("werkstatt");

  // New studio -> editor -> check -> save -> commit.
  const protectedBefore = await snapshot(studioDir);
  check("Geschütztes Studio: kein Bearbeiten-Knopf", await ev(`!document.querySelector('.card[data-key="s-testatelier"] [data-edit]')`));
  check("Beispiel wird nicht im Editor bearbeitet", await ev(`!document.querySelector('.card[data-key="beispiel"] [data-edit]')`));
  await ev(`document.getElementById('new-studio').click()`);
  await ev(`(()=>{const f=document.getElementById('new-form');f.elements.id.value='atelier-nord';f.elements.name.value='Atelier Nord';f.requestSubmit()})()`);
  await until(`!document.getElementById('editor').hidden && document.querySelectorAll('#texts textarea').length > 20`);
  check("Neues Studio angelegt, Editor geöffnet", await ev(`document.querySelector('.card[data-key="s-atelier-nord"] [data-edit]') !== null`));
  await ev(`document.getElementById('editor-check').click()`);
  await until(`document.querySelector('#editor-result .error')`);
  check(
    "Prüfen zeigt Musterstudio-Texte als Fehler und markiert das Feld",
    await ev(`document.getElementById('editor-result').textContent.includes('Musterstudios') && document.querySelector('[name="text.studioName"]').getAttribute('aria-invalid')==='true'`),
  );
  // Replace the sample studio's names in every text, then check and save.
  await ev(`(()=>{for(const t of document.querySelectorAll('#editor-form textarea, #editor-form input[name]')){if(t.type==='file')continue;t.value=t.value.replace(/musterstudio\.example/gi,'atelier-nord.example').replace(/12345 Musterstadt/g,'54321 Nordstadt').replace(/Max Mustermann/g,'Erika Nordmann').replace(/musterstudio/gi,'Atelier Nord');t.dispatchEvent(new Event('input',{bubbles:true}))}})()`);
  await ev(`document.querySelector('[name="description"]').value='Testprofil'`);
  await ev(`document.getElementById('editor-check').click()`);
  await until(`document.querySelector('#editor-result .badge.ok')`);
  check("Marker-Probe: im eigenen Build gefunden", await ev(`document.querySelector('#markers .probe').textContent.includes('im Build gefunden: ')`));
  await ev(`document.getElementById('editor-save').click()`);
  check(
    "Während des Speicherns ist der Editor gesperrt",
    await ev(`[...document.querySelectorAll('#editor-form fieldset')].every((f) => f.disabled) && document.getElementById('editor-close').disabled`),
  );
  await until(`document.getElementById('editor-result').textContent.includes('Gespeichert')`, 200);
  const saved = JSON.parse(await readFile(path.join(base, "studios", "atelier-nord", "profile.json"), "utf8"));
  check("Gespeichert: Profil ohne Musterstudio-Texte", saved.text.customerStudioName === "Atelier Nord" && saved.id === "atelier-nord");
  await until(`!document.querySelector('.card[data-key="s-atelier-nord"] [data-commit]')?.disabled`);
  await ev(`document.querySelector('.card[data-key="s-atelier-nord"] [data-commit]').click()`);
  await until(`document.getElementById('commit-dialog').open && document.querySelectorAll('#commit-files li').length > 3`);
  check("Commit-Dialog zeigt die Dateien", await ev(`document.getElementById('commit-files').textContent.includes('profile.json')`));
  await ev(`document.getElementById('commit-form').requestSubmit()`);
  await until(`!document.getElementById('commit-dialog').open`);
  const log = execFileSync("git", ["-C", path.join(base, "studios", "atelier-nord"), "log", "-1", "--format=%an <%ae> %s"], { encoding: "utf8" }).trim();
  check("Erster Commit als Sven mit neutraler Adresse", log === "Sven <sven@inkform.invalid> Erstes Profil");
  check("Geschütztes Studio blieb unverändert", (await snapshot(studioDir)) === protectedBefore);
  await screenshot("werkstatt-editor");

  // The export dialog names what is still missing and does not export.
  check("Geschütztes Studio: kein Export-Knopf", await ev(`!document.querySelector('.card[data-key="s-testatelier"] [data-export]')`));
  await ev(`document.querySelector('.card[data-key="s-atelier-nord"] [data-export]').click()`);
  await until(`document.getElementById('export-dialog').open && document.getElementById('export-reasons').textContent.length > 0`);
  check(
    "Export-Dialog nennt fehlende Voraussetzungen und sperrt den Knopf",
    await ev(`document.getElementById('export-reasons').textContent.includes('noch nicht gelaufen') && document.getElementById('export-ok').disabled`),
  );
  await ev(`document.getElementById('export-cancel').click()`);

  // The on-site panel opens, shows the QR code and starts nothing by itself.
  check("Geschütztes Studio: kein Vor-Ort-Knopf", await ev(`!document.querySelector('.card[data-key="s-testatelier"] [data-onsite]')`));
  await ev(`document.querySelector('.card[data-key="beispiel"] [data-onsite]').click()`);
  await until(`!document.getElementById('onsite').hidden && document.querySelector('#onsite-qr path')`);
  check(
    "Vor-Ort: QR-Code gezeichnet, Zertifikat noch nicht vorhanden, nichts gestartet",
    await ev(`document.querySelector('#onsite-qr path').getAttribute('d').length > 100 && document.getElementById('onsite-cert').textContent.includes('Noch kein Zertifikat') && document.getElementById('onsite-running').hidden && !document.getElementById('onsite-start').disabled`),
  );
  await screenshot("werkstatt-vor-ort");
  await ev(`document.getElementById('onsite-close').click()`);
  if (errors.length) console.log("Fehler:", JSON.stringify(errors).slice(0, 1500));
  check("Keine JavaScript- oder CSP-Fehler", errors.length === 0);
} finally {
  server.close();
  await rm(base, { recursive: true, force: true });
}
process.exit(0);
