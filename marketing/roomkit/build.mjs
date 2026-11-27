import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";
import { parseRelease } from "./release-source.mjs";

const source = import.meta.dirname;
const output = join(source, "dist");
const appMessagesDir = join(source, "../../apps/web/src/i18n/messages");
const origin = "https://www.roomkit.space";
const fragments = /\{(\w+)\}/g;

async function readLocaleFile(name) {
  return JSON.parse(
    await readFile(join(source, "locales", `${name}.json`), "utf8"),
  );
}

function appLocaleFilename(options) {
  const locale = new Intl.Locale(options.locale);
  const fallback =
    locale.language === "zh"
      ? locale.maximize().script === "Hant"
        ? "zh-Hant"
        : "zh-Hans"
      : locale.language === "pt"
        ? "pt-BR"
        : locale.language;
  return (
    [locale.baseName, fallback]
      .map((name) => `${name}.json`)
      .find((filename) => options.files.has(filename)) ?? "en.json"
  );
}

function localePath(locale) {
  return locale === "en" ? "/" : `/${locale}/`;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderInlineCopy({ copy, app }) {
  const label = (key) => `<strong>${escapeHtml(app[key])}</strong>`;
  const settingsPath = (key) => `${label("settings.title")} → ${label(key)}`;
  const markup = {
    node: '<a href="https://nodejs.org/">Node.js 24+</a>',
    pnpm: '<a href="https://pnpm.io/installation">pnpm 10.34.9</a>',
    localhost: '<a href="http://localhost:3210">localhost:3210</a>',
    newProject: label("projects.newProject"),
    create: label("projects.create"),
    homebrew: '<a href="https://brew.sh/">Homebrew</a>',
    claude: '<a href="https://code.claude.com/docs/en/setup">Claude Code</a>',
    codex: '<a href="https://developers.openai.com/codex/cli/">Codex</a>',
    photoSettings: settingsPath("setup.title"),
    blender: "<strong>Blender</strong>",
    rebuildPhotos: label("setup.rebuildRooms"),
    startFromPhotos: label("projects.startFromPhotos"),
    tailscale: '<a href="https://tailscale.com/download">Tailscale</a>',
    magicDns:
      '<a href="https://tailscale.com/docs/features/magicdns">MagicDNS</a>',
    httpsCertificates: `<a href="https://tailscale.com/docs/how-to/set-up-https-certificates">${escapeHtml(copy.httpsCertificates)}</a>`,
    remoteSettings: settingsPath("tailnet.title"),
    checkAgain: label("tailnet.checkAgain"),
  };

  return Object.fromEntries(
    Object.entries(copy).map(([key, value]) => [
      key,
      escapeHtml(value).replaceAll(fragments, (token, fragment) =>
        Object.hasOwn(markup, fragment) ? markup[fragment] : token,
      ),
    ]),
  );
}

function placeholders(value) {
  return Array.from(value.matchAll(fragments), ([token]) => token)
    .sort()
    .join(" ");
}

function validateCopy({ locale, copy, english }) {
  for (const [key, fallback] of Object.entries(english)) {
    const translation = copy[key];
    if (
      typeof translation !== "string" ||
      !translation.trim() ||
      placeholders(translation) !== placeholders(fallback)
    ) {
      throw new Error(`${locale}: missing or invalid copy for ${key}`);
    }
  }
  for (const key of Object.keys(copy)) {
    if (!Object.hasOwn(english, key)) {
      throw new Error(`${locale}: unknown copy key ${key}`);
    }
  }
}

const [
  layout,
  installFigure,
  published,
  english,
  releaseFile,
  appcast,
  appLocales,
] = await Promise.all([
  readFile(join(source, "index.html"), "utf8"),
  readFile(join(source, "install-dmg.svg"), "utf8"),
  readLocaleFile("published"),
  readLocaleFile("en"),
  readFile(join(source, "macos-release.json"), "utf8"),
  readFile(join(source, "appcast.xml")),
  readdir(appMessagesDir),
]);
const appLocaleFiles = new Set(appLocales);
const [beforeFigure, afterFigure, ...extraFigures] = layout.split(
  "{{macInstallFigure}}",
);
if (afterFigure === undefined || extraFigures.length > 0) {
  throw new Error("The landing page needs exactly one install illustration.");
}
const template = beforeFigure + installFigure + afterFigure;
const macRelease = parseRelease(
  JSON.parse(releaseFile),
  appcast.toString("utf8"),
);
const hostedRelease = process.env.ROOMKIT_HOSTED_RELEASES === "1";
if (!Object.hasOwn(published, "en")) {
  throw new Error("Publish English at / for the x-default alternate");
}
const locales = Object.entries(published).map(([locale, name]) => {
  if (Intl.getCanonicalLocales(locale).at(0) !== locale) {
    throw new Error(`Use the canonical language tag for ${locale}`);
  }
  if (typeof name !== "string" || !name.trim()) {
    throw new Error(`${locale}: enter the language name`);
  }
  return { locale, name, path: localePath(locale) };
});
const alternates = [...locales, { locale: "x-default", path: localePath("en") }]
  .map(
    ({ locale, path }) =>
      `<link rel="alternate" hreflang="${locale}" href="${origin}${path}">`,
  )
  .join("\n    ");

const pages = await Promise.all(
  locales.map(async ({ locale, path }) => {
    const [copy, app] = await Promise.all([
      locale === "en" ? english : readLocaleFile(locale),
      readFile(
        join(
          appMessagesDir,
          appLocaleFilename({ locale, files: appLocaleFiles }),
        ),
        "utf8",
      ).then(JSON.parse),
    ]);
    validateCopy({ locale, copy, english });
    const canonical = origin + path;
    const socialImage = new URL("/assets/roomkit-social.png", origin).href;
    const languageLinks = locales
      .map(({ locale: target, name, path: href }) => {
        const current = target === locale ? ' aria-current="page"' : "";
        return `<li><a href="${href}" lang="${target}" hreflang="${target}"${current}>${escapeHtml(name)}</a></li>`;
      })
      .join("\n            ");
    const structuredData = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Roomkit",
      url: canonical,
      inLanguage: locale,
      operatingSystem: copy.operatingSystem,
      description: copy.description,
      image: socialImage,
    }).replaceAll("<", "\\u003c");
    const values = {
      ...renderInlineCopy({ copy, app }),
      macDmgUrl: hostedRelease
        ? "/downloads/Roomkit.dmg"
        : escapeHtml(macRelease.dmg),
      macChecksumUrl: hostedRelease
        ? "/downloads/Roomkit.dmg.sha256"
        : escapeHtml(macRelease.checksum),
      macVersion: hostedRelease ? "" : macRelease.version,
      macVersionHidden: hostedRelease ? " hidden" : "",
      locale,
      canonical,
      socialImage,
      alternates,
      languageLinks,
      structuredData,
    };
    const html = template.replaceAll(/\{\{(\w+)\}\}/g, (_, key) => {
      if (!Object.hasOwn(values, key)) {
        throw new Error(`Unknown template key ${key}`);
      }
      return values[key];
    });
    return { path, html };
  }),
);

const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...locales.map(({ path }) => `  <url><loc>${origin}${path}</loc></url>`),
  "</urlset>",
  "",
].join("\n");
const robots = `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`;
const files = await readdir(source);
await rm(output, { recursive: true, force: true });
await mkdir(output);
await Promise.all([
  build({
    entryPoints: [join(source, "landing-motion.jsx")],
    outfile: join(output, "landing-motion.js"),
    bundle: true,
    minify: true,
    format: "esm",
    jsx: "automatic",
    target: "es2022",
    define: { "process.env.NODE_ENV": '"production"' },
  }),
  cp(join(source, "assets"), join(output, "assets"), { recursive: true }),
  cp(join(source, "..", "..", "LICENSE"), join(output, "license.txt")),
  ...(hostedRelease ? [] : [writeFile(join(output, "appcast.xml"), appcast)]),
  ...files
    .filter((file) => file.endsWith(".css") || file.endsWith(".js"))
    .map((file) => cp(join(source, file), join(output, file))),
  writeFile(join(output, "sitemap.xml"), sitemap),
  writeFile(join(output, "robots.txt"), robots),
  ...pages.map(async ({ path, html }) => {
    const directory = join(output, path);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "index.html"), html);
  }),
]);
