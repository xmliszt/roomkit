import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type RequestListener } from "node:http";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import { isPrivateAddress } from "./is-private-address.ts";
import { readPageMetadata } from "./read-page-metadata.ts";
import { safeGet } from "./safe-get.ts";
import { unfurlLinkBlock } from "./unfurl-link-block.ts";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function startServer(handler: RequestListener) {
  const server = createServer(handler).listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("no address");
  return `127.0.0.1:${address.port}`;
}

test("private, loopback and link-local addresses are private; public ones are not", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.20.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])
    expect(isPrivateAddress(address), address).toBe(true);
  for (const address of ["93.184.216.34", "2606:4700::1111", "::ffff:8.8.8.8"])
    expect(isPrivateAddress(address), address).toBe(false);
});

test("refuses a private address unless its host is allowed", async () => {
  const host = await startServer((_, response) => response.end("ok"));
  await expect(
    safeGet({
      url: `http://${host}/`,
      allowedHosts: [],
      maxBytes: 100,
      timeoutMs: 2000,
      isTruncationAllowed: true,
    }),
  ).rejects.toThrowError("private address");
  const page = await safeGet({
    url: `http://${host}/`,
    allowedHosts: [host],
    maxBytes: 100,
    timeoutMs: 2000,
    isTruncationAllowed: true,
  });
  expect(page.body.toString()).toBe("ok");
});

test("refuses a redirect from an allowed host to a private one", async () => {
  const target = await startServer((_, response) => response.end("secret"));
  const port = target.split(":").at(1);
  const host = await startServer((_, response) => {
    response.writeHead(302, { location: `http://localhost:${port}/` }).end();
  });
  await expect(
    safeGet({
      url: `http://${host}/`,
      allowedHosts: [host],
      maxBytes: 100,
      timeoutMs: 2000,
      isTruncationAllowed: true,
    }),
  ).rejects.toThrowError("private address");
});

test("cuts a page at the size limit and refuses an image over it", async () => {
  const host = await startServer((_, response) =>
    response.end("x".repeat(1000)),
  );
  const page = await safeGet({
    url: `http://${host}/`,
    allowedHosts: [host],
    maxBytes: 100,
    timeoutMs: 2000,
    isTruncationAllowed: true,
  });
  expect(page.body.byteLength).toBe(100);
  await expect(
    safeGet({
      url: `http://${host}/`,
      allowedHosts: [host],
      maxBytes: 100,
      timeoutMs: 2000,
      isTruncationAllowed: false,
    }),
  ).rejects.toThrowError("too large");
});

test("reads the OG title before the title tag and resolves the OG image", () => {
  expect(
    readPageMetadata({
      html: `<title>Plain &amp; simple</title><meta content='/a.png' property="og:image">`,
      pageUrl: new URL("https://shop.test/sofa/1"),
    }),
  ).toStrictEqual({
    title: "Plain & simple",
    imageUrl: new URL("https://shop.test/a.png"),
  });
  expect(
    readPageMetadata({
      html: `<meta property="og:title" content="Sofa &#8211; Oak"><title>x</title>`,
      pageUrl: new URL("https://shop.test/"),
    }).title,
  ).toBe("Sofa – Oak");
});

test("an out-of-range numeric entity stays as written", () => {
  expect(
    readPageMetadata({
      html: "<title>Chair &#1114112; &#x110000; &#x41;</title>",
      pageUrl: new URL("https://shop.test/"),
    }).title,
  ).toBe("Chair &#1114112; &#x110000; A");
});

test("a preview finished after its project was removed writes no image", async () => {
  const host = await startServer((request, response) => {
    if (request.url === "/a.png") {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(Buffer.from("png"));
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end('<meta property="og:image" content="/a.png"><title>A</title>');
  });
  mkdirSync(".tmp", { recursive: true });
  const projectFolder = mkdtempSync(resolve(".tmp/link-project-"));
  try {
    const block = await unfurlLinkBlock({
      block: { kind: "link", url: `http://${host}/`, domain: "shop.test" },
      projectFolder,
      allowedHosts: [host],
      logWarning: () => undefined,
    });
    expect(block).toStrictEqual({
      kind: "link",
      url: `http://${host}/`,
      domain: "shop.test",
      title: "A",
    });
    expect(existsSync(join(projectFolder, ".planner"))).toBe(false);
  } finally {
    rmSync(projectFolder, { recursive: true, force: true });
  }
});
