// One root certificate per studio for the on-site mode, only valid for the
// neutral address inkform-app.local. Uses the system's openssl, nothing is downloaded.
//
//   ~/Library/Application Support/Inkform/zertifikate/<studio>/
//     <studio>.crt   root certificate: AirDrop to the iPad, install and trust it there
//     ca.key         root key, encrypted with a password (AES-256); never shown, never copied
//     server.crt/key server certificate (825 days) used while the on-site server runs
//
// The password is only needed to create the root and to renew the server certificate. It is
// handed to openssl through a separate pipe (never on the command line, in the environment or in
// a file) and never stored. The existing installation's certificate in .../Inkform/zertifikat/ is
// not touched by any of this.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { STUDIO_ID } from "./status.mjs";

export const NEUTRAL_HOST = "inkform-app.local";
const certsRoot = (env = process.env) =>
  path.resolve(env.INKFORM_ZERTIFIKATE || path.join(homedir(), "Library", "Application Support", "Inkform", "zertifikate"));
const ID = STUDIO_ID;
const exists = (p) => access(p).then(() => true, () => false);

// Runs openssl; a password goes in through file descriptor 3 ("fd:3"), nothing else sees it.
function ssl(args, password = null) {
  return new Promise((resolve, reject) => {
    const child = spawn("openssl", args, { stdio: ["ignore", "pipe", "pipe", "pipe"], env: { PATH: "/usr/bin:/bin" } });
    let out = "",
      err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.stdio[3].on("error", () => {});
    if (password !== null) child.stdio[3].end(`${password}\n`);
    else child.stdio[3].end();
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve(out);
      const lines = err.split("\n").filter((l) => l.trim() && !/^Signature ok|^Certificate request self-signature ok|^subject=/.test(l));
      reject(Object.assign(new Error(lines.at(-1) || `openssl ${code}`), { details: err }));
    });
  });
}

function passwordError(password) {
  if (typeof password !== "string" || password.length < 12) return "Passwort: mindestens 12 Zeichen.";
  if (password.length > 200 || /[\r\n\u0000]/.test(password)) return "Passwort: höchstens 200 Zeichen, eine Zeile.";
  return null;
}

export function studioCertDir(id, env = process.env) {
  if (!ID.test(id)) throw new Error("Ungültige Studio-Kennung.");
  return path.join(certsRoot(env), id);
}

async function until(file) {
  const out = await ssl(["x509", "-in", file, "-noout", "-enddate"]);
  const date = new Date(out.trim().replace("notAfter=", ""));
  return { until: date.toISOString(), daysLeft: Math.floor((date - Date.now()) / 86_400_000) };
}

export async function certStatus(id, env = process.env) {
  const dir = studioCertDir(id, env);
  // Complete means: encrypted root key and root certificate. Anything less counts as missing.
  if (!(await exists(path.join(dir, "ca.key"))) || !(await exists(path.join(dir, `${id}.crt`)))) return { exists: false, dir, host: NEUTRAL_HOST };
  const root = await until(path.join(dir, `${id}.crt`)).catch(() => null);
  const server = (await exists(path.join(dir, "server.crt"))) ? await until(path.join(dir, "server.crt")).catch(() => null) : null;
  const warnings = [];
  if (!server) warnings.push("Kein Serverzertifikat. Bitte erneuern.");
  else if (server.daysLeft < 0) warnings.push("Das Serverzertifikat ist abgelaufen. Bitte erneuern; am iPad ist nichts zu tun.");
  else if (server.daysLeft < 60) warnings.push(`Das Serverzertifikat läuft in ${server.daysLeft} Tagen ab. Bitte erneuern; am iPad ist nichts zu tun.`);
  if (root && root.daysLeft < 365) warnings.push(`Das Stammzertifikat läuft in ${root.daysLeft} Tagen ab. Dann ein neues erzeugen und einmal neu aufs iPad bringen.`);
  return { exists: true, dir, host: NEUTRAL_HOST, rootFile: path.join(dir, `${id}.crt`), root, server, warnings };
}

