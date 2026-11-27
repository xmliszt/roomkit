# Contributing to Roomkit

Follow the [quick start](README.md#quick-start) to run the app. The 3D editor, TypeScript checks, and fake-CLI tests work without downloading model weights.

## Make a change

1. For a substantial feature or a breaking change, open an issue first to agree on the scope. For a bug, include your environment, the steps to reproduce it, and what you expected to happen.
2. Fork the repository and branch from `main`. Keep each branch focused on one change.
3. Run `pnpm check`. For editor, settings, or capture changes, also run the relevant Playwright tests. For Python worker or Blender changes, run the relevant checks in those directories on a machine with the tools installed.
4. Open a pull request against `main`. Include the linked issue, the effect on users, and the checks you ran. Include a screenshot for a visual change when it helps explain the result.

Keep real room photos, project databases, personal paths, and tokens out of issues and commits. Use synthetic or redistributable fixtures. Tests must use temporary Roomkit storage and the fake CLIs in `test/fake-cli/`.

## Where to work

| Path | What it contains |
| --- | --- |
| `apps/web` | Next.js interface and 3D editor |
| `packages/daemon` | Local API, project storage, and job orchestration |
| `packages/shared` | Scene schemas and protocol contracts |
| `packages/mcp`, `roles` | Agent tools and role prompts |
| `python`, `blender` | Reconstruction, asset generation, and rendering |
| `marketing/roomkit` | Public landing page |

Use the [code of conduct](CODE_OF_CONDUCT.md) when participating. Send security reports through the [private reporting process](SECURITY.md).
