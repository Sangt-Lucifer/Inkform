// Werkstatt, part 5: one root certificate per studio for the on-site mode, only valid for the
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
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const NEUTRAL_HOST = "inkform-app.local";
export const certsRoot = (env = process.env) =>
  path.resolve(env.INKFORM_ZERTIFIKATE || path.join(homedir(), "Library", "Application Support", "Inkform", "zertifikate"));
const ID = /^[a-z0-9-]{3,40}$/;
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

export function passwordError(password) {
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
  if (!(await exists(path.join(dir, "ca.key")))) return { exists: false, dir, host: NEUTRAL_HOST };
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
  const file = (n) => path.join(dir, n);
  await writeFile(
    file("server.cnf"),
    `[req]\ndistinguished_name = dn\nprompt = no\n[dn]\nCN = ${NEUTRAL_HOST}\n[v3]\nbasicConstraints = critical, CA:FALSE\nkeyUsage = critical, digitalSignature, keyEncipherment\nextendedKeyUsage = serverAuth\nsubjectAltName = DNS:${NEUTRAL_HOST}\n`,
  );
  try {
    await ssl(["req", "-newkey", "rsa:2048", "-sha256", "-nodes", "-keyout", file("server.key.neu"), "-out", file("server.csr"), "-config", file("server.cnf")]);
    await chmod(file("server.key.neu"), 0o600);
    await ssl(
      ["x509", "-req", "-in", file("server.csr"), "-CA", file(`${id}.crt`), "-CAkey", file("ca.key"), "-passin", "fd:3", "-CAcreateserial", "-days", "825", "-sha256", "-extfile", file("server.cnf"), "-extensions", "v3", "-out", file("server.crt.neu")],
      password,
    );
    await ssl(["verify", "-CAfile", file(`${id}.crt`), file("server.crt.neu")]);
  } catch (error) {
    const { rm } = await import("node:fs/promises");
    await rm(file("server.key.neu"), { force: true });
    await rm(file("server.crt.neu"), { force: true });
    throw error;
  }
  // Replaced only once the new pair is complete and verified.
  const { rename } = await import("node:fs/promises");
  await rename(file("server.key.neu"), file("server.key"));
  await rename(file("server.crt.neu"), file("server.crt"));
  await writeFile(file("host.txt"), NEUTRAL_HOST + "\n");
}

// New root (10 years, name-constrained to inkform-app.local, key encrypted) plus server certificate.
export async function createCert(id, password, env = process.env) {
  const bad = passwordError(password);
  if (bad) return { error: bad };
  const dir = studioCertDir(id, env);
  if (await exists(path.join(dir, "ca.key"))) return { error: "Für dieses Studio gibt es schon ein Stammzertifikat. Es wird nicht ersetzt." };
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  await chmod(path.dirname(dir), 0o700).catch(() => {});
  const file = (n) => path.join(dir, n);
  await writeFile(
    file("ca.cnf"),
    `[req]\ndistinguished_name = dn\nprompt = no\nx509_extensions = v3\n[dn]\nCN = Inkform ${id} (${NEUTRAL_HOST})\nO = Inkform\n[v3]\nbasicConstraints = critical, CA:TRUE, pathlen:0\nkeyUsage = critical, keyCertSign, cRLSign\nsubjectKeyIdentifier = hash\nnameConstraints = critical, permitted;DNS:${NEUTRAL_HOST}\n`,
  );
  try {
    await ssl(["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:3072", "-aes-256-cbc", "-pass", "fd:3", "-out", file("ca.key")], password);
    await chmod(file("ca.key"), 0o600);
    await ssl(["req", "-x509", "-new", "-key", file("ca.key"), "-passin", "fd:3", "-sha256", "-days", "3650", "-out", file(`${id}.crt`), "-config", file("ca.cnf")], password);
    await serverCert(dir, id, password);
  } catch (error) {
    return { error: `Zertifikat konnte nicht erzeugt werden: ${error.message}` };
  }
  return certStatus(id, env);
}

// New server certificate with the same root: nothing to do on the iPad.
export async function renewCert(id, password, env = process.env) {
  const bad = passwordError(password);
  if (bad) return { error: bad };
  const dir = studioCertDir(id, env);
  if (!(await exists(path.join(dir, "ca.key")))) return { error: "Noch kein Stammzertifikat für dieses Studio." };
  try {
    await serverCert(dir, id, password);
  } catch (error) {
    const text = `${error.message}\n${error.details ?? ""}`;
    return { error: /decrypt|wrong password|bad password|could not (read|decode|find).*key|unable to load.*key/i.test(text) ? "Passwort falsch." : `Erneuern fehlgeschlagen: ${error.message}` };
  }
  return certStatus(id, env);
}

export async function readServerCert(id, env = process.env) {
  const dir = studioCertDir(id, env);
  const [key, cert] = await Promise.all([readFile(path.join(dir, "server.key")), readFile(path.join(dir, "server.crt"))]);
  return { key, cert, dir };
}
