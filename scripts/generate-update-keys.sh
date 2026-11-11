#!/usr/bin/env bash
set -euo pipefail

echo "=========================================="
echo "API Client Reborn - Updater Key Generator"
echo "=========================================="
echo "This tool generates a Minisign ed25519 key pair for signing in-app updates."
echo ""

KEY_DIR="${HOME}/.tauri"
KEY_FILE="${KEY_DIR}/api-client-reborn.key"

mkdir -p "${KEY_DIR}"

if [ -f "${KEY_FILE}" ]; then
  read -p "Key file already exists at ${KEY_FILE}. Overwrite? (y/N) " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
  npx @tauri-apps/cli signer generate --force -w "${KEY_FILE}"
else
  npx @tauri-apps/cli signer generate -w "${KEY_FILE}"
fi

echo ""
echo "------------------------------------------------------------------"
echo "Key generation complete!"
echo "Public Key (set this in src-tauri/tauri.conf.json -> plugins.updater.pubkey):"
cat "${KEY_FILE}.pub"
echo ""
echo "Private Key (add this as GitHub Secret TAURI_SIGNING_PRIVATE_KEY):"
echo "Found at: ${KEY_FILE}"
echo "------------------------------------------------------------------"
