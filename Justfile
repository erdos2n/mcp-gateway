# MCP Gateway — task runner
# Install just: cargo install just  OR  brew install just

# Pull latest, rebuild, and restart the gateway
update:
    git pull
    npm install
    npm run build
    sudo systemctl restart mcp-gateway

# Rebuild and restart without pulling
restart:
    npm run build
    sudo systemctl restart mcp-gateway

# Restart all MCP services + gateway
restart-all:
    sudo systemctl restart meticulous-mcp
    sudo systemctl restart github-mcp
    sudo systemctl restart mcp-gateway

# Full setup from scratch (clones repos, builds, configures Tailscale, starts services)
setup:
    chmod +x setup.sh
    ./setup.sh

# Check status of all services
status:
    sudo systemctl status mcp-gateway meticulous-mcp github-mcp --no-pager

# Stream gateway logs
logs:
    journalctl -u mcp-gateway -f

# Stream meticulous logs
logs-meticulous:
    journalctl -u meticulous-mcp -f

# Stream github-mcp logs
logs-github:
    journalctl -u github-mcp -f

# Test all public endpoints
test:
    curl -s https://mcp-gateway.tail401b7f.ts.net/health | jq
    curl -s https://mcp-gateway.tail401b7f.ts.net/.well-known/oauth-authorization-server | jq
    curl -s https://mcp-gateway.tail401b7f.ts.net/.well-known/oauth-authorization-server/github | jq
