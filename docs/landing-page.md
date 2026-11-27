# Roomkit landing page

The static site lives in `marketing/roomkit/`. Its Node build writes the landing pages, shared assets, `robots.txt`, and `sitemap.xml` to `marketing/roomkit/dist/`. Production serves the English page at `https://www.roomkit.space/` and translations at paths such as `/zh-Hans/`.

## Preview

```sh
pnpm install --frozen-lockfile --filter @planner/landing...
node marketing/roomkit/build.mjs
python3 -m http.server 8080 --bind 127.0.0.1 --directory marketing/roomkit/dist
```

Open [the English page](http://127.0.0.1:8080/) or [the Simplified Chinese page](http://127.0.0.1:8080/zh-Hans/). Rerun the build after editing a locale, the shared template, or the motion bundle.

## Add a locale

1. Copy `marketing/roomkit/locales/en.json` to a file named for the BCP 47 language tag, such as `fr-CA.json`. Translate every value, including metadata, image descriptions and interaction feedback. Keep placeholders such as `{node}` and `{command}` intact. They can move within the sentence.
2. Add the tag and its native language name to `marketing/roomkit/locales/published.json` in your local worktree. Build and preview the page at `/<tag>/`. The build requires a complete copy file for every listed locale. It generates the language links, canonical URLs, alternates and sitemap from that list.
3. Review the page with JavaScript enabled and disabled. Keep workflow labels short enough to fit on one line at 320 px. Check keyboard language switching from an anchored section, command copying and title and description language. Keep draft locales out of the published list until the copy has been approved.

The template owns the section IDs and shell examples. Keep these in the template so every language exposes the same anchors and copies the same commands. Setup instructions use the control names from the app catalog for the page’s language.

Run `pnpm check` and `pnpm exec playwright test -c apps/web/playwright.config.ts --no-deps roomkit-landing.spec.ts` before handing off changes.

## Connect to Vercel

1. Import the Roomkit repository into a Vercel project. Set **Root Directory** to `marketing/roomkit`. The checked-in `vercel.json` runs the build and serves `dist/`.
2. Under **Settings → Domains**, set `www.roomkit.space` as the production host and redirect `roomkit.space` to it. Use the DNS records shown by Vercel.
3. After deploying, fetch `/robots.txt` and `/sitemap.xml` on the production host without signing in. Check that every sitemap URL returns HTTP 200, is allowed by robots rules, and has neither an `X-Robots-Tag: noindex` header nor a robots `noindex` directive in the HTML.
4. Check each page’s language, title, description and self-referencing canonical. Confirm that every page links back to the same set of locale URLs, with English listed as `x-default`. Inspect representative URLs in Search Console when access is available.

Follow the [macOS release guide](macos-release.md) to publish the DMG and signed update feed. Hosted pages use stable download routes and read the current version from `/release.json`. The checked-in release metadata and appcast support the standalone build.
