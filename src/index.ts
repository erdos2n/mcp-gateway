/**
 * MCP Gateway
 *
 * Single entry point for all MCP servers behind Tailscale Funnel.
 * Handles OAuth discovery and proxies to individual MCP services.
 *
 * Services:
 *   Meticulous MCP  →  http://localhost:3001  (root path)
 *   GitHub MCP      →  http://localhost:47891 (/github path)
 *
 * Environment variables:
 *   PORT            - HTTP port to listen on (default: 3000)
 *   PUBLIC_HOST     - Public hostname e.g. mcp-gateway.tail401b7f.ts.net
 */

import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const PUBLIC_HOST = process.env.PUBLIC_HOST ?? "";

const app = express();

// ============================================================
// OAUTH DISCOVERY DOCUMENTS
// Generated here so each MCP service stays unaware of routing
// ============================================================

app.get("/.well-known/oauth-authorization-server", (req, res) => {
  const base = PUBLIC_HOST ? `https://${PUBLIC_HOST}` : `https://${req.get("host")}`;
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/oauth/token`,
    grant_types_supported: ["authorization_code"],
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
  });
});

app.get("/.well-known/oauth-authorization-server/github", (req, res) => {
  const base = PUBLIC_HOST ? `https://${PUBLIC_HOST}` : `https://${req.get("host")}`;
  res.json({
    issuer: `${base}/github`,
    authorization_endpoint: `${base}/github/authorize`,
    token_endpoint: `${base}/github/oauth/token`,
    grant_types_supported: ["authorization_code"],
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
  });
});

// ============================================================
// HEALTH CHECK
// ============================================================

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// ============================================================
// PROXY — /github/* → GitHub MCP (port 47891)
// Strip the /github prefix before forwarding
// ============================================================

app.use(
  "/github",
  createProxyMiddleware({
    target: "http://localhost:47891",
    changeOrigin: true,
    pathRewrite: { "^/github": "" },
  })
);

// ============================================================
// PROXY — /* → Meticulous MCP (port 3001)
// ============================================================

app.use(
  "/",
  createProxyMiddleware({
    target: "http://localhost:3001",
    changeOrigin: true,
  })
);

app.listen(PORT, () => {
  console.log(`MCP Gateway running on port ${PORT}`);
  console.log(`Public host: ${PUBLIC_HOST || "(using request host)"}`);
});

process.on("unhandledRejection", (reason) => console.error("Unhandled rejection:", reason));
process.on("uncaughtException", (err) => console.error("Uncaught exception:", err));
