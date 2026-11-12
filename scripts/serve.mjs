import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

// Local preview: binds to 127.0.0.1, never to the network.
//   node scripts/serve.mjs                                  build/beispiel/dist
//   node scripts/serve.mjs --profile ../Inkform-Studios/x   <profil>/build/dist
//   node scripts/serve.mjs --dir <ordner mit index.html>    any built dist folder
//
// iPad installation or update over the home network (only while this command runs):
//   node scripts/serve.mjs --profile ../Inkform-Studios/x --lan
// serves HTTPS on port 8443 with the certificate from scripts/lokales-zertifikat.mjs, reachable
// as https://<mac>.local:8443. Keep host name and port unchanged: the iPad stores the app's data
// per address. Only the static app is served; customer data never passes through this server.
//
// Additional options, used by the Werkstatt's on-site mode (without them nothing changes):
//   --cert-dir <ordner>   certificate folder (server.key, server.crt, host.txt) instead of the default
//   --bind <ip>           listen only on this address (e.g. the Wi-Fi address) instead of all
//   --log-requests        one line per request: time and path, never the client address
import { defaultOut, resolveProfileDir } from "./build.mjs";
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const lan = process.argv.includes("--lan");
const port = Number(arg("--port", lan ? "8443" : "8080"));
const profile = arg("--profile", "beispiel");
const root =
  path.resolve(arg("--dir", path.join(defaultOut(resolveProfileDir(profile)), "dist"))) + path.sep;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
};

const logRequests = process.argv.includes("--log-requests");
const handler = async (request, response) => {
  if (logRequests)
    // After the answer, with its status; only time, method, status and path (never the client).
    response.on("finish", () => {
      let pathname = "?";
      try {
        pathname = new URL(request.url, "http://localhost").pathname;
      } catch {}
      console.log(`ANFRAGE ${new Date().toISOString()} ${request.method} ${response.statusCode} ${pathname.replace(/\s/g, "")}`);
    });
  try {
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405).end();
      return;
    }
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const filename = path.resolve(
      root,
      `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`,
    );
    // Hidden entries (.git, .DS_Store …) are never served, e.g. when --dir is a repository.
    if (!filename.startsWith(root) || pathname.split("/").some((part) => part.startsWith(".")) || !(await stat(filename)).isFile()) {
      response.writeHead(404).end();
      return;
    }
    const body = await readFile(filename);
    response.writeHead(200, {
      "Content-Type": types[path.extname(filename)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    response.writeHead(404).end();
  }
};

if (lan) {
  const dir = path.resolve(arg("--cert-dir", path.join(homedir(), "Library", "Application Support", "Inkform", "zertifikat")));
  const read = (n) =>
    readFile(path.join(dir, n)).catch(() => {
      throw new Error(`Zertifikat fehlt (${n}). Zuerst: node scripts/lokales-zertifikat.mjs`);
    });
  const [key, cert, host] = await Promise.all([read("server.key"), read("server.crt"), read("host.txt")]);
  createHttpsServer({ key, cert }, handler).listen(port, arg("--bind", "0.0.0.0"), () => {
    console.log(`Für das iPad: https://${String(host).trim()}:${port}/  (${root})`);
    console.log("Läuft nur, solange dieses Fenster offen ist. Beenden mit Ctrl+C.");
  });
} else
  createServer(handler).listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port} (${root})`));
