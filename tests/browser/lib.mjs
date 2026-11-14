// Small Chrome DevTools Protocol client shared by the browser checks (run via tests/browser/run.mjs).
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

export const OUT = process.env.INKFORM_OUT;
export const ORIGIN = process.env.INKFORM_HTTP_ORIGIN;

export async function connect() {
  const pages = await (await fetch(process.env.INKFORM_CDP + "/json/list")).json();
  const ws = new WebSocket(pages.find((p) => p.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let serial = 0;
  const pending = new Map(),
    requests = [],
    errors = [];
  ws.addEventListener("message", ({ data }) => {
    const m = JSON.parse(data);
    if (m.id) {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result);
      return;
    }
    if (m.method === "Network.requestWillBeSent") requests.push(m.params.request.url);
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails);
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push(m.params.entry);
    if (m.method === "Page.javascriptDialogOpening") cmd("Page.handleJavaScriptDialog", { accept: true });
  });
  const cmd = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++serial;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => pending.delete(id) && reject(Error("Timeout " + method)), 20000).unref();
    });
  const ev = async (expression) => {
    const r = await cmd("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const until = async (expression, tries = 80) => {
    let last;
    for (let n = 0; n < tries; n++) {
      try {
        if (await ev(expression)) return;
      } catch (e) {
        last = e;
        if (!/navigated|context|Cannot find|not defined/i.test(e.message)) throw e;
      }
      await new Promise((r) => setTimeout(r, 125));
    }
    const state = await ev(
      `JSON.stringify({toast:document.getElementById('toast')?.hidden?null:document.getElementById('toast')?.textContent,errors:[...document.querySelectorAll('[aria-invalid="true"]')].map(e=>e.id||e.name),summary:document.getElementById('error-summary')?.hidden?null:document.getElementById('error-summary')?.textContent.slice(0,300),completion:!document.getElementById('completion-screen')?.hidden,pending:typeof pendingConsent!=='undefined'&&!!pendingConsent})`,
    ).catch((e) => e.message);
    throw Error("Nicht erreicht: " + expression + (last ? " / " + last.message : "") + "\nZustand: " + state);
  };
  const check = (name, value) => {
    if (!value) console.log("Diagnose", JSON.stringify(errors));
    assert.ok(value, name);
    console.log("PASS " + name);
  };
  const loaded = () =>
    new Promise((resolve) => {
      const listener = ({ data }) => {
        if (JSON.parse(data).method === "Page.loadEventFired") {
          ws.removeEventListener("message", listener);
          resolve();
        }
      };
      ws.addEventListener("message", listener);
    });
  const navigate = async (url) => {
    const done = loaded();
    await cmd("Page.navigate", { url });
    await done;
    await until(`typeof adminAccess!=='undefined' && document.readyState==='complete'`);
  };
  const reload = async () => {
    const done = loaded();
    await cmd("Page.reload", { ignoreCache: false });
    await done;
    await until(`typeof adminAccess!=='undefined' && document.readyState==='complete'`);
  };
  const screenshot = async (name) =>
    writeFile(`${OUT}/${name}.png`, Buffer.from((await cmd("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await cmd("Page.enable");
  await cmd("Runtime.enable");
  await cmd("Log.enable");
  await cmd("Network.enable");
  // Same as airplane mode on the iPad. Called after the first load from the local preview server
  // (from then on the service worker serves the app); reloads and the whole workflow run offline.
  const offline = (on = true) =>
    cmd("Network.emulateNetworkConditions", { offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  // Answers the app's confirmation window (#confirm-dialog) once it is open, with a real pointer
  // click at the button's centre, which must be the topmost element there; returns the question.
  const answer = async (yes = true) => {
    await until(`document.getElementById('confirm-dialog').open`);
    const id = yes ? "confirm-ok" : "confirm-cancel";
    const { x, y, top, question } = await ev(`(()=>{const r=document.getElementById('${id}').getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return {x,y,top:document.elementFromPoint(x,y)?.id,question:document.getElementById('confirm-title').textContent+'\\n\\n'+document.getElementById('confirm-text').textContent}})()`);
    if (top !== id) throw Error(`Rückfrage nicht bedienbar: oben liegt ${top}`);
    for (const type of ["mousePressed", "mouseReleased"]) await cmd("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
    return question;
  };
  return { ws, cmd, ev, until, check, navigate, reload, screenshot, offline, requests, errors, answer };
}

// Browser-side helpers, installed with ev(HELPERS) after each page load.
export const HELPERS = `
window.unlockAdmin=(pin='839274')=>{document.getElementById('admin-pin').value=pin;document.getElementById('admin-pin-form').requestSubmit()};
window.fillConsent=(values={})=>{const v={firstName:'Test',lastName:'Person',birthDate:'1990-01-02',appointment:'2026-11-06',artist:'Alex',placement:'Oberarm',motif:'Testmotiv',totalPrice:'450,50',depositPaid:'100,25',...values};
for(const [id,value] of Object.entries(v)){const el=document.getElementById(id);el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));}
for(const q of MEDICAL)document.querySelector('input[name="'+q.id+'"][value="no"]').click();
for(const item of LEGAL){const el=document.getElementById(item.id);if(!el.checked)el.click();}
if(!document.getElementById('sober').checked)document.getElementById('sober').click();
document.querySelector('input[name="photo"][value="no"]').click();
resizeCanvas();if(ink.width<50)throw Error('Unterschriftsfeld noch nicht vermessen');ink.strokes=[[{x:.1,y:.3,pressure:.5},{x:.4,y:.7,pressure:.5},{x:.8,y:.2,pressure:.5}]];ink.signedAt=Date.now();};
window.askWith=(fn)=>{window.__realAsk??=askConfirm;askConfirm=async(o)=>fn(o.title+'\\n\\n'+o.text)};window.askReal=()=>{if(window.__realAsk)askConfirm=window.__realAsk};
window.incomeRecords=()=>JSON.parse(localStorage.getItem(INCOME_KEY)||'{"records":[]}').records;
window.blobBase64=async(blob)=>{const b=new Uint8Array(await blob.arrayBuffer());let s='';for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));return btoa(s)};
`;
