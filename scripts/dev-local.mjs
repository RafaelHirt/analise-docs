import http from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { BlobsServer } from "@netlify/blobs/server";

const require = createRequire(import.meta.url);
const { handler } = require("../netlify/functions/api.js");
const config = await readFile(new URL("../netlify.toml", import.meta.url), "utf8");
const csp = JSON.parse(config.match(/Content-Security-Policy = (.+)/)[1]);
const root = resolve(fileURLToPath(new URL("../public/", import.meta.url)));
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm" };

// Real GEMOD handler and official Netlify Blobs emulator, isolated from remote sites.
export async function startLocal({ port = Number(process.env.PORT || 8888), directory = fileURLToPath(new URL("../.netlify/local-blobs/", import.meta.url)) } = {}) {
  await mkdir(directory, { recursive: true });
  const token = randomBytes(32).toString("hex");
  const blobs = new BlobsServer({ directory, token });
  const address = await blobs.start();
  const localURL = `http://127.0.0.1:${address.port}`;
  const blobsContext = Buffer.from(JSON.stringify({ url: localURL, url_uncached: localURL, token })).toString("base64");
  // BlobsServer 11.1.7 omits ETags on GET, although its LIST and conditional
  // PUT implement them. Adapt this local emulator gap without weakening the
  // production storage layer. Each GET+LIST pair is serialized with local PUTs.
  let queue = Promise.resolve();
  const localBlobsFetch = (url, options = {}) => {
    const task = queue.then(async () => {
      const response = await fetch(url, options);
      const bytes = await response.arrayBuffer();
      const headers = new Headers(response.headers);
      const parsed = new URL(url);
      const parts = parsed.pathname.split("/").filter(Boolean);
      if ((options.method || "GET").toUpperCase() === "GET" && response.ok && parts.length >= 3 && !headers.has("etag")) {
        const key = decodeURIComponent(parts.slice(2).join("/"));
        const listing = new URL(`/${parts.slice(0, 2).join("/")}`, localURL);
        listing.searchParams.set("prefix", key);
        const listed = await fetch(listing, { headers: options.headers });
        const entry = (await listed.json()).blobs?.find((item) => item.key === key);
        if (!entry?.etag) throw new Error("Emulador local não forneceu a versão do registro.");
        headers.set("etag", entry.etag);
      }
      return new Response([204, 304].includes(response.status) ? null : bytes, { status: response.status, headers });
    });
    queue = task.catch(() => {});
    return task;
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      res.setHeader("x-content-type-options", "nosniff");
      res.setHeader("content-security-policy", csp);
      res.setHeader("x-frame-options", "DENY");
      res.setHeader("cache-control", "no-store");
      if (url.pathname.startsWith("/api/")) {
        const parts = []; let length = 0;
        for await (const chunk of req) {
          length += chunk.length;
          if (length > 4 * 1024 * 1024) { res.writeHead(413); res.end("Corpo muito grande"); return; }
          parts.push(chunk);
        }
        const result = await handler({ httpMethod: req.method, path: url.pathname,
          headers: { ...req.headers, "x-nf-site-id": "analise-docs-local", "x-nf-deploy-id": "local" },
          blobs: blobsContext, body: Buffer.concat(parts).toString("utf8"),
          localBlobsFetch,
          queryStringParameters: Object.fromEntries(url.searchParams),
        });
        res.writeHead(result.statusCode, result.headers);
        res.end(result.isBase64Encoded ? Buffer.from(result.body, "base64") : result.body);
        return;
      }
      let path = resolve(root, "." + decodeURIComponent(url.pathname));
      if (!path.startsWith(root + sep) && path !== root) { res.writeHead(403); res.end(); return; }
      if (!extname(path)) path = resolve(root, "index.html");
      const data = await readFile(path);
      res.setHeader("content-type", `${types[extname(path)] || "application/octet-stream"}; charset=utf-8`);
      res.end(data);
    } catch (error) {
      res.writeHead(error.code === "ENOENT" ? 404 : 500);
      res.end("Não foi possível atender a requisição local.");
    }
  });
  await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolveListen); });
  return { port: server.address().port, close: async () => {
    await new Promise((done) => server.close(done));
    await blobs.stop();
  } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const runtime = await startLocal();
  console.log(`Análise Docs local iniciado na porta ${runtime.port}; armazenamento isolado em .netlify/local-blobs.`);
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => { await runtime.close(); process.exit(0); });
}
