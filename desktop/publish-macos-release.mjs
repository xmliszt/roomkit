import { execFile } from "node:child_process";
import { createHash, verify } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { BlobPreconditionFailedError, put } from "@vercel/blob";
import {
  latestReleaseUrl,
  parseRelease,
  releaseVersionPattern,
} from "../marketing/roomkit/release-source.mjs";

const [mode, directory, generateAppcast] = process.argv.slice(2);
const version = process.env.ROOMKIT_VERSION;
if (!directory || !version || !releaseVersionPattern.test(version)) {
  throw new Error(
    "Provide a release directory and a three-part ROOMKIT_VERSION.",
  );
}

const dmgName = `Roomkit-${version}-arm64.dmg`;
const checksumName = `${dmgName}.sha256`;
const dmg = await readFile(join(directory, dmgName));
const checksum = await readFile(join(directory, checksumName));
const digest = hash(dmg);
if (checksum.toString().trimEnd() !== `${digest}  ${dmgName}`) {
  throw new Error("The release DMG does not match its SHA-256 checksum.");
}
const prefix = `/releases/${version}/${digest}/`;
const dmgUrl = new URL(prefix + dmgName, latestReleaseUrl).href;
const checksumUrl = `${dmgUrl}.sha256?download=1`;
const feedFile = join(directory, "appcast.xml");
const metadataFile = join(directory, "macos-release.json");
const plist = await readFile(new URL("./Info.plist", import.meta.url), "utf8");
const publicKey = plist.match(
  /<key>SUPublicEDKey<\/key>\s*<string>([^<]+)<\/string>/,
)?.[1];
if (!publicKey || Buffer.from(publicKey, "base64").length !== 32) {
  throw new Error("The desktop app needs a Sparkle Ed25519 public key.");
}
const key = {
  key: Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    Buffer.from(publicKey, "base64"),
  ]),
  format: "der",
  type: "spki",
};

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function verifySignature(bytes, signature) {
  return (
    signature && verify(null, bytes, key, Buffer.from(signature, "base64"))
  );
}

function verifyFeed(release, archive) {
  const feed = Buffer.from(release.appcast);
  const footer = release.appcast.match(
    /<!-- sparkle-signatures:\nedSignature: ([\w+/=]+)\nlength: (\d+)\n-->\s*$/,
  );
  const signedLength = Number(footer?.[2]);
  const enclosure = release.appcast.match(/<enclosure\s[^>]+>/)?.[0];
  const archiveSignature = enclosure?.match(
    /\ssparkle:edSignature="([^"]+)"/,
  )?.[1];
  if (
    signedLength !== feed.indexOf("<!-- sparkle-signatures:") ||
    !verifySignature(feed.subarray(0, signedLength), footer?.[1]) ||
    enclosure?.match(/\slength="(\d+)"/)?.[1] !== String(archive.length) ||
    !verifySignature(archive, archiveSignature)
  ) {
    throw new Error(
      "The appcast and DMG must be signed by the installed app's Sparkle key.",
    );
  }
}

async function prepare() {
  const { SPARKLE_ED_PRIVATE_KEY: privateKey, ...env } = process.env;
  if (!generateAppcast || !privateKey) {
    throw new Error("Sparkle's generate_appcast and signing key are required.");
  }
  await new Promise((resolve, reject) => {
    const child = execFile(
      generateAppcast,
      [
        "--ed-key-file",
        "-",
        "--maximum-deltas",
        "0",
        "--disable-signing-warning",
        "--download-url-prefix",
        new URL(prefix, latestReleaseUrl).href,
        "-o",
        feedFile,
        directory,
      ],
      { env, timeout: 30000 },
      (error) =>
        error
          ? reject(new Error("Sparkle appcast generation failed."))
          : resolve(),
    );
    child.stdin.on("error", reject);
    child.stdin.end(privateKey);
  });
  const appcast = await readFile(feedFile, "utf8");
  const release = parseRelease({
    version,
    dmg: dmgUrl,
    checksum: checksumUrl,
    appcast,
  });
  verifyFeed(release, dmg);
  await writeFile(metadataFile, `${JSON.stringify(release, null, 2)}\n`);
  process.stdout.write(`Prepared a signed appcast for Roomkit ${version}.\n`);
}

function compareVersions(left, right) {
  const leftParts = left.split(".").map(BigInt);
  const rightParts = right.split(".").map(BigInt);
  for (const [index, part] of leftParts.entries()) {
    if (part > rightParts[index]) return 1;
    if (part < rightParts[index]) return -1;
  }
  return 0;
}

async function fetchPublic(url, options = {}) {
  return fetch(url, { signal: AbortSignal.timeout(60000), ...options });
}

