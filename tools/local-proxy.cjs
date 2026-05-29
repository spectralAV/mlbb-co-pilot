#!/usr/bin/env node

const http = require("node:http");
const net = require("node:net");

const DEFAULT_HOSTNAMES = ["mlbb.local", "api.mlbb.local", "obs.mlbb.local"];

function numberFromEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

function csvFromEnv(value, fallback) {
  const entries = (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return entries.length ? Array.from(new Set(entries)) : fallback;
}

const listenHost = process.env.LOCAL_PROXY_HOST ?? "127.0.0.1";
const listenPort = numberFromEnv(process.env.LOCAL_PROXY_PORT, 80);
const frontendPort = numberFromEnv(process.env.FRONTEND_PORT, 5173);
const backendPort = numberFromEnv(process.env.BACKEND_PORT ?? process.env.PORT, 8787);
const hostnames = csvFromEnv(process.env.LOCAL_DNS_HOSTNAMES, DEFAULT_HOSTNAMES);
const apiHostname = hostnames.find((hostname) => hostname.startsWith("api.")) ?? hostnames[0];

function hostnameFromHeader(hostHeader) {
  return String(hostHeader ?? "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
}

function isKnownHostname(hostname) {
  return hostnames.includes(hostname) || hostname === "localhost" || hostname === "127.0.0.1";
}

function routeFor(req) {
  const hostname = hostnameFromHeader(req.headers.host);
  if (!isKnownHostname(hostname)) return null;

  const path = req.url ?? "/";
  const backendPath = path === "/api" || path.startsWith("/api/") || path === "/ws" || path.startsWith("/ws/");
  const useBackend = hostname === apiHostname || backendPath;

  return {
    name: useBackend ? "backend" : "frontend",
    host: "127.0.0.1",
    port: useBackend ? backendPort : frontendPort
  };
}

function proxyHttp(req, res) {
  const target = routeFor(req);
  if (!target) {
    res.writeHead(421, { "content-type": "text/plain; charset=utf-8" });
    res.end("Unknown local DNS hostname. Check LOCAL_DNS_HOSTNAMES and the Windows hosts file.\n");
    return;
  }

  const headers = { ...req.headers };
  delete headers["proxy-connection"];
  headers["x-forwarded-host"] = req.headers.host ?? "";
  headers["x-forwarded-proto"] = "http";
  headers["x-forwarded-for"] = req.socket.remoteAddress ?? "";

  const proxyReq = http.request(
    {
      host: target.host,
      port: target.port,
      method: req.method,
      path: req.url,
      headers
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.statusMessage, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("error", (error) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    }
    res.end(`MLBB local proxy could not reach ${target.name} at http://${target.host}:${target.port}.\n${error.message}\n`);
  });

  req.pipe(proxyReq);
}

function rawHeaderLines(req) {
  if (!req.rawHeaders.length) return "";
  let lines = "";
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    lines += `${req.rawHeaders[index]}: ${req.rawHeaders[index + 1]}\r\n`;
  }
  return lines;
}

function failUpgrade(socket, statusCode, message) {
  socket.write(`HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function proxyUpgrade(req, socket, head) {
  const target = routeFor(req);
  if (!target) {
    failUpgrade(socket, 421, "Misdirected Request");
    return;
  }

  const targetSocket = net.connect(target.port, target.host);
  let connected = false;

  targetSocket.once("connect", () => {
    connected = true;
    targetSocket.write(`${req.method ?? "GET"} ${req.url ?? "/"} HTTP/${req.httpVersion}\r\n`);
    targetSocket.write(rawHeaderLines(req));
    targetSocket.write("\r\n");
    if (head.length) targetSocket.write(head);
    socket.pipe(targetSocket).pipe(socket);
  });

  targetSocket.once("error", () => {
    if (!connected) failUpgrade(socket, 502, "Bad Gateway");
    socket.destroy();
  });

  socket.once("error", () => targetSocket.destroy());
}

const server = http.createServer(proxyHttp);
server.on("upgrade", proxyUpgrade);
server.on("error", (error) => {
  if (error.code === "EACCES") {
    console.error(`Cannot listen on ${listenHost}:${listenPort}. Run the local proxy from an elevated PowerShell or set LOCAL_PROXY_PORT to a high port.`);
  } else if (error.code === "EADDRINUSE") {
    console.error(`Cannot listen on ${listenHost}:${listenPort}. Another process is already using that port.`);
  } else {
    console.error(error);
  }
  process.exit(1);
});

server.listen(listenPort, listenHost, () => {
  console.log(`MLBB local proxy listening on http://${listenHost}:${listenPort}`);
  console.log(`frontend -> http://127.0.0.1:${frontendPort}`);
  console.log(`backend  -> http://127.0.0.1:${backendPort}`);
  for (const hostname of hostnames) {
    console.log(`http://${hostname}`);
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
