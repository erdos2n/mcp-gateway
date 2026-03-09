#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Building setup script..."
npm install
npm run build

echo "Running setup..."
node dist/setup.js "$@"