async function verifyDownload(url, bytes, contentType) {
  const current = await fetchPublic(url, { redirect: "error" });
  if (current.status === 404) {
    await put(new URL(url).pathname.slice(1), bytes, {
      access: "public",
      addRandomSuffix: false,
      contentType,
      multipart: bytes.length > 16 * 1024 * 1024,
      abortSignal: AbortSignal.timeout(180000),
    });
  } else if (
    !current.ok ||
    !Buffer.from(await current.arrayBuffer()).equals(bytes)
  ) {
    throw new Error(
      "An existing public release asset does not match this build.",
    );
  } else {
    return;
  }
  const uploaded = await fetchPublic(url, { redirect: "error" });
  if (
    !uploaded.ok ||
    !Buffer.from(await uploaded.arrayBuffer()).equals(bytes)
  ) {
    throw new Error(
      "The uploaded release asset did not pass public verification.",
    );
  }
}

async function verifyLive(release) {
  const site = "https://www.roomkit.space";
  for (let attempt = 0; attempt <= 24; attempt += 1) {
    const [feed, metadata, download, checksumResponse] =
      await Promise.allSettled([
        fetchPublic(`${site}/appcast.xml`).then(
          (response) => response.ok && response.text(),
        ),
        fetchPublic(`${site}/release.json`).then(
          (response) => response.ok && response.json(),
        ),
        fetchPublic(`${site}/downloads/Roomkit.dmg`, { redirect: "manual" }),
        fetchPublic(`${site}/downloads/Roomkit.dmg.sha256`, {
          redirect: "manual",
        }),
      ]);
    if (
      feed.status === "fulfilled" &&
      feed.value === release.appcast &&
      metadata.status === "fulfilled" &&
      metadata.value?.version === release.version &&
      metadata.value.dmg === release.dmg &&
      metadata.value.checksum === release.checksum &&
      download.status === "fulfilled" &&
      download.value.headers.get("location") === release.dmg &&
      checksumResponse.status === "fulfilled" &&
      checksumResponse.value.headers.get("location") === release.checksum
    ) {
      process.stdout.write(
        `Verified Roomkit ${release.version} on the public landing and update routes.\n`,
      );
      return;
    }
    if (attempt < 24) await delay(5000);
  }
  throw new Error(
    "The public release routes did not converge. Rerun the publish job.",
  );
}

async function readCurrentRelease() {
  const result = await fetchPublic(latestReleaseUrl, {
    redirect: "error",
    headers: {
      "Accept-Encoding": "identity",
      "Cache-Control": "no-cache",
    },
  });
  const etag = result.headers.get("etag");
  if (!result.ok || !etag || etag.startsWith("W/")) {
    throw new Error("The current release record needs a strong ETag.");
  }
  return { release: parseRelease(await result.json()), etag };
}

async function verifyCurrentAssets(current) {
  const [download, checksumDownload] = await Promise.all([
    fetchPublic(current.dmg, { redirect: "error" }),
    fetchPublic(current.checksum, { redirect: "error" }),
  ]);
  if (!download.ok || !checksumDownload.ok) {
    throw new Error("The current release DMG or checksum is missing.");
  }
  const archive = Buffer.from(await download.arrayBuffer());
  const filename = `Roomkit-${current.version}-arm64.dmg`;
  if (
    (await checksumDownload.text()).trimEnd() !==
    `${hash(archive)}  ${filename}`
  ) {
    throw new Error("The current release DMG failed checksum verification.");
  }
  verifyFeed(current, archive);
}

async function publish() {
  if (!process.env.BLOB_READ_WRITE_TOKEN)
    throw new Error("Missing release-store token.");
  const release = parseRelease(
    JSON.parse(await readFile(metadataFile, "utf8")),
  );
  if (
    release.version !== version ||
    release.dmg !== dmgUrl ||
    release.checksum !== checksumUrl ||
    release.appcast !== (await readFile(feedFile, "utf8"))
  ) {
    throw new Error(
      "The release artifact metadata does not match its contents.",
    );
  }
  verifyFeed(release, dmg);
  for (let attempt = 0; attempt <= 6; attempt += 1) {
    const { release: current, etag } = await readCurrentRelease();
    const order = compareVersions(version, current.version);
    if (order < 0) {
      throw new Error(
        "Publishing an older version would replace a newer release.",
      );
    }
    await verifyLive(current);
    if (order === 0) {
      if (
        current.dmg !== release.dmg ||
        current.checksum !== release.checksum ||
        current.appcast !== release.appcast
      ) {
        throw new Error(
          `Roomkit ${version} was published from a different build. Rerun the failed job from the original release run.`,
        );
      }
      await verifyCurrentAssets(current);
      return;
    }
    await Promise.all([
      verifyDownload(dmgUrl, dmg, "application/x-apple-diskimage"),
      verifyDownload(checksumUrl, checksum, "text/plain"),
    ]);
    try {
      await put(latestReleaseUrl.pathname.slice(1), JSON.stringify(release), {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 60,
        contentType: "application/json",
        ifMatch: etag,
        abortSignal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      if (!(error instanceof BlobPreconditionFailedError)) throw error;
      if (attempt < 6) await delay(12000);
      continue;
    }
    await verifyLive(release);
    return;
  }
  throw new Error(
    "The release record changed during publication. Rerun the publish job.",
  );
}

if (mode === "prepare") await prepare();
else if (mode === "publish") await publish();
else throw new Error("Use prepare or publish for the macOS release.");