async function serverCert(dir, id, password) {
  // Everything new is made in a private work folder inside the certificate folder; only the
  // finished, verified files are renamed into place (a rename replaces a link instead of writing
  // through it). The serial number is random, so openssl writes no serial file next to the root.
  const work = await mkdtemp(path.join(dir, ".server-neu-"));
  const w = (n) => path.join(work, n);
  try {
    await writeFile(
      w("server.cnf"),
      `[req]\ndistinguished_name = dn\nprompt = no\n[dn]\nCN = ${NEUTRAL_HOST}\n[v3]\nbasicConstraints = critical, CA:FALSE\nkeyUsage = critical, digitalSignature, keyEncipherment\nextendedKeyUsage = serverAuth\nsubjectAltName = DNS:${NEUTRAL_HOST}\n`,
      { flag: "wx" },
    );
    await ssl(["req", "-newkey", "rsa:2048", "-sha256", "-nodes", "-keyout", w("server.key"), "-out", w("server.csr"), "-config", w("server.cnf")]);
    await chmod(w("server.key"), 0o600);
    await ssl(
      ["x509", "-req", "-in", w("server.csr"), "-CA", path.join(dir, `${id}.crt`), "-CAkey", path.join(dir, "ca.key"), "-passin", "fd:3", "-set_serial", `0x${randomBytes(16).toString("hex")}`, "-days", "825", "-sha256", "-extfile", w("server.cnf"), "-extensions", "v3", "-out", w("server.crt")],
      password,
    );
    await ssl(["verify", "-CAfile", path.join(dir, `${id}.crt`), w("server.crt")]);
    await writeFile(w("host.txt"), NEUTRAL_HOST + "\n", { flag: "wx" });
    for (const n of ["server.key", "server.crt", "host.txt"]) await rename(w(n), path.join(dir, n));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

// New root (10 years, name-constrained to inkform-app.local, key encrypted) plus server certificate.
// One certificate operation per studio at a time (create and renew wait for each other).
const busy = new Map();
function exclusive(key, work) {
  const previous = busy.get(key) ?? Promise.resolve();
  const next = previous.then(work, work);
  busy.set(key, next.catch(() => {}));
  return next;
}

export function createCert(id, password, env = process.env) {
  return exclusive(studioCertDir(id, env), () => createCertNow(id, password, env));
}
export function renewCert(id, password, env = process.env) {
  return exclusive(studioCertDir(id, env), () => renewCertNow(id, password, env));
}

async function createCertNow(id, password, env) {
  const bad = passwordError(password);
  if (bad) return { error: bad };
  const dir = studioCertDir(id, env);
  if ((await certStatus(id, env)).exists) return { error: "Für dieses Studio gibt es schon ein Stammzertifikat. Es wird nicht ersetzt." };
  // Everything is made in a private work folder next to it and only takes the studio's name once
  // complete and verified. A half-made folder from an interrupted earlier attempt is kept aside
  // (renamed, never deleted), so a new attempt is always possible.
  const parent = path.dirname(dir);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await chmod(parent, 0o700).catch(() => {});
  const work = await mkdtemp(path.join(parent, `.${id}.neu-`));
  await chmod(work, 0o700);
  const file = (n) => path.join(work, n);
  try {
    await writeFile(
      file("ca.cnf"),
      `[req]\ndistinguished_name = dn\nprompt = no\nx509_extensions = v3\n[dn]\nCN = Inkform ${id} (${NEUTRAL_HOST})\nO = Inkform\n[v3]\nbasicConstraints = critical, CA:TRUE, pathlen:0\nkeyUsage = critical, keyCertSign, cRLSign\nsubjectKeyIdentifier = hash\nnameConstraints = critical, permitted;DNS:${NEUTRAL_HOST}\n`,
    );
    await ssl(["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:3072", "-aes-256-cbc", "-pass", "fd:3", "-out", file("ca.key")], password);
    await chmod(file("ca.key"), 0o600);
    await ssl(["req", "-x509", "-new", "-key", file("ca.key"), "-passin", "fd:3", "-sha256", "-days", "3650", "-out", file(`${id}.crt`), "-config", file("ca.cnf")], password);
    await serverCert(work, id, password);
    // Checked again right before: a complete root that exists by now is never replaced.
    if ((await certStatus(id, env)).exists) throw new Error("Für dieses Studio gibt es inzwischen ein Stammzertifikat. Es wird nicht ersetzt.");
    if (await exists(dir)) await rename(dir, path.join(parent, `.${id}.unvollstaendig-${Date.now()}`));
    await rename(work, dir);
  } catch (error) {
    await rm(work, { recursive: true, force: true }).catch(() => {});
    return { error: `Zertifikat konnte nicht erzeugt werden: ${error.message}` };
  }
  return certStatus(id, env);
}

// New server certificate with the same root: nothing to do on the iPad.
async function renewCertNow(id, password, env) {
  const bad = passwordError(password);
  if (bad) return { error: bad };
  const dir = studioCertDir(id, env);
  if (!(await certStatus(id, env)).exists) return { error: "Noch kein vollständiges Stammzertifikat für dieses Studio." };
  try {
    await serverCert(dir, id, password);
  } catch (error) {
    const text = `${error.message}\n${error.details ?? ""}`;
    return { error: /decrypt|wrong password|bad password|could not (read|decode|find).*key|unable to load.*key/i.test(text) ? "Passwort falsch." : `Erneuern fehlgeschlagen: ${error.message}` };
  }
  return certStatus(id, env);
}
