# Maintaining Roomkit

## Before publishing source

- Roomkit's first-party code and documentation use the [MIT License](../LICENSE). Confirm the license and copyright for code and documentation brought in from other projects.
- The generated landing-page room visuals and in-app sample room models are approved for public redistribution. Check redistribution rights for any new assets and keep their notices with the source. The [Duck fixture](../blender/fixtures/duck.LICENSE.md) and fonts have their own terms.
- Audit the files and Git refs you plan to publish for personal information, credentials, and private captures. Model weights are downloaded separately under their upstream terms. [Model registry](../packages/daemon/src/preflight/model-registry.json)

## GitHub settings

1. Enable squash merging and automatic deletion of merged branches. Use a descriptive PR title as the squash commit title.
2. Add a ruleset for `main`. Require a pull request, resolved review conversations, and the `Check` status from GitHub Actions after its first run. Block force pushes and deletion. Require one approval once a second maintainer is available to review the sole maintainer's PRs. [GitHub rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
3. Enable private vulnerability reporting, Dependabot alerts, and secret scanning with push protection where available. [Repository security settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-security-and-analysis-settings-for-your-repository), [Private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)

## Version and release

Use a single product tag on `main`, starting at `v0.1.0`. Workspace packages are private and use that tag for releases from source. During `0.x`, increment the minor version for features or breaking changes and the patch version for compatible fixes. Call out saved-project, configuration, and setup changes in the release notes. At `1.0.0`, document what compatibility Roomkit promises and follow SemVer for that contract. [Semantic Versioning](https://semver.org/)

1. Open a release PR that moves the applicable entries in [CHANGELOG.md](../CHANGELOG.md) from **Unreleased** to the new version.
2. After merging, confirm the intended commit on `main` passed CI. Run `pnpm test:e2e` and smoke-test a manual layout and a photo reconstruction on an Apple silicon Mac before tagging.
3. Run [Publish Roomkit for macOS](macos-release.md) from `main` with the new version. The workflow publishes the verified download and creates the `vX.Y.Z` tag and GitHub Release. Check the tag, release notes, and source archive. Fix an already published release with a new tag.

## Automation

CI runs `pnpm check` on pull requests and pushes to `main`. Dependabot opens weekly npm and GitHub Actions update PRs. Review and merge those through the same checks as other PRs.

Start the release workflow manually after the real model and Blender smoke tests run on a Mac. Add the fake-CLI browser suite to CI once it passes reliably on GitHub-hosted runners. Deploy the [landing page](landing-page.md) to Vercel at `roomkit.space`.
