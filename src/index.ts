/**
 * MCP Gateway
 *
 * Reads config.yaml at startup and dynamically:
 *   - Generates OAuth discovery endpoints for each service
 *   - Proxies requests to the appropriate MCP service
 *
 * To add a new MCP server: add an entry to config.yaml and restart.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
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

// ============================================================
// APP
// ============================================================

const app = express();

// Health check — lists all registered services
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
// Per RFC 8414, for issuer https://host/path the discovery URL is:
// https://host/.well-known/oauth-authorization-server/path
// Root services use: https://host/.well-known/oauth-authorization-server

for (const service of config.services) {
  const discoveryPath =
    service.path === "/"
      ? "/.well-known/oauth-authorization-server"
      : `/.well-known/oauth-authorization-server${service.path}`;

  app.get(discoveryPath, (req, res) => {
    const base = `https://${PUBLIC_HOST || req.get("host")}`;
    const serviceBase = service.path === "/" ? base : `${base}${service.path}`;
    res.json({
      issuer: serviceBase,
      authorization_endpoint: `${serviceBase}/authorize`,
      token_endpoint: `${serviceBase}/oauth/token`,
      grant_types_supported: ["authorization_code"],
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
    });
  });
}

// ── Proxy routes ─────────────────────────────────────────────
// Sort longest path first so more specific routes match before root

const sorted = [...config.services].sort((a, b) => b.path.length - a.path.length);

for (const service of sorted) {
  const proxyOptions =
    service.path === "/"
      ? {
          target: `http://localhost:${service.port}`,
          changeOrigin: true,
        }
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
