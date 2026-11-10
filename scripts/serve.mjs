import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

// Local preview only: binds to 127.0.0.1, never to the network.
//   node scripts/serve.mjs                                  build/beispiel/dist
//   node scripts/serve.mjs --profile ../Inkform-Studios/x   <profil>/build/dist
//   node scripts/serve.mjs --dir <ordner mit index.html>    any built dist folder
import { defaultOut, resolveProfileDir } from "./build.mjs";
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const port = Number(arg("--port", "8080"));
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

createServer(async (request, response) => {
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
    if (!filename.startsWith(root) || !(await stat(filename)).isFile()) {
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
}).listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port} (${root})`));
