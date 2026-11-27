import { ClientCommandSchema } from "@planner/shared/src/protocol/client-command-schema.ts";
import { expect, test } from "@playwright/test";

test("Roomkit identity and social metadata", async ({ page, request }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Roomkit");
  await expect(
    page.getByRole("heading", { name: "Roomkit", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Make a room that feels right.", { exact: true }),
  ).toBeVisible();
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: /^(Connections|About)$/ }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Hosted 3D generation", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Voice input", { exact: true })).toHaveCount(0);
  for (const selector of [
    'meta[property="og:title"]',
    'meta[name="twitter:title"]',
  ]) {
    await expect(page.locator(`head ${selector}`)).toHaveAttribute(
      "content",
      "Roomkit",
    );
  }
  for (const selector of [
    'meta[name="description"]',
    'meta[property="og:description"]',
    'meta[name="twitter:description"]',
  ]) {
    await expect(page.locator(`head ${selector}`)).toHaveAttribute(
      "content",
      "Make a room that feels right.",
    );
  }
  await expect(page.locator('head meta[name="twitter:card"]')).toHaveAttribute(
    "content",
    "summary_large_image",
  );
  for (const selector of [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
  ]) {
    const imageUrl = await page
      .locator(`head ${selector}`)
      .getAttribute("content");
    expect(imageUrl).toMatch(/\/og-1200x630\.png$/);
    const response = await request.get(
      new URL(imageUrl ?? "", page.url()).pathname,
    );
    expect(response.ok()).toBe(true);
    const image = await response.body();
    expect(image.readUInt32BE(16)).toBe(1200);
    expect(image.readUInt32BE(20)).toBe(630);
  }
  await expect(
    page.locator('head meta[property="og:image:width"]'),
  ).toHaveAttribute("content", "1200");
  await expect(
    page.locator('head meta[property="og:image:height"]'),
  ).toHaveAttribute("content", "630");
});

test("Settings shows Tailscale Serve status and copies the private HTTPS URL", async ({
  context,
  page,
}) => {
  const host = "roomkit-host.example-tailnet.ts.net:8443";
  const url = `https://${host}`;
  let serveConfigured = true;
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.routeWebSocket(
    `ws://127.0.0.1:${process.env.PLANNER_PORT ?? "4820"}/**`,
    (socket) => {
      const server = socket.connectToServer();
      socket.onMessage((raw) => {
        const command = ClientCommandSchema.safeParse(JSON.parse(String(raw)));
        if (!command.success || command.data.type !== "tailnet.status") {
          server.send(raw);
          return;
        }
        socket.send(
          JSON.stringify({
            type: "command.ack",
            ok: true,
            requestId: command.data.requestId,
            result: {
              kind: serveConfigured ? "ready" : "serve-not-configured",
              host,
            },
          }),
        );
      });
    },
  );

  await page.goto("/settings#tailscale");
  const remoteAccess = page.locator("#tailscale");
  await expect(
    remoteAccess.getByText("Tailscale Serve is configured"),
  ).toBeVisible();
  await expect(
    remoteAccess.getByRole("textbox", { name: "Roomkit HTTPS URL" }),
  ).toHaveValue(url);
  await expect(
    page.getByRole("heading", { name: "Jobs", exact: true }),
  ).toHaveCount(0);
  await remoteAccess.getByRole("button", { name: "Copy URL" }).click();
  await expect(remoteAccess.getByText("URL copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);

  serveConfigured = false;
  await remoteAccess.getByRole("button", { name: "Check again" }).click();
  await expect(
    remoteAccess.getByText("Tailscale connected. Set up Serve to continue."),
  ).toBeVisible();
  await expect(
    remoteAccess.getByRole("button", { name: "Copy URL" }),
  ).toHaveCount(0);
  await remoteAccess.getByText("Set up access from another device").click();
  await expect(
    remoteAccess.getByText("sh scripts/tailnet-serve.sh", { exact: true }),
  ).toBeVisible();
});

test("Settings enables and disables packaged Tailscale access without a checkout", async ({
  context,
  page,
}) => {
  const url = "https://roomkit-host.example-tailnet.ts.net:42142";
  const owner = "owner@example.test";
  const guest = "guest@example.test";
  let needsHttps = true;
  let enabled = false;
  let logins = [owner];
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.routeWebSocket(
    `ws://127.0.0.1:${process.env.PLANNER_PORT ?? "4820"}/**`,
    (socket) => {
      const server = socket.connectToServer();
      socket.onMessage((raw) => {
        const command = ClientCommandSchema.safeParse(JSON.parse(String(raw)));
        if (!command.success) return server.send(raw);
        switch (command.data.type) {
          case "tailnet.enable":
            enabled = true;
            logins = command.data.logins;
            break;
          case "tailnet.disable":
            enabled = false;
            break;
          case "tailnet.status":
            break;
          default:
            return server.send(raw);
        }
        socket.send(
          JSON.stringify({
            type: "command.ack",
            ok: true,
            requestId: command.data.requestId,
            result: {
              kind: "desktop",
              state: needsHttps
                ? "needs-https"
                : enabled
                  ? "ready"
                  : "disabled",
              canDisable: enabled,
              logins,
              ...(enabled && { url }),
            },
          }),
        );
      });
    },
  );

  await page.goto("/settings#tailscale");
  const settings = page.locator("#tailscale");
  await expect(
    settings.getByRole("link", { name: "Enable HTTPS certificates" }),
  ).toBeVisible();
  await expect(
    settings.getByText("Set up access from another device"),
  ).toHaveCount(0);
  await expect(
    settings.getByRole("button", { name: "Enable remote access" }),
  ).toHaveCount(0);
  needsHttps = false;
  await settings.getByRole("button", { name: "Check again" }).click();
  const allowedLogins = settings.getByRole("textbox", {
    name: "Allowed Tailscale logins",
  });
  const enableAccess = settings.getByRole("button", {
    name: "Enable remote access",
  });
  await expect(allowedLogins).toHaveValue(owner);
  await expect(allowedLogins).toHaveAccessibleDescription(
    "Enter the login shown on each person’s Tailscale account, usually their sign-in email. Use one line per person.",
  );
  await allowedLogins.fill("");
  await expect(allowedLogins).toHaveAttribute(
    "placeholder",
    "you@example.com\nteammate@example.com",
  );
  await enableAccess.click();
  await expect(
    settings.getByText("Enter 1 to 50 Tailscale logins, one per line."),
  ).toBeVisible();
  await expect(allowedLogins).toBeFocused();
  await expect(allowedLogins).toHaveAccessibleDescription(
    /Enter 1 to 50 Tailscale logins, one per line\./,
  );
  await allowedLogins.fill(`${owner}\n${guest}`);
  await enableAccess.click();
  await expect(settings.getByText("Remote access is on.")).toBeVisible();
  await expect(
    settings.getByRole("textbox", { name: "Roomkit HTTPS URL" }),
  ).toHaveValue(url);
  await settings.getByRole("button", { name: "Copy URL" }).click();
  await expect(settings.getByText("URL copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  await page.reload();
  await expect(allowedLogins).toHaveValue(`${owner}\n${guest}`);
  await settings.getByRole("button", { name: "Disable remote access" }).click();
  await expect(settings.getByText("Remote access is off.")).toBeVisible();
  await expect(settings.getByRole("button", { name: "Copy URL" })).toHaveCount(
    0,
  );
  await expect(allowedLogins).toHaveValue(`${owner}\n${guest}`);
});
