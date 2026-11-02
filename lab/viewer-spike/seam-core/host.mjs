// The spike's hosts: the core's series-server on a fresh certificate, and a static host that sends the product's three
// isolation headers and its Content-Security-Policy on every response (deploy/README.md §What must be preserved exactly).
import { execFileSync, spawn } from "node:child_process";
import { createSocket } from "node:dgram";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";

const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html", ".wasm": "application/wasm", ".json": "application/json" };
export const policy = (wt) =>
  `default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${wt}; ` +
  "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

const children = [];
process.on("exit", () => children.forEach((c) => c.kill("SIGKILL")));

async function freeUdpPort() {
  const s = createSocket("udp4");
  await new Promise((r) => s.bind(0, "127.0.0.1", r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

/** The bundle's own metadata, as client/viewer/check.mjs reads it. */
function metadataOf(sbnd) {
  const b = readFileSync(sbnd);
  return b.subarray(16 + 12 * b.readUInt32LE(12), 16 + 12 * b.readUInt32LE(12) + b.readUInt32LE(8));
}

export async function seriesServer(core, sbnd) {
  const T = mkdtempSync(join(tmpdir(), "seam-core-"));
  const [key, cert] = [`${T}/key.pem`, `${T}/cert.pem`];
  execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-keyout", key, "-out", cert,
    "-days", "2", "-nodes", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
  const hash = execFileSync("openssl", ["dgst", "-sha256", "-r"], { input: execFileSync("openssl", ["x509", "-in", cert, "-outform", "DER"]) }).toString().split(" ")[0];
  const port = await freeUdpPort();
  const server = spawn(join(core, "target/release/series-server"), ["--port", String(port), "--bind", "127.0.0.1", "--series", sbnd, "--cert-pem", cert, "--key-pem", key], { stdio: ["ignore", "pipe", "inherit"] });
  children.push(server);
  await new Promise((resolve, reject) => {
    let out = "";
    server.stdout.on("data", (d) => ((out += d), /transport=/.test(out) && resolve()));
    server.once("exit", (c) => reject(new Error(`series-server exited ${c}: ${out}`)));
  });
  return { wt: `https://127.0.0.1:${port}`, transport: { wt_url: `https://127.0.0.1:${port}/`, cert_sha256: hash, client: "ts" }, metadata: metadataOf(sbnd) };
}

/** `/client/` from the core's tree, the rest from this checkout; `routes` answer exact paths first. */
export function staticHost({ core, root, routes, wt }) {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Content-Security-Policy", policy(wt));
    try {
      const body = routes[path]?.() ?? (await readFile(join(path.startsWith("/client/") ? core : root, normalize(path))));
      res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}
