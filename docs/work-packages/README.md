# Work packages

These are historical work records. For current architecture and design, use the [architecture guide](../PLAN.md), [design guide](../DESIGN.md), and source code. Keep capture artifacts and evidence outside Git.

## Rules for every work-package agent

1. Read `CLAUDE.md`, `docs/PLAN.md`, `docs/DESIGN.md` and your own work-package file before you start. `docs/mock/editor-mock.html` matters for UI work only.
2. Your worktree is based on the `orchestrator` branch, which is the integration branch. Do not touch `main`. Do not merge anything; the orchestrator merges.
3. Call the `advisor` tool (Fable 5.2) before you commit to an approach, when stuck, when results do not fit the plan, and before you call the work done. If your session has no `advisor` tool, run `/advisor` and set it to `fable`. Codex agents have no advisor: make the routine call where the docs are silent, list it in your final message, and stop and report on any contract question; the orchestrator takes those to the advisor.
4. Stay inside the paths your file lists. If you need a change to a contract in `packages/shared` (scene, commands, events, jobs, chat blocks, WS or MCP protocol) that your file does not grant, stop and report it instead of guessing.
5. Tests never touch `~/.interior-planner` or `~/InteriorPlanner`. Point `PLANNER_HOME` and `PLANNER_PROJECTS` at a temp folder. Tests never call the real `claude` or `codex`.
6. The user's `~/.claude/CLAUDE.md` code rules apply. For a change over about 40 lines, run the `self-review` skill before you finish.
7. You have the user's permission to commit on your own branch. Commit when your gate passes. Do not push (there is no remote).
8. **Ports.** Several worktrees run at once. Before any gate, e2e test or dev server, set `PLANNER_PORT` and `PLANNER_WEB_PORT` to free ports (for example from `node -e "const s=require('net').createServer().listen(0,()=>{console.log(s.address().port);s.close()})"`), never the defaults 4820 and 3210.
9. **Browser tests** go in the existing suite that `pnpm test:e2e` runs (`e2e/` or `apps/web/e2e/`). Do not add a new Playwright config; if you truly need a different fake daemon, add your config to the `test:e2e` script in the same commit.
10. **Playwright browsers** are shared by every worktree. Always set `PLAYWRIGHT_SKIP_BROWSER_GC=1` when you run `playwright install`, so it does not delete browser versions other worktrees use.
11. **Not blocks:** a slow install or download, a wait for the machine lock, creating the gate script your brief names, or a small fix to an existing test that your change exposes (say what you changed in your final message). Let installs run as long as they need (raise your command timeout); a gate script named in your gate is always in your scope.
12. **Real-CLI scripts** (the ones the orchestrator runs by hand with the real `claude` or `codex`) start the daemon with the full `process.env` spread first, then the temp-folder overrides. Without `USER` and the rest of the login environment, Claude cannot read its keychain sign-in and fails with "Not logged in". Never set `CLAUDE_CONFIG_DIR` or `CODEX_HOME` in these scripts.
13. **Never stop processes by a name pattern** (`pkill -f main.ts`, `pkill node` and the like): the user's own app daemon and other projects run on this Mac. Stop only the process ids your own scripts started.
14. When done, or blocked, set the Orca card so the orchestrator sees it, then stop:
   - done: `orca worktree set --worktree active --workspace-status in-review --comment "gate passed: <one line>" --json`
   - blocked: `orca worktree set --worktree active --unread --comment "blocked: <one line>" --json`
15. Your last message states: gate command and its output summary, commits made, any routine calls you made where the docs were silent, and anything the orchestrator must decide.
