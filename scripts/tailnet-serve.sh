#!/bin/sh
set -eu
export TAILSCALE_BE_CLI=1

case "${1:-}" in
  ""|off) ;;
  *)
    printf '%s\n' 'Usage: scripts/tailnet-serve.sh [off]' >&2
    exit 2
    ;;
esac

status=$(tailscale status --json)
host=$(printf '%s' "$status" | node -e '
  const status = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
  const dnsName = status.Self?.DNSName;
  if (!dnsName) {
    process.stderr.write("Tailscale did not report a DNS name for this device.\n");
    process.exit(1);
  }
  process.stdout.write(dnsName.replace(/\.$/, ""));
')

case "${1:-}" in
  "")
    tailscale serve --bg --yes --https=8443 --set-path=/ http://127.0.0.1:3210
    tailscale serve --bg --yes --https=8443 --set-path=/daemon http://127.0.0.1:4820
    printf 'https://%s:8443\n' "$host"
    ;;
  off)
    for mount in /daemon /; do
      case "$mount" in
        /daemon) target=http://127.0.0.1:4820 ;;
        /) target=http://127.0.0.1:3210 ;;
      esac
      config=$(tailscale serve status --json)
      if printf '%s' "$config" | node -e '
        const config = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
        const [host, mount, target] = process.argv.slice(1);
        const handler = config.Web?.[host]?.Handlers?.[mount];
        process.exit(handler?.Proxy === target ? 0 : 1);
      ' "$host:8443" "$mount" "$target"; then
        tailscale serve --yes --https=8443 --set-path="$mount" off
      fi
    done
    ;;
esac
