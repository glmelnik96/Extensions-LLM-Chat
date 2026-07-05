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
