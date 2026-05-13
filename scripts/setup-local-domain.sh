#!/usr/bin/env bash
# Add a /etc/hosts entry so http://<domain>:3000 routes to the local
# JobAssist dev server. Idempotent: safe to run multiple times.
#
# Usage:
#   ./scripts/setup-local-domain.sh                 # uses jobassist.com
#   ./scripts/setup-local-domain.sh jobassist.test  # uses a custom domain
#
# To remove the entry later:
#   sudo sed -i '' '/# JobAssist local dev/d' /etc/hosts        # macOS
#   sudo sed -i      '/# JobAssist local dev/d' /etc/hosts      # Linux
set -euo pipefail

DOMAIN="${1:-jobassist.com}"
HOSTS_FILE="/etc/hosts"
ENTRY="127.0.0.1   ${DOMAIN}   # JobAssist local dev"

if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
  HOSTS_FILE="/c/Windows/System32/drivers/etc/hosts"
  echo "Detected Windows. Edit ${HOSTS_FILE} as Administrator and add:"
  echo "  ${ENTRY}"
  exit 0
fi

# Already there?
if grep -qE "^127\.0\.0\.1[[:space:]]+${DOMAIN}\b" "$HOSTS_FILE" 2>/dev/null; then
  echo "✓ ${DOMAIN} is already mapped in ${HOSTS_FILE}."
  echo ""
  echo "Open the app at: http://${DOMAIN}:3000"
  exit 0
fi

echo "About to add this line to ${HOSTS_FILE} (requires sudo):"
echo ""
echo "  ${ENTRY}"
echo ""
read -p "Continue? [y/N] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted. You can do this manually with:"
  echo "  sudo sh -c \"echo '${ENTRY}' >> ${HOSTS_FILE}\""
  exit 1
fi

echo "$ENTRY" | sudo tee -a "$HOSTS_FILE" > /dev/null

echo ""
echo "✓ Done. ${DOMAIN} now routes to 127.0.0.1."
echo ""
echo "Start the dev server:    npm run dev"
echo "Open in your browser:    http://${DOMAIN}:3000"
echo ""
echo "To undo later:"
echo "  sudo sed -i '' '/# JobAssist local dev/d' ${HOSTS_FILE}   # macOS"
echo "  sudo sed -i      '/# JobAssist local dev/d' ${HOSTS_FILE} # Linux"
