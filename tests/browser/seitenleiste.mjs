// The admin sidebar: four groups, eight entries, the text pages under one entry with tabs, the
// device settings on "iPad & Einstellungen", and every entry reachable on the iPad in landscape
// and portrait. Synthetic data only.
import { HELPERS, ORIGIN, connect } from "./lib.mjs";

const { cmd, ev, until, check, navigate, screenshot, errors } = await connect();
const size = (width, height) => cmd("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
await size(1024, 768);
const clean = await cmd("Page.addScriptToEvaluateOnNewDocument", {
  source: `try{localStorage.clear();sessionStorage.clear()}catch(_){}`,
});
await navigate(ORIGIN + "/index.html");
await cmd("Page.removeScriptToEvaluateOnNewDocument", { identifier: clean.identifier });
// Leaving the previous check's page may log a blocked leave warning; it belongs to that page.
errors.length = 0;
await ev(HELPERS);
await until(`document.getElementById('admin-pin-dialog')?.open`);
await ev(`(()=>{for(const id of ['admin-pin','admin-pin-repeat'])document.getElementById(id).value='839274';document.getElementById('admin-pin-form').requestSubmit()})()`);
await until(`adminAccess.isUnlocked()`);
await ev(`openAdminAuthorized('overview')`);

const nav = () => ev(`[...document.getElementById('admin-nav').children].map(e=>(e.matches('.ad-nav-group')?'# ':'')+e.textContent.trim()).join(' | ')`);
check(
  "Seitenleiste: Übersicht, dann Alltag, Formular, Daten, Gerät mit neun Einträgen",
  (await nav()) ===
    "Übersicht | # Alltag | Einnahmen | Export | # Formular | Studio & Kontakt | Texte | # Daten | Sichern & Wiederherstellen | Aufbewahren & Löschen | # Gerät | iPad & Einstellungen | Sprachen",
);
check("Keine Seite „Darstellung“ mehr", await ev(`!('appearance' in ADMIN_PAGES)`));

// Texts -----------------------------------------------------------------------------------------
await ev(`document.querySelector('#admin-nav [data-admin-page="content"]').click()`);
const tabs = () => ev(`[...document.querySelectorAll('.ad-tabs button')].map(b=>b.textContent.trim()+(b.getAttribute('aria-current')?'*':'')).join(' | ')`);
check("„Texte“ öffnet den ersten Reiter", (await ev(`adminPage`)) === "content" && (await tabs()) === "Einstieg & Unterschrift* | Gesundheitsfragen | Einwilligungstexte | Datenschutz");
await ev(`[...document.querySelectorAll('.ad-tabs button')].find(b=>b.dataset.adminPage==='medical').click()`);
check(
  "Reiter „Gesundheitsfragen“: Seite gewechselt, „Texte“ bleibt markiert",
  (await ev(`adminPage`)) === "medical" &&
    (await tabs()) === "Einstieg & Unterschrift | Gesundheitsfragen* | Einwilligungstexte | Datenschutz" &&
    (await ev(`document.querySelector('#admin-nav [aria-current="page"]').textContent.trim()`)) === "Texte",
);
check("Fokus bleibt nach dem Wechsel auf dem Reiter", await ev(`document.activeElement.matches('.ad-tabs [data-admin-page="medical"][aria-current="page"]')`));
await ev(`document.querySelector('#admin-nav [data-admin-page="backup"]').click()`);
check("Fokus bleibt nach dem Wechsel auf dem Eintrag der Seitenleiste", await ev(`document.activeElement.matches('#admin-nav [data-admin-page="backup"][aria-current="page"]')`));
await ev(`openAdminAuthorized('medical')`);
await screenshot("seitenleiste-texte-quer");
check("Andere Seiten ohne Reiter", await ev(`openAdminAuthorized('studio');!document.querySelector('.ad-tabs')`));

// Device ----------------------------------------------------------------------------------------
await ev(`openAdminAuthorized('ipad')`);
check(
  "„iPad & Einstellungen“: Ablage-Test, Farbschema, Sprache dieses Geräts, PIN ändern, Standardvorlage",
  await ev(`['[data-set-theme="dark"]','#operator-language','#pin-change-form','[data-admin-action="defaults"]'].every(q=>document.querySelector('#admin-section '+q))&&document.getElementById('admin-section').textContent.includes(t('ipad.check'))`),
);

// iPad formats: no sideways scrolling, the last entry reachable ----------------------------------
for (const [name, width, height] of [
  ["quer", 1024, 768],
  ["hoch", 768, 1024],
]) {
  await size(width, height);
  await ev(`openAdminAuthorized('overview')`);
  const last = await ev(`(()=>{const side=document.querySelector('.ad-sidebar'),b=[...document.querySelectorAll('#admin-nav button')].pop();window.scrollTo(0,0);side.scrollTop=side.scrollHeight;const r=b.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return {inside:r.top>=0&&r.bottom<=innerHeight,top:document.elementFromPoint(x,y)?.closest('button')===b,page:window.scrollY===0&&(side.scrollTop>0||side.scrollHeight<=side.clientHeight),wide:document.documentElement.scrollWidth<=document.documentElement.clientWidth&&side.scrollWidth<=side.clientWidth,info:[side.scrollWidth,side.clientWidth,side.scrollHeight,side.clientHeight]}})()`);
  check(`iPad ${name} (${width} × ${height}): letzter Eintrag erreichbar, kein seitliches Scrollen`, last.inside && last.top && last.page && last.wide);
  await ev(`window.scrollTo(0,0);document.querySelector('.ad-sidebar').scrollTop=0`);
  await screenshot(`seitenleiste-${name}`);
}
check("Keine JavaScript- oder CSP-Fehler", errors.length === 0, JSON.stringify(errors));
process.exit(0);
