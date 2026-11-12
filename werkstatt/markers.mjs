// Studio markers (text or regex) checked without ever blocking the Werkstatt. Regex markers run
// in the leak test over whole builds: constructs that can backtrack for ages are refused outright,
// and every match runs in a worker that is stopped after a few seconds.
import { Worker } from "node:worker_threads";

export function regexShapeError(source) {
  if (/\\[1-9]|\\k</.test(source)) return "keine Rückverweise (\\1, \\k<…>).";
  if (/\)[*+?{]/.test(source)) return "keine wiederholten Gruppen wie (…)+ oder (…)*.";
  if ((source.match(/(?<!\\)[*+]|\{\d+,\}/g) ?? []).length > 2) return "höchstens zwei offene Wiederholungen (*, +, {n,}).";
  if ([...source.matchAll(/\{(\d+)(?:,(\d*))?\}/g)].some((m) => Number(m[1]) > 50 || Number(m[2] || 0) > 50))
    return "Wiederholungen höchstens {0,50}.";
  if ((source.match(/(?<!\\)[*+?]|\{\d+(?:,\d*)?\}/g) ?? []).length > 4) return "höchstens vier Wiederholungen insgesamt.";
  return null;
}
const SLOW_INPUTS = ["a".repeat(30_000) + "!", " ".repeat(30_000) + "!", "aA0-. ".repeat(6_000) + "\u0000", "äöü".repeat(10_000) + "!"];
const MATCH_WORKER = `
const { parentPort, workerData } = require("node:worker_threads");
const { markers, slow, texts } = workerData;
const low = (t) => t.normalize("NFC").toLocaleLowerCase("de");
markers.forEach((m, index) => {
  let test;
  try {
    test = m.regex === undefined
      ? ((needle) => (t) => t.includes(needle))(low(m.text))
      : ((rx) => (t) => rx.test(t))(new RegExp(m.regex, m.flags));
  } catch {
    return parentPort.postMessage({ index, hits: [] });
  }
  for (const t of slow) test(low(t));
  parentPort.postMessage({ index, hits: texts.flatMap((t, i) => (test(t) ? [i] : [])) });
});
parentPort.postMessage({ done: true });`;

// Runs markers (own or other studios') over texts in a worker that is stopped after ms. Returns,
// per marker by position, the indexes of the texts it is found in, or null when it had to be
// stopped. Texts are normalised and lower-cased exactly like findMarkers does. Nothing user- or
// studio-defined ever runs a regex on the main thread.
export function matchInWorker(markers, texts, ms = 4000) {
  const low = (t) => String(t).normalize("NFC").toLocaleLowerCase("de");
  const list = markers.map((m) => (typeof m === "string" ? { text: m } : { regex: String(m?.regex ?? ""), flags: m?.flags ?? "i" }));
  const results = new Array(list.length).fill(null);
  if (!list.length) return Promise.resolve(results);
  return new Promise((resolve) => {
    const worker = new Worker(MATCH_WORKER, { eval: true, workerData: { markers: list, slow: SLOW_INPUTS, texts: texts.map(low) } });
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
      resolve(results);
    };
    const timer = setTimeout(finish, ms);
    worker.on("message", (m) => (m.done ? finish() : (results[m.index] = m.hits)));
    worker.on("error", finish);
  });
}

export async function probeMarkers(markers, { build = [], sample = "", others = [] } = {}, ms = 4000) {
  const texts = [...build.map(([, t]) => t), sample, ...others.map(([, t]) => t)];
  const hits = await matchInWorker(markers, texts, ms);
  const b = build.length;
  return hits.map((h) =>
    h === null
      ? null
      : {
          inBuild: h.filter((i) => i < b).map((i) => build[i][0]),
          inSample: h.includes(b),
          inOthers: h.filter((i) => i > b).map((i) => others[i - b - 1][0]),
        },
  );
}
