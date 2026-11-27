# Roomkit

Use the [setup guide](README.md), [architecture](docs/PLAN.md), and [design guide](docs/DESIGN.md) when working in this repository. The schemas in `packages/shared` define persisted data and protocol contracts.

- Use temporary values for both `PLANNER_HOME` and `PLANNER_PROJECTS` in tests.
- Use the fake agents in `test/fake-cli/` for automated tests.
- Keep fixtures synthetic or explicitly cleared for redistribution.
- Run `pnpm check` and the relevant browser or worker tests before handing off a change.
- Commit and push only when asked.
