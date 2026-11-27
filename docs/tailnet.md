# Access Roomkit from another device

## Roomkit for macOS

1. Install Tailscale on the Mac running Roomkit and on the device you want to connect from. Sign both devices in to your tailnet. In the [tailnet DNS settings](https://login.tailscale.com/admin/dns), enable MagicDNS and HTTPS certificates.
2. Open **Settings → Remote access with Tailscale** in Roomkit on the Mac. Enter the allowed Tailscale logins, one per line, and select **Enable remote access**.
3. Copy the HTTPS URL and open it on the other device while connected to Tailscale. Keep Roomkit running and the Mac awake.

Roomkit remembers your allowed logins and uses private Tailscale Serve on HTTPS port 42142. Tailscale keeps those routes configured when you quit Roomkit. Select **Disable remote access** on the Mac to remove Roomkit’s routes.

## Source checkout

Install and sign in to Tailscale on the Mac that runs Roomkit. Enable MagicDNS and HTTPS certificates for your tailnet. Install [CLI integration](https://tailscale.com/docs/reference/tailscale-cli?tab=macos) in Tailscale Settings so the terminal that starts Roomkit can run the `tailscale` command. Sign the other device in to the same tailnet.

Replace `roomkit-host.example-tailnet.ts.net` with this Mac’s Tailscale DNS name and `planner@example.com` with your exact Tailscale login. Use a comma-separated list to allow more than one login.

Start the daemon:

```sh
PLANNER_WEB_ORIGIN='http://localhost:3210,http://127.0.0.1:3210,https://roomkit-host.example-tailnet.ts.net:8443' \
PLANNER_ALLOWED_HOSTS='roomkit-host.example-tailnet.ts.net:8443' \
PLANNER_TAILNET_LOGINS='planner@example.com' pnpm daemon
```

In a separate terminal, start the web app:

```sh
PLANNER_ALLOWED_HOSTS='roomkit-host.example-tailnet.ts.net:8443' pnpm web
```

Run `scripts/tailnet-serve.sh` and open **Settings → Remote access with Tailscale** in Roomkit. Select **Check again** and copy the HTTPS URL when Serve is configured. Open it on the other device while connected to Tailscale. Serve uses port 8443, with the web app at `/` and the daemon at `/daemon`. The daemon checks the Tailscale login and the browser origin or same-origin fetch header. Keep access on the tailnet using Serve.

Run `scripts/tailnet-serve.sh off` to remove the matching Roomkit routes. The script leaves services on port 443 alone.
