// Werkstatt, part 2: runs build.mjs, the unit/leak tests and the browser checks as separate
// processes (the existing tools, unchanged) and turns their output into a readable summary.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { root } from "../scripts/build.mjs";
import { gitInfo } from "./status.mjs";

export const KINDS = {
  build: { label: "Bauen" },
  test: { label: "Unit- und Leak-Tests (alle Profile über Kreuz)" },
  browser: { label: "Browser-Prüfungen" },
  alles: { label: "Bauen, Tests und Browser-Prüfungen" },
};
const MAX_LOG = 400_000;
const strip = (text) => text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");

export function summarizeBuild(output, code) {
  const lines = output.trim().split("\n").filter(Boolean);
  return code === 0
    ? { ok: true, text: "Gebaut: eigenständige index.html und offline-fähiges dist/." }
    : { ok: false, text: `Bauen fehlgeschlagen: ${lines.at(-1) ?? "unbekannter Fehler"}` };
}

export function summarizeTests(output, code) {
  const num = (name) => Number(output.match(new RegExp(`ℹ ${name} (\\d+)`))?.[1] ?? NaN);
  const pass = num("pass"),
    fail = num("fail");
  const failing = [...new Set([...output.matchAll(/^✖ (.+?)(?: \(\d[\d.]*ms\))?$/gm)].map((m) => m[1].trim()))].filter(
    (n) => n !== "failing tests:",
  );
  // Leak findings name the file and the marker ("build/x: Kennzeichen …", "…: Datei logo.png").
  const leaks = [...new Set([...output.matchAll(/'([^'\n]*(?:Kennzeichen|: Datei) [^'\n]*)'/g)].map((m) => m[1]))];
  const ok = code === 0 && fail === 0;
  const text = Number.isFinite(pass)
    ? `${pass} von ${pass + (fail || 0)} Tests bestanden${fail ? `, ${fail} fehlgeschlagen` : ""}.`
    : "Tests konnten nicht ausgewertet werden.";
  return { ok, text, failing: failing.slice(0, 20), leaks: leaks.slice(0, 20) };
}

export function summarizeBrowser(output, code) {
  const total = output.match(/(\d+)\/(\d+) Browser-Prüfungen bestanden/);
  const failed = [...output.matchAll(/^FAIL (\S+)/gm)].map((m) => m[1]);
  const reasons = [
    ...new Set(
      [...output.matchAll(/AssertionError \[ERR_ASSERTION\]: (.+)|Error: (Nicht erreicht: .+)/g)].map((m) =>
        (m[1] ?? m[2]).slice(0, 200),
      ),
    ),
  ];
  const ok = code === 0 && !!total && total[1] === total[2];
  return {
    ok,
    text: total ? `${total[1]} von ${total[2]} Browser-Prüfungen bestanden.` : "Browser-Prüfungen nicht abgeschlossen.",
    failing: failed,
    reasons: reasons.slice(0, 10),
  };
}

const STEPS = {
  build: (ref) => ({ args: [path.join(root, "scripts/build.mjs"), "--profile", ref], summarize: summarizeBuild }),
  // npm test: every *.test.mjs, leak tests across all profiles (they only read other studios).
  test: () => ({ glob: true, summarize: summarizeTests }),
  browser: (ref) => ({ args: [path.join(root, "tests/browser/run.mjs"), "--profile", ref], summarize: summarizeBrowser }),
};

// node --test treats its arguments as glob patterns; the project folder "[6] Projekte" contains
// brackets, so absolute paths would not match. Test files are passed relative to the core folder
// (the process runs there).
export async function testFileArgs() {
  return (await readdir(path.join(root, "tests")))
    .filter((f) => f.endsWith(".test.mjs"))
    .sort()
    .map((f) => `tests/${f}`);
}

export function createRunner({ stateDir, env = process.env }) {
  let current = null;
  const runsDir = path.join(stateDir, "laeufe");

  function step(kind, ref, record) {
    return new Promise(async (resolve) => {
      const spec = STEPS[kind](ref);
      const args = spec.glob ? ["--test", "--test-timeout=60000", ...(await testFileArgs())] : spec.args;
      record.log += `\n▶ ${KINDS[kind].label}\n`;
      const child = spawn(process.execPath, args, { cwd: root, env: { ...env, FORCE_COLOR: "0" } });
      let output = "";
      const take = (chunk) => {
        const text = strip(String(chunk));
        output += text;
        record.log = (record.log + text).slice(-MAX_LOG);
      };
      child.stdout.on("data", take);
      child.stderr.on("data", take);
      child.on("close", (code) => {
        const summary = spec.summarize(output, code ?? 1);
        record.steps.push({ kind, label: KINDS[kind].label, code, ...summary });
        resolve(summary.ok);
      });
    });
  }

  async function start(entry, kind) {
    if (!KINDS[kind]) throw Object.assign(Error("Unbekannte Aktion."), { status: 400 });
    if (!entry.actionable) throw Object.assign(Error(entry.protectedReason), { status: 403 });
    if (current && !current.endedAt)
      throw Object.assign(Error("Es läuft bereits eine Prüfung. Bitte warten."), { status: 409 });
    const [core, studio] = await Promise.all([gitInfo(root), entry.kind === "studio" ? gitInfo(entry.dir) : null]);
    const record = {
      id: randomUUID(),
      studio: entry.key,
      name: entry.name,
      kind,
      label: KINDS[kind].label,
      startedAt: new Date().toISOString(),
      endedAt: null,
      ok: null,
      steps: [],
      log: "",
      // Which sources were checked: Phase 3 exports only if these match the current state.
      core: { commit: core.commit, clean: core.clean },
      profile: studio ? { commit: studio.commit, clean: studio.clean } : null,
    };
    current = record;
    const ref = entry.kind === "blanko" ? entry.id : entry.dir;
    (async () => {
      let ok = true;
      for (const k of kind === "alles" ? ["build", "test", "browser"] : [kind]) {
        ok = await step(k, ref, record);
        if (!ok) break;
      }
      record.ok = ok;
      record.endedAt = new Date().toISOString();
      await mkdir(runsDir, { recursive: true, mode: 0o700 });
      await writeFile(path.join(runsDir, `${record.startedAt.replace(/[:.]/g, "-")}_${entry.key}_${kind}.json`), JSON.stringify(record, null, 2));
    })();
    return record;
  }

  // Latest finished run per studio and kind (from disk) plus the run in progress.
  async function latest() {
    const files = (await readdir(runsDir).catch(() => [])).filter((f) => f.endsWith(".json")).sort();
    const result = {};
    for (const file of files) {
      const r = await readFile(path.join(runsDir, file), "utf8").then(JSON.parse, () => null);
      if (!r) continue;
      for (const s of r.steps) result[`${r.studio}:${s.kind}`] = { at: r.endedAt, ok: s.ok, text: s.text, core: r.core, profile: r.profile };
    }
    return result;
  }

  return { start, latest, current: () => current };
}
