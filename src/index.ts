/**
 * MCP Gateway
 *
 * Reads config.yaml at startup and dynamically:
 *   - Handles OAuth discovery and routing for all services via a single /authorize endpoint
 *   - Proxies MCP requests to the appropriate backend service
 *
 * To add a new MCP server: add an entry to config.yaml and restart.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { request as httpRequest } from "http";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================
// CONFIG
// ============================================================

interface ServiceConfig {
  name: string;
  path: string;
  port: number;
  oauth_client_id: string;
}

interface Config {
  gateway: {
    port: number;
    public_host: string;
  };
  services: ServiceConfig[];
}

const config = yaml.load(
  readFileSync(join(__dirname, "../config.yaml"), "utf8")
) as Config;

const PORT = config.gateway.port;
const PUBLIC_HOST = process.env.PUBLIC_HOST ?? config.gateway.public_host;

function getBase(req: express.Request) {
  return `https://${PUBLIC_HOST || req.get("host")}`;
}

function findServiceByClientId(client_id: string): ServiceConfig | undefined {
  return config.services.find((s) => s.oauth_client_id === client_id);
}

function discoveryResponse(base: string, issuer: string) {
  return {
    issuer,
    // Always point to the gateway's own authorize/token so it can route by client_id
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/oauth/token`,
    grant_types_supported: ["authorization_code"],
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
  };
}

// ============================================================
// APP
// ============================================================

const app = express();

// ── Health ───────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    services: config.services.map((s) => ({
      name: s.name,
      path: s.path,
      port: s.port,
    })),
  });
});

// ── OAuth discovery ──────────────────────────────────────────
// Root discovery (used by claude.ai for all services)

app.get("/.well-known/oauth-authorization-server", (req, res) => {
  const base = getBase(req);
  res.json(discoveryResponse(base, base));
});

// Per-service discovery (RFC 8414 path format)
for (const service of config.services) {
  if (service.path !== "/") {
    app.get(`/.well-known/oauth-authorization-server${service.path}`, (req, res) => {
      const base = getBase(req);
      res.json(discoveryResponse(base, `${base}${service.path}`));
    });
  }
}

// ── OAuth authorize ──────────────────────────────────────────
// Routes to the right service based on client_id query param

app.get("/authorize", (req, res) => {
  const client_id = req.query.client_id as string;
  const service = findServiceByClientId(client_id);
  if (!service) {
    res.status(401).json({ error: "invalid_client", error_description: `Unknown client_id: ${client_id}` });
    return;
  }
  const params = new URLSearchParams(req.query as Record<string, string>);
  const proxyReq = httpRequest(
    { hostname: "localhost", port: service.port, path: `/authorize?${params}`, method: "GET" },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode!, proxyRes.headers as any);
      proxyRes.pipe(res);
    }
  );
  proxyReq.on("error", (err) => {
    console.error("Authorize proxy error:", err);
    if (!res.headersSent) res.status(502).json({ error: "Bad Gateway" });
  });
  proxyReq.end();
});

// ── OAuth token ──────────────────────────────────────────────
// Routes to the right service based on client_id in body

app.post("/oauth/token", async (req, res) => {
  // Read raw body so we can forward it intact
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    const params = new URLSearchParams(body);
    const client_id = params.get("client_id") ?? "";
    const service = findServiceByClientId(client_id);
    if (!service) {
      res.status(401).json({ error: "invalid_client", error_description: `Unknown client_id: ${client_id}` });
      return;
    }
    try {
      const response = await fetch(`http://localhost:${service.port}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (err) {
      console.error("Token proxy error:", err);
      res.status(502).json({ error: "Bad Gateway" });
    }
  });
});

// ── MCP proxy routes ─────────────────────────────────────────
// Sort longest path first so /github matches before /

const sorted = [...config.services].sort((a, b) => b.path.length - a.path.length);

for (const service of sorted) {
  const proxyOptions =
    service.path === "/"
      ? { target: `http://localhost:${service.port}`, changeOrigin: true }
      : {
          target: `http://localhost:${service.port}`,
          changeOrigin: true,
          pathRewrite: { [`^${service.path}`]: "" },
        };

  app.use(service.path, createProxyMiddleware(proxyOptions));
}

// ── Start ────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`MCP Gateway running on port ${PORT}`);
  console.log(`Public host: ${PUBLIC_HOST}`);
  for (const s of config.services) {
    console.log(`  ${s.name}: ${s.path} → localhost:${s.port}`);
  }
});

process.on("unhandledRejection", (reason) => console.error("Unhandled rejection:", reason));
process.on("uncaughtException", (err) => console.error("Uncaught exception:", err));
