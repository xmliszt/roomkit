# Roomkit

Roomkit turns photos of a room into an editable 3D scene. Move furniture, try different finishes and lighting, and walk through the result in your browser. You can also start from room dimensions and build a layout by hand.

## Quick start

Use an Apple silicon Mac with [Node.js 24 or later](https://nodejs.org/) and [pnpm](https://pnpm.io/installation). This repo pins pnpm 10.34.9 in `package.json`.

```sh
git clone https://github.com/xmliszt/roomkit.git
cd roomkit
pnpm install --frozen-lockfile
pnpm daemon
```

In a second terminal, from the same checkout, run:

```sh
pnpm web
```

Open [http://localhost:3210](http://localhost:3210). On first launch, choose your language and select **Continue**. Choose **Open sample room** to explore the furnished editor, or create a project from room dimensions. The daemon listens on `127.0.0.1:4820`.

### Work from photos

1. Open **Settings → Set up AI and photo tools**. The guide lists tools that still need setup and shows how much space each install needs.
2. Select **Set up** beside the feature you want. Follow the [Homebrew instructions](https://brew.sh/) if Roomkit needs Homebrew for that feature. Roomkit reuses tools and model weights it already detects.
3. Complete the agent’s own sign-in, then select **Check again**. Assign the agent to all roles or choose a model for each role under **Agents**.
4. Choose **Start from photos**, add photos from several viewpoints, and enter a known dimension to set the room scale.

Room reconstruction uses MapAnything and one segmentation model, SAM 3 or SAM 2.1. SAM 3D Objects and TRELLIS.2 generate individual objects and can be installed independently. Manual editing and the sample room work without these tools.

Projects and photos are stored under `~/InteriorPlanner/projects/`. Settings, the daemon token, and downloaded weights are under `~/.interior-planner/`. To use different directories, set both `PLANNER_HOME` and `PLANNER_PROJECTS` when starting the daemon. The agent CLIs use their own sign-ins and may send prompts or images to their providers when you use agent-assisted features.

## Development

```sh
pnpm check
pnpm exec playwright install chromium
pnpm test:e2e
```

Stop the development servers before running browser tests on their default ports. The suites start test servers and use temporary project data and fake agent CLIs.

- [Contributing](CONTRIBUTING.md)
- [Security reports](SECURITY.md)
- [Access from another device](docs/tailnet.md)
- [Replay a saved project](docs/replay.md)
- [Architecture](docs/PLAN.md)
- [Design](docs/DESIGN.md)
- [Landing page](docs/landing-page.md)

- [Build and sign a macOS DMG](docs/macos-release.md)

## License

Roomkit's first-party code and documentation are available under the [MIT License](LICENSE). Third-party assets and separately downloaded model weights have their own terms.
