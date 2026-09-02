# Scripts

## `cdp-eval.js` — Live panel evaluator

Evaluate JS inside the running CEP panel via Chrome DevTools Protocol.

```bash
node scripts/cdp-eval.js "window.AGENT_TOOL_REGISTRY.tools.length"
node scripts/cdp-eval.js @scripts/some-file.js
```

## `e2e-golden.js` — E2E golden scenario test harness

Drives the AE Motion Agent panel through CDP to run end-to-end agent tasks
against a real After Effects instance, then programmatically verifies the
resulting composition state.

### Prerequisites

1. After Effects is running.
2. The AE Motion Agent panel is loaded and visible.
3. CDP debug port 8092 is open (`.debug` file in extension root).
4. An API key is configured in `config/secrets.local.js`.

### Usage

```bash
# Run all 5 golden scenarios
node scripts/e2e-golden.js

# Run a single scenario
node scripts/e2e-golden.js --scenario wiggle

# List available scenarios
node scripts/e2e-golden.js --list

# Override the agent model
node scripts/e2e-golden.js --model zai-org/GLM-4.7

# Custom agent timeout (seconds)
node scripts/e2e-golden.js --timeout 300
```

### Scenarios

| Name       | Description                                              |
|------------|----------------------------------------------------------|
| wiggle     | Add wiggle(3,25) to Position of a named layer            |
| spin       | Continuous rotation via time expression                  |
| fade       | Auto fade in/out expression on Opacity                   |
| typewriter | Typewriter text reveal on Source Text                    |
| popin      | Scale 0-to-100 pop-in with spring overshoot              |

### Output

- Per-scenario PASS/FAIL with individual check details and duration.
- Summary table with token usage.
- JSON report written to `scripts/e2e-report-<timestamp>.json` (gitignored).
- Exit code 0 on all-pass, 1 on any failure.

### Notes

- Each scenario creates layers prefixed `E2E-` and cleans them up on teardown.
- A dedicated `E2E-TestComp` composition is created at the start.
- The harness talks to `AGENT_TOOL_LOOP` directly, bypassing the panel UI.
- Agent runs are sequential; the panel must be idle between scenarios.
- Agent calls use real LLM API tokens. A full suite run typically takes 3-8
  minutes and costs ~20-50k tokens depending on the model.

## `eval-corpus.js` — behaviour eval corpus (pass-rate, not vibes)

Runs a fixed corpus of human-style Russian requests (`eval-cases.js`, 21 cases) against the REAL agent loop in a running AE and checks the resulting comp state semantically. Every case gets a fresh fixture in the `Eval-Comp` composition, one or more agent turns (plan + verify + scene diff wired exactly like `main.js`), a structural probe (values at times, comp-space positions, keyframe/expression info, switches, colors, text) and pure check functions. Checks test observable outcomes, never the method — keyframes and expressions both pass.

### Usage

```bash
# full corpus (≈ 10–20 min, real LLM calls)
node scripts/eval-corpus.js

# subset by id / tag / count
node scripts/eval-corpus.js --only fade-in,orbit-faster
node scripts/eval-corpus.js --tag guard
node scripts/eval-corpus.js --limit 5

# A/B the harness: plan-first turn, verify turn and tool gating on/off
node scripts/eval-corpus.js --plan off --verify off
node scripts/eval-corpus.js --gating on

# another model, and a regression comparison against an earlier report
node scripts/eval-corpus.js --model MiniMaxAI/MiniMax-M2.5 --compare scripts/eval-report-<ts>.json
```

### Output

Console: per-case PASS/FAIL lines with measured details, the tool chain, tokens, seconds and the scene diff; a summary with pass-rate per tag. JSON report `scripts/eval-report-<timestamp>.json` (gitignored) carries `meta` (model, `planTurn`/`verifyTurn`, `promptHash` = sha1 of `agentSystemPrompt.js` + `toolRegistry.js`, `gitRev`), every case with its checks, calls, failed calls, usage, plan text, diff text and final answer, and `summary` (cases, checks, tokens, time, byTag).

### Adding a case

Add an entry to `cases` in `eval-cases.js`: `{ id, tags, fixture, prompt, sampleTimes?, preProbe?, checks(after, before, run) }` — `after`/`before` are probe states (see `probeState` in the runner), `run` has `content`, `toolCallLog`, `diffText`, `plan`, `usage`. Reuse a fixture or add one to `fixtures` (ExtendScript ES3 inside `fx(...)`; helpers `circle`, `solid`, `pos`). Multi-turn cases use `turns: [{ prompt, checks }]` with shared history.
