#!/usr/bin/env bash
# Sets up a branded local URL for JobAssist:
#   1. Adds a /etc/hosts entry mapping the chosen domain to 127.0.0.1
#   2. Generates a locally-trusted TLS cert via mkcert (REQUIRED for
#      .dev domains because Chrome / Firefox / Safari force HTTPS on
#      every .dev hostname via the HSTS preload list). The cert
#      lands in ./certs/ and the dev server picks it up
#      automatically (see scripts/dev.cjs).
#
# Usage:
#   ./scripts/setup-local-domain.sh                   # job-assist.dev (default)
#   ./scripts/setup-local-domain.sh job-assist.test   # any custom domain
#
# Idempotent: safe to run multiple times.
set -euo pipefail

DOMAIN="${1:-job-assist.dev}"
HOSTS_FILE="/etc/hosts"
ENTRY="127.0.0.1   ${DOMAIN}   # JobAssist local dev"
CERT_DIR="./certs"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
cd "$REPO_ROOT"

green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
red()    { printf '\033[31m%s\033[0m\n' "$*"; }
bold()   { printf '\033[1m%s\033[0m\n' "$*"; }

bold "Step 1/3 - Map ${DOMAIN} -> 127.0.0.1 in ${HOSTS_FILE}"

if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
  yellow "Windows detected. Add this line to C:\\Windows\\System32\\drivers\\etc\\hosts (as Administrator):"
  echo "  ${ENTRY}"
elif grep -qE "^127\.0\.0\.1[[:space:]]+${DOMAIN}\b" "$HOSTS_FILE" 2>/dev/null; then
  green "OK ${DOMAIN} already mapped."
else
  echo "About to add (requires sudo):"
  echo "  ${ENTRY}"
  echo ""
  read -p "Continue? [y/N] " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    red "Aborted by user."
    exit 1
  fi
  echo "$ENTRY" | sudo tee -a "$HOSTS_FILE" > /dev/null
  green "OK ${DOMAIN} mapped to 127.0.0.1."
fi
echo ""

bold "Step 2/3 - Generate a locally-trusted TLS cert"

if ! command -v mkcert >/dev/null 2>&1; then
  red "mkcert is not installed."
  echo ""
  echo "mkcert creates a local Certificate Authority and signs certs trusted"
  echo "by your system. Required here because .dev domains are HSTS-preloaded"
  echo "(browsers force HTTPS, no way around it)."
  echo ""
  echo "Install:"
  case "$OSTYPE" in
    darwin*)  echo "  brew install mkcert nss" ;;
    linux*)   echo "  sudo apt install libnss3-tools mkcert" ;;
    *)        echo "  See https://github.com/FiloSottile/mkcert#installation" ;;
  esac
  echo ""
  echo "Then re-run:  npm run setup-domain ${DOMAIN}"
  exit 1
fi
green "OK mkcert is installed."

echo "Ensuring the local CA is in the system trust store (may prompt for sudo)..."
mkcert -install > /dev/null 2>&1 || true
green "OK Local CA trusted."
echo ""

bold "Step 3/3 - Generate ./certs/cert.pem + ./certs/key.pem for ${DOMAIN}"

mkdir -p "$CERT_DIR"
mkcert \
  -cert-file "$CERT_DIR/cert.pem" \
  -key-file  "$CERT_DIR/key.pem" \
  "$DOMAIN" "localhost" "127.0.0.1" "::1" > /dev/null

green "OK Cert + key written to ${CERT_DIR}/"
echo ""

bold "Setup complete."
echo ""
echo "Start the dev server:    npm run dev"
echo "Open in your browser:    https://${DOMAIN}:3000"
echo "                         (dev script auto-detects ${CERT_DIR}/cert.pem"
echo "                          and switches to HTTPS - no extra flags needed)"
echo ""
echo "Notes:"
echo "  - ${DOMAIN} is a real registered TLD, but mkcert's cert is trusted only"
echo "    by your machine - the public site (if any) is unaffected."
echo "  - http://localhost:3000 keeps working as a fallback only when certs"
echo "    are NOT present; once HTTPS is active, use https://localhost:3000."
echo ""
echo "Undo:"
echo "  sudo sed -i '' '/# JobAssist local dev/d' ${HOSTS_FILE}   # macOS"
echo "  sudo sed -i      '/# JobAssist local dev/d' ${HOSTS_FILE} # Linux"
echo "  rm -rf ${CERT_DIR}                                         # remove certs"
echo "  mkcert -uninstall                                          # remove local CA"
