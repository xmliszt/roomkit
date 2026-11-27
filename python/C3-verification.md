# C3 verification — 2026-11-23

`scripts/machine-lock.sh c3 scripts/gate-c3.sh`: PASS. Four GLBs, zero validator
errors or warnings, each run below 900 seconds. Product input: HEKTAR floor lamp.
All four results report `sourceUp:"+Z"` and `sourceFront:"-Y"`.

| Generator | Input | Seconds | Peak RSS GB | MLX peak GB | Validator errors / warnings |
|---|---|---:|---:|---:|---:|
| trellis2 | sofa | 754.4 | 4.03 | 4.34 | 0 / 0 |
| trellis2 | product | 244.0 | 5.53 | 6.72 | 0 / 0 |
| sam3d | sofa | 562.1 | 13.67 | 9.02 | 0 / 0 |
| sam3d | product | 376.6 | 12.57 | 9.64 | 0 / 0 |

`peakMemoryGb` is the larger of RSS and MLX peak, a lower bound on combined
memory. Evidence: `/path/to/run/planner-c3/gate.json`, with requests, JSONL output, stderr,
validator reports and generated models in that directory.
The first TRELLIS sofa run began before the publication fix. Its generator
settings are unchanged; subsequent runs exercise the fixed publication path.

- `uv run --project python pytest python/tests`: 153 passed.
- Registry validation and `git diff --check`: passed.
- `pnpm check`: typecheck and lint passed, with two existing `noImgElement`
  warnings. 464 tests passed; one install test failed because it still expects
  exactly three registry models. C3 adds five entries. Its file is outside C3's
  allowed paths; permission to update the expectation was requested.

Ship: no, pending the install-test expectation update outside C3 scope.
Ratings below are severity / likelihood / blast radius, each 1–3.

| Finding | Location | Reviewer | Bucket; ratings | Resolution |
|---|---|---|---|---|
| Metrics publication failure replaced the previous GLB | `workers/generation.py` | implementation reviewer | act; 3/2/2 | Fixed with unique run directories and atomic metrics publication. Failure-before/after-publication tests pass for both workers. |
| Install test expects only three models | `../packages/daemon/src/install/install.test.ts:51` | project checks | ask; 2/3/2 | Orchestrator should permit or make the five-entry expectation update. |

The implementation reviewer found no remaining issues in round two; 153 Python
tests passed. The second model found no issues in the current diff. Its read-only
sandbox could collect the tests but could not execute them because temporary-file
and cache-lock writes were denied. The main session and implementation reviewer
ran them successfully outside that review sandbox. No findings were dismissed.

The comment pass deleted nothing. All 100 `factory diff-audit` findings were
executable Python misclassified after embedded JavaScript strings. No added
comments, docstrings, suppressions or casts remain. The shell interpreter
directive is required executable metadata.

Routine calls: require explicit `weightsDir`, following the existing worker
protocol; use HEKTAR for the product gate; register TRELLIS.2's nested sparse
decoder separately because its files come from another repository; cap both
workers' photo inputs at 1536 px. Install the sparse decoder after TRELLIS.2
when both are missing.

Integration: allow 900 seconds for generation calls; TRELLIS sofa took 754.4
seconds, above reconstruction's 600-second default. TRELLIS front verification
remains a later model-selection task, as documented in S2.
