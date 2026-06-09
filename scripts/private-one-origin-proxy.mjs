#!/usr/bin/env node
import { createReadStream, statSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = resolve(
  process.env.HVC_PROXY_DIST_ROOT ?? join(repoRoot, "apps/web/dist"),
);
const backend = new URL(
  process.env.HVC_BACKEND_ORIGIN ?? "http://127.0.0.1:8765",
);
const host = process.env.HVC_PROXY_HOST ?? "127.0.0.1";
const port = Number(process.env.HVC_PROXY_PORT ?? "8787");

const apiPrefixes = [
  "/auth",
  "/gemini",
  "/tools",
  "/chat",
  "/confirmations",
  "/logs",
  "/healthz",
  "/readyz",
];

const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
  [".json", "application/json; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
]);

function isApiPath(pathname) {
  return apiPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function cleanHeaders(headers) {
  const next = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!hopByHopHeaders.has(key.toLowerCase())) next[key] = value;
  }
  return next;
}

function proxyApi(req, res, url) {
  const target = new URL(`${url.pathname}${url.search}`, backend);
  const remoteAddress = req.socket.remoteAddress ?? "";
  const existingForwardedFor = req.headers["x-forwarded-for"];
  const forwardedFor = [
    ...(Array.isArray(existingForwardedFor)
      ? existingForwardedFor
      : existingForwardedFor
        ? [existingForwardedFor]
        : []),
    remoteAddress,
  ]
    .filter(Boolean)
    .join(", ");
  const proxy = httpRequest(
    target,
    {
      method: req.method,
      headers: {
        ...cleanHeaders(req.headers),
        host: backend.host,
        "x-forwarded-for": forwardedFor,
        "x-forwarded-host": req.headers.host ?? "",
        "x-forwarded-proto": "https",
        "x-real-ip": remoteAddress,
      },
    },
    (backendRes) => {
      res.writeHead(
        backendRes.statusCode ?? 502,
        cleanHeaders(backendRes.headers),
      );
      backendRes.pipe(res);
    },
  );
  proxy.on("error", () => {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ detail: "Backend proxy failed" }));
  });
  req.pipe(proxy);
}

function resolveAssetPath(pathname) {
  let decoded = "/";
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return join(distRoot, "index.html");
  }

  const relativePath = decoded === "/" ? "index.html" : `.${decoded}`;
  const assetPath = resolve(distRoot, relativePath);
  const insideDist =
    assetPath === distRoot || assetPath.startsWith(`${distRoot}${sep}`);
  return insideDist ? assetPath : join(distRoot, "index.html");
}

function sendFile(res, filePath) {
  const stat = statSync(filePath);
  if (!stat.isFile()) throw new Error("not file");
  res.writeHead(200, {
    "content-type":
      contentTypes.get(extname(filePath)) ?? "application/octet-stream",
    "content-length": stat.size,
    "cache-control": cacheControl(filePath),
  });
  createReadStream(filePath).pipe(res);
}

function cacheControl(filePath) {
  const relativePath = relative(distRoot, filePath).split(sep).join("/");
  if (relativePath === "index.html") return "no-store";
  if (
    relativePath.startsWith("assets/") &&
    /-[A-Za-z0-9_-]{8,}\.[^.]+$/.test(basename(filePath))
  ) {
    return "public, max-age=31536000, immutable";
  }
  return "no-cache";
}

const server = createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url ?? "/", "http://localhost");
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ detail: "Malformed request target" }));
    return;
  }
  if (isApiPath(url.pathname)) {
    proxyApi(req, res, url);
    return;
  }

  const assetPath = resolveAssetPath(url.pathname);
  try {
    sendFile(res, assetPath);
  } catch {
    sendFile(res, join(distRoot, "index.html"));
  }
});

server.listen(port, host, () => {
  console.log(`HVC one-origin proxy listening on http://${host}:${port}`);
});
