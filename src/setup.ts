/**
 * MCP Gateway Setup Script
 *
 * Reads config.yaml and fully provisions the Pi:
 *   - Clones or updates each service repo
 *   - Installs deps and builds each service
 *   - Creates systemd service files
 *   - Configures Tailscale Funnel
 *   - Starts all services
 *
 * Usage:
 *   npm run setup              # install + start everything
 *   npm run setup -- --update  # pull latest + rebuild + restart
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync, ExecSyncOptions } from "child_process";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const isUpdate = args.includes("--update");

// ============================================================
// CONFIG
// ============================================================

interface ServiceConfig {
  name: string;
  path: string;
  port: number;
  oauth_client_id: string;
  repo: string;
  dir: string;
  start: string;
  systemd_name: string;
}

interface Config {
  gateway: {
    port: number;
    public_host: string;
    base_dir: string;
    user: string;
    node_path: string;
    systemd_name: string;
  };
  services: ServiceConfig[];
}

const config = yaml.load(
  readFileSync(join(__dirname, "../config.yaml"), "utf8")
) as Config;

const { gateway, services } = config;

// ============================================================
// HELPERS
// ============================================================

function run(cmd: string, opts: ExecSyncOptions = {}) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: "inherit", ...opts });
}

function section(title: string) {
  console.log(`\n${"─".repeat(50)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(50));
}

function writeSystemdService(name: string, workingDir: string, startFile: string, envFile: string) {
  const content = [
    "[Unit]",
    `Description=${name} MCP Service`,
    "After=network.target",
    "",
    "[Service]",
    `WorkingDirectory=${workingDir}`,
    `EnvironmentFile=${envFile}`,
    `ExecStart=${gateway.node_path} ${startFile}`,
    "Restart=always",
    "RestartSec=5",
    `User=${gateway.user}`,
    "",
    "[Install]",
    "WantedBy=multi-user.target",
  ].join("\n");

  const dest = `/etc/systemd/system/${name}.service`;
  execSync(`sudo tee ${dest} > /dev/null`, {
    input: content,
    stdio: ["pipe", "inherit", "inherit"],
  });
  console.log(`  ✓ Wrote ${dest}`);
}

// ============================================================
// SETUP EACH SERVICE
// ============================================================

for (const service of services) {
  section(`Service: ${service.name}`);

  const serviceDir = join(gateway.base_dir, service.dir);
  const envFile = join(serviceDir, ".env");

  if (existsSync(serviceDir)) {
    console.log(`  Updating ${service.dir}...`);
    run("git pull", { cwd: serviceDir });
  } else {
    console.log(`  Cloning ${service.repo}...`);
    run(`git clone ${service.repo} ${serviceDir}`);
  }

  run("npm install", { cwd: serviceDir });
  run("npm run build", { cwd: serviceDir });

  if (!existsSync(envFile)) {
    console.log(`\n  ⚠️  No .env found at ${envFile}`);
    console.log(`  Create it before starting the service.`);
    console.log(`  See ${serviceDir}/.env.example for reference.\n`);
  }

  writeSystemdService(service.systemd_name, serviceDir, service.start, envFile);
}

// ============================================================
// SETUP GATEWAY
// ============================================================

section("Gateway");

const gatewayDir = join(gateway.base_dir, "mcp-gateway");
const gatewayEnv = join(gatewayDir, ".env");

run("npm install", { cwd: gatewayDir });
run("npm run build", { cwd: gatewayDir });

writeSystemdService(gateway.systemd_name, gatewayDir, "dist/index.js", gatewayEnv);

if (!existsSync(gatewayEnv)) {
  // Create a minimal .env for the gateway (no secrets needed)
  execSync(`tee ${gatewayEnv} > /dev/null`, {
    input: `PORT=${gateway.port}\nPUBLIC_HOST=${gateway.public_host}\n`,
    stdio: ["pipe", "inherit", "inherit"],
  });
  console.log(`  ✓ Created ${gatewayEnv}`);
}

// ============================================================
// TAILSCALE
// ============================================================

section("Tailscale");

run("sudo tailscale serve reset");
run(`sudo tailscale serve --bg ${gateway.port}`);
run(`sudo tailscale funnel --bg ${gateway.port}`);

// ============================================================
// SYSTEMD
// ============================================================

section("Starting services");

run("sudo systemctl daemon-reload");

// Stop all first to avoid port conflicts
for (const service of services) {
  run(`sudo systemctl stop ${service.systemd_name} 2>/dev/null || true`);
}
run(`sudo systemctl stop ${gateway.systemd_name} 2>/dev/null || true`);

// Start services, then gateway
for (const service of services) {
  run(`sudo systemctl enable ${service.systemd_name}`);
  run(`sudo systemctl start ${service.systemd_name}`);
  console.log(`  ✓ Started ${service.systemd_name}`);
}

run(`sudo systemctl enable ${gateway.systemd_name}`);
run(`sudo systemctl start ${gateway.systemd_name}`);
console.log(`  ✓ Started ${gateway.systemd_name}`);

// ============================================================
// DONE
// ============================================================

section("Done");
console.log(`  Gateway: https://${gateway.public_host}`);
for (const s of services) {
  console.log(`  ${s.name}: https://${gateway.public_host}${s.path}`);
}
console.log();
