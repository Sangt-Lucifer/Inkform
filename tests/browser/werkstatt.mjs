// Werkstatt UI in the real browser: a throw-away studio (temporary folder) is shown as protected
// without buttons, Blanko can be built, the page runs under its strict CSP without errors.
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { root } from "../../scripts/build.mjs";
import { startWerkstatt } from "../../werkstatt/server.mjs";
import { connect } from "./lib.mjs";

const base = await mkdtemp(path.join(tmpdir(), "inkform-werkstatt-ui-"));
const studioDir = path.join(base, "studios", "testatelier");
await cp(path.join(root, "profiles", "beispiel"), studioDir, { recursive: true });
const profile = JSON.parse(await readFile(path.join(studioDir, "profile.json"), "utf8"));
await writeFile(path.join(studioDir, "profile.json"), JSON.stringify({ ...profile, id: "testatelier", name: "Testatelier" }));
const { server, url } = await startWerkstatt({
  port: 0,
  env: { ...process.env, INKFORM_STUDIOS: path.join(base, "studios") },
  stateDir: path.join(base, "state"),
  certDir: path.join(base, "keine-zertifikate"),
});
const { cmd, ev, until, check, screenshot, errors } = await connect();
try {
  await cmd("Page.navigate", { url });
  await until(`document.querySelectorAll('.card').length === 2`);
  check("Werkstatt zeigt Blanko und das Wegwerf-Studio", await ev(`[...document.querySelectorAll('.card h2')].map(h=>h.textContent).join('|').includes('Testatelier')`));
  check(
    "Nicht freigegebenes Studio: nur Anzeige, keine Knöpfe",
    await ev(`(()=>{const c=document.querySelector('.card[data-key="s-testatelier"]');return !c.querySelector('button')&&c.textContent.includes('nur Anzeige')&&c.textContent.includes('Musterstudios')})()`),
  );
  check("Blanko hat die Knöpfe zum Bauen und Prüfen", await ev(`document.querySelectorAll('.card[data-key="blanko"] button[data-kind]').length === 4`));
  await ev(`document.querySelector('button[data-studio="blanko"][data-kind="build"]').click()`);
  await until(`document.getElementById('run-state').textContent === 'alles grün'`, 300);
  check("Bauen über die Oberfläche: Ergebnis verständlich angezeigt", await ev(`document.getElementById('run-steps').textContent.includes('Gebaut')`));
  await screenshot("werkstatt");
  if (errors.length) console.log("Fehler:", JSON.stringify(errors).slice(0, 1500));
  check("Keine JavaScript- oder CSP-Fehler", errors.length === 0);
} finally {
  server.close();
  await rm(base, { recursive: true, force: true });
}
process.exit(0);
