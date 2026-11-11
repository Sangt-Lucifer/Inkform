// Werkstatt, part 2: runs build.mjs, the unit/leak tests and the browser checks as separate
// processes (the existing tools, unchanged) and turns their output into a readable summary.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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

// fs and listTests can be replaced in tests to simulate disk and permission errors.
export function createRunner({ stateDir, env = process.env, fs = { mkdir, writeFile, rename, rm }, listTests = testFileArgs }) {
  let current = null;
  // Results of this session's runs, shown even if their record could not be saved.
  const session = new Map();
  const runsDir = path.join(stateDir, "laeufe");

  // Errors before the process starts (e.g. reading the test list) reject and end the run as red.
  async function step(kind, ref, record) {
    const spec = STEPS[kind](ref);
    const args = spec.glob ? ["--test", "--test-timeout=60000", ...(await listTests())] : spec.args;
    return new Promise((resolve) => {
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
      let finished = false;
      child.on("error", (error) => {
        if (finished) return;
        finished = true;
        record.steps.push({ kind, label: KINDS[kind].label, code: null, ok: false, text: `Start fehlgeschlagen: ${error.message}` });
        resolve(false);
      });
      child.on("close", (code) => {
        if (finished) return;
        finished = true;
        const summary = spec.summarize(output, code ?? 1);
        record.steps.push({ kind, label: KINDS[kind].label, code, ...summary });
        resolve(summary.ok);
      });
    });
  }

  async function start(entry, kind) {
    if (!KINDS[kind]) throw Object.assign(Error("Unbekannte Aktion."), { status: 400 });
    if (!entry.actionable) throw Object.assign(Error(entry.protectedReason), { status: 403 });
    // The slot is taken synchronously, before the first await: two requests arriving at the same
    // time can never both start a run.
    if (current && !current.endedAt)
      throw Object.assign(Error("Es läuft bereits eine Prüfung. Bitte warten."), { status: 409 });
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
      core: null,
      profile: null,
    };
    current = record;
    const ref = entry.kind === "blanko" ? entry.id : entry.dir;
    const sequence = kind === "alles" ? ["build", "test", "browser"] : [kind];
    (async () => {
      let ok = false,
        active = sequence[0];
      try {
        const [core, studio] = await Promise.all([gitInfo(root), entry.kind === "studio" ? gitInfo(entry.dir) : null]);
        record.core = { commit: core.commit ?? null, clean: core.clean ?? false };
        record.profile = studio ? { commit: studio.commit ?? null, clean: studio.clean ?? false } : null;
        ok = true;
        for (const k of sequence) {
          active = k;
          ok = await step(k, ref, record);
          if (!ok) break;
        }
      } catch (error) {
        ok = false;
        record.log += `\nFehler: ${error.message}\n`;
        // The failed action gets a red result, so an older green one is no longer shown.
        if (!record.steps.some((s) => s.kind === active))
          record.steps.push({ kind: active, label: KINDS[active].label, code: null, ok: false, text: `Vorbereitung fehlgeschlagen: ${error.message}` });
      }
      // Green only once the record is saved (written to a temporary file, then renamed, so a
      // record is never half-written). The slot is released last, on every path.
      const endedAt = new Date().toISOString();
      const file = path.join(runsDir, `${record.startedAt.replace(/[:.]/g, "-")}_${entry.key}_${kind}.json`);
      try {
        await fs.mkdir(runsDir, { recursive: true, mode: 0o700 });
        await fs.writeFile(`${file}.tmp`, JSON.stringify({ ...record, ok, endedAt }, null, 2));
        await fs.rename(`${file}.tmp`, file);
      } catch (error) {
        // No half-written leftovers: the temporary file goes, whatever step failed.
        await fs.rm?.(`${file}.tmp`, { force: true }).catch(() => {});
        ok = false;
        record.saveError = `Protokoll nicht gespeichert: ${error.message}`;
        record.log += `\n${record.saveError}\n`;
        record.steps.push({ kind: "speichern", label: "Protokoll speichern", code: null, ok: false, text: record.saveError });
      }
      for (const st of record.steps)
        if (KINDS[st.kind])
          session.set(`${entry.key}:${st.kind}`, {
            at: endedAt,
            ok: st.ok && !record.saveError,
            text: record.saveError ? `${st.text} (${record.saveError})` : st.text,
            core: record.core,
            profile: record.profile,
          });
      record.ok = ok;
      record.endedAt = endedAt;
    })();
    return record;
  }

  // Latest finished run per studio and kind (from disk) plus the run in progress.
  async function latest() {
    const files = (await readdir(runsDir).catch(() => [])).filter((f) => f.endsWith(".json")).sort();
    const result = {};
    for (const file of files) {
      let r = null;
      try {
        r = JSON.parse(await readFile(path.join(runsDir, file), "utf8"));
      } catch (_) {
        continue; // a damaged record is skipped, it never blocks the overview
      }
      if (!Array.isArray(r?.steps)) continue;
      for (const s of r.steps)
        if (s && typeof s === "object" && Object.hasOwn(KINDS, s.kind)) result[`${r.studio}:${s.kind}`] = { at: r.endedAt, ok: s.ok === true, text: String(s.text ?? ""), core: r.core, profile: r.profile };
    }
    // This session's results win, including runs whose record could not be saved.
    for (const [key, value] of session) result[key] = value;
    return result;
  }

  return { start, latest, current: () => current };
}
