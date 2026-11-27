export const releaseOrigin =
  "https://1gsj5xkqpdkrf2ss.public.blob.vercel-storage.com";
export const latestReleaseUrl = new URL("/releases/latest.json", releaseOrigin);
export const releaseVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseRelease(value, appcast = value?.appcast) {
  if (
    typeof value?.version !== "string" ||
    !releaseVersionPattern.test(value.version) ||
    typeof value.dmg !== "string" ||
    typeof value.checksum !== "string" ||
    typeof appcast !== "string"
  ) {
    throw new Error("Invalid macOS release metadata.");
  }
  const { version } = value;
  const filename = `Roomkit-${version}-arm64.dmg`;
  const dmg = new URL(value.dmg);
  const checksum = new URL(value.checksum);
  if (
    dmg.origin !== releaseOrigin ||
    dmg.username ||
    dmg.password ||
    dmg.search ||
    dmg.hash ||
    !dmg.pathname.startsWith(`/releases/${version}/`) ||
    !dmg.pathname.endsWith(`/${filename}`) ||
    checksum.href !== `${dmg.href}.sha256?download=1`
  ) {
    throw new Error(
      "macOS downloads must point to their release in Roomkit's public store.",
    );
  }
  const item = appcast
    .replace(/<!\[CDATA\[.*?\]\]>|<!--.*?-->/gs, "")
    .match(/<item(?:\s[^>]*)?>.*?<\/item>/s)?.[0];
  const enclosure = item?.match(/<enclosure\s[^>]+>/)?.[0];
  if (
    !item?.includes(`<sparkle:version>${version}</sparkle:version>`) ||
    enclosure?.match(/\surl="([^"]+)"/)?.[1] !== dmg.href
  ) {
    throw new Error("The first Sparkle update must match the macOS download.");
  }
  return { version, dmg: dmg.href, checksum: checksum.href, appcast };
}
