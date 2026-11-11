// Creates a local HTTPS certificate so the iPad can load the app once from this Mac over the home
// network (Wi-Fi), without any cloud service. Uses the system's openssl, nothing is downloaded.
//
//   node scripts/lokales-zertifikat.mjs                 host = this Mac's Bonjour name (.local)
//   node scripts/lokales-zertifikat.mjs --host <name>   e.g. studio-mac (".local" is appended)
//   node scripts/lokales-zertifikat.mjs --renew         new server certificate, same root
//
// Output (outside every repository, private keys readable only by this user):
//   ~/Library/Application Support/Inkform/zertifikat/
//     Inkform-Lokal.crt    root certificate: install on the iPad (AirDrop), then trust it
//     ca.key               root key: never copy anywhere
//     server.crt/key       used by: node scripts/serve.mjs --lan
//
// The root is name-constrained to exactly this one host name: even if its key leaked, it could
// not be used to impersonate any other website. Server certificate: 825 days (iPadOS limit for
// user-installed roots); renew with --renew before it expires, the iPad keeps the root.
import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile, access } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const value = (n) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : undefined);
export const certDir = path.join(homedir(), "Library", "Application Support", "Inkform", "zertifikat");
const bonjour = () => execFileSync("scutil", ["--get", "LocalHostName"], { encoding: "utf8" }).trim();
const host = `${(value("--host") || bonjour()).replace(/\.local$/i, "").toLowerCase()}.local`;
if (!/^[a-z0-9-]+\.local$/.test(host)) throw new Error(`Ungültiger Rechnername: ${host}`);

const file = (n) => path.join(certDir, n);
const exists = (p) => access(p).then(() => true, () => false);
const ssl = (...args) => execFileSync("openssl", args, { stdio: ["ignore", "pipe", "pipe"] });

await mkdir(certDir, { recursive: true, mode: 0o700 });
await chmod(certDir, 0o700);

if (!(await exists(file("ca.key")))) {
  if (flag("--renew")) throw new Error("Kein Stammzertifikat vorhanden. Bitte ohne --renew erzeugen.");
  await writeFile(
    file("ca.cnf"),
    `[req]
distinguished_name = dn
prompt = no
x509_extensions = v3
[dn]
CN = Inkform lokal (${host})
O = Inkform
[v3]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
nameConstraints = critical, permitted;DNS:${host}
`,
  );
  ssl("req", "-x509", "-newkey", "rsa:3072", "-sha256", "-days", "3650", "-nodes",
    "-keyout", file("ca.key"), "-out", file("Inkform-Lokal.crt"), "-config", file("ca.cnf"));
  await chmod(file("ca.key"), 0o600);
  console.log("Stammzertifikat erzeugt (10 Jahre, nur gültig für " + host + ").");
} else {
  const existing = ssl("x509", "-in", file("Inkform-Lokal.crt"), "-noout", "-text").toString();
  if (!existing.includes(`DNS:${host}`))
    throw new Error(`Das vorhandene Stammzertifikat gilt nicht für ${host}. Ordner prüfen: ${certDir}`);
}

await writeFile(
  file("server.cnf"),
  `[req]
distinguished_name = dn
prompt = no
[dn]
CN = ${host}
[v3]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = DNS:${host}
`,
);
ssl("req", "-newkey", "rsa:2048", "-sha256", "-nodes", "-keyout", file("server.key"),
  "-out", file("server.csr"), "-config", file("server.cnf"));
ssl("x509", "-req", "-in", file("server.csr"), "-CA", file("Inkform-Lokal.crt"), "-CAkey", file("ca.key"),
  "-CAcreateserial", "-days", "825", "-sha256", "-extfile", file("server.cnf"), "-extensions", "v3",
  "-out", file("server.crt"));
await chmod(file("server.key"), 0o600);
ssl("verify", "-CAfile", file("Inkform-Lokal.crt"), file("server.crt"));
const until = ssl("x509", "-in", file("server.crt"), "-noout", "-enddate").toString().trim().replace("notAfter=", "");
await writeFile(file("host.txt"), host + "\n");
console.log(`Serverzertifikat für ${host}, gültig bis ${until}.`);
console.log(`Ordner: ${certDir}`);
console.log(`Für das iPad: ${file("Inkform-Lokal.crt")} (per AirDrop senden)`);
